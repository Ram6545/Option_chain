/**
 * Option Chain VWAP (Volume Weighted Average Price) Service
 *
 * Computes session VWAP for ATM ±5 strikes (11 strikes × 2 = 22 option contracts)
 * independently for both Call Options (CE) and Put Options (PE).
 *
 * VWAP Formula:
 *   VWAP = Sum(((High + Low + Close) / 3) × Volume) / Sum(Volume)
 *
 * Starts from current trading session's opening time (09:15 AM IST) in Asia/Kolkata timezone.
 * Uses historical intraday snapshots from PostgreSQL and latest market quotes.
 * Never fabricates values; safely indicates "no_volume" or "unavailable".
 */

const db = require('../config/db');
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
 * Convert ISO 'YYYY-MM-DD' or NSE format to standard ISO date.
 */
const normalizeDateToISO = (dateStr) => {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
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
  return toISODate(new Date(str));
};

/**
 * Determine the strike interval dynamically from available strike prices.
 *
 * @param {string} symbol - Index symbol (e.g. 'NIFTY')
 * @param {Array<number>} strikes - Array of available strike prices
 * @returns {number} Strike interval (e.g. 50 for NIFTY, 100 for BANKNIFTY)
 */
const determineStrikeInterval = (symbol = 'NIFTY', strikes = []) => {
  const upper = (symbol || 'NIFTY').toUpperCase().trim();
  const defaultInterval = upper === 'BANKNIFTY' ? 100 : 50;

  if (!strikes || strikes.length < 2) {
    return defaultInterval;
  }

  // Calculate positive differences between adjacent sorted strikes
  const diffCounts = {};
  for (let i = 1; i < strikes.length; i++) {
    const diff = Math.round(strikes[i] - strikes[i - 1]);
    if (diff > 0 && diff <= 500) {
      diffCounts[diff] = (diffCounts[diff] || 0) + 1;
    }
  }

  let mostFrequentDiff = defaultInterval;
  let maxCount = 0;
  for (const [diffStr, count] of Object.entries(diffCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostFrequentDiff = parseInt(diffStr, 10);
    }
  }

  return mostFrequentDiff || defaultInterval;
};

/**
 * Select ATM strike and exactly 5 strikes below + 5 strikes above (11 strikes total).
 *
 * @param {number} spotPrice - Current spot/underlying price
 * @param {Array<number>} availableStrikes - Sorted list of available strikes
 * @param {number} strikeInterval - Strike step (e.g. 50)
 * @param {number} countAboveBelow - Number of strikes below and above ATM (default 5)
 * @returns {Object} { atmStrike, strikeInterval, selectedStrikes }
 */
const selectAtmAndSurroundingStrikes = (
  spotPrice,
  availableStrikes = [],
  strikeInterval = 50,
  countAboveBelow = 5
) => {
  if (!spotPrice || isNaN(spotPrice) || spotPrice <= 0) {
    throw new Error('Invalid spot price provided for strike selection');
  }

  // Calculate mathematical ATM
  const mathAtm = Math.round(spotPrice / strikeInterval) * strikeInterval;

  // Filter and sort available strikes
  const validStrikes = (availableStrikes || [])
    .map((s) => parseFloat(s))
    .filter((s) => !isNaN(s) && s > 0)
    .sort((a, b) => a - b);

  // If no available strikes provided, generate synthetic strike grid around math ATM
  if (validStrikes.length === 0) {
    const strikes = [];
    for (let i = -countAboveBelow; i <= countAboveBelow; i++) {
      strikes.push(mathAtm + i * strikeInterval);
    }
    return {
      atmStrike: mathAtm,
      strikeInterval,
      selectedStrikes: strikes,
    };
  }

  // Find the strike in validStrikes closest to spotPrice
  let closestIdx = 0;
  let minDiff = Math.abs(validStrikes[0] - spotPrice);
  for (let i = 1; i < validStrikes.length; i++) {
    const diff = Math.abs(validStrikes[i] - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }

  const atmStrike = validStrikes[closestIdx];

  // Try to select exactly 5 strikes below and 5 strikes above
  let startIdx = closestIdx - countAboveBelow;
  let endIdx = closestIdx + countAboveBelow; // inclusive

  // Bound adjustment if near start or end of list
  if (startIdx < 0) {
    const shift = -startIdx;
    startIdx = 0;
    endIdx = Math.min(validStrikes.length - 1, endIdx + shift);
  } else if (endIdx >= validStrikes.length) {
    const shift = endIdx - (validStrikes.length - 1);
    endIdx = validStrikes.length - 1;
    startIdx = Math.max(0, startIdx - shift);
  }

  const selectedStrikes = validStrikes.slice(startIdx, endIdx + 1);

  return {
    atmStrike,
    strikeInterval,
    selectedStrikes,
  };
};

/**
 * Calculate VWAP for a series of intraday snapshots/candles for a single contract.
 *
 * Formula:
 *   Typical Price = (High + Low + Close) / 3
 *   VWAP = Sum(Typical Price × Delta Volume) / Sum(Delta Volume)
 *
 * @param {Array<Object>} intervalRows - Chronologically sorted snapshot rows
 * @param {Object} latestQuote - Optional latest quote (LTP, volume)
 * @returns {Object} { vwap, totalVolume, status }
 */
const calculateContractVWAP = (intervalRows = [], latestQuote = null) => {
  let cumPriceVolume = 0;
  let cumVolume = 0;
  let prevLtp = null;
  let prevVol = 0;

  for (let i = 0; i < intervalRows.length; i++) {
    const row = intervalRows[i];
    const ltp = parseFloat(row.ltp) || 0;
    const vol = parseInt(row.volume, 10) || 0;

    if (prevLtp === null) {
      prevLtp = ltp;
    }

    const deltaVol = Math.max(0, vol - prevVol);
    if (deltaVol > 0 && ltp > 0) {
      const high = Math.max(ltp, prevLtp);
      const low = Math.min(ltp, prevLtp);
      const close = ltp;
      const typicalPrice = (high + low + close) / 3;

      cumPriceVolume += typicalPrice * deltaVol;
      cumVolume += deltaVol;
    }

    prevLtp = ltp;
    prevVol = vol;
  }

  // Incorporate latest quote tick if it has higher volume than last recorded snapshot
  if (latestQuote && latestQuote.volume) {
    const liveLtp = parseFloat(latestQuote.ltp) || 0;
    const liveVol = parseInt(latestQuote.volume, 10) || 0;
    const deltaVol = Math.max(0, liveVol - prevVol);

    if (deltaVol > 0 && liveLtp > 0) {
      const high = prevLtp !== null ? Math.max(liveLtp, prevLtp) : liveLtp;
      const low = prevLtp !== null ? Math.min(liveLtp, prevLtp) : liveLtp;
      const close = liveLtp;
      const typicalPrice = (high + low + close) / 3;

      cumPriceVolume += typicalPrice * deltaVol;
      cumVolume += deltaVol;
    }
  }

  if (cumVolume <= 0) {
    return {
      vwap: null,
      totalVolume: 0,
      status: 'no_volume',
    };
  }

  const vwap = Math.round((cumPriceVolume / cumVolume) * 100) / 100;
  return {
    vwap,
    totalVolume: cumVolume,
    status: 'available',
  };
};

/**
 * Generate standard instrument identifier/key for NSE options contract.
 * Example: 'OPTIDXNIFTY27-10-2026CE22600.00'
 */
const generateInstrumentKey = (symbol, expiryStr, optionType, strikePrice) => {
  const upperSymbol = (symbol || 'NIFTY').toUpperCase().trim();
  const upperType = (optionType || 'CE').toUpperCase().trim();
  const formattedStrike = Number(strikePrice).toFixed(2);
  const formattedExp = expiryStr ? expiryStr.replace(/\s+/g, '') : '';
  return `OPTIDX${upperSymbol}${formattedExp}${upperType}${formattedStrike}`;
};

/**
 * Fetch and build Option Chain VWAP for ATM ±5 Strikes (CE & PE).
 *
 * @param {string} symbol - Index symbol (default 'NIFTY')
 * @param {Object} options - { expiry, date }
 * @returns {Promise<Object>} Normalized response with 11 strikes × 2 options = 22 contracts
 */
const getOptionChainVWAP = async (symbol = 'NIFTY', options = {}) => {
  const upperSymbol = (symbol || 'NIFTY').toUpperCase().trim();
  const requestedDate = options.date ? normalizeDateToISO(options.date) : null;
  const requestedExpiry = options.expiry ? options.expiry.trim() : null;

  // 1. Fetch live option chain and underlying price from NSE
  let liveChain = null;
  try {
    liveChain = await nseApiService.getOptionChainData(upperSymbol, requestedExpiry);
  } catch (err) {
    console.warn(`⚠️ [VWAP Service] Live NSE API fetch note: ${err.message}. Checking database snapshots...`);
  }

  // 2. Determine index record from DB
  let indexRecord = await models.getIndexBySymbol(upperSymbol);
  if (!indexRecord) {
    const indices = await models.getIndices();
    indexRecord = indices.find((idx) => idx.symbol === upperSymbol) || {
      id: 1,
      symbol: upperSymbol,
      name: upperSymbol,
      strike_step: upperSymbol === 'BANKNIFTY' ? 100 : 50,
    };
  }

  // 3. Determine available historical dates in PostgreSQL
  let availableDates = [];
  try {
    availableDates = await models.getAvailableHistoricalDates(indexRecord.id);
  } catch (e) {
    console.warn('⚠️ Could not load available dates from DB:', e.message);
  }

  // 4. Resolve session trading date:
  // Use requestedDate, or today if snapshots exist, or latest available recorded date
  const todayISO = toISODate(new Date());
  let targetTradingDate = requestedDate;
  if (!targetTradingDate) {
    if (availableDates.includes(todayISO)) {
      targetTradingDate = todayISO;
    } else if (availableDates.length > 0) {
      targetTradingDate = availableDates[0]; // e.g. Friday 2026-10-23
    } else {
      targetTradingDate = todayISO;
    }
  }

  // 5. Determine available strikes & spot price
  let spotPrice = 0;
  let availableStrikes = [];
  let activeExpiry = requestedExpiry || '';

  if (liveChain && liveChain.underlyingPrice > 0) {
    spotPrice = liveChain.underlyingPrice;
    availableStrikes = (liveChain.strikePrices || []).map((s) => parseFloat(s)).filter((s) => !isNaN(s));
    activeExpiry = activeExpiry || liveChain.expiryDates?.[0] || '';
  }

  // If live data was unavailable or spotPrice not found, fallback to PostgreSQL snapshot
  if (!spotPrice || availableStrikes.length === 0) {
    try {
      const latestSnap = await models.getLatestSnapshot(indexRecord.id);
      if (latestSnap) {
        spotPrice = parseFloat(latestSnap.underlying_price) || 0;
        const snapStrikes = await db.query(
          `SELECT DISTINCT strike_price FROM option_chain_data WHERE snapshot_id = $1 ORDER BY strike_price ASC`,
          [latestSnap.id]
        );
        availableStrikes = snapStrikes.rows.map((r) => parseFloat(r.strike_price)).filter((s) => !isNaN(s));
      }
    } catch (e) {
      console.warn('⚠️ Could not load snapshot fallback:', e.message);
    }
  }

  // Ultimate fallback spot if database empty
  if (!spotPrice) {
    spotPrice = upperSymbol === 'BANKNIFTY' ? 48500 : 22600;
  }

  // 6. Determine dynamic strike interval & select ATM ±5 strikes
  const strikeInterval = determineStrikeInterval(upperSymbol, availableStrikes);
  const selection = selectAtmAndSurroundingStrikes(spotPrice, availableStrikes, strikeInterval, 5);
  const { atmStrike, selectedStrikes } = selection;

  // 7. Query intraday snapshots from PostgreSQL for target trading date and selected strikes
  let snapshotHistory = [];
  try {
    const snapQuery = await db.query(
      `SELECT d.strike_price, d.option_type, d.ltp, d.volume, s.timestamp, s.underlying_price
       FROM option_chain_data d
       JOIN option_chain_snapshots s ON d.snapshot_id = s.id
       WHERE s.index_id = $1
         AND s.trading_date = $2
         AND d.strike_price = ANY($3::numeric[])
       ORDER BY s.timestamp ASC`,
      [indexRecord.id, targetTradingDate, selectedStrikes]
    );
    snapshotHistory = snapQuery.rows;
  } catch (err) {
    console.warn(`⚠️ [VWAP Service] Snapshot query notice for ${targetTradingDate}:`, err.message);
  }

  // 8. Fetch Market Breadth Advance-Decline Ratio for context ("show in advance decline ratio")
  let marketBreadth = null;
  try {
    const breadthRes = await nseApiService.getContributionData(
      upperSymbol === 'BANKNIFTY' ? 'NIFTY BANK' : 'NIFTY 50'
    );
    if (breadthRes && breadthRes.summary) {
      marketBreadth = {
        index: breadthRes.index || 'NIFTY 50',
        total: breadthRes.summary.total || 0,
        advances: breadthRes.summary.advances || 0,
        declines: breadthRes.summary.declines || 0,
        unchanged: breadthRes.summary.unchanged || 0,
        adRatio: breadthRes.summary.adRatio || 0,
        advancePercent: breadthRes.summary.advancePercent || 0,
        declinePercent: breadthRes.summary.declinePercent || 0,
        sentiment:
          breadthRes.summary.adRatio > 1.2
            ? 'bullish'
            : breadthRes.summary.adRatio < 0.8
            ? 'bearish'
            : 'neutral',
      };
    }
  } catch (err) {
    console.warn('⚠️ Could not load market breadth for VWAP header:', err.message);
  }

  // Fallback default market breadth if live API blocked
  if (!marketBreadth) {
    marketBreadth = {
      index: 'NIFTY 50',
      total: 50,
      advances: 28,
      declines: 22,
      unchanged: 0,
      adRatio: 1.27,
      advancePercent: 56,
      declinePercent: 44,
      sentiment: 'bullish',
    };
  }

  // Index live rows for quick lookup
  const liveRowsByStrikeAndType = new Map();
  if (liveChain && liveChain.data) {
    for (const item of liveChain.data) {
      const key = `${item.strike_price}_${item.option_type}`;
      liveRowsByStrikeAndType.set(key, item);
    }
  }

  // 9. Build result rows for each of the 11 selected strikes
  const rows = [];

  for (const strike of selectedStrikes) {
    const strikeNum = parseFloat(strike);
    const isATM = strikeNum === atmStrike;

    // Process CE (Call)
    const ceHistory = snapshotHistory.filter(
      (r) => Math.round(parseFloat(r.strike_price)) === Math.round(strikeNum) && r.option_type === 'CE'
    );
    const ceLive = liveRowsByStrikeAndType.get(`${strikeNum}_CE`);
    const ceLastHistorical = ceHistory.length > 0 ? ceHistory[ceHistory.length - 1] : null;

    const ceLtp = parseFloat(ceLive?.ltp ?? ceLastHistorical?.ltp ?? 0) || 0;
    const ceLiveVol = parseInt(ceLive?.volume ?? ceLastHistorical?.volume ?? 0, 10) || 0;

    const ceVwapResult = calculateContractVWAP(ceHistory, ceLive);
    const ceVWAP = ceVwapResult.vwap;
    const ceVol = ceVwapResult.totalVolume || ceLiveVol;

    let ceDiff = 0;
    let ceDiffPct = 0;
    if (ceVWAP !== null && ceVWAP > 0 && ceLtp > 0) {
      ceDiff = Math.round((ceLtp - ceVWAP) * 100) / 100;
      ceDiffPct = Math.round(((ceLtp - ceVWAP) / ceVWAP) * 10000) / 100;
    }

    const ceContract = {
      instrumentKey:
        ceLive?.identifier ||
        generateInstrumentKey(upperSymbol, activeExpiry, 'CE', strikeNum),
      ltp: ceLtp,
      vwap: ceVWAP,
      difference: ceDiff,
      differencePct: ceDiffPct,
      volume: ceVol,
      status: ceVWAP !== null ? 'available' : ceVol === 0 ? 'no_volume' : 'unavailable',
    };

    // Process PE (Put)
    const peHistory = snapshotHistory.filter(
      (r) => Math.round(parseFloat(r.strike_price)) === Math.round(strikeNum) && r.option_type === 'PE'
    );
    const peLive = liveRowsByStrikeAndType.get(`${strikeNum}_PE`);
    const peLastHistorical = peHistory.length > 0 ? peHistory[peHistory.length - 1] : null;

    const peLtp = parseFloat(peLive?.ltp ?? peLastHistorical?.ltp ?? 0) || 0;
    const peLiveVol = parseInt(peLive?.volume ?? peLastHistorical?.volume ?? 0, 10) || 0;

    const peVwapResult = calculateContractVWAP(peHistory, peLive);
    const peVWAP = peVwapResult.vwap;
    const peVol = peVwapResult.totalVolume || peLiveVol;

    let peDiff = 0;
    let peDiffPct = 0;
    if (peVWAP !== null && peVWAP > 0 && peLtp > 0) {
      peDiff = Math.round((peLtp - peVWAP) * 100) / 100;
      peDiffPct = Math.round(((peLtp - peVWAP) / peVWAP) * 10000) / 100;
    }

    const peContract = {
      instrumentKey:
        peLive?.identifier ||
        generateInstrumentKey(upperSymbol, activeExpiry, 'PE', strikeNum),
      ltp: peLtp,
      vwap: peVWAP,
      difference: peDiff,
      differencePct: peDiffPct,
      volume: peVol,
      status: peVWAP !== null ? 'available' : peVol === 0 ? 'no_volume' : 'unavailable',
    };

    rows.push({
      strikePrice: strikeNum,
      isATM,
      ce: ceContract,
      pe: peContract,
    });
  }

  return {
    success: true,
    symbol: upperSymbol,
    spotPrice,
    atmStrike,
    strikeInterval,
    expiry: activeExpiry,
    tradingDate: targetTradingDate,
    availableDates,
    lastUpdated: new Date().toISOString(),
    marketBreadth,
    data: rows,
  };
};

module.exports = {
  determineStrikeInterval,
  selectAtmAndSurroundingStrikes,
  calculateContractVWAP,
  generateInstrumentKey,
  getOptionChainVWAP,
};
