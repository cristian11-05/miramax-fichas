import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, {recursive:true});
const PORT = Number(process.env.PORT || 4000);
const sessions = new Map();

// CockroachDB Connection
const connectionString = process.env.DATABASE_URL || 'postgresql://franco_huaman_tecsup:iO2El4JvzFmf5KFnBljzvQ@sonic-wilddog-29676.j77.aws-us-east-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';
const pool = new Pool({ connectionString });

const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
};

const body = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', c => {
    raw += c;
    if (raw.length > 15_000_000) reject(new Error('Payload demasiado grande'));
  });
  req.on('end', () => {
    if (!raw) return resolve({});
    try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido')); }
  });
  req.on('error', reject);
});

const userFromReq = req => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  return sessions.get(token) || null;
};

const auth = (req, res, role) => {
  const u = userFromReq(req);
  if (!u) {
    json(res, 401, { message: 'Sesión no válida' });
    return null;
  }
  if (role && u.role !== role) {
    json(res, 403, { message: 'No autorizado' });
    return null;
  }
  return u;
};

// Log audit action
const audit = async (user, action, entity, entityId) => {
  try {
    await pool.query(
      `INSERT INTO audit (user_id, user_name, action, entity, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [user?.id || null, user?.name || 'Sistema', action, entity, entityId]
    );
  } catch (e) {
    console.error('Audit Error:', e);
  }
};

const routes = [];
const add = (method, pattern, handler) => routes.push({ method, pattern, handler });
const match = (pattern, pathName) => {
  const a = pattern.split('/').filter(Boolean), b = pathName.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
};

// Utils
const toCamelCase = (rows) => {
  return rows.map(row => {
    const obj = {};
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, g => g[1].toUpperCase());
      obj[camel] = v;
    }
    return obj;
  });
};

const getOrderWithDetails = async (id, technicianId = null) => {
  let query = `
    SELECT o.*, c.name as client_name, t.name as technician_name 
    FROM orders o
    LEFT JOIN clients c ON o.client_id = c.id
    LEFT JOIN technicians t ON o.technician_id = t.id
    WHERE o.id = $1
  `;
  const params = [id];
  if (technicianId) {
    query += ` AND o.technician_id = $2`;
    params.push(technicianId);
  }

  const { rows } = await pool.query(query, params);
  if (rows.length === 0) return null;
  const order = toCamelCase(rows)[0];
  
  // Client object
  const clientRes = await pool.query('SELECT * FROM clients WHERE id = $1', [order.clientId]);
  order.client = clientRes.rows.length ? toCamelCase(clientRes.rows)[0] : null;

  // Technician object
  const techRes = await pool.query('SELECT * FROM technicians WHERE id = $1', [order.technicianId]);
  order.technician = techRes.rows.length ? toCamelCase(techRes.rows)[0] : null;

  // Materials Detailed
  const matRes = await pool.query(`
    SELECT om.quantity, om.material_id, m.name, m.code, m.unit 
    FROM order_materials om
    JOIN materials m ON om.material_id = m.id
    WHERE om.order_id = $1
  `, [id]);
  order.materials = toCamelCase(matRes.rows);
  order.materialsDetailed = matRes.rows.map(r => ({
    materialId: r.material_id,
    quantity: r.quantity,
    material: { id: r.material_id, name: r.name, code: r.code, unit: r.unit }
  }));

  // Photos
  const photoRes = await pool.query('SELECT url FROM order_photos WHERE order_id = $1', [id]);
  order.photos = photoRes.rows.map(r => r.url);

  return order;
};

// ----- ROUTES -----

add('GET', '/api/health', async (req, res) => json(res, 200, { ok: true, service: 'Fiberlink SIGOST API', db: 'PostgreSQL', time: new Date().toISOString() }));

add('POST', '/api/auth/login', async (req, res) => {
  const d = await body(req);
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [d.email, d.password]);
  if (rows.length === 0) return json(res, 401, { message: 'Correo o contraseña incorrectos' });
  
  const u = toCamelCase(rows)[0];
  const token = crypto.randomBytes(24).toString('hex');
  const safe = { id: u.id, name: u.name, email: u.email, role: u.role, technicianId: u.technicianId };
  sessions.set(token, safe);
  json(res, 200, { token, user: safe });
});

add('GET', '/api/me', async (req, res) => {
  const u = auth(req, res);
  if (u) json(res, 200, u);
});

add('POST', '/api/auth/logout', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  sessions.delete(token);
  json(res, 200, { ok: true });
});

add('GET', '/api/dashboard', async (req, res) => {
  if (!auth(req, res)) return;
  
  const totalRes = await pool.query('SELECT COUNT(*) as c FROM orders');
  const pendingRes = await pool.query('SELECT COUNT(*) as c FROM orders WHERE status = $1', ['Pendiente']);
  const inProgRes = await pool.query('SELECT COUNT(*) as c FROM orders WHERE status = $1', ['En proceso']);
  const compRes = await pool.query('SELECT COUNT(*) as c FROM orders WHERE status = $1', ['Finalizada']);
  const cancRes = await pool.query('SELECT COUNT(*) as c FROM orders WHERE status = $1', ['Cancelada']);
  const techRes = await pool.query("SELECT COUNT(*) as c FROM technicians WHERE status != 'Inactivo'");
  const cliRes = await pool.query('SELECT COUNT(*) as c FROM clients');
  const matRes = await pool.query('SELECT COUNT(*) as c, SUM(stock * price) as v FROM materials');
  const lowStockRes = await pool.query('SELECT COUNT(*) as c FROM materials WHERE stock <= min_stock');
  
  const techniciansRows = await pool.query('SELECT * FROM technicians');
  const recentRows = await pool.query('SELECT id FROM orders ORDER BY id DESC LIMIT 8');
  
  const recentOrders = [];
  for (const r of recentRows.rows) {
    recentOrders.push(await getOrderWithDetails(r.id));
  }

  json(res, 200, {
    totalOrders: Number(totalRes.rows[0].c),
    pending: Number(pendingRes.rows[0].c),
    inProgress: Number(inProgRes.rows[0].c),
    completed: Number(compRes.rows[0].c),
    cancelled: Number(cancRes.rows[0].c),
    activeTechnicians: Number(techRes.rows[0].c),
    clients: Number(cliRes.rows[0].c),
    lowStock: Number(lowStockRes.rows[0].c),
    inventoryValue: Number(matRes.rows[0].v || 0),
    recentOrders,
    technicians: toCamelCase(techniciansRows.rows)
  });
});

// Dynamic CRUD for clients, technicians, materials
const resources = ['clients', 'technicians', 'materials'];
for (const resource of resources) {
  add('GET', `/api/${resource}`, async (req, res) => {
    if (!auth(req, res)) return;
    const { rows } = await pool.query(`SELECT * FROM ${resource} ORDER BY id ASC`);
    json(res, 200, toCamelCase(rows));
  });
  
  add('POST', `/api/${resource}`, async (req, res) => {
    const u = auth(req, res, 'admin');
    if (!u) return;
    const d = await body(req);
    const keys = Object.keys(d);
    // Convert camelCase keys back to snake_case for the query
    const dbKeys = keys.map(k => k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`));
    const values = Object.values(d);
    const placeholders = values.map((_, i) => `$${i+1}`).join(', ');
    
    try {
      const { rows } = await pool.query(
        `INSERT INTO ${resource} (${dbKeys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      const item = toCamelCase(rows)[0];
      await audit(u, 'CREAR', resource, item.id);
      json(res, 201, item);
    } catch(e) {
      json(res, 500, { message: e.message });
    }
  });
  
  add('PATCH', `/api/${resource}/:id`, async (req, res, p) => {
    const u = auth(req, res, 'admin');
    if (!u) return;
    const d = await body(req);
    const keys = Object.keys(d);
    if (keys.length === 0) return json(res, 200, {ok: true});
    
    const dbKeys = keys.map(k => k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`));
    const values = Object.values(d);
    const setClause = dbKeys.map((k, i) => `${k} = $${i+1}`).join(', ');
    values.push(p.id);
    
    try {
      const { rows } = await pool.query(
        `UPDATE ${resource} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (rows.length === 0) return json(res, 404, { message: 'Registro no encontrado' });
      await audit(u, 'ACTUALIZAR', resource, p.id);
      json(res, 200, toCamelCase(rows)[0]);
    } catch(e) {
      json(res, 500, { message: e.message });
    }
  });

  add('DELETE', `/api/${resource}/:id`, async (req, res, p) => {
    const u = auth(req, res, 'admin');
    if (!u) return;
    try {
      const { rowCount } = await pool.query(`DELETE FROM ${resource} WHERE id = $1`, [p.id]);
      if (rowCount === 0) return json(res, 404, { message: 'Registro no encontrado' });
      await audit(u, 'ELIMINAR', resource, p.id);
      json(res, 200, { ok: true });
    } catch(e) {
      json(res, 500, { message: 'No se puede eliminar (posible restricción de integridad)' });
    }
  });
}

add('GET', '/api/orders', async (req, res) => {
  const u = auth(req, res);
  if (!u) return;
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  
  let query = 'SELECT id FROM orders WHERE 1=1';
  let params = [];
  
  if (u.role === 'technician') {
    params.push(u.technicianId);
    query += ` AND technician_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  query += ' ORDER BY id DESC';

  const { rows } = await pool.query(query, params);
  
  let out = [];
  for (const r of rows) {
    const o = await getOrderWithDetails(r.id);
    out.push(o);
  }
  
  if (q) out = out.filter(o => JSON.stringify(o).toLowerCase().includes(q));
  json(res, 200, out);
});

add('GET', '/api/orders/:id', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const o = await getOrderWithDetails(p.id, u.role === 'technician' ? u.technicianId : null);
  if (!o) return json(res, 404, { message: 'Orden no encontrada o no asignada' });
  json(res, 200, o);
});

add('POST', '/api/orders', async (req, res) => {
  const u = auth(req, res, 'admin');
  if (!u) return;
  const d = await body(req);
  
  try {
    const { rows } = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM orders`);
    const id = rows[0].next_id;
    const code = `OS-${String(id).padStart(6, '0')}`;
    await pool.query(`
      INSERT INTO orders (id, code, client_id, technician_id, service_type, description, priority, scheduled_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, code, d.clientId, d.technicianId, d.serviceType, d.description, d.priority || 'Media', d.scheduledAt, 'Pendiente']);
    
    await audit(u, 'CREAR', 'orders', id);
    json(res, 201, await getOrderWithDetails(id));
  } catch(e) {
    json(res, 500, { message: e.message });
  }
});

add('PATCH', '/api/orders/:id', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const d = await body(req);
  
  // Security check
  const check = await pool.query('SELECT technician_id FROM orders WHERE id = $1', [p.id]);
  if (check.rows.length === 0) return json(res, 404, { message: 'Orden no encontrada' });
  if (u.role === 'technician' && check.rows[0].technician_id !== u.technicianId) return json(res, 403, { message: 'No asignada' });

  const keys = Object.keys(d);
  if (keys.length > 0) {
    const dbKeys = keys.map(k => k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`));
    const values = Object.values(d);
    const setClause = dbKeys.map((k, i) => `${k} = $${i+1}`).join(', ');
    values.push(p.id);
    
    await pool.query(`UPDATE orders SET ${setClause} WHERE id = $${values.length}`, values);
  }
  await audit(u, 'ACTUALIZAR', 'orders', p.id);
  json(res, 200, await getOrderWithDetails(p.id));
});

add('POST', '/api/orders/:id/start', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const check = await pool.query('SELECT technician_id, started_at FROM orders WHERE id = $1', [p.id]);
  if (check.rows.length === 0) return json(res, 404, { message: 'Orden no encontrada' });
  if (u.role === 'technician' && check.rows[0].technician_id !== u.technicianId) return json(res, 403, { message: 'No asignada' });

  const startedAt = check.rows[0].started_at || new Date().toISOString();
  await pool.query('UPDATE orders SET status = $1, started_at = $2 WHERE id = $3', ['En proceso', startedAt, p.id]);
  await audit(u, 'INICIAR', 'orders', p.id);
  json(res, 200, await getOrderWithDetails(p.id));
});

add('POST', '/api/orders/:id/complete', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const check = await pool.query('SELECT technician_id FROM orders WHERE id = $1', [p.id]);
  if (check.rows.length === 0) return json(res, 404, { message: 'Orden no encontrada' });
  if (u.role === 'technician' && check.rows[0].technician_id !== u.technicianId) return json(res, 403, { message: 'No asignada' });

  const d = await body(req);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update order
    await client.query(`
      UPDATE orders 
      SET status = 'Finalizada', finished_at = $1, signature = COALESCE($2, signature), 
          observations = COALESCE($3, observations), technical_notes = COALESCE($4, technical_notes)
      WHERE id = $5
    `, [new Date().toISOString(), d.signature || null, d.observations || null, d.technicalNotes || null, p.id]);

    // Save materials
    if (d.materials && d.materials.length > 0) {
      await client.query('DELETE FROM order_materials WHERE order_id = $1', [p.id]); // clear existing if any
      for (const m of d.materials) {
        await client.query('INSERT INTO order_materials (order_id, material_id, quantity) VALUES ($1, $2, $3)', [p.id, m.materialId, m.quantity]);
        await client.query('UPDATE materials SET stock = GREATEST(0, stock - $1) WHERE id = $2', [m.quantity, m.materialId]);
      }
    }

    await client.query('COMMIT');
    await audit(u, 'FINALIZAR', 'orders', p.id);
    json(res, 200, await getOrderWithDetails(p.id));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    json(res, 500, { message: 'Error al finalizar orden' });
  } finally {
    client.release();
  }
});

add('POST', '/api/orders/:id/photo', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const check = await pool.query('SELECT technician_id FROM orders WHERE id = $1', [p.id]);
  if (check.rows.length === 0) return json(res, 404, { message: 'Orden no encontrada' });
  
  const d = await body(req);
  if (!d.dataUrl?.startsWith('data:image/')) return json(res, 400, { message: 'Imagen inválida' });
  
  const ext = (d.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);/)||[])[1]||'jpg';
  const file = `order-${p.id}-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(d.dataUrl.split(',')[1], 'base64'));
  const url = `/uploads/${file}`;
  
  await pool.query('INSERT INTO order_photos (order_id, url) VALUES ($1, $2)', [p.id, url]);
  await audit(u, 'AGREGAR_FOTO', 'orders', p.id);
  json(res, 200, await getOrderWithDetails(p.id));
});

add('GET', '/api/audit', async (req, res) => {
  if (!auth(req, res, 'admin')) return;
  const { rows } = await pool.query('SELECT * FROM audit ORDER BY id DESC');
  json(res, 200, toCamelCase(rows));
});

add('GET', '/api/orders/:id/pdf', async (req, res, p) => {
  const u = auth(req, res);
  if (!u) return;
  const o = await getOrderWithDetails(p.id);
  if (!o) return json(res, 404, { message: 'Orden no encontrada' });
  json(res, 200, { ok: true, message: 'PDF generado exitosamente (Simulación)', url: `/uploads/pdf_mock_${o.id}.pdf` });
});

add('POST', '/api/ai/diagnostico', async (req, res) => {
  if (!auth(req, res)) return;
  const d = await body(req);
  json(res, 200, { ok: true, diagnostico: `Análisis IA: El problema reportado "${d.sintoma||''}" suele solucionarse cambiando el conector óptico o revisando la atenuación.`, materialesRecomendados: ['Conector SC/APC', 'Patchcord'] });
});

add('POST', '/api/ocr/procesar', async (req, res) => {
  if (!auth(req, res)) return;
  json(res, 200, { ok: true, textoExtraido: { dni: '70809012', nombres: 'Juan Perez (Extraído vía OCR)', direccion: 'Av. Central 123 (Extraído)' } });
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(url.pathname));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
    return fs.createReadStream(file).pipe(res);
  }
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const params = match(r.pattern, url.pathname);
      if (params) return await r.handler(req, res, params);
    }
    json(res, 404, { message: 'Ruta no encontrada' });
  } catch (e) {
    console.error(e);
    json(res, 500, { message: e.message || 'Error interno' });
  }
});

server.listen(PORT, () => console.log(`Fiberlink SIGOST API (CockroachDB): http://localhost:${PORT}`));
