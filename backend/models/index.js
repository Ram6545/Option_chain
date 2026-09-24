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
    'SELECT id, name, symbol, display_name, lot_size, COALESCE(strike_step, 50) as strike_step, pre_market_open, is_active FROM indices WHERE is_active = true ORDER BY id'
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
    'SELECT id, name, symbol, display_name, lot_size, COALESCE(strike_step, 50) as strike_step, pre_market_open, is_active FROM indices WHERE symbol = $1',
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
  const {
    indexId,
    underlyingPrice,
    timestamp = new Date(),
    tradingDate = new Date().toISOString().slice(0, 10),
    expiryDate = null,
    status = 'ACTIVE',
    isActiveCycle = true,
    atmStrike = null,
    pcr = null,
  } = snapshotData;

  const result = await db.query(
    `INSERT INTO option_chain_snapshots 
      (index_id, underlying_price, timestamp, trading_date, expiry_date, status, is_active_cycle, atm_strike, pcr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (index_id, COALESCE(expiry_date, '1970-01-01'::date), timestamp)
     DO UPDATE SET 
       underlying_price = EXCLUDED.underlying_price,
       atm_strike = EXCLUDED.atm_strike,
       pcr = EXCLUDED.pcr
     RETURNING id, index_id, underlying_price, timestamp, trading_date, expiry_date, status, is_active_cycle, atm_strike, pcr, created_at`,
    [
      indexId,
      underlyingPrice,
      timestamp,
      tradingDate,
      expiryDate,
      status,
      isActiveCycle,
      atmStrike,
      pcr,
    ]
  );
  return result?.rows?.[0] || null;
};

/**
 * Insert option chain data rows for a snapshot.
 * @param {number} snapshotId
 * @param {Array} options
 * @returns {Promise<void>}
 */
const insertOptionChainData = async (snapshotId, options) => {
  if (!snapshotId || !options || options.length === 0) return;

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
    await db.query(`ALTER TABLE indices ADD COLUMN IF NOT EXISTS pre_market_open DECIMAL(12,2);`);
  } catch (e) {}

  // 1b. Table: pre_market_data
  await db.query(`
    CREATE TABLE IF NOT EXISTS pre_market_data (
      id SERIAL PRIMARY KEY,
      index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      pre_market_open DECIMAL(12,2) NOT NULL,
      trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
      timestamp TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_index_trade_date UNIQUE (index_id, trade_date)
    );
  `);

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

  // 3. Table: expiry_cycles
  await db.query(`
    CREATE TABLE IF NOT EXISTS expiry_cycles (
      id SERIAL PRIMARY KEY,
      index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      symbol VARCHAR(20) NOT NULL,
      cycle_start_date DATE NOT NULL,
      expiry_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      is_current BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      closed_at TIMESTAMP,
      CONSTRAINT uq_index_cycle_expiry UNIQUE (index_id, expiry_date)
    );
  `);

  // 4. Table: option_chain_snapshots
  await db.query(`
    CREATE TABLE IF NOT EXISTS option_chain_snapshots (
      id SERIAL PRIMARY KEY,
      index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
      underlying_price DECIMAL(12,2) NOT NULL,
      trading_date DATE NOT NULL DEFAULT CURRENT_DATE,
      expiry_date DATE,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      is_active_cycle BOOLEAN DEFAULT true,
      atm_strike DECIMAL(12,2),
      pcr DECIMAL(6,2),
      timestamp TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Migration: ensure new columns exist on option_chain_snapshots
  try {
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS trading_date DATE NOT NULL DEFAULT CURRENT_DATE;`);
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS expiry_date DATE;`);
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';`);
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS is_active_cycle BOOLEAN DEFAULT TRUE;`);
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS atm_strike DECIMAL(12,2);`);
    await db.query(`ALTER TABLE option_chain_snapshots ADD COLUMN IF NOT EXISTS pcr DECIMAL(6,2);`);
  } catch (e) {}

  // 5. Table: option_chain_data
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

  // 6. Indexes for high performance & historical replay
  try {
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_snapshot ON option_chain_data(snapshot_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_strike ON option_chain_data(strike_price);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_option_chain_data_type ON option_chain_data(option_type);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_chain_data_snapshot_strike ON option_chain_data(snapshot_id, strike_price ASC, option_type);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_index ON option_chain_snapshots(index_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON option_chain_snapshots(timestamp DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_date_expiry_time ON option_chain_snapshots(index_id, trading_date, expiry_date, timestamp ASC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_snapshots_active_cycle ON option_chain_snapshots(index_id, is_active_cycle) WHERE is_active_cycle = TRUE;`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_expiry_cycles_status ON expiry_cycles(index_id, status, is_current);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_underlying_index ON underlying_prices(index_id);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_underlying_timestamp ON underlying_prices(timestamp DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_pre_market_index ON pre_market_data(index_id);`);
  } catch (e) {}

  // 6. Insert / Upsert standard market indices
  const standardIndices = [
    { name: 'NIFTY 50', symbol: 'NIFTY', displayName: 'NIFTY 50', lotSize: 65, strikeStep: 50, preMarketOpen: null },
    { name: 'BANK NIFTY', symbol: 'BANKNIFTY', displayName: 'BANK NIFTY', lotSize: 15, strikeStep: 100, preMarketOpen: null },
    { name: 'NIFTY FINANCIAL SERVICES', symbol: 'FINNIFTY', displayName: 'FIN NIFTY', lotSize: 65, strikeStep: 50, preMarketOpen: null },
    { name: 'NIFTY MIDCAP SELECT', symbol: 'MIDCPNIFTY', displayName: 'MIDCAP NIFTY', lotSize: 120, strikeStep: 25, preMarketOpen: null },
    { name: 'NIFTY NEXT 50', symbol: 'NIFTYNXT50', displayName: 'NIFTY NEXT 50', lotSize: 25, strikeStep: 100, preMarketOpen: null },
  ];

  for (const idx of standardIndices) {
    try {
      await db.query(
        `INSERT INTO indices (name, symbol, display_name, lot_size, strike_step, pre_market_open, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (symbol) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           lot_size = EXCLUDED.lot_size,
           strike_step = EXCLUDED.strike_step`,
        [idx.name, idx.symbol, idx.displayName, idx.lotSize, idx.strikeStep, idx.preMarketOpen]
      );
    } catch (e) {
      console.warn(`Could not seed index ${idx.symbol}:`, e.message);
    }
  }

  console.log('✅ PostgreSQL Database [optionchain] tables & indices initialized successfully');
};

/**
 * Get pre-market open price for an index symbol.
 * Pre-market session is 9:00 AM to 9:15 AM every trading day.
 * Dynamically queries the first recorded price on opening time (between 09:00:00 and 09:15:59).
 * If no tick in 9:00-9:15 today, checks earliest tick today (>= 09:00),
 * or most recent trading day's opening price, or earliest available snapshot price.
 * Never uses static hardcoded 23410.
 *
 * @param {string} symbol
 * @returns {Promise<number|null>}
 */
const getPreMarketOpen = async (symbol, targetDate = null) => {
  const upper = (symbol || 'NIFTY').toUpperCase();
  const index = await getIndexBySymbol(upper);
  if (!index) return null;

  try {
    // 1. Resolve trading date: targetDate if given, otherwise the latest available trading date in snapshots/underlying_prices
    let dateFilter = targetDate;
    if (!dateFilter) {
      const latestDateRes = await db.query(
        `SELECT (timestamp AT TIME ZONE 'Asia/Kolkata')::date as trade_date
         FROM option_chain_snapshots
         WHERE index_id = $1
         ORDER BY timestamp DESC
         LIMIT 1`,
        [index.id]
      );
      if (latestDateRes.rows.length > 0 && latestDateRes.rows[0].trade_date) {
        dateFilter = latestDateRes.rows[0].trade_date;
      }
    }

    // 2. Query option_chain_snapshots for the first price at or after 09:15:00 IST on that trading day
    const snap915Res = await db.query(
      `SELECT underlying_price, timestamp FROM option_chain_snapshots
       WHERE index_id = $1
         ${dateFilter ? `AND (timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2` : ''}
         AND (timestamp AT TIME ZONE 'Asia/Kolkata')::time >= '09:15:00'
       ORDER BY timestamp ASC
       LIMIT 1`,
      dateFilter ? [index.id, dateFilter] : [index.id]
    );
    if (snap915Res.rows.length > 0 && snap915Res.rows[0].underlying_price) {
      const openPrice = parseFloat(snap915Res.rows[0].underlying_price);
      if (openPrice > 0) return openPrice;
    }

    // 3. Query underlying_prices for the first price at or after 09:15:00 IST on that trading day
    const price915Res = await db.query(
      `SELECT price, timestamp FROM underlying_prices
       WHERE index_id = $1
         ${dateFilter ? `AND (timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2` : ''}
         AND (timestamp AT TIME ZONE 'Asia/Kolkata')::time >= '09:15:00'
       ORDER BY timestamp ASC
       LIMIT 1`,
      dateFilter ? [index.id, dateFilter] : [index.id]
    );
    if (price915Res.rows.length > 0 && price915Res.rows[0].price) {
      const openPrice = parseFloat(price915Res.rows[0].price);
      if (openPrice > 0) return openPrice;
    }

    // 4. Check if opening price was recorded in pre_market_data for this trade date
    const preMarketRes = await db.query(
      `SELECT pre_market_open FROM pre_market_data
       WHERE index_id = $1
         ${dateFilter ? `AND trade_date = $2` : ''}
       ORDER BY id DESC
       LIMIT 1`,
      dateFilter ? [index.id, dateFilter] : [index.id]
    );
    if (preMarketRes.rows.length > 0 && preMarketRes.rows[0].pre_market_open) {
      const openPrice = parseFloat(preMarketRes.rows[0].pre_market_open);
      if (openPrice > 0) return openPrice;
    }

    // 5. Earliest snapshot recorded on that trade date
    const earliestSnapRes = await db.query(
      `SELECT underlying_price FROM option_chain_snapshots
       WHERE index_id = $1
         ${dateFilter ? `AND (timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2` : ''}
       ORDER BY timestamp ASC
       LIMIT 1`,
      dateFilter ? [index.id, dateFilter] : [index.id]
    );
    if (earliestSnapRes.rows.length > 0 && earliestSnapRes.rows[0].underlying_price) {
      const openPrice = parseFloat(earliestSnapRes.rows[0].underlying_price);
      if (openPrice > 0) return openPrice;
    }

    // 6. Earliest underlying_prices recorded on that trade date
    const earliestPriceRes = await db.query(
      `SELECT price FROM underlying_prices
       WHERE index_id = $1
         ${dateFilter ? `AND (timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2` : ''}
       ORDER BY timestamp ASC
       LIMIT 1`,
      dateFilter ? [index.id, dateFilter] : [index.id]
    );
    if (earliestPriceRes.rows.length > 0 && earliestPriceRes.rows[0].price) {
      const openPrice = parseFloat(earliestPriceRes.rows[0].price);
      if (openPrice > 0) return openPrice;
    }
  } catch (e) {
    console.warn('⚠️ Error in getPreMarketOpen:', e.message);
  }

  return null;
};

/**
 * Upsert pre-market open price for an index symbol.
 * @param {string} symbol
 * @param {number} preMarketOpen
 * @param {string} [tradeDate]
 * @returns {Promise<Object|null>}
 */
const upsertPreMarketOpen = async (symbol, preMarketOpen, tradeDate = new Date().toISOString().slice(0, 10)) => {
  const upper = symbol.toUpperCase();
  const index = await getIndexBySymbol(upper);
  if (!index) return null;

  const price = parseFloat(preMarketOpen);
  if (isNaN(price)) return null;

  try {
    await db.query(
      `UPDATE indices SET pre_market_open = $1, updated_at = NOW() WHERE id = $2`,
      [price, index.id]
    );
  } catch (e) {}

  try {
    const result = await db.query(
      `INSERT INTO pre_market_data (index_id, pre_market_open, trade_date, timestamp)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (index_id, trade_date) DO UPDATE SET
         pre_market_open = EXCLUDED.pre_market_open,
         timestamp = NOW()
       RETURNING id, index_id, pre_market_open, trade_date, timestamp`,
      [index.id, price, tradeDate]
    );
    return result.rows[0];
  } catch (e) {
    return { index_id: index.id, pre_market_open: price, trade_date: tradeDate };
  }
};

/**
 * Query historical snapshots and their option chain data for a given index, date, expiry, and time range.
 * Fully supports 1m, 3m, 5m replay intervals and expiry cycle filtering.
 *
 * @param {number} indexId
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string|null} [expiryDate] - optional expiry date 'YYYY-MM-DD'
 * @param {string} [startTime='09:15']
 * @param {string} [endTime='15:30']
 * @returns {Promise<Array>} Array of snapshots with nested options array
 */
const getHistoricalSnapshotsByRange = async (
  indexId,
  dateStr,
  expiryDate = null,
  startTime = '09:15',
  endTime = '15:30'
) => {
  try {
    const params = [indexId, dateStr];
    let expiryFilter = '';

    if (expiryDate) {
      params.push(expiryDate);
      expiryFilter = `AND (s.expiry_date = $${params.length}::date OR s.expiry_date IS NULL)`;
    }

    const query = `
      SELECT 
        s.id, 
        s.index_id, 
        s.underlying_price, 
        s.timestamp,
        s.trading_date,
        s.expiry_date,
        s.status,
        s.pcr,
        s.atm_strike,
        json_agg(
          json_build_object(
            'strike_price', d.strike_price,
            'option_type', d.option_type,
            'ltp', d.ltp,
            'change', d.change,
            'oi', d.oi,
            'change_oi', d.change_oi,
            'volume', d.volume,
            'iv', d.iv,
            'bid_price', d.bid_price,
            'bid_qty', d.bid_qty,
            'ask_price', d.ask_price,
            'ask_qty', d.ask_qty
          )
        ) AS options
      FROM option_chain_snapshots s
      LEFT JOIN option_chain_data d ON d.snapshot_id = s.id
      WHERE s.index_id = $1
        AND (s.trading_date = $2::date OR (s.timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
        ${expiryFilter}
      GROUP BY s.id, s.index_id, s.underlying_price, s.timestamp, s.trading_date, s.expiry_date, s.status, s.pcr, s.atm_strike
      ORDER BY s.timestamp ASC;
    `;

    const result = await db.query(query, params);
    return result.rows;
  } catch (err) {
    console.warn('⚠️ getHistoricalSnapshotsByRange error:', err.message);
    return [];
  }
};

/**
 * Get distinct available historical trading dates recorded in option_chain_snapshots.
 * @param {number} indexId
 * @returns {Promise<Array<string>>}
 */
const getAvailableHistoricalDates = async (indexId) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT COALESCE(trading_date, (timestamp AT TIME ZONE 'Asia/Kolkata')::date)::text as date
       FROM option_chain_snapshots
       WHERE index_id = $1
       ORDER BY date DESC`,
      [indexId]
    );
    return result.rows.map((r) => r.date);
  } catch (err) {
    console.warn('⚠️ getAvailableHistoricalDates error:', err.message);
    return [];
  }
};

/**
 * Get distinct available historical expiry dates recorded in option_chain_snapshots.
 * @param {number} indexId
 * @param {string} [dateStr] - optional trading date filter
 * @returns {Promise<Array<string>>}
 */
const getAvailableHistoricalExpiries = async (indexId, dateStr = null) => {
  try {
    let query = `
      SELECT DISTINCT expiry_date::date::text as expiry
      FROM option_chain_snapshots
      WHERE index_id = $1 AND expiry_date IS NOT NULL
    `;
    const params = [indexId];
    if (dateStr) {
      query += ` AND (trading_date = $2::date OR (timestamp AT TIME ZONE 'Asia/Kolkata')::date = $2::date)`;
      params.push(dateStr);
    }
    query += ` ORDER BY expiry DESC`;

    const result = await db.query(query, params);
    return result.rows.map((r) => r.expiry);
  } catch (err) {
    console.warn('⚠️ getAvailableHistoricalExpiries error:', err.message);
    return [];
  }
};

/**
 * Get active expiry cycle for a symbol.
 * @param {string} symbol
 * @returns {Promise<Object|null>}
 */
const getActiveExpiryCycle = async (symbol) => {
  const upper = symbol.toUpperCase();
  const result = await db.query(
    `SELECT c.id, c.index_id, c.symbol, c.cycle_start_date, c.expiry_date, c.status, c.is_current, c.created_at
     FROM expiry_cycles c
     WHERE c.symbol = $1 AND c.is_current = true
     ORDER BY c.expiry_date ASC
     LIMIT 1`,
    [upper]
  );
  return result.rows[0] || null;
};

/**
 * Upsert expiry cycle record.
 * @param {Object} cycleData
 * @returns {Promise<Object>}
 */
const upsertExpiryCycle = async ({ symbol, cycleStartDate, expiryDate, status = 'ACTIVE', isCurrent = true }) => {
  const upper = symbol.toUpperCase();
  const index = await getIndexBySymbol(upper);
  if (!index) throw new Error(`Index not found: ${upper}`);

  // If this cycle is marked isCurrent, reset previous active cycles
  if (isCurrent) {
    await db.query(
      `UPDATE expiry_cycles SET is_current = false WHERE index_id = $1 AND expiry_date != $2::date`,
      [index.id, expiryDate]
    );
  }

  const result = await db.query(
    `INSERT INTO expiry_cycles (index_id, symbol, cycle_start_date, expiry_date, status, is_current)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (index_id, expiry_date) DO UPDATE SET
       status = EXCLUDED.status,
       is_current = EXCLUDED.is_current,
       cycle_start_date = EXCLUDED.cycle_start_date
     RETURNING id, index_id, symbol, cycle_start_date, expiry_date, status, is_current, created_at`,
    [index.id, upper, cycleStartDate, expiryDate, status, isCurrent]
  );
  return result.rows[0];
};

/**
 * Archive expired cycles up to completedExpiryDate.
 * Sets status='EXPIRED', is_current=false in expiry_cycles,
 * and sets status='EXPIRED', is_active_cycle=false in option_chain_snapshots.
 * NEVER DELETES HISTORICAL ROWS.
 *
 * @param {string} symbol
 * @param {string} completedExpiryDate - 'YYYY-MM-DD'
 * @returns {Promise<Object>}
 */
const archiveExpiredCycles = async (symbol, completedExpiryDate) => {
  const upper = symbol.toUpperCase();
  const index = await getIndexBySymbol(upper);
  if (!index) return { archivedCycles: 0, updatedSnapshots: 0 };

  const cycleRes = await db.query(
    `UPDATE expiry_cycles
     SET status = 'EXPIRED', is_current = false, closed_at = NOW()
     WHERE index_id = $1 AND expiry_date <= $2::date AND status != 'EXPIRED'
     RETURNING id`,
    [index.id, completedExpiryDate]
  );

  const snapRes = await db.query(
    `UPDATE option_chain_snapshots
     SET status = 'EXPIRED', is_active_cycle = false
     WHERE index_id = $1 AND expiry_date <= $2::date AND (status != 'EXPIRED' OR is_active_cycle = true)
     RETURNING id`,
    [index.id, completedExpiryDate]
  );

  return {
    archivedCycles: cycleRes.rowCount,
    updatedSnapshots: snapRes.rowCount,
  };
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
  getPreMarketOpen,
  upsertPreMarketOpen,
  getHistoricalSnapshotsByRange,
  getAvailableHistoricalDates,
  getAvailableHistoricalExpiries,
  getActiveExpiryCycle,
  upsertExpiryCycle,
  archiveExpiredCycles,
};