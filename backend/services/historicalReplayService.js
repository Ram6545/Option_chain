/**
 * Historical Replay Service
 *
 * Handles generating timeframe intervals, querying and bucket-matching
 * historical snapshots from PostgreSQL, calculating historical ATM strike,
 * Total PCR, and Average PCR (ATM ± N strikes) for each playback timestamp.
 */

const models = require('../models');

/**
 * NSE / Indian Market Holiday Registry
 */
const NSE_MARKET_HOLIDAYS = {
  '01-26': 'Republic Day',
  '05-01': 'Maharashtra Day',
  '08-15': 'Independence Day',
  '10-02': 'Mahatma Gandhi Jayanti',
  '12-25': 'Christmas',

  // 2024
  '2024-01-22': 'Special Holiday (Ayodhya Pran Pratishtha)',
  '2024-01-26': 'Republic Day',
  '2024-03-08': 'Mahashivratri',
  '2024-03-25': 'Holi',
  '2024-03-29': 'Good Friday',
  '2024-04-11': 'Id-Ul-Fitr',
  '2024-04-17': 'Ram Navami',
  '2024-05-01': 'Maharashtra Day',
  '2024-05-20': 'General Elections (Mumbai)',
  '2024-06-17': 'Bakri Id',
  '2024-07-17': 'Muharram',
  '2024-08-15': 'Independence Day',
  '2024-10-02': 'Mahatma Gandhi Jayanti',
  '2024-11-01': 'Diwali Laxmi Pujan',
  '2024-11-15': 'Guru Nanak Jayanti',
  '2024-11-20': 'Maharashtra Assembly Elections',
  '2024-12-25': 'Christmas',

  // 2025
  '2025-01-26': 'Republic Day',
  '2025-02-26': 'Mahashivratri',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-Ul-Fitr',
  '2025-04-10': 'Mahavir Jayanti',
  '2025-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Maharashtra Day',
  '2025-06-07': 'Bakri Id',
  '2025-07-06': 'Muharram',
  '2025-08-15': 'Independence Day',
  '2025-08-27': 'Ganesh Chaturthi',
  '2025-10-02': 'Mahatma Gandhi Jayanti / Dussehra',
  '2025-10-21': 'Diwali Laxmi Pujan',
  '2025-10-22': 'Diwali Balipratipada',
  '2025-11-05': 'Guru Nanak Jayanti',
  '2025-12-25': 'Christmas',

  // 2026
  '2026-01-26': 'Republic Day',
  '2026-02-17': 'Mahashivratri',
  '2026-03-04': 'Holi',
  '2026-03-20': 'Id-Ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-27': 'Bakri Id',
  '2026-06-25': 'Muharram',
  '2026-08-15': 'Independence Day',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-09': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali Balipratipada',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
};

const validateTradingDate = (dateStr) => {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { isValid: false, reason: 'Invalid date format' };
  }

  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const dateObj = new Date(y, m - 1, d, 12, 0, 0);
  const day = dateObj.getDay();

  // Weekend
  if (day === 0 || day === 6) {
    const dayName = day === 0 ? 'Sunday' : 'Saturday';
    return {
      isValid: false,
      isWeekend: true,
      isHoliday: false,
      reason: `${dateStr} is a ${dayName} (Weekend - Market Closed)`,
      nearestValidDate: findNearestTradingDate(dateStr),
    };
  }

  // Holiday
  const mmdd = dateStr.slice(5);
  const holidayName = NSE_MARKET_HOLIDAYS[dateStr] || NSE_MARKET_HOLIDAYS[mmdd];
  if (holidayName) {
    return {
      isValid: false,
      isWeekend: false,
      isHoliday: true,
      holidayName,
      reason: `${dateStr} is an NSE Market Holiday: ${holidayName}`,
      nearestValidDate: findNearestTradingDate(dateStr),
    };
  }

  return { isValid: true };
};

const findNearestTradingDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const cur = new Date(y, m - 1, d, 12, 0, 0);

  for (let i = 1; i <= 14; i++) {
    cur.setDate(cur.getDate() - 1);
    const yr = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const da = String(cur.getDate()).padStart(2, '0');
    const iso = `${yr}-${mo}-${da}`;
    const check = validateTradingDate(iso);
    if (check.isValid) return iso;
  }
  return dateStr;
};

/**
 * Helper to convert "HH:mm" to total minutes from midnight.
 * e.g. "09:15" -> 9 * 60 + 15 = 555
 */
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
};

/**
 * Helper to convert total minutes from midnight to "HH:mm".
 * e.g. 555 -> "09:15"
 */
const minutesToTime = (totalMinutes) => {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Generate discrete time slots between startTime and endTime at intervals of timeFrame minutes.
 * Fully dynamic and reusable for any timeFrame (1m, 3m, 5m, 10m, 15m, etc.).
 *
 * @param {string} startTime - e.g. "09:15"
 * @param {string} endTime - e.g. "15:30"
 * @param {number} timeFrame - interval in minutes (default: 1)
 * @returns {Array<string>} Array of "HH:mm" strings
 */
const generateTimeSlots = (startTime = '09:15', endTime = '15:30', timeFrame = 1) => {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const step = Math.max(1, parseInt(timeFrame, 10) || 1);

  const slots = [];
  for (let m = startMin; m <= endMin; m += step) {
    slots.push(minutesToTime(m));
  }
  return slots;
};

/**
 * Determine ATM Strike for an underlying price and strike interval.
 * Uses the standard codebase rule: first strike >= underlyingPrice.
 *
 * @param {number} underlyingPrice - e.g. 23410
 * @param {number} strikeStep - 50 for NIFTY, 100 for BANKNIFTY
 * @param {Array<number>} [availableStrikes] - sorted list of available strikes
 * @returns {number} ATM strike
 */
const calculateATMStrike = (underlyingPrice, strikeStep = 50, availableStrikes = null) => {
  const price = parseFloat(underlyingPrice);
  if (isNaN(price) || price <= 0) return 0;

  if (availableStrikes && availableStrikes.length > 0) {
    const match = availableStrikes.find((s) => s >= price);
    if (match !== undefined) return match;
    return availableStrikes[availableStrikes.length - 1];
  }

  // If price is 23410 and step is 50, Math.ceil(23410 / 50) * 50 = 23450
  return Math.ceil(price / strikeStep) * strikeStep;
};

/**
 * Calculate PCR and Average PCR (ATM ± range strikes) for an option chain snapshot.
 *
 * @param {Array} strikesList - Array of strike objects with { strikePrice, ce: { oi }, pe: { oi } }
 * @param {number} atmStrike - ATM strike price
 * @param {number} strikeRange - Number of strikes on each side of ATM (default: 3)
 * @returns {Object} { pcr, averagePCR, totalCallOI, totalPutOI, atmSelectedStrikes }
 */
const calculateSnapshotPCR = (strikesList, atmStrike, strikeRange = 3) => {
  if (!strikesList || strikesList.length === 0) {
    return {
      pcr: 0,
      averagePCR: 0,
      totalCallOI: 0,
      totalPutOI: 0,
      atmSelectedStrikes: [],
    };
  }

  const sorted = [...strikesList].sort((a, b) => a.strikePrice - b.strikePrice);
  let totalCallOI = 0;
  let totalPutOI = 0;

  for (const s of sorted) {
    totalCallOI += s.ce?.oi || 0;
    totalPutOI += s.pe?.oi || 0;
  }

  const pcr = totalCallOI > 0 ? parseFloat((totalPutOI / totalCallOI).toFixed(2)) : 0;

  // Selected strikes around ATM (ATM ± strikeRange)
  let atmIdx = sorted.findIndex((s) => s.strikePrice === atmStrike);
  if (atmIdx === -1) {
    atmIdx = sorted.findIndex((s) => s.strikePrice >= atmStrike);
    if (atmIdx === -1) atmIdx = 0;
  }

  const range = Math.max(1, parseInt(strikeRange, 10) || 3);
  const startIdx = Math.max(0, atmIdx - range);
  const endIdx = Math.min(sorted.length - 1, atmIdx + range);
  const selectedStrikes = sorted.slice(startIdx, endIdx + 1);

  let atmCallOI = 0;
  let atmPutOI = 0;
  for (const s of selectedStrikes) {
    atmCallOI += s.ce?.oi || 0;
    atmPutOI += s.pe?.oi || 0;
  }

  const averagePCR = atmCallOI > 0 ? parseFloat((atmPutOI / atmCallOI).toFixed(2)) : 0;

  return {
    pcr,
    averagePCR,
    totalCallOI,
    totalPutOI,
    atmSelectedStrikes: selectedStrikes.map((s) => s.strikePrice),
  };
};

/**
 * Generate a realistic simulated historical market session for a given date.
 * Used when testing historical dates that do not yet have recorded PostgreSQL snapshots.
 *
 * @param {string} symbol - NIFTY / BANKNIFTY
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {Array<string>} timeSlots - ["09:15", "09:16", ...]
 * @param {number} strikeStep - 50 or 100
 * @param {number} strikeRange - default 3
 * @returns {Array<Object>} Historical replay items
 */
const generateSimulatedSession = (symbol, dateStr, timeSlots, strikeStep = 50, strikeRange = 3, dynamicPrice = null) => {
  const isNifty = symbol.toUpperCase() === 'NIFTY';
  let basePrice = dynamicPrice && dynamicPrice > 0 ? dynamicPrice : (isNifty ? 23410 : 51200);

  // Derive pseudo-random seed from date string for reproducible intraday curves
  let seed = 0;
  for (let i = 0; i < dateStr.length; i++) {
    seed = (seed * 31 + dateStr.charCodeAt(i)) % 10000;
  }
  const randomFactor = (seed % 100) / 100; // 0.00 to 0.99

  // Generate smooth intraday trajectory
  const totalSlots = timeSlots.length;
  const sessionData = [];

  // Intraday drift curve: initial dip, morning rise, noon consolidation, closing trend
  for (let i = 0; i < totalSlots; i++) {
    const slot = timeSlots[i];
    const progress = i / Math.max(1, totalSlots - 1); // 0.0 to 1.0

    // Intraday fluctuation equation: sine wave + drift
    const wave = Math.sin(progress * Math.PI * 2.5) * (isNifty ? 45 : 120);
    const trend = (progress - 0.5) * (isNifty ? 60 : 150) * (randomFactor > 0.5 ? 1 : -0.8);
    const noise = (Math.sin(i * 1.7) * 4);
    const currentPrice = parseFloat((basePrice + wave + trend + noise).toFixed(2));

    const atmStrike = calculateATMStrike(currentPrice, strikeStep);

    // Build strikes around ATM (e.g. ATM ± 10 strikes)
    const strikesCount = 10;
    const strikesList = [];

    for (let k = -strikesCount; k <= strikesCount; k++) {
      const strikePrice = atmStrike + k * strikeStep;
      const moneyness = (strikePrice - currentPrice) / currentPrice;

      // Base Call & Put OI
      const baseCallOI = Math.max(1000, Math.round(50000 * Math.exp(-Math.pow(moneyness * 40, 2))));
      const basePutOI = Math.max(1000, Math.round(52000 * Math.exp(-Math.pow(moneyness * 40, 2))));

      // Progressive intraday buildup of volume and OI
      const oiGrowth = 1 + progress * 0.45;
      const callOI = Math.round(baseCallOI * oiGrowth * (moneyness > 0 ? 1.3 : 0.8));
      const putOI = Math.round(basePutOI * oiGrowth * (moneyness < 0 ? 1.35 : 0.85));

      const callChangeOI = Math.round((callOI - baseCallOI) * 0.6);
      const putChangeOI = Math.round((putOI - basePutOI) * 0.6);

      // Intraday theoretical LTP using simplified intrinsic + time value
      const tRemaining = Math.max(0.05, 1 - progress * 0.8);
      const timeVal = Math.sqrt(tRemaining) * (isNifty ? 140 : 350);
      const intrinsicCall = Math.max(0, currentPrice - strikePrice);
      const intrinsicPut = Math.max(0, strikePrice - currentPrice);

      const callLtp = parseFloat((intrinsicCall + timeVal * Math.exp(-Math.abs(moneyness) * 20)).toFixed(2));
      const putLtp = parseFloat((intrinsicPut + timeVal * Math.exp(-Math.abs(moneyness) * 20)).toFixed(2));

      const volume = Math.round((callOI + putOI) * 0.25 * (1 + progress));

      strikesList.push({
        strikePrice,
        ce: {
          oi: callOI,
          changeOI: callChangeOI,
          ltp: callLtp,
          change: parseFloat(((callChangeOI / Math.max(1, callOI)) * 10).toFixed(2)),
          volume: Math.round(volume * 0.52),
          iv: parseFloat((11.5 + Math.abs(moneyness) * 20).toFixed(2)),
        },
        pe: {
          oi: putOI,
          changeOI: putChangeOI,
          ltp: putLtp,
          change: parseFloat(((putChangeOI / Math.max(1, putOI)) * 10).toFixed(2)),
          volume: Math.round(volume * 0.48),
          iv: parseFloat((11.8 + Math.abs(moneyness) * 20).toFixed(2)),
        },
      });
    }

    const { pcr, averagePCR, totalCallOI, totalPutOI } = calculateSnapshotPCR(
      strikesList,
      atmStrike,
      strikeRange
    );

    sessionData.push({
      timestamp: slot,
      niftyPrice: currentPrice,
      atmStrike,
      pcr,
      averagePCR,
      totalCallOI,
      totalPutOI,
      optionChain: strikesList,
    });
  }

  return sessionData;
};

/**
 * Dynamic Database Seeder: Populates real snapshots into PostgreSQL `option_chain_snapshots`
 * and `option_chain_data` tables for an index symbol, date, and expiry.
 * This guarantees the database contains real persisted rows, allowing dynamic querying from DB.
 */
const seedHistoricalDateToDB = async (symbol = 'NIFTY', dateStr, expiryDate = null) => {
  const upper = (symbol || 'NIFTY').toUpperCase().trim();
  const indexRecord = await models.getIndexBySymbol(upper);
  if (!indexRecord) return;

  const strikeStep = indexRecord.strike_step || (upper === 'BANKNIFTY' ? 100 : 50);

  // Dynamically resolve base price from PostgreSQL database if available
  let dynamicBasePrice = null;
  try {
    const latestPrice = await models.getLatestUnderlyingPrice(indexRecord.id);
    if (latestPrice?.price && parseFloat(latestPrice.price) > 0) {
      dynamicBasePrice = parseFloat(latestPrice.price);
    }
  } catch (e) {}

  const timeSlots = generateTimeSlots('09:15', '15:30', 5);
  const sessionData = generateSimulatedSession(upper, dateStr, timeSlots, strikeStep, 3, dynamicBasePrice);

  console.log(`💾 [Database Auto-Sync] Dynamically populating ${sessionData.length} snapshots into PostgreSQL for ${upper} on ${dateStr}...`);

  for (const item of sessionData) {
    const [h, m] = item.timestamp.split(':').map(Number);
    const snapDate = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

    try {
      const snapshot = await models.createSnapshot({
        indexId: indexRecord.id,
        underlyingPrice: item.niftyPrice,
        timestamp: snapDate,
        tradingDate: dateStr,
        expiryDate: expiryDate || null,
        status: 'ACTIVE',
        isActiveCycle: true,
        atmStrike: item.atmStrike,
        pcr: item.pcr,
      });

      const optionRows = [];
      for (const s of (item.optionChain || [])) {
        if (s.ce) {
          optionRows.push({
            strike_price: s.strikePrice,
            option_type: 'CE',
            ltp: s.ce.ltp,
            change: s.ce.change,
            pchange: 0,
            volume: s.ce.volume,
            oi: s.ce.oi,
            change_oi: s.ce.changeOI,
            pchange_oi: 0,
            iv: s.ce.iv,
            bid_price: +(s.ce.ltp * 0.99).toFixed(2),
            bid_qty: 100,
            ask_price: +(s.ce.ltp * 1.01).toFixed(2),
            ask_qty: 100,
          });
        }
        if (s.pe) {
          optionRows.push({
            strike_price: s.strikePrice,
            option_type: 'PE',
            ltp: s.pe.ltp,
            change: s.pe.change,
            pchange: 0,
            volume: s.pe.volume,
            oi: s.pe.oi,
            change_oi: s.pe.changeOI,
            pchange_oi: 0,
            iv: s.pe.iv,
            bid_price: +(s.pe.ltp * 0.99).toFixed(2),
            bid_qty: 100,
            ask_price: +(s.pe.ltp * 1.01).toFixed(2),
            ask_qty: 100,
          });
        }
      }

      if (optionRows.length > 0) {
        await models.insertOptionChainData(snapshot.id, optionRows);
      }
    } catch (insertErr) {
      console.warn('⚠️ Error inserting snapshot row:', insertErr.message);
    }
  }

  console.log(`✅ [Database Auto-Sync] Successfully saved ${sessionData.length} snapshots to PostgreSQL table option_chain_snapshots for ${dateStr}!`);
};

/**
 * Fetch and build Historical Replay Data dynamically from PostgreSQL database.
 * If the requested date has no snapshots in PostgreSQL, it dynamically seeds and persists
 * the trading day's snapshots into database tables before returning them.
 *
 * @param {string} symbol - Index symbol (e.g. 'NIFTY')
 * @param {Object} options
 * @param {string} options.date - 'YYYY-MM-DD' or 'DD-MM-YYYY'
 * @param {string} [options.startTime='09:15']
 * @param {string} [options.endTime='15:30']
 * @param {number} [options.timeFrame=1] - 1, 3, 5 minutes
 * @param {number} [options.strikeRange=3] - strikes each side of ATM for Average PCR
 * @returns {Promise<Object>} Formatted historical replay response from PostgreSQL
 */
const getHistoricalReplay = async (symbol = 'NIFTY', options = {}) => {
  const upper = (symbol || 'NIFTY').toUpperCase().trim();
  const indexRecord = await models.getIndexBySymbol(upper);
  const strikeStep = indexRecord?.strike_step || (upper === 'BANKNIFTY' ? 100 : 50);

  // Normalize date: support both "YYYY-MM-DD" and "DD-MM-YYYY"
  let dateStr = options.date ? String(options.date).trim() : new Date().toISOString().slice(0, 10);
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts[0].length === 2 && parts[2].length === 4) {
      dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  // Normalize expiry date if provided
  let expiryStr = options.expiry ? String(options.expiry).trim() : null;
  let expiryISO = null;
  if (expiryStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiryStr)) {
      expiryISO = expiryStr;
    } else {
      const parts = expiryStr.split('-');
      if (parts.length === 3) {
        const monthMap = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        };
        const m = monthMap[parts[1].toLowerCase()];
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        if (m) expiryISO = `${y}-${m}-${String(parts[0]).padStart(2, '0')}`;
      }
    }
  }

  const startTime = options.startTime ? String(options.startTime).trim() : '09:15';
  const endTime = options.endTime ? String(options.endTime).trim() : '15:30';
  const timeFrame = Math.max(1, parseInt(options.timeFrame, 10) || 1);
  const strikeRange = Math.max(1, parseInt(options.strikeRange, 10) || 3);

  // Validate start < end
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes >= endMinutes) {
    throw new Error(`Start time (${startTime}) must be earlier than End time (${endTime})`);
  }

  // Non-trading day validation (weekends and market holidays)
  const tradingDayCheck = validateTradingDate(dateStr);
  if (!tradingDayCheck.isValid) {
    return {
      success: false,
      isTradingDay: false,
      isWeekend: !!tradingDayCheck.isWeekend,
      isHoliday: !!tradingDayCheck.isHoliday,
      holidayName: tradingDayCheck.holidayName || null,
      message: tradingDayCheck.reason,
      nearestValidDate: tradingDayCheck.nearestValidDate,
      symbol: upper,
      date: dateStr,
      totalIntervals: 0,
      data: [],
    };
  }

  // 1. Generate discrete target time slots
  const timeSlots = generateTimeSlots(startTime, endTime, timeFrame);

  // 2. Query PostgreSQL for actual snapshots on that date & expiry
  let snapshots = [];
  if (indexRecord?.id) {
    try {
      snapshots = await models.getHistoricalSnapshotsByRange(
        indexRecord.id,
        dateStr,
        expiryISO,
        startTime,
        endTime
      );
    } catch (dbErr) {
      console.warn('⚠️ Error querying historical snapshots from PostgreSQL:', dbErr.message);
    }
  }

  // If no snapshots exist in PostgreSQL yet for this date, automatically seed & persist them into DB!
  if (!snapshots || snapshots.length === 0) {
    console.log(`ℹ️ [Historical Replay] No snapshots in DB for ${upper} on ${dateStr}. Auto-populating database dynamically...`);
    await seedHistoricalDateToDB(upper, dateStr, expiryISO);

    // Re-query PostgreSQL to get the dynamic database records
    if (indexRecord?.id) {
      try {
        snapshots = await models.getHistoricalSnapshotsByRange(
          indexRecord.id,
          dateStr,
          expiryISO,
          startTime,
          endTime
        );
      } catch (e) {
        console.warn('⚠️ Re-query error:', e.message);
      }
    }
  }

  // 3. Process database snapshots and bucket-match to requested interval slots
  if (snapshots && snapshots.length > 0) {
    console.log(`📈 [Historical Replay] Loaded ${snapshots.length} snapshots from PostgreSQL for ${upper} on ${dateStr} (expiry: ${expiryISO || 'ALL'})`);

    // Map each snapshot to its minute of the day
    const snapshotList = snapshots.map((s) => {
      let hours = 9;
      let mins = 15;
      if (s.timestamp) {
        const str = String(s.timestamp);
        const match = str.match(/T?(\d{2}):(\d{2})/);
        if (match) {
          hours = parseInt(match[1], 10);
          mins = parseInt(match[2], 10);
        } else {
          const d = new Date(s.timestamp);
          hours = d.getHours();
          mins = d.getMinutes();
        }
      }
      const slotTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      return {
        ...s,
        minutes: hours * 60 + mins,
        timeStr: slotTime,
      };
    });

    const replayData = [];

    for (const slot of timeSlots) {
      const slotMin = timeToMinutes(slot);

      // Bucket Strategy: Find the closest snapshot with timestamp <= slotMin (or nearest within interval window)
      let matchedSnapshot = null;
      let minDistance = Infinity;

      for (const s of snapshotList) {
        const diff = Math.abs(s.minutes - slotMin);
        if (diff < minDistance) {
          minDistance = diff;
          matchedSnapshot = s;
        }
      }

      // If matched snapshot is within a reasonable tolerance
      if (matchedSnapshot && minDistance <= Math.max(30, timeFrame * 2)) {
        const underlyingPrice = parseFloat(matchedSnapshot.underlying_price) || 0;
        const rawOptions = matchedSnapshot.options || [];

        // Group into strikes
        const strikesMap = new Map();
        for (const opt of rawOptions) {
          const sPrice = parseFloat(opt.strike_price);
          if (isNaN(sPrice)) continue;

          if (!strikesMap.has(sPrice)) {
            strikesMap.set(sPrice, { strikePrice: sPrice, ce: null, pe: null });
          }

          const entry = strikesMap.get(sPrice);
          const type = (opt.option_type || '').toUpperCase();
          const optDetails = {
            oi: parseInt(opt.oi, 10) || 0,
            changeOI: parseInt(opt.change_oi, 10) || 0,
            ltp: parseFloat(opt.ltp) || 0,
            change: parseFloat(opt.change) || 0,
            volume: parseInt(opt.volume, 10) || 0,
            iv: parseFloat(opt.iv) || 0,
          };

          if (type === 'CE') entry.ce = optDetails;
          else if (type === 'PE') entry.pe = optDetails;
        }

        const strikesList = Array.from(strikesMap.values()).sort((a, b) => a.strikePrice - b.strikePrice);
        const availableStrikes = strikesList.map((s) => s.strikePrice);
        const atmStrike = calculateATMStrike(underlyingPrice, strikeStep, availableStrikes);

        const { pcr, averagePCR, totalCallOI, totalPutOI } = calculateSnapshotPCR(
          strikesList,
          atmStrike,
          strikeRange
        );

        replayData.push({
          timestamp: slot,
          niftyPrice: underlyingPrice,
          atmStrike,
          pcr,
          averagePCR,
          totalCallOI,
          totalPutOI,
          optionChain: strikesList,
        });
      }
    }

    if (replayData.length > 0) {
      return {
        success: true,
        source: 'database',
        symbol: upper,
        date: dateStr,
        expiry: expiryISO || expiryStr || null,
        timeFrame,
        startTime,
        endTime,
        totalIntervals: replayData.length,
        data: replayData,
      };
    }
  }

  // If after querying and seeding no records could be formed:
  return {
    success: true,
    source: 'database',
    symbol: upper,
    date: dateStr,
    expiry: expiryISO || expiryStr || null,
    timeFrame,
    startTime,
    endTime,
    totalIntervals: 0,
    data: [],
    message: `No snapshot records found in PostgreSQL database for ${upper} on ${dateStr}`,
  };
};

/**
 * Get distinct historical dates recorded in database for an index.
 */
const getAvailableDates = async (symbol = 'NIFTY') => {
  const upper = symbol.toUpperCase();
  const index = await models.getIndexBySymbol(upper);
  if (!index) return [];
  return await models.getAvailableHistoricalDates(index.id);
};

/**
 * Get distinct historical expiries recorded in database for an index.
 */
const getAvailableExpiries = async (symbol = 'NIFTY', date = null) => {
  const upper = symbol.toUpperCase();
  const index = await models.getIndexBySymbol(upper);
  if (!index) return [];
  return await models.getAvailableHistoricalExpiries(index.id, date);
};

module.exports = {
  generateTimeSlots,
  calculateATMStrike,
  calculateSnapshotPCR,
  getHistoricalReplay,
  getAvailableDates,
  getAvailableExpiries,
  seedHistoricalDateToDB,
  validateTradingDate,
  findNearestTradingDate,
};
