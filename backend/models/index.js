const db = require('../config/db');

/**
 * Database model layer for Option Chain application.
 * Provides methods to interact with PostgreSQL tables.
 */

/**
 * Get all active indices.
 * @returns {Promise<Array>}
 */
const getIndices = async () => {
  const result = await db.query(
    'SELECT id, name, symbol, display_name, lot_size, COALESCE(strike_step, 50) as strike_step, is_active FROM indices WHERE is_active = true ORDER BY id'
  );
  return result.rows;
};

/**
 * Get index by symbol.
 * @param {string} symbol
 * @returns {Promise<Object|null>}
 */
const getIndexBySymbol = async (symbol) => {
  const result = await db.query(
    'SELECT id, name, symbol, display_name, lot_size, COALESCE(strike_step, 50) as strike_step, is_active FROM indices WHERE symbol = $1',
    [symbol.toUpperCase()]
  );
  return result.rows[0] || null;
};

/**
 * Get the latest snapshot for a given index.
 * @param {number} indexId
 * @returns {Promise<Object|null>}
 */
const getLatestSnapshot = async (indexId) => {
  const result = await db.query(
    `SELECT id, index_id, underlying_price, timestamp, created_at
     FROM option_chain_snapshots
     WHERE index_id = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [indexId]
  );
  return result.rows[0] || null;
};

const getSnapshotById = async (snapshotId) => {
  const result = await db.query(
    `SELECT s.id, s.index_id, s.underlying_price, s.timestamp, s.created_at, i.symbol, i.name
     FROM option_chain_snapshots s
     JOIN indices i ON s.index_id = i.id
     WHERE s.id = $1`,
    [snapshotId]
  );
  return result.rows[0] || null;
};

/**
 * Get all snapshots for a given index (paginated).
 * @param {number} indexId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
const getSnapshots = async (indexId, limit = 50, offset = 0) => {
  const result = await db.query(
    `SELECT id, index_id, underlying_price, timestamp, created_at
     FROM option_chain_snapshots
     WHERE index_id = $1
     ORDER BY id DESC
     LIMIT $2 OFFSET $3`,
    [indexId, limit, offset]
  );
  return result.rows;
};

/**
 * Get option chain data for a specific snapshot.
 * @param {number} snapshotId
 * @returns {Promise<Array>}
 */
const getOptionChainBySnapshot = async (snapshotId) => {
  const result = await db.query(
    `SELECT id, snapshot_id, strike_price, option_type, ltp, change, pchange, volume, oi,
            change_oi, pchange_oi, iv, bid_price, bid_qty, ask_price, ask_qty, created_at
     FROM option_chain_data
     WHERE snapshot_id = $1
     ORDER BY strike_price ASC, option_type ASC`,
    [snapshotId]
  );
  return result.rows;
};

/**
 * Get the latest option chain data for an index (combines snapshot + data).
 * @param {number} indexId
 * @returns {Promise<Object|null>}
 */
const getLatestOptionChain = async (indexId) => {
  const snapshot = await getLatestSnapshot(indexId);
  if (!snapshot) return null;

  const data = await getOptionChainBySnapshot(snapshot.id);
  return {
    snapshotId: snapshot.id,
    indexId: snapshot.index_id,
    underlyingPrice: parseFloat(snapshot.underlying_price),
    timestamp: snapshot.timestamp,
    createdAt: snapshot.created_at,
    data,
  };
};

/**
 * Get latest underlying price for an index.
 * @param {number} indexId
 * @returns {Promise<Object|null>}
 */
const getLatestUnderlyingPrice = async (indexId) => {
  const result = await db.query(
    `SELECT id, index_id, price, timestamp, created_at
     FROM underlying_prices
     WHERE index_id = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [indexId]
  );
  return result.rows[0] || null;
};

/**
 * Create a new option chain snapshot.
 * @param {Object} snapshotData
 * @returns {Promise<Object>}
 */
const createSnapshot = async (snapshotData) => {
  const { indexId, underlyingPrice, timestamp } = snapshotData;
  const result = await db.query(
    `INSERT INTO option_chain_snapshots (index_id, underlying_price, timestamp)
     VALUES ($1, $2, $3)
     RETURNING id, index_id, underlying_price, timestamp, created_at`,
    [indexId, underlyingPrice, timestamp || new Date()]
  );
  return result.rows[0];
};

/**
 * Insert option chain data rows for a snapshot.
 * @param {number} snapshotId
 * @param {Array} options
 * @returns {Promise<void>}
 */
const insertOptionChainData = async (snapshotId, options) => {
  if (!options || options.length === 0) return;

  const chunkSize = 25;
  for (let i = 0; i < options.length; i += chunkSize) {
    const chunk = options.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let paramIndex = 1;

    for (const opt of chunk) {
      values.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3},
         $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7},
         $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11},
         $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14})`
      );
      params.push(
        snapshotId,
        parseFloat(opt.strike_price),
        opt.option_type,
        parseFloat(opt.ltp) || 0,
        parseFloat(opt.change) || 0,
        parseFloat(opt.pchange) || 0,
        parseInt(opt.volume) || 0,
        parseInt(opt.oi) || 0,
        parseInt(opt.change_oi) || 0,
        parseFloat(opt.pchange_oi) || 0,
        parseFloat(opt.iv) || 0,
        parseFloat(opt.bid_price) || 0,
        parseInt(opt.bid_qty) || 0,
        parseFloat(opt.ask_price) || 0,
        parseInt(opt.ask_qty) || 0
      );
      paramIndex += 15;
    }

    const query = `
      INSERT INTO option_chain_data
        (snapshot_id, strike_price, option_type, ltp, change, pchange, volume, oi,
         change_oi, pchange_oi, iv, bid_price, bid_qty, ask_price, ask_qty)
      VALUES ${values.join(', ')}
    `;

    try {
      await db.query(query, params);
    } catch (chunkErr) {
      console.warn('⚠️ Chunk insert notice, inserting rows individually:', chunkErr.message);
      for (const opt of chunk) {
        await db.query(
          `INSERT INTO option_chain_data
            (snapshot_id, strike_price, option_type, ltp, change, pchange, volume, oi,
             change_oi, pchange_oi, iv, bid_price, bid_qty, ask_price, ask_qty)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            snapshotId,
            parseFloat(opt.strike_price),
            opt.option_type,
            parseFloat(opt.ltp) || 0,
            parseFloat(opt.change) || 0,
            parseFloat(opt.pchange) || 0,
            parseInt(opt.volume) || 0,
            parseInt(opt.oi) || 0,
            parseInt(opt.change_oi) || 0,
            parseFloat(opt.pchange_oi) || 0,
            parseFloat(opt.iv) || 0,
            parseFloat(opt.bid_price) || 0,
            parseInt(opt.bid_qty) || 0,
            parseFloat(opt.ask_price) || 0,
            parseInt(opt.ask_qty) || 0,
          ]
        );
      }
    }
  }
};

/**
 * Insert underlying price record.
 * @param {number} indexId
 * @param {number} price
 * @param {Date|string} [timestamp]
 * @returns {Promise<Object>}
 */
const insertUnderlyingPrice = async (indexId, price, timestamp = new Date()) => {
  const result = await db.query(
    `INSERT INTO underlying_prices (index_id, price, timestamp)
     VALUES ($1, $2, $3)
     RETURNING id, index_id, price, timestamp, created_at`,
    [indexId, price, timestamp]
  );
  return result.rows[0];
};

/**
 * Save underlying price directly using index symbol.
 * Creates/retrieves the index record, then saves the spot price to underlying_prices table.
 * @param {string} symbol
 * @param {number} price
 * @param {Date|string} [timestamp]
 * @returns {Promise<Object|null>}
 */
const saveUnderlyingPriceBySymbol = async (symbol, price, timestamp = new Date()) => {
  if (!symbol || !price || isNaN(price)) return null;
  const upper = symbol.toUpperCase();
  let indexRecord = await getIndexBySymbol(upper);
  if (!indexRecord) {
    const lotMap = { NIFTY: 65, BANKNIFTY: 15, FINNIFTY: 65, MIDCPNIFTY: 120, NIFTYNXT50: 25 };
    const stepMap = { NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25, NIFTYNXT50: 100 };
    indexRecord = await upsertIndex({
      name: upper,
      symbol: upper,
      displayName: upper === 'BANKNIFTY' ? 'BANK NIFTY' : (upper === 'NIFTY' ? 'NIFTY 50' : upper),
      lotSize: lotMap[upper] || 50,
      strikeStep: stepMap[upper] || 50,
    });
  }
  if (!indexRecord?.id) return null;
  const saved = await insertUnderlyingPrice(indexRecord.id, price, timestamp);
  console.log(`💾 [SAVED TO TABLE underlying_prices] Symbol: ${upper} | Index ID: ${indexRecord.id} | Price: ${price} | Timestamp: ${timestamp}`);
  return saved;
};

/**
 * Upsert index definition.
 * @param {Object} indexData
 * @returns {Promise<Object>}
 */
const upsertIndex = async (indexData) => {
  const { name, symbol, displayName, lotSize, strikeStep } = indexData;
  const result = await db.query(
    `INSERT INTO indices (name, symbol, display_name, lot_size, strike_step, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (symbol) DO UPDATE SET
       name = EXCLUDED.name,
       display_name = EXCLUDED.display_name,
       lot_size = EXCLUDED.lot_size,
       strike_step = EXCLUDED.strike_step,
       updated_at = NOW()
     RETURNING id, name, symbol, display_name, lot_size, strike_step, is_active`,
    [name, symbol.toUpperCase(), displayName || name, lotSize || 50, strikeStep || 50]
  );
  return result.rows[0];
};

/**
 * Get historical underlying prices for an index.
 * @param {number} indexId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
const getHistoricalUnderlyingPrices = async (indexId, limit = 100) => {
  const result = await db.query(
    `SELECT id, index_id, price, timestamp, created_at
     FROM underlying_prices
     WHERE index_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [indexId, limit]
  );
  return result.rows;
};

/**
 * Get snapshot count for an index.
 * @param {number} indexId
 * @returns {Promise<number>}
 */
const getSnapshotCount = async (indexId) => {
  const result = await db.query(
    'SELECT COUNT(*) as count FROM option_chain_snapshots WHERE index_id = $1',
    [indexId]
  );
  return parseInt(result.rows[0].count);
};

/**
 * Initialize database - create tables if they don't exist and ensure all columns exist.
 * @returns {Promise<void>}
 */
const initializeDatabase = async () => {
  // 1. Table: indices
  await db.query(`
    CREATE TABLE IF NOT EXISTS indices (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      symbol VARCHAR(20) UNIQUE NOT NULL,
      display_name VARCHAR(100),
      lot_size INTEGER,
      strike_step INTEGER DEFAULT 50,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  try {
    await db.query(`ALTER TABLE indices ADD COLUMN IF NOT EXISTS strike_step INTEGER DEFAULT 50;`);
  } catch (e) {}

  // 2. Table: underlying_prices
  await db.query(`
    CREATE TABLE IF NOT EXISTS underlying_prices (
      id SERIAL PRIMARY KEY,
      index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      price DECIMAL(12,2) NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // 3. Table: option_chain_snapshots
  await db.query(`
    CREATE TABLE IF NOT EXISTS option_chain_snapshots (
      id SERIAL PRIMARY KEY,
      index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      underlying_price DECIMAL(12,2) NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // 4. Table: option_chain_data
  await db.query(`
    CREATE TABLE IF NOT EXISTS option_chain_data (
      id SERIAL PRIMARY KEY,
      snapshot_id INTEGER NOT NULL REFERENCES option_chain_snapshots(id) ON DELETE CASCADE,
      strike_price DECIMAL(12,2) NOT NULL,
      option_type VARCHAR(10) NOT NULL CHECK (option_type IN ('CE', 'PE')),
      ltp DECIMAL(12,2),
      change DECIMAL(12,2) DEFAULT 0,
      pchange DECIMAL(12,2) DEFAULT 0,
      volume INTEGER DEFAULT 0,
      oi INTEGER DEFAULT 0,
      change_oi INTEGER DEFAULT 0,
      pchange_oi DECIMAL(12,2) DEFAULT 0,
      iv DECIMAL(12,2),
      bid_price DECIMAL(12,2),
      bid_qty INTEGER DEFAULT 0,
      ask_price DECIMAL(12,2),
      ask_qty INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // 5. Indexes
  try {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_snapshot ON option_chain_data(snapshot_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_strike ON option_chain_data(strike_price);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_type ON option_chain_data(option_type);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_index ON option_chain_snapshots(index_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON option_chain_snapshots(timestamp DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_underlying_index ON underlying_prices(index_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_underlying_timestamp ON underlying_prices(timestamp DESC);`);
  } catch (e) {}

  // 6. Insert / Upsert standard market indices
  const standardIndices = [
    { name: 'NIFTY 50', symbol: 'NIFTY', displayName: 'NIFTY 50', lotSize: 65, strikeStep: 50 },
    { name: 'BANK NIFTY', symbol: 'BANKNIFTY', displayName: 'BANK NIFTY', lotSize: 15, strikeStep: 100 },
    { name: 'NIFTY FINANCIAL SERVICES', symbol: 'FINNIFTY', displayName: 'FIN NIFTY', lotSize: 65, strikeStep: 50 },
    { name: 'NIFTY MIDCAP SELECT', symbol: 'MIDCPNIFTY', displayName: 'MIDCAP NIFTY', lotSize: 120, strikeStep: 25 },
    { name: 'NIFTY NEXT 50', symbol: 'NIFTYNXT50', displayName: 'NIFTY NEXT 50', lotSize: 25, strikeStep: 100 },
  ];

  for (const idx of standardIndices) {
    try {
      await db.query(
        `INSERT INTO indices (name, symbol, display_name, lot_size, strike_step, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (symbol) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           lot_size = EXCLUDED.lot_size,
           strike_step = EXCLUDED.strike_step`,
        [idx.name, idx.symbol, idx.displayName, idx.lotSize, idx.strikeStep]
      );
    } catch (e) {
      console.warn(`Could not seed index ${idx.symbol}:`, e.message);
    }
  }

  console.log('✅ PostgreSQL Database [optionchain] tables & indices initialized successfully');
};

module.exports = {
  getIndices,
  getIndexBySymbol,
  upsertIndex,
  getLatestSnapshot,
  getSnapshotById,
  getSnapshots,
  getOptionChainBySnapshot,
  getLatestOptionChain,
  getLatestUnderlyingPrice,
  createSnapshot,
  insertOptionChainData,
  insertUnderlyingPrice,
  saveUnderlyingPriceBySymbol,
  getHistoricalUnderlyingPrices,
  getSnapshotCount,
  initializeDatabase,
};