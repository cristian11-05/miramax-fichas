import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
const { Client } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL || 'postgresql://franco_huaman_tecsup:iO2El4JvzFmf5KFnBljzvQ@sonic-wilddog-29676.j77.aws-us-east-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full';

async function migrate() {
  console.log('Iniciando DB Setup...');
  
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
        phone2 VARCHAR(50),
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
        sede VARCHAR(100),
        plan VARCHAR(100),
        cto VARCHAR(50),
        precinto VARCHAR(50),
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

    // 1b. Agregar columnas nuevas si no existen (ALTER TABLE seguro)
    console.log('Aplicando ALTER TABLE para nuevas columnas...');
    await client.query(`ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS phone2 VARCHAR(50);`);
    await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS sede VARCHAR(100);`);
    await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS plan VARCHAR(100);`);
    await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cto VARCHAR(50);`);
    await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS precinto VARCHAR(50);`);
    console.log('ALTER TABLE completado.');

  } catch (e) {
    console.error('Error in DB Setup:', e);
  } finally {
    await client.end();
  }
}

migrate();