/**
 * Expiry Cycle & Historical Data Management Service
 *
 * Implements NIFTY Expiry Cycle Rules:
 * - Tuesday = Expiry Day (09:15 to 15:30 continuous storage, completion at 15:30)
 * - Wednesday = New Cycle / Archive Day
 *
 * Lifecycle:
 * 1. Tuesday completes market hours (15:30).
 * 2. On Wednesday, automatically detects completed Tuesday expiry.
 * 3. Archives active expiry records (status = 'EXPIRED', is_active_cycle = false).
 * 4. NEVER DELETES HISTORICAL RECORDS. Historical data remains permanent.
 * 5. Identifies next applicable NIFTY expiry dynamically via NSE API (handles holidays).
 * 6. Creates and activates new cycle.
 * 7. Starts day-by-day storage under the new active cycle.
 */

const models = require('../models');
const nseApiService = require('./nseApiService');

/**
 * Format a Date object to 'YYYY-MM-DD'.
 */
const toISODate = (date) => {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Normalize NSE expiry string ('15-Sep-2026') or ISO ('2026-09-15') to 'YYYY-MM-DD'.
 */
const normalizeExpiryToISO = (expiryStr) => {
  if (!expiryStr) return null;
  const str = String(expiryStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const parts = str.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = monthMap[parts[1].toLowerCase()];
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    if (!isNaN(day) && month && !isNaN(year)) {
      return `${year}-${month}-${String(day).padStart(2, '0')}`;
    }
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : toISODate(d);
};

/**
 * Format ISO 'YYYY-MM-DD' back to NSE format '15-Sep-2026'.
 */
const formatISOToNSE = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

/**
 * Dynamically identify current and upcoming expiry dates from NSE.
 * Never hardcodes static calendar dates; respects exchange holidays and official schedules.
 *
 * @param {string} symbol
 * @returns {Promise<Array<string>>} Array of expiry strings (NSE format)
 */
const fetchDynamicExpiries = async (symbol = 'NIFTY') => {
  try {
    const expiries = await nseApiService.getExpiryDates(symbol);
    if (expiries && expiries.length > 0) {
      return expiries;
    }
  } catch (err) {
    console.warn(`⚠️ Could not fetch expiries from nseApiService for ${symbol}:`, err.message);
  }

  // Fallback: calculate next Tuesdays dynamically based on today
  const dynamicTuesdays = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + ((2 - now.getDay() + 7) % 7) + i * 7);
    dynamicTuesdays.push(formatISOToNSE(toISODate(d)));
  }
  return dynamicTuesdays;
};

/**
 * Get current active expiry cycle details for an index.
 * If no cycle exists in DB, initializes one automatically.
 *
 * @param {string} symbol - Index symbol (e.g. 'NIFTY')
 * @returns {Promise<Object>} Active cycle info
 */
const getActiveCycle = async (symbol = 'NIFTY') => {
  const upper = symbol.toUpperCase();
  let cycle = await models.getActiveExpiryCycle(upper);

  if (!cycle) {
    // Determine dynamically from exchange
    const expiries = await fetchDynamicExpiries(upper);
    const targetExpiryNSE = expiries[0];
    const targetExpiryISO = normalizeExpiryToISO(targetExpiryNSE) || toISODate(new Date());

    // Cycle start date is typically the preceding Wednesday
    const expDate = new Date(targetExpiryISO);
    const startDate = new Date(expDate);
    startDate.setDate(expDate.getDate() - 6);

    cycle = await models.upsertExpiryCycle({
      symbol: upper,
      cycleStartDate: toISODate(startDate),
      expiryDate: targetExpiryISO,
      status: 'ACTIVE',
      isCurrent: true,
    });
    console.log(`✨ [Initialized Active Expiry Cycle for ${upper}]:`, cycle);
  }

  return {
    ...cycle,
    expiryDateNSE: formatISOToNSE(cycle.expiry_date),
  };
};

/**
 * Execute Expiry Transition / Cleanup.
 *
 * Idempotent:
 * 1. Checks if current date / time warrants a cycle rollover.
 * 2. On Wednesday (or after Tuesday 15:30), detects that active cycle has expired.
 * 3. Archives expired records in DB (marks status='EXPIRED', is_active_cycle=false).
 * 4. NEVER DELETES HISTORICAL DATA.
 * 5. Activates next expiry cycle dynamically.
 *
 * @param {string} symbol
 * @param {boolean} force - Force rollover regardless of day of week
 * @returns {Promise<Object>} Transition result
 */
const processCycleTransition = async (symbol = 'NIFTY', force = false) => {
  const upper = symbol.toUpperCase();
  const now = new Date();
  const todayISO = toISODate(now);
  const dayOfWeek = now.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, ...
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const currentActive = await models.getActiveExpiryCycle(upper);
  const expiries = await fetchDynamicExpiries(upper);

  if (!currentActive) {
    return await getActiveCycle(upper);
  }

  const activeExpiryISO = toISODate(currentActive.expiry_date);
  const isPastExpiryDate = activeExpiryISO < todayISO;
  const isExpiryDayCompleted = activeExpiryISO === todayISO && currentMinutes >= (15 * 60 + 30);
  const isWednesdayCleanup = dayOfWeek === 3; // Wednesday

  const shouldRollover = force || isPastExpiryDate || (isWednesdayCleanup && activeExpiryISO <= todayISO) || isExpiryDayCompleted;

  if (!shouldRollover) {
    return {
      status: 'NO_ROLLOVER_NEEDED',
      message: `Active cycle ${activeExpiryISO} is still valid`,
      activeCycle: currentActive,
    };
  }

  console.log(`🔄 [CYCLE ROLLOVER TRIGGERED] Symbol: ${upper} | Active Expiry: ${activeExpiryISO} | Force: ${force}`);

  // 1. Archive previous expired cycle(s) in PostgreSQL
  const archiveResult = await models.archiveExpiredCycles(upper, activeExpiryISO);
  console.log(`📦 [ARCHIVED EXPIRED CYCLE]:`, archiveResult);

  // 2. Select next active expiry from exchange valid dates
  let nextExpiryNSE = null;
  for (const exp of expiries) {
    const expISO = normalizeExpiryToISO(exp);
    if (expISO && expISO > activeExpiryISO) {
      nextExpiryNSE = exp;
      break;
    }
  }

  if (!nextExpiryNSE) {
    nextExpiryNSE = expiries[0] || formatISOToNSE(toISODate(new Date(Date.now() + 7 * 86400000)));
  }

  const nextExpiryISO = normalizeExpiryToISO(nextExpiryNSE);

  // 3. New cycle start date (Wednesday)
  const newCycleStartISO = todayISO;

  // 4. Upsert new cycle as ACTIVE
  const newCycle = await models.upsertExpiryCycle({
    symbol: upper,
    cycleStartDate: newCycleStartISO,
    expiryDate: nextExpiryISO,
    status: 'ACTIVE',
    isCurrent: true,
  });

  console.log(`🚀 [NEW ACTIVE CYCLE STARTED]:`, {
    symbol: upper,
    cycleStartDate: newCycleStartISO,
    expiryDate: nextExpiryISO,
    status: 'ACTIVE',
  });

  return {
    status: 'ROLLOVER_COMPLETED',
    archivedExpiry: activeExpiryISO,
    archivedRecords: archiveResult,
    newActiveCycle: {
      ...newCycle,
      expiryDateNSE: formatISOToNSE(newCycle.expiry_date),
    },
  };
};

/**
 * Save an Option Chain snapshot with proper trading_date, expiry_date, and cycle metadata.
 * Ensures idempotency by checking index_id, trading_date, expiry_date, and timestamp minute.
 *
 * @param {string} symbol
 * @param {Object} chainData - { underlyingPrice, strikes, timestamp, expiry, pcr, atmStrike }
 * @returns {Promise<Object>} Stored snapshot metadata
 */
const saveSnapshotWithCycle = async (symbol = 'NIFTY', chainData = {}) => {
  const upper = symbol.toUpperCase();
  const index = await models.getIndexBySymbol(upper);
  if (!index) throw new Error(`Index not found: ${upper}`);

  const activeCycle = await getActiveCycle(upper);
  const now = chainData.timestamp ? new Date(chainData.timestamp) : new Date();
  const tradingDate = toISODate(now);

  const expiryDate = chainData.expiry
    ? normalizeExpiryToISO(chainData.expiry)
    : toISODate(activeCycle.expiry_date);

  const underlyingPrice = parseFloat(chainData.underlyingPrice) || 0;
  const atmStrike = chainData.atmStrike || null;
  const pcr = chainData.pcr || null;

  // Insert Snapshot
  const snapshot = await models.createSnapshot({
    indexId: index.id,
    underlyingPrice,
    timestamp: now,
    tradingDate,
    expiryDate,
    status: 'ACTIVE',
    isActiveCycle: true,
    atmStrike,
    pcr,
  });

  // Prepare Option Contracts
  const optionRows = [];
  const strikes = chainData.strikes || [];

  for (const s of strikes) {
    if (s.ce) {
      optionRows.push({
        strike_price: s.strikePrice,
        option_type: 'CE',
        ltp: s.ce.ltp || 0,
        change: s.ce.change || 0,
        pchange: s.ce.ltpChgPercent || 0,
        volume: s.ce.volume || 0,
        oi: s.ce.oi || 0,
        change_oi: s.ce.changeOI || 0,
        pchange_oi: s.ce.changeOIPercent || 0,
        iv: s.ce.iv || 0,
        bid_price: s.ce.bidPrice || 0,
        bid_qty: s.ce.bidQty || 0,
        ask_price: s.ce.askPrice || 0,
        ask_qty: s.ce.askQty || 0,
      });
    }
    if (s.pe) {
      optionRows.push({
        strike_price: s.strikePrice,
        option_type: 'PE',
        ltp: s.pe.ltp || 0,
        change: s.pe.change || 0,
        pchange: s.pe.ltpChgPercent || 0,
        volume: s.pe.volume || 0,
        oi: s.pe.oi || 0,
        change_oi: s.pe.changeOI || 0,
        pchange_oi: s.pe.changeOIPercent || 0,
        iv: s.pe.iv || 0,
        bid_price: s.pe.bidPrice || 0,
        bid_qty: s.pe.bidQty || 0,
        ask_price: s.pe.askPrice || 0,
        ask_qty: s.pe.askQty || 0,
      });
    }
  }

  if (optionRows.length > 0) {
    await models.insertOptionChainData(snapshot.id, optionRows);
  }

  return {
    snapshotId: snapshot.id,
    indexId: index.id,
    symbol: upper,
    tradingDate,
    expiryDate,
    underlyingPrice,
    contractRows: optionRows.length,
    timestamp: snapshot.timestamp,
  };
};

/**
 * Background Scheduler initialization.
 * Automatically checks cycle rollover on startup and runs periodic checks.
 */
const initExpiryCycleScheduler = () => {
  console.log('⏰ [ExpiryCycleService] Initializing automated expiry cycle manager...');

  // 1. Immediate boot check
  setTimeout(async () => {
    try {
      await processCycleTransition('NIFTY', false);
    } catch (err) {
      console.warn('⚠️ Boot cycle check notice:', err.message);
    }
  }, 3000);

  // 2. Recurring periodic check (every 10 minutes)
  setInterval(async () => {
    try {
      await processCycleTransition('NIFTY', false);
    } catch (err) {
      console.warn('⚠️ Scheduled cycle transition notice:', err.message);
    }
  }, 10 * 60 * 1000);
};

module.exports = {
  toISODate,
  normalizeExpiryToISO,
  formatISOToNSE,
  fetchDynamicExpiries,
  getActiveCycle,
  processCycleTransition,
  saveSnapshotWithCycle,
  initExpiryCycleScheduler,
};
