/**
 * NSE (National Stock Exchange) API Service
 *
 * Fetches real-time live option chain data directly from the official NSE India API:
 * - https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=08-Sep-2026
 * - https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY
 * - https://www.nseindia.com/api/option-chain-equities?symbol=RELIANCE
 */

const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

// In-memory cache for API responses
const cache = new Map();
const CACHE_TTL_MS = parseInt(process.env.NSE_CACHE_TTL_SECONDS || 3, 10) * 1000;

// NSE Base URL
const NSE_BASE_URL = process.env.NSE_API_BASE_URL || 'https://www.nseindia.com';

const cookieStore = new Map();
let lastSessionTime = 0;

// Chrome TLS ciphers for Akamai / NSE WAF bypass
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  family: 4,
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
  ].join(':'),
  honorCipherOrder: true,
  minVersion: 'TLSv1.2',
});

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const getCookieHeader = () => {
  return Array.from(cookieStore.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
};

const saveCookies = (setCookieHeaders) => {
  if (!setCookieHeaders) return;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const item of list) {
    const firstPart = item.split(';')[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const key = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (key && val) {
        cookieStore.set(key, val);
      }
    }
  }
};

/**
 * Perform HTTPS request with decompression & cookie tracking
 */
const makeHttpsRequest = (targetUrl, customHeaders = {}, isApi = false) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const cookies = getCookieHeader();

    let headers = {
      Host: parsed.host,
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    };

    if (isApi) {
      headers = {
        ...headers,
        Accept: 'application/json, text/plain, */*',
        Referer: `${NSE_BASE_URL}/option-chain`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...customHeaders,
      };
    } else {
      headers = {
        ...headers,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...customHeaders,
      };
    }

    if (cookies) {
      headers.Cookie = cookies;
    }

    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      agent: httpsAgent,
      family: 4,
      headers,
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      saveCookies(res.headers['set-cookie']);

      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = `https://${parsed.hostname}${redirectUrl}`;
        }
        return resolve(makeHttpsRequest(redirectUrl, customHeaders, isApi));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];

        let decoded;
        try {
          if (encoding === 'gzip') {
            decoded = zlib.gunzipSync(buffer).toString('utf-8');
          } else if (encoding === 'deflate') {
            decoded = zlib.inflateSync(buffer).toString('utf-8');
          } else if (encoding === 'br') {
            decoded = zlib.brotliDecompressSync(buffer).toString('utf-8');
          } else {
            decoded = buffer.toString('utf-8');
          }
        } catch (e) {
          decoded = buffer.toString('utf-8');
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: decoded,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
};

/**
 * Initialize / refresh session cookies from NSE pages.
 */
const initializeSession = async (force = false) => {
  if (!force && cookieStore.size >= 2 && Date.now() - lastSessionTime < 3 * 60 * 1000) {
    return;
  }

  try {
    await makeHttpsRequest(NSE_BASE_URL, {}, false);
    const res = await makeHttpsRequest(`${NSE_BASE_URL}/option-chain`, {
      Referer: `${NSE_BASE_URL}/`,
    }, false);

    if (res.statusCode === 200) {
      lastSessionTime = Date.now();
    }
  } catch (err) {
    console.warn('⚠️ Session handshake notice:', err.message);
  }
};

/**
 * Perform authenticated request to NSE JSON endpoints.
 */
const fetchNSEJson = async (url) => {
  try {
    await initializeSession();
    let res = await makeHttpsRequest(url, {}, true);

    if (res.statusCode === 401 || res.statusCode === 403) {
      cookieStore.clear();
      await initializeSession(true);
      res = await makeHttpsRequest(url, {}, true);
    }

    if (res.statusCode !== 200 || !res.body) {
      return null;
    }

    return JSON.parse(res.body);
  } catch (error) {
    console.warn(`⚠️ Error fetching NSE JSON for ${url}:`, error.message);
    return null;
  }
};

const parseExpiryDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(dateStr);
  const day = parseInt(parts[0], 10);
  const monthMap = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = monthMap[parts[1].toLowerCase()];
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || month === undefined || isNaN(year)) return new Date(dateStr);
  return new Date(year, month, day, 23, 59, 59);
};

const isCurrentOrFutureExpiry = (dateStr) => {
  const d = parseExpiryDate(dateStr);
  if (!d || isNaN(d.getTime())) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d >= today;
};

/**
 * Check if symbol is an index.
 */
const isIndex = (symbol) => {
  const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'];
  return indices.includes((symbol || '').toUpperCase());
};

/**
 * Fetch full live option chain for an index/equity directly from NSE.
 * Primary Endpoint:
 * https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=08-Sep-2026
 *
 * Fallback Endpoint:
 * https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY
 */
const getOptionChainData = async (symbol, expiry = null) => {
  const upperSymbol = (symbol || 'NIFTY').toUpperCase().trim();
  const trimmedExpiry = expiry ? expiry.trim() : null;
  const cacheKey = `nse:live-chain:${upperSymbol}:${trimmedExpiry || 'all'}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const isIndexSymbol = isIndex(upperSymbol);
  let v3Url = `${NSE_BASE_URL}/api/option-chain-v3?type=${isIndexSymbol ? 'Indices' : 'Equities'}&symbol=${encodeURIComponent(upperSymbol)}`;
  if (trimmedExpiry) {
    v3Url += `&expiry=${encodeURIComponent(trimmedExpiry)}`;
  }
  const fallbackUrl = isIndexSymbol
    ? `${NSE_BASE_URL}/api/option-chain-indices?symbol=${encodeURIComponent(upperSymbol)}`
    : `${NSE_BASE_URL}/api/option-chain-equities?symbol=${encodeURIComponent(upperSymbol)}`;

  console.log('📡 [NSE API REQUEST v3]:', v3Url);
  let rawData = await fetchNSEJson(v3Url);
  if (!rawData || (!rawData.records && !rawData.filtered)) {
    console.log('⚠️ [NSE API v3 fallback to indices URL]:', fallbackUrl);
    rawData = await fetchNSEJson(fallbackUrl);
  }

  if (!rawData || (!rawData.records && !rawData.filtered)) {
    console.warn('❌ [NSE API FAILED / NULL RESPONSE] for symbol:', upperSymbol);
    return null;
  }

  console.log('📊 [NSE API RAW RESPONSE RECEIVED]:', {
    underlyingValue: rawData.records?.underlyingValue || rawData.filtered?.CE?.underlyingValue,
    expiryDates: rawData.records?.expiryDates?.slice(0, 5),
    dataRowsCount: (rawData.records?.data || rawData.filtered?.data || []).length,
    sampleRow: (rawData.records?.data || rawData.filtered?.data || [])[0],
  });

  const records = rawData.records || {};
  const filtered = rawData.filtered || {};

  const allExpiryDates = records.expiryDates || filtered.expiryDates || [];
  const expiryDates = allExpiryDates.filter(isCurrentOrFutureExpiry);
  const strikePrices = (records.strikePrices || filtered.strikePrices || [])
    .map((s) => parseFloat(s))
    .filter((s) => !isNaN(s))
    .sort((a, b) => a - b);

  const timestamp = records.timestamp || new Date().toISOString();

  // Determine target expiry date (only current/future active dates)
  const targetExpiry = trimmedExpiry || rawData.selectedExpiry || expiryDates[0] || null;

  // Extract raw rows
  let rawRows = [];
  if (filtered.data && Array.isArray(filtered.data) && filtered.data.length > 0) {
    rawRows = filtered.data;
  } else if (records.data && Array.isArray(records.data) && records.data.length > 0) {
    rawRows = records.data;
  }

  // Filter records by selected expiry date if needed
  const getRowExpiry = (r) => r.expiryDate || r.CE?.expiryDate || r.PE?.expiryDate || '';
  if (targetExpiry && rawRows.some((r) => getRowExpiry(r).toLowerCase() === targetExpiry.toLowerCase())) {
    rawRows = rawRows.filter((r) => getRowExpiry(r).toLowerCase() === targetExpiry.toLowerCase());
  }

  // Determine underlying price
  let underlyingValue =
    parseFloat(
      records.underlyingValue ||
      filtered.CE?.underlyingValue ||
      filtered.PE?.underlyingValue ||
      rawData.records?.underlyingValue ||
      rawRows[0]?.CE?.underlyingValue ||
      rawRows[0]?.PE?.underlyingValue ||
      rawData.underlyingValue ||
      0
    ) || 0;

  // Transform rows to standard CE/PE format
  const transformedData = [];

  for (const row of rawRows) {
    const strike = parseFloat(row.strikePrice || row.CE?.strikePrice || row.PE?.strikePrice);
    if (isNaN(strike)) continue;

    if (row.CE) {
      transformedData.push({
        strike_price: strike,
        option_type: 'CE',
        ltp: parseFloat(row.CE.lastPrice ?? row.CE.ltp ?? 0) || 0,
        change: parseFloat(row.CE.change ?? 0) || 0,
        p_change: parseFloat(row.CE.pChange ?? row.CE.PChange ?? row.CE.pchange ?? 0) || 0,
        volume: parseInt(row.CE.totalTradedVolume ?? row.CE.volume ?? row.CE.total_traded_volume ?? 0, 10) || 0,
        oi: parseInt(row.CE.openInterest ?? row.CE.oi ?? 0, 10) || 0,
        change_oi: parseInt(row.CE.changeinOpenInterest ?? row.CE.changeInOpenInterest ?? row.CE.change_oi ?? 0, 10) || 0,
        p_change_oi: parseFloat(row.CE.pchangeinOpenInterest ?? row.CE.pChangeInOpenInterest ?? row.CE.p_change_oi ?? 0) || 0,
        iv: parseFloat(row.CE.impliedVolatility ?? row.CE.iv ?? 0) || 0,
        bid_price: parseFloat(row.CE.buyPrice1 ?? row.CE.bidprice ?? row.CE.bidPrice ?? row.CE.buyPrice ?? 0) || 0,
        bid_qty: parseInt(row.CE.buyQuantity1 ?? row.CE.bidQty ?? row.CE.bidQuantity ?? row.CE.totalBuyQuantity ?? 0, 10) || 0,
        ask_price: parseFloat(row.CE.sellPrice1 ?? row.CE.askPrice ?? row.CE.askprice ?? row.CE.sellPrice ?? 0) || 0,
        ask_qty: parseInt(row.CE.sellQuantity1 ?? row.CE.askQty ?? row.CE.askQuantity ?? row.CE.totalSellQuantity ?? 0, 10) || 0,
      });
    }

    if (row.PE) {
      transformedData.push({
        strike_price: strike,
        option_type: 'PE',
        ltp: parseFloat(row.PE.lastPrice ?? row.PE.ltp ?? 0) || 0,
        change: parseFloat(row.PE.change ?? 0) || 0,
        p_change: parseFloat(row.PE.pChange ?? row.PE.PChange ?? row.PE.pchange ?? 0) || 0,
        volume: parseInt(row.PE.totalTradedVolume ?? row.PE.volume ?? row.PE.total_traded_volume ?? 0, 10) || 0,
        oi: parseInt(row.PE.openInterest ?? row.PE.oi ?? 0, 10) || 0,
        change_oi: parseInt(row.PE.changeinOpenInterest ?? row.PE.changeInOpenInterest ?? row.PE.change_oi ?? 0, 10) || 0,
        p_change_oi: parseFloat(row.PE.pchangeinOpenInterest ?? row.PE.pChangeInOpenInterest ?? row.PE.p_change_oi ?? 0) || 0,
        iv: parseFloat(row.PE.impliedVolatility ?? row.PE.iv ?? 0) || 0,
        bid_price: parseFloat(row.PE.buyPrice1 ?? row.PE.bidprice ?? row.PE.bidPrice ?? row.PE.buyPrice ?? 0) || 0,
        bid_qty: parseInt(row.PE.buyQuantity1 ?? row.PE.bidQty ?? row.PE.bidQuantity ?? row.PE.totalBuyQuantity ?? 0, 10) || 0,
        ask_price: parseFloat(row.PE.sellPrice1 ?? row.PE.askPrice ?? row.PE.askprice ?? row.PE.sellPrice ?? 0) || 0,
        ask_qty: parseInt(row.PE.sellQuantity1 ?? row.PE.askQty ?? row.PE.askQuantity ?? row.PE.totalSellQuantity ?? 0, 10) || 0,
      });
    }
  }

  const result = {
    symbol: upperSymbol,
    underlyingPrice: underlyingValue,
    timestamp,
    expiryDates,
    strikePrices,
    selectedExpiry: targetExpiry,
    data: transformedData,
    source: 'nse-live',
  };

  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
};

/**
 * Get available expiry dates for an index from NSE.
 */
const getExpiryDates = async (symbol) => {
  const chainData = await getOptionChainData(symbol);
  return chainData?.expiryDates || [];
};

/**
 * Alias for getExpiryDates.
 */
const getExpiries = async (symbol) => {
  return getExpiryDates(symbol);
};

/**
 * Get nearest expiry date for an index from NSE.
 */
const getNearestExpiry = async (symbol) => {
  const expiries = await getExpiryDates(symbol);
  return expiries.length > 0 ? expiries[0] : null;
};

/**
 * Get available strike prices for an index from NSE.
 */
const getStrikePrices = async (symbol) => {
  const chainData = await getOptionChainData(symbol);
  return chainData?.strikePrices || [];
};

/**
 * Get strike prices filtered by specific expiry date.
 */
const getStrikePricesByExpiry = async (symbol, expiry) => {
  const chainData = await getOptionChainData(symbol, expiry);
  if (chainData && chainData.data && chainData.data.length > 0) {
    const strikes = [...new Set(chainData.data.map((d) => d.strike_price))].sort((a, b) => a - b);
    return strikes;
  }
  return chainData?.strikePrices || [];
};

/**
 * Get ATM strike prices within a given range (+/- range strikes around ATM).
 */
const getATMStrikePrices = async (symbol, range = 10) => {
  const chainData = await getOptionChainData(symbol);
  if (!chainData || !chainData.strikePrices || chainData.strikePrices.length === 0) {
    return [];
  }
  const strikes = chainData.strikePrices;
  const underlying = chainData.underlyingPrice;

  const atmIndex = strikes.reduce((closest, s, idx) => {
    return Math.abs(s - underlying) < Math.abs(strikes[closest] - underlying) ? idx : closest;
  }, 0);

  const start = Math.max(0, atmIndex - range);
  const end = Math.min(strikes.length, atmIndex + range + 1);
  return strikes.slice(start, end);
};

/**
 * Get current underlying price from NSE.
 */
const getUnderlyingPrice = async (symbol) => {
  const chainData = await getOptionChainData(symbol);
  return chainData?.underlyingPrice || null;
};

/**
 * Get contract info (strike prices and expiry dates).
 */
const getContractInfo = async (symbol) => {
  const chainData = await getOptionChainData(symbol);
  if (!chainData) return null;
  return {
    symbol: chainData.symbol,
    strikePrices: chainData.strikePrices,
    expiryDates: chainData.expiryDates,
    timestamp: chainData.timestamp,
  };
};

module.exports = {
  getOptionChainData,
  getExpiryDates,
  getExpiries,
  getNearestExpiry,
  getStrikePrices,
  getStrikePricesByExpiry,
  getATMStrikePrices,
  getUnderlyingPrice,
  getContractInfo,
  initializeSession,
};
