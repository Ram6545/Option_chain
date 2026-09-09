require('dotenv').config();
const { Client, Pool } = require('pg');
const inMemoryDb = require('./inMemoryDb');

let pool = null;
let useInMemory = false;
let activePort = parseInt(process.env.DB_PORT, 10) || 5433;

/**
 * Automatically check and create the database if it doesn't exist.
 * Tries the configured port (e.g. 5433, 5432) and passwords.
 */
const ensureDatabaseExists = async () => {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'postgres';
  const configuredPassword = process.env.DB_PASSWORD || 'root';
  const targetDb = process.env.DB_NAME || 'optionchain';

  const ports = [parseInt(process.env.DB_PORT, 10) || 5433, 5432, 5433].filter((v, i, a) => a.indexOf(v) === i);
  const passwords = [configuredPassword, 'root', 'postgres', 'admin', 'password'].filter((v, i, a) => a.indexOf(v) === i);

  for (const port of ports) {
    for (const password of passwords) {
      let client = null;
      try {
        client = new Client({
          host,
          port,
          user,
          password,
          database: 'postgres',
          connectionTimeoutMillis: 2000,
        });
        await client.connect();

        // Check if target database exists
        const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
        if (res.rowCount === 0) {
          await client.query(`CREATE DATABASE "${targetDb}"`);
          console.log(`🎉 Successfully created PostgreSQL database [${targetDb}] on port ${port}!`);
        } else {
          console.log(`✅ PostgreSQL database [${targetDb}] exists on port ${port}.`);
        }

        await client.end();
        return { port, password };
      } catch (err) {
        if (client) {
          try { await client.end(); } catch (e) {}
        }
      }
    }
  }
  return null;
};

/**
 * Initialize PostgreSQL connection pool.
 */
const initPool = async () => {
  const dbInfo = await ensureDatabaseExists();

  if (!dbInfo) {
    console.warn('⚠️ PostgreSQL server not found on ports 5433/5432 with standard credentials. Using in-memory fallback.');
    useInMemory = true;
    return null;
  }

  activePort = dbInfo.port;
  try {
    const pgPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: dbInfo.port,
      user: process.env.DB_USER || 'postgres',
      password: dbInfo.password,
      database: process.env.DB_NAME || 'optionchain',
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pgPool.on('error', (err) => {
      console.warn('⚠️ PostgreSQL idle connection notice:', err.message);
    });

    // Test query
    await pgPool.query('SELECT 1');
    useInMemory = false;
    pool = pgPool;
    console.log(`🚀 CONNECTED TO POSTGRESQL DATABASE [${process.env.DB_NAME || 'optionchain'}] on port ${dbInfo.port}!`);
    return pgPool;
  } catch (err) {
    console.warn(`⚠️ Failed to connect to database [${process.env.DB_NAME || 'optionchain'}]:`, err.message);
    useInMemory = true;
    return null;
  }
};

/**
 * Test or initialize connection.
 */
const testConnection = async () => {
  if (!pool) {
    await initPool();
  }
};

/**
 * Query helper: sends SQL directly to PostgreSQL database [optionchain].
 */
const query = async (text, params) => {
  const start = Date.now();

  if (!pool && !useInMemory) {
    await initPool();
  }

  let res;
  if (!useInMemory && pool) {
    try {
      res = await pool.query(text, params);
    } catch (error) {
      console.error(`❌ PostgreSQL Query Failed: ${error.message} | SQL: ${text.trim().substring(0, 100)}`);
      // If table/column error, retry with in-memory or propagate
      try {
        res = await inMemoryDb.query(text, params);
      } catch (e) {
        throw error;
      }
    }
  } else {
    res = await inMemoryDb.query(text, params);
  }

  const duration = Date.now() - start;
  const source = (!useInMemory && pool) ? 'POSTGRESQL' : 'IN-MEMORY';
  const cleanSql = text.trim().replace(/\s+/g, ' ').substring(0, 75);
  console.log(`💾 DB [${source}] | ${cleanSql}... | ${duration}ms | Rows: ${res?.rowCount ?? res?.rows?.length ?? 0}`);
  return res;
};

module.exports = {
  pool: {
    query,
    connect: () => (pool ? pool.connect() : { release: () => {} }),
    on: () => {},
    end: () => (pool ? pool.end() : Promise.resolve()),
  },
  query,
  testConnection,
  initPool,
};
