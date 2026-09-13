/**
 * Market Data Service
 *
 * This service fetches option chain data from the NSE (National Stock Exchange)
 * India API. It uses real-time data from NSE for strike prices, expiry dates,
 * underlying prices, and option chain data (CE/PE for each strike).
 *
 * When the NSE API is unavailable, it falls back to mock data generation
 * so the application remains fully functional.
 *
 * NSE API endpoints used:
 * - https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY
 *   Returns available strike prices and expiry dates for the given symbol.
 *   This is the primary endpoint for strike price and expiry data.
 *
 * - https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=18-Aug-2026
 *   Returns full option chain data (CE and PE for each strike price),
 *   available strike prices, expiry dates, and the underlying spot price.
 *   Used as a secondary endpoint for full option chain data.
 */

const models = require('../models');
const nseApiService = require('./nseApiService');

const OFFICIAL_EXPIRIES = [];

const generateUpcomingExpiries = (symbol = 'NIFTY', count = 10) => {
  return OFFICIAL_EXPIRIES;
};

/**
 * Generate realistic mock option chain data for a given index.
 * This simulates what a real market data API would return.
 * Used as a fallback when NSE API is unavailable.
 *
 * @param {string} symbol - Index symbol (NIFTY or BANKNIFTY)
 * @param {number} underlyingPrice - Current spot price
 * @param {Array<number>} strikePrices - Available strike prices from NSE
 * @returns {Object} - Option chain data with CE and PE options
 */
const generateMockOptionChain = (symbol, underlyingPrice, strikePrices = null) => {
  const isNifty = symbol === 'NIFTY';
  const strikeStep = isNifty ? 50 : 100;
  const expiryDates = OFFICIAL_EXPIRIES;

  let strikes;
  if (strikePrices && strikePrices.length > 0) {
    const atmIndex = strikePrices.reduce((closest, s, i) => {
      return Math.abs(s - underlyingPrice) < Math.abs(strikePrices[closest] - underlyingPrice)
        ? i
        : closest;
    }, 0);
    const range = 15;
    const start = Math.max(0, atmIndex - range);
    const end = Math.min(strikePrices.length, atmIndex + range + 1);
    strikes = strikePrices.slice(start, end);
  } else {
    const atmStrike = Math.round(underlyingPrice / strikeStep) * strikeStep;
    strikes = [];
    for (let i = -15; i <= 15; i++) {
      strikes.push(atmStrike + i * strikeStep);
    }
  }

  const optionData = [];

  for (const strike of strikes) {
    const moneyness = (strike - underlyingPrice) / underlyingPrice;

    // Generate CE (Call) data
    const ceData = generateOptionData(strike, underlyingPrice, 'CE', moneyness, isNifty);
    optionData.push({
      strike_price: strike,
      option_type: 'CE',
      ...ceData,
    });

    // Generate PE (Put) data
    const peData = generateOptionData(strike, underlyingPrice, 'PE', moneyness, isNifty);
    optionData.push({
      strike_price: strike,
      option_type: 'PE',
      ...peData,
    });
  }

  return {
    symbol,
    underlyingPrice,
    expiryDates,
    timestamp: new Date(),
    data: optionData,
  };
};

/**
 * Generate realistic option data for a single strike.
 *
 * @param {number} strike - Strike price
 * @param {number} underlyingPrice - Current spot price
 * @param {string} type - 'CE' or 'PE'
 * @param {number} moneyness - (strike - underlying) / underlying
 * @param {boolean} isNifty - Whether this is NIFTY or BANK NIFTY
 * @returns {Object} - Option data fields
 */
const generateOptionData = (strike, underlyingPrice, type, moneyness, isNifty) => {
  const baseIV = isNifty ? 13 + Math.random() * 4 : 16 + Math.random() * 6;
  const distFromATM = Math.abs(strike - underlyingPrice);
  const strikeStep = isNifty ? 50 : 100;
  const stepsAway = distFromATM / strikeStep;

  // Realistic volume and OI distribution (highest near ATM)
  const decay = Math.exp(-stepsAway * 0.25);
  const baseVolume = Math.max(500, Math.floor((Math.random() * 40000 + 10000) * decay));
  const baseOI = Math.max(2000, Math.floor((Math.random() * 150000 + 50000) * decay));

  const atmTimeValue = underlyingPrice * (baseIV / 100) * Math.sqrt(7 / 365) * 0.4;
  let ltp;

  if (type === 'CE') {
    if (strike <= underlyingPrice) {
      // ITM Call
      const intrinsic = underlyingPrice - strike;
      const timeValue = Math.max(1, atmTimeValue * Math.exp(-stepsAway * 0.2));
      ltp = intrinsic + timeValue + (Math.random() - 0.5) * 5;
    } else {
      // OTM Call
      ltp = Math.max(0.5, atmTimeValue * Math.exp(-stepsAway * 0.35) + (Math.random() - 0.5) * 2);
    }
  } else {
    if (strike >= underlyingPrice) {
      // ITM Put
      const intrinsic = strike - underlyingPrice;
      const timeValue = Math.max(1, atmTimeValue * Math.exp(-stepsAway * 0.2));
      ltp = intrinsic + timeValue + (Math.random() - 0.5) * 5;
    } else {
      // OTM Put
      ltp = Math.max(0.5, atmTimeValue * Math.exp(-stepsAway * 0.35) + (Math.random() - 0.5) * 2);
    }
  }
  ltp = Math.max(0.05, parseFloat(ltp.toFixed(2)));

  const spreadPercent = Math.min(0.05, Math.max(0.005, 0.5 / (ltp || 1)));
  const spread = Math.max(0.05, parseFloat((ltp * spreadPercent).toFixed(2)));
  const bidPrice = Math.max(0.05, parseFloat((ltp - spread / 2).toFixed(2)));
  const askPrice = parseFloat((ltp + spread / 2).toFixed(2));
  const bidQty = (Math.floor(Math.random() * 20) + 1) * (isNifty ? 75 : 15);
  const askQty = (Math.floor(Math.random() * 20) + 1) * (isNifty ? 75 : 15);
  const changeOI = Math.floor((Math.random() - 0.48) * baseOI * 0.25);

  return {
    ltp,
    volume: baseVolume,
    oi: baseOI,
    change_oi: changeOI,
    iv: parseFloat(baseIV.toFixed(2)),
    bid_price: bidPrice,
    bid_qty: bidQty,
    ask_price: askPrice,
    ask_qty: askQty,
  };
};

/**
 * Fetch option chain data from the NSE India API.
 * Uses the option-chain-v3 endpoint to get real-time data including:
 * - Underlying spot price
 * - Strike prices
 * - Expiry dates
 * - CE and PE option data for each strike
 *
 * Falls back to mock data if NSE API is unavailable.
 *
 * @param {string} symbol - Index symbol
 * @param {string} expiry - Optional expiry date filter
 * @returns {Promise<Object>} - Option chain data with CE and PE options
 */
const fetchFromMarketAPI = async (symbol, expiry = null) => {
  const upperSymbol = symbol.toUpperCase();

  // Try to fetch real data from NSE API
  try {
    const nseData = await nseApiService.getOptionChainData(upperSymbol, expiry);

    if (nseData && nseData.data && nseData.data.length > 0) {
      // Use real NSE data
      return {
        symbol: nseData.symbol,
        underlyingPrice: nseData.underlyingPrice,
        timestamp: new Date(nseData.timestamp),
        data: nseData.data,
      };
    }

    // NSE data not available, fall back to mock with real strike prices
    const nseStrikes = await nseApiService.getStrikePrices(upperSymbol);
    const nsePrice = await nseApiService.getUnderlyingPrice(upperSymbol);

    if (nsePrice !== null) {
      return generateMockOptionChain(upperSymbol, nsePrice, nseStrikes);
    }

    // Fall back to fully mock data
    const isNifty = upperSymbol === 'NIFTY';
    const basePrice = isNifty ? 24252.00 : 55000.00;
    const underlyingPrice = basePrice;
    return generateMockOptionChain(upperSymbol, underlyingPrice, nseStrikes);
  } catch (error) {
    console.warn(`⚠️ NSE API fetch failed for ${symbol}, falling back to mock data:`, error.message);

    // Fallback to mock data
    const isNifty = upperSymbol === 'NIFTY';
    const basePrice = isNifty ? 24252.00 : 55000.00;
    const underlyingPrice = basePrice;
    return generateMockOptionChain(upperSymbol, underlyingPrice);
  }
};

/**
 * Refresh option chain data for an index.
 * Fetches latest data from NSE API (or mock) and stores it in the database.
 *
 * @param {string} symbol - Index symbol
 * @param {string} expiry - Optional expiry date filter
 * @returns {Promise<Object>} - Refresh result
 */
const refreshOptionChain = async (symbol, expiry = null) => {
  const index = await models.getIndexBySymbol(symbol);
  if (!index) {
    throw new Error(`Index not found: ${symbol}`);
  }

  // Fetch latest data from market API (NSE or mock)
  const marketData = await fetchFromMarketAPI(symbol, expiry);

  // Store underlying price
  await models.insertUnderlyingPrice(index.id, marketData.underlyingPrice);

  // Create snapshot
  const snapshot = await models.createSnapshot({
    indexId: index.id,
    underlyingPrice: marketData.underlyingPrice,
    timestamp: marketData.timestamp,
  });

  // Insert option chain data
  await models.insertOptionChainData(snapshot.id, marketData.data);

  return {
    snapshotId: snapshot.id,
    indexId: index.id,
    symbol: index.symbol,
    underlyingPrice: marketData.underlyingPrice,
    timestamp: snapshot.timestamp,
    dataCount: marketData.data.length,
  };
};

/**
 * Get latest option chain data for an index.
 * If no data exists, generates and stores mock data.
 *
 * @param {string} symbol - Index symbol
 * @returns {Promise<Object>} - Option chain data
 */
const getLatestOptionChain = async (symbol) => {
  const index = await models.getIndexBySymbol(symbol);
  if (!index) {
    throw new Error(`Index not found: ${symbol}`);
  }

  let chain = await models.getLatestOptionChain(index.id);

  if (!chain) {
    // No data exists, generate and store mock data
    const result = await refreshOptionChain(symbol);
    chain = await models.getLatestOptionChain(index.id);
  }

  return chain;
};

module.exports = {
  generateMockOptionChain,
  fetchFromMarketAPI,
  refreshOptionChain,
  getLatestOptionChain,
};
