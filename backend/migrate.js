import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
const { Client } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'data', 'db.json');

const connectionString = process.env.DATABASE_URL || 'postgresql://franco_huaman_tecsup:iO2El4JvzFmf5KFnBljzvQ@sonic-wilddog-29676.j77.aws-us-east-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

async function migrate() {
  console.log('Iniciando migración a CockroachDB...');
  
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    console.log('Conectado a la base de datos.');

    // 1. Crear tablas
    console.log('Creando tablas...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        technician_id INT
      );

      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        dni VARCHAR(20) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        district VARCHAR(100),
        reference TEXT,
        status VARCHAR(50)
      );

      CREATE TABLE IF NOT EXISTS technicians (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        dni VARCHAR(20) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        specialty VARCHAR(100),
        status VARCHAR(50),
        zone VARCHAR(100),
        vehicle VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        unit VARCHAR(50),
        stock FLOAT NOT NULL DEFAULT 0,
        min_stock FLOAT NOT NULL DEFAULT 0,
        price FLOAT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        client_id INT REFERENCES clients(id),
        technician_id INT REFERENCES technicians(id),
        service_type VARCHAR(100),
        description TEXT,
        status VARCHAR(50),
        priority VARCHAR(50),
        scheduled_at TIMESTAMP,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        initial_state VARCHAR(100),
        observations TEXT,
        technical_notes TEXT,
        signature TEXT,
        latitude FLOAT,
        longitude FLOAT
      );

      CREATE TABLE IF NOT EXISTS order_materials (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id) ON DELETE CASCADE,
        material_id INT REFERENCES materials(id),
        quantity FLOAT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS order_photos (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES orders(id) ON DELETE CASCADE,
        url TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit (
        id SERIAL PRIMARY KEY,
        at TIMESTAMP NOT NULL DEFAULT NOW(),
        user_id INT,
        user_name VARCHAR(255),
        action VARCHAR(100),
        entity VARCHAR(100),
        entity_id INT
      );
    `);
    console.log('Tablas creadas correctamente.');

    // 2. Leer db.json
    console.log('Leyendo datos de db.json...');
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    // Limpiar tablas para evitar duplicados en la migración (opcional, útil para pruebas)
    console.log('Limpiando tablas para insertar datos limpios...');
    await client.query(`
      TRUNCATE TABLE audit, order_photos, order_materials, orders, materials, technicians, clients, users CASCADE;
    `);

    // 3. Insertar datos
    console.log('Insertando Usuarios...');
    for (const u of data.users) {
      await client.query(`
        INSERT INTO users (id, name, email, password, role, technician_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [u.id, u.name, u.email, u.password, u.role, u.technicianId]);
    }

    console.log('Insertando Clientes...');
    for (const c of data.clients) {
      await client.query(`
        INSERT INTO clients (id, name, dni, phone, email, address, district, reference, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [c.id, c.name, c.dni, c.phone, c.email, c.address, c.district, c.reference, c.status]);
    }

    console.log('Insertando Técnicos...');
    for (const t of data.technicians) {
      await client.query(`
        INSERT INTO technicians (id, name, dni, phone, email, specialty, status, zone, vehicle)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [t.id, t.name, t.dni, t.phone, t.email, t.specialty, t.status, t.zone, t.vehicle]);
    }

    console.log('Insertando Materiales...');
    for (const m of data.materials) {
      await client.query(`
        INSERT INTO materials (id, code, name, category, unit, stock, min_stock, price)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [m.id, m.code, m.name, m.category, m.unit, m.stock, m.minStock, m.price]);
    }

    console.log('Insertando Órdenes...');
    for (const o of data.orders) {
      const scheduledAt = o.scheduledAt ? new Date(o.scheduledAt).toISOString() : null;
      const startedAt = o.startedAt ? new Date(o.startedAt).toISOString() : null;
      const finishedAt = o.finishedAt ? new Date(o.finishedAt).toISOString() : null;

      await client.query(`
        INSERT INTO orders (
          id, code, client_id, technician_id, service_type, description, status, priority,
          scheduled_at, started_at, finished_at, initial_state, observations, technical_notes,
          signature, latitude, longitude
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        o.id, o.code, o.clientId, o.technicianId, o.serviceType, o.description, o.status, o.priority,
        scheduledAt, startedAt, finishedAt, o.initialState, o.observations, o.technicalNotes,
        o.signature, o.latitude, o.longitude
      ]);

      // Materiales de la orden
      if (o.materials && o.materials.length > 0) {
        for (const om of o.materials) {
          await client.query(`
            INSERT INTO order_materials (order_id, material_id, quantity)
            VALUES ($1, $2, $3)
          `, [o.id, om.materialId, om.quantity]);
        }
      }

      // Fotos de la orden
      if (o.photos && o.photos.length > 0) {
        for (const url of o.photos) {
          await client.query(`
            INSERT INTO order_photos (order_id, url)
            VALUES ($1, $2)
          `, [o.id, url]);
        }
      }
    }

    console.log('Insertando Auditoría...');
    for (const a of data.audit) {
      await client.query(`
        INSERT INTO audit (id, at, user_id, user_name, action, entity, entity_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [a.id, new Date(a.at).toISOString(), a.userId, a.user, a.action, a.entity, a.entityId]);
    }

    // Actualizar secuencias
    console.log('Actualizando secuencias de IDs...');
    await client.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));`);
    await client.query(`SELECT setval('clients_id_seq', (SELECT MAX(id) FROM clients));`);
    await client.query(`SELECT setval('technicians_id_seq', (SELECT MAX(id) FROM technicians));`);
    await client.query(`SELECT setval('materials_id_seq', (SELECT MAX(id) FROM materials));`);
    await client.query(`SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));`);
    await client.query(`SELECT setval('audit_id_seq', (SELECT MAX(id) FROM audit));`);
    // order_materials y order_photos usan la secuencia normal porque no le pasamos id

    console.log('¡Migración completada exitosamente!');
  } catch (error) {
    console.error('Error durante la migración:', error);
  } finally {
    await client.end();
  }
}

migrate();
