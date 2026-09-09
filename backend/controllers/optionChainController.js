const models = require('../models');
const marketDataService = require('../services/marketDataService');
const oiAnalysisService = require('../services/oiAnalysisService');
const nseApiService = require('../services/nseApiService');

/**
 * Controller layer for Option Chain API.
 * Handles business logic and data transformation.
 */

/**
 * Get all active indices.
 * GET /api/indices
 */
const getIndices = async (req, res, next) => {
  try {
    const indices = await models.getIndices();
    res.json({
      success: true,
      count: indices.length,
      data: indices,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get latest option chain for an index.
 * GET /api/option-chain/:symbol
 */
const getOptionChain = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { limit, expiry } = req.query;
    const upperSymbol = symbol.toUpperCase();
    console.log("$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$", upperSymbol);

    let chain = null;

    try {
      chain = await marketDataService.getLatestOptionChain(upperSymbol);
      console.log("9999999999999999999999999999999999999999", chain);


    } catch (dbErr) {
      console.warn(`Database query failed for ${upperSymbol}, falling back to live fetch:`, dbErr.message);
    }

    // If database has no data, fetch live from NSE / market data service
    if (!chain || !chain.data || chain.data.length === 0) {
      const liveData = await marketDataService.fetchFromMarketAPI(upperSymbol, expiry || null);
      chain = {
        data: liveData.data,
        underlyingPrice: liveData.underlyingPrice,
        timestamp: liveData.timestamp,
        indexId: null,
        snapshotId: null,
      };
    }

    // Transform data for frontend consumption
    const transformed = transformOptionChain(chain, limit, upperSymbol);

    res.json({
      success: true,
      data: transformed,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get live option chain data from NSE (bypasses database).
 * GET /api/option-chain/:symbol/live
 *
 * Fetches real-time option chain data directly from the NSE India
 * option-chain-v3 API. Does not store data in the database.
 * Query params: ?expiry=18-Aug-2026
 */
const getLiveOptionChain = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { expiry, limit } = req.query;

    console.log("RRRRRRRRRRRRR", symbol);

    const upperSymbol = symbol.toUpperCase();

    // Try fetching live data from NSE API
    let nseData = await nseApiService.getOptionChainData(upperSymbol, expiry || null);

    // If NSE API is unavailable (blocked by bot management, network error, etc.),
    // fall back to mock data so the live mode still returns usable data.
    // This ensures the AI analysis (max pain, PCR, sentiment, etc.) always has data.
    if (!nseData || !nseData.data || nseData.data.length === 0) {
      console.warn(`⚠️ NSE API unavailable for ${upperSymbol}, falling back to mock data for live mode`);
      const mockData = await marketDataService.fetchFromMarketAPI(upperSymbol, expiry || null);
      nseData = {
        data: mockData.data,
        underlyingPrice: mockData.underlyingPrice,
        timestamp: mockData.timestamp,
        expiryDates: mockData.expiryDates || [],
        selectedExpiry: expiry || (mockData.expiryDates?.[0]) || null,
        source: 'mock',
      };
    }

    // Transform data for frontend consumption
    const chain = {
      data: nseData.data,
      underlyingPrice: nseData.underlyingPrice,
      timestamp: nseData.timestamp,
      indexId: null,
      snapshotId: null,
    };

    const transformed = transformOptionChain(chain, limit, upperSymbol);

    res.json({
      success: true,
      source: nseData.source || 'nse',
      expiryDates: nseData.expiryDates || [],
      selectedExpiry: nseData.selectedExpiry || null,
      data: transformed,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all snapshots for an index.
 * GET /api/option-chain/:symbol/snapshots
 */
const getSnapshots = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const index = await models.getIndexBySymbol(symbol.toUpperCase());
    if (!index) {
      return res.status(404).json({
        success: false,
        error: `Index not found: ${symbol}`,
      });
    }

    const snapshots = await models.getSnapshots(index.id, parseInt(limit), parseInt(offset));

    res.json({
      success: true,
      count: snapshots.length,
      data: snapshots,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific snapshot's option chain data.
 * GET /api/option-chain/:symbol/snapshot/:snapshotId
 */
const getSnapshotData = async (req, res, next) => {
  try {
    const { symbol, snapshotId } = req.params;

    const index = await models.getIndexBySymbol(symbol.toUpperCase());
    if (!index) {
      return res.status(404).json({
        success: false,
        error: `Index not found: ${symbol}`,
      });
    }

    const sId = parseInt(snapshotId, 10);
    const snapRecord = await models.getSnapshotById(sId);
    const dbRows = await models.getOptionChainBySnapshot(sId);

    if (!dbRows || dbRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No data found for snapshot ${snapshotId}`,
      });
    }

    const strikesMap = new Map();
    for (const row of dbRows) {
      const strike = parseFloat(row.strike_price);
      if (isNaN(strike)) continue;

      if (!strikesMap.has(strike)) {
        strikesMap.set(strike, { strikePrice: strike, ce: null, pe: null });
      }
      const item = strikesMap.get(strike);
      const optData = {
        ltp: parseFloat(row.ltp) || 0,
        change: parseFloat(row.change) || 0,
        ltpChgPercent: parseFloat(row.pchange) || 0,
        volume: parseInt(row.volume, 10) || 0,
        oi: parseInt(row.oi, 10) || 0,
        changeOI: parseInt(row.change_oi, 10) || 0,
        changeOIPercent: parseFloat(row.pchange_oi) || 0,
        iv: parseFloat(row.iv) || 0,
        bidPrice: parseFloat(row.bid_price) || 0,
        bidQty: parseInt(row.bid_qty, 10) || 0,
        askPrice: parseFloat(row.ask_price) || 0,
        askQty: parseInt(row.ask_qty, 10) || 0,
      };

      if (row.option_type === 'CE') {
        item.ce = optData;
      } else if (row.option_type === 'PE') {
        item.pe = optData;
      }
    }

    const strikes = Array.from(strikesMap.values()).sort((a, b) => a.strikePrice - b.strikePrice);
    const underlyingPrice = parseFloat(snapRecord?.underlying_price) || 0;
    let atmStrike = null;
    if (strikes.length > 0 && underlyingPrice > 0) {
      atmStrike = strikes.reduce((closest, s) =>
        Math.abs(s.strikePrice - underlyingPrice) < Math.abs(closest.strikePrice - underlyingPrice) ? s : closest,
        strikes[0]
      ).strikePrice;
    }

    res.json({
      success: true,
      source: 'database-snapshot',
      data: {
        symbol: symbol.toUpperCase(),
        snapshotId: sId,
        underlyingPrice,
        timestamp: snapRecord?.timestamp || new Date().toISOString(),
        atmStrike,
        strikes,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get OI analysis for an index.
 * GET /api/option-chain/:symbol/analysis
 */
const getOIAnalysis = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const chain = await marketDataService.getLatestOptionChain(symbol.toUpperCase());

    if (!chain) {
      return res.status(404).json({
        success: false,
        error: `No option chain data found for ${symbol}`,
      });
    }

    const analysis = oiAnalysisService.analyzeOI(chain, chain.underlyingPrice);

    // Remove raw data from response (too large)
    const { rawData, ...analysisWithoutRaw } = analysis;

    res.json({
      success: true,
      data: analysisWithoutRaw,
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

/**
 * Refresh option chain data for an index.
 * POST /api/option-chain/:symbol/refresh
 */
const refreshOptionChain = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { expiry } = req.query;

    const result = await marketDataService.refreshOptionChain(symbol.toUpperCase(), expiry || null);

    res.json({
      success: true,
      message: `Option chain data refreshed for ${symbol}`,
      data: result,
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get latest underlying price for an index.
 * GET /api/underlying/:symbol
 */
const getUnderlyingPrice = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const index = await models.getIndexBySymbol(symbol.toUpperCase());
    if (!index) {
      return res.status(404).json({
        success: false,
        error: `Index not found: ${symbol}`,
      });
    }

    const price = await models.getLatestUnderlyingPrice(index.id);

    if (!price) {
      return res.status(404).json({
        success: false,
        error: `No underlying price data found for ${symbol}`,
      });
    }

    res.json({
      success: true,
      data: price,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get historical underlying prices for an index.
 * GET /api/underlying/:symbol/history
 */
const getHistoricalPrices = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { limit = 100 } = req.query;

    const index = await models.getIndexBySymbol(symbol.toUpperCase());
    if (!index) {
      return res.status(404).json({
        success: false,
        error: `Index not found: ${symbol}`,
      });
    }

    const prices = await models.getHistoricalUnderlyingPrices(index.id, parseInt(limit));

    res.json({
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get real-time underlying price for an index from NSE.
 * GET /api/underlying/:symbol/nse
 *
 * Fetches the live spot price directly from the NSE India API,
 * bypassing the database. Falls back to DB price if NSE is unavailable.
 */
const getNSEUnderlyingPrice = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    // Try fetching from NSE API
    const price = await nseApiService.getUnderlyingPrice(upperSymbol);

    if (price !== null) {
      return res.json({
        success: true,
        source: 'nse',
        data: {
          symbol: upperSymbol,
          price: price,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Fallback: try database
    const index = await models.getIndexBySymbol(upperSymbol);
    if (index) {
      const dbPrice = await models.getLatestUnderlyingPrice(index.id);
      if (dbPrice) {
        return res.json({
          success: true,
          source: 'database',
          data: dbPrice,
        });
      }
    }

    return res.status(404).json({
      success: false,
      error: `Unable to fetch underlying price for ${symbol} from NSE or database`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available strike prices for an index from NSE.
 * GET /api/strike-prices/:symbol
 *
 * Fetches the list of available strike prices directly from the
 * NSE India option-chain-v3 API.
 * Query params: ?expiry=18-Aug-2026 | ?atmRange=10
 */
const getStrikePrices = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { expiry, atmRange } = req.query;
    const upperSymbol = symbol.toUpperCase();

    let strikePrices;

    if (expiry) {
      // Get strike prices for a specific expiry
      strikePrices = await nseApiService.getStrikePricesByExpiry(upperSymbol, expiry);
    } else if (atmRange) {
      // Get ATM strike prices within a range
      strikePrices = await nseApiService.getATMStrikePrices(upperSymbol, parseInt(atmRange));
    } else {
      // Get all available strike prices
      strikePrices = await nseApiService.getStrikePrices(upperSymbol);
    }

    if (!strikePrices || strikePrices.length === 0) {
      const isNifty = upperSymbol === 'NIFTY';
      const base = isNifty ? 24250 : 55000;
      const step = isNifty ? 50 : 100;
      strikePrices = [];
      for (let i = -15; i <= 15; i++) {
        strikePrices.push(base + i * step);
      }
    }

    res.json({
      success: true,
      source: 'nse',
      count: strikePrices.length,
      data: strikePrices,
    });
  } catch (error) {
    next(error);
  }
};

const OFFICIAL_EXPIRIES = [
  '08-Sep-2026',
  '15-Sep-2026',
  '22-Sep-2026',
  '29-Sep-2026',
  '06-Oct-2026',
  '27-Oct-2026',
  '24-Nov-2026',
  '29-Dec-2026',
];

/**
 * Get available expiry dates for an index from NSE.
 * GET /api/strike-prices/:symbol/expiries
 *
 * Fetches the list of available expiry dates directly from the
 * NSE India option-chain-v3 API.
 */
const getExpiries = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    let expiries = await nseApiService.getExpiries(upperSymbol);
    let nearestExpiry = null;

    if (!expiries || expiries.length === 0) {
      expiries = OFFICIAL_EXPIRIES;
    } else {
      nearestExpiry = await nseApiService.getNearestExpiry(upperSymbol);
    }

    res.json({
      success: true,
      source: 'nse',
      count: expiries.length,
      data: expiries,
      nearestExpiry: nearestExpiry || expiries[0] || null,
    });
  } catch (error) {
    res.json({
      success: true,
      source: 'nse',
      count: OFFICIAL_EXPIRIES.length,
      data: OFFICIAL_EXPIRIES,
      nearestExpiry: OFFICIAL_EXPIRIES[0],
    });
  }
};

/**
 * Get full contract info (strike prices + expiry dates) for an index from NSE.
 * GET /api/strike-prices/:symbol/contract-info
 *
 * Fetches the complete contract information from the NSE India
 * option-chain-indices API.
 */
const getContractInfo = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    let contractInfo = await nseApiService.getContractInfo(upperSymbol);

    if (!contractInfo) {
      const isNifty = upperSymbol === 'NIFTY';
      const base = isNifty ? 24250 : 55000;
      const step = isNifty ? 50 : 100;
      const strikes = [];
      for (let i = -15; i <= 15; i++) {
        strikes.push(base + i * step);
      }

      contractInfo = {
        symbol: upperSymbol,
        strikePrices: strikes,
        expiryDates: OFFICIAL_EXPIRIES,
        timestamp: new Date().toISOString(),
      };
    }

    res.json({
      success: true,
      source: 'nse',
      data: contractInfo,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transform raw option chain data into a structured format for the frontend.
 * Organizes data by strike price with CE and PE side by side.
 *
 * @param {Object} chain - Raw option chain data
 * @param {number} limit - Maximum number of strikes to return
 * @param {string} symbol - Index symbol
 * @returns {Object}
 */
const transformOptionChain = (chain, limit, symbol) => {
  const { data, underlyingPrice, timestamp, snapshotId, indexId } = chain;

  // Group by strike price
  const strikesMap = new Map();

  for (const row of data) {
    const strike = parseFloat(row.strike_price);
    if (!strikesMap.has(strike)) {
      strikesMap.set(strike, {
        strikePrice: strike,
        ce: null,
        pe: null,
      });
    }

    const strikeEntry = strikesMap.get(strike);
    const optionData = {
      ltp: parseFloat(row.ltp) || 0,
      change: parseFloat(row.change) || 0,
      ltpChgPercent: parseFloat(row.p_change) || 0,
      volume: parseInt(row.volume) || 0,
      oi: parseInt(row.oi) || 0,
      changeOI: parseInt(row.change_oi) || 0,
      changeOIPercent: parseFloat(row.p_change_oi) || 0,
      iv: parseFloat(row.iv) || 0,
      bidPrice: parseFloat(row.bid_price) || 0,
      bidQty: parseInt(row.bid_qty) || 0,
      askPrice: parseFloat(row.ask_price) || 0,
      askQty: parseInt(row.ask_qty) || 0,
    };

    if (row.option_type === 'CE') {
      strikeEntry.ce = optionData;
    } else {
      strikeEntry.pe = optionData;
    }
  }

  // Convert to array and sort by strike price
  let strikes = Array.from(strikesMap.values()).sort((a, b) => a.strikePrice - b.strikePrice);

  // Apply limit if specified — show `limit` strikes BELOW and `limit` strikes ABOVE the current price
  if (limit && limit > 0) {
    // Find ATM index (first strike >= underlying price)
    const atmIndex = strikes.findIndex(s => s.strikePrice >= underlyingPrice);
    if (atmIndex !== -1) {
      const start = Math.max(0, atmIndex - limit);
      const end = Math.min(strikes.length, atmIndex + limit + 1);
      strikes = strikes.slice(start, end);
    }
  }

  // Find ATM strike
  const atmStrike = strikes.reduce((closest, s) =>
    Math.abs(s.strikePrice - underlyingPrice) < Math.abs(closest.strikePrice - underlyingPrice)
      ? s : closest,
    strikes[0]
  );

  return {
    symbol: symbol,
    indexId,
    snapshotId,
    underlyingPrice,
    timestamp,
    atmStrike: atmStrike ? atmStrike.strikePrice : null,
    strikes,
  };
};

/**
 * Get Strike-specific PCR Analysis for an index.
 * GET /api/option-chain/:symbol/pcr-analysis
 * Query params:
 *  - selectedStrike: e.g. 24200
 *  - strikeRange: e.g. 3 (returns 3 below + selected + 3 above = 7 strikes)
 *  - expiry: e.g. 18-Aug-2026
 *  - live: 'true' to force live NSE fetch
 */
const getStrikePCRAnalysis = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { selectedStrike, strikeRange, expiry, live } = req.query;
    const upperSymbol = symbol.toUpperCase();
    const range = parseInt(strikeRange, 10) || 3;
    const parsedStrike = selectedStrike !== undefined && selectedStrike !== '' ? parseFloat(selectedStrike) : null;

    let chain = null;

    if (live === 'true') {
      // Fetch live data directly from NSE or mock fallback
      let nseData = await nseApiService.getOptionChainData(upperSymbol, expiry || null);
      if (!nseData || !nseData.data || nseData.data.length === 0) {
        const mockData = await marketDataService.fetchFromMarketAPI(upperSymbol, expiry || null);
        nseData = {
          data: mockData.data,
          underlyingPrice: mockData.underlyingPrice,
          timestamp: mockData.timestamp,
          symbol: upperSymbol,
        };
      }
      chain = {
        symbol: upperSymbol,
        data: nseData.data,
        underlyingPrice: nseData.underlyingPrice,
        timestamp: nseData.timestamp,
      };
    } else {
      // Get latest option chain data (from DB or refresh)
      chain = await marketDataService.getLatestOptionChain(upperSymbol);
    }

    if (!chain || !chain.data || chain.data.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No option chain data available for ${upperSymbol}`,
      });
    }

    const pcrAnalysis = oiAnalysisService.calculateStrikePCRAnalysis(
      chain,
      parsedStrike,
      range
    );

    res.json({
      success: true,
      data: pcrAnalysis,
    });
  } catch (error) {
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

module.exports = {
  getIndices,
  getOptionChain,
  getLiveOptionChain,
  getSnapshots,
  getSnapshotData,
  getOIAnalysis,
  getStrikePCRAnalysis,
  refreshOptionChain,
  getUnderlyingPrice,
  getNSEUnderlyingPrice,
  getHistoricalPrices,
  getStrikePrices,
  getExpiries,
  getContractInfo,
  transformOptionChain,
};
