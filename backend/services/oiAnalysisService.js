/**
 * Open Interest (OI) Analysis Service
 *
 * Provides bullish/bearish analysis based on Open Interest data.
 * Key metrics calculated:
 * - Max OI strike (highest open interest)
 * - PCR (Put Call Ratio)
 * - OI Change analysis (building/burning positions)
 * - Support/Resistance levels based on OI
 * - Bullish/Bearish sentiment indicators
 */

/**
 * Analyze option chain data for bullish/bearish signals.
 *
 * @param {Object} optionChain - Option chain data with CE/PE options
 * @param {number} underlyingPrice - Current spot price
 * @returns {Object} - Analysis results
 */
const analyzeOI = (optionChain, underlyingPrice) => {
  const { data } = optionChain;

  // Separate CE and PE data
  const ceData = data.filter(d => d.option_type === 'CE');
  const peData = data.filter(d => d.option_type === 'PE');

  // Calculate total OI
  const totalCEOI = ceData.reduce((sum, d) => sum + (parseInt(d.oi) || 0), 0);
  const totalPEOI = peData.reduce((sum, d) => sum + (parseInt(d.oi) || 0), 0);
  const totalOI = totalCEOI + totalPEOI;

  // Calculate total volume
  const totalCEVolume = ceData.reduce((sum, d) => sum + (parseInt(d.volume) || 0), 0);
  const totalPEVolume = peData.reduce((sum, d) => sum + (parseInt(d.volume) || 0), 0);

  // Put Call Ratio (OI-based)
  const pcrOI = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : 0;
  const pcrVolume = totalCEVolume > 0 ? (totalPEVolume / totalCEVolume).toFixed(2) : 0;

  // Max OI strikes
  const maxOISTrikeCE = ceData.reduce((max, d) =>
    (parseInt(d.oi) || 0) > (parseInt(max.oi) || 0) ? d : max, ceData[0] || {});
  const maxOISTrikePE = peData.reduce((max, d) =>
    (parseInt(d.oi) || 0) > (parseInt(max.oi) || 0) ? d : max, peData[0] || {});

  // OI Change Analysis
  const totalChangeCEOI = ceData.reduce((sum, d) => sum + (parseInt(d.change_oi) || 0), 0);
  const totalChangePEOI = peData.reduce((sum, d) => sum + (parseInt(d.change_oi) || 0), 0);

  // Determine sentiment
  const sentiment = determineSentiment({
    totalCEOI,
    totalPEOI,
    totalChangeCEOI,
    totalChangePEOI,
    pcrOI,
    underlyingPrice,
    ceData,
    peData,
  });

  // Find support and resistance levels based on OI concentration
  const supportResistance = findSupportResistance(ceData, peData, underlyingPrice);

  // Max pain calculation
  const maxPain = calculateMaxPain(data, underlyingPrice);

  // OI concentration around ATM
  const atmOIAnalysis = analyzeATMConcentration(data, underlyingPrice);

  return {
    underlyingPrice,
    timestamp: optionChain.timestamp,
    totalOI: {
      calls: totalCEOI,
      puts: totalPEOI,
      total: totalOI,
    },
    totalVolume: {
      calls: totalCEVolume,
      puts: totalPEVolume,
    },
    pcr: {
      oi: parseFloat(pcrOI),
      volume: parseFloat(pcrVolume),
    },
    maxOISTrikes: {
      call: {
        strike: parseFloat(maxOISTrikeCE.strike_price) || 0,
        oi: parseInt(maxOISTrikeCE.oi) || 0,
      },
      put: {
        strike: parseFloat(maxOISTrikePE.strike_price) || 0,
        oi: parseInt(maxOISTrikePE.oi) || 0,
      },
    },
    oiChange: {
      calls: totalChangeCEOI,
      puts: totalChangePEOI,
      net: totalChangePEOI - totalChangeCEOI,
    },
    sentiment,
    supportResistance,
    maxPain,
    atmOIAnalysis,
    rawData: {
      ceData,
      peData,
    },
  };
};

/**
 * Determine bullish/bearish sentiment based on OI data.
 *
 * @param {Object} params
 * @returns {Object}
 */
const determineSentiment = (params) => {
  const {
    totalCEOI,
    totalPEOI,
    totalChangeCEOI,
    totalChangePEOI,
    pcrOI,
    underlyingPrice,
    ceData,
    peData,
  } = params;

  let score = 0;
  const signals = [];

  // 1. PCR Analysis
  if (pcrOI > 1.2) {
    score += 2;
    signals.push({ type: 'bullish', reason: `High PCR (${pcrOI}) indicates more put OI than call OI` });
  } else if (pcrOI < 0.8) {
    score -= 2;
    signals.push({ type: 'bearish', reason: `Low PCR (${pcrOI}) indicates more call OI than put OI` });
  } else {
    signals.push({ type: 'neutral', reason: `Balanced PCR (${pcrOI})` });
  }

  // 2. OI Change Analysis
  const netOIChange = totalChangePEOI - totalChangeCEOI;
  if (netOIChange > 0) {
    score += 1;
    signals.push({ type: 'bullish', reason: `Net OI increase in puts suggests accumulation` });
  } else if (netOIChange < 0) {
    score -= 1;
    signals.push({ type: 'bearish', reason: `Net OI decrease suggests position unwinding` });
  }

  // 3. OI Concentration at Strikes
  // Check if highest OI is above or below current price
  const maxOICallStrike = ceData.reduce((max, d) =>
    (parseInt(d.oi) || 0) > (parseInt(max.oi) || 0) ? d : max, ceData[0] || { strike_price: 0, oi: 0 });
  const maxOIPutStrike = peData.reduce((max, d) =>
    (parseInt(d.oi) || 0) > (parseInt(max.oi) || 0) ? d : max, peData[0] || { strike_price: 0, oi: 0 });

  const callStrike = parseFloat(maxOICallStrike.strike_price) || 0;
  const putStrike = parseFloat(maxOIPutStrike.strike_price) || 0;

  if (callStrike > underlyingPrice) {
    score -= 1;
    signals.push({ type: 'bearish', reason: `Highest call OI at ${callStrike} (above spot ${underlyingPrice})` });
  } else if (callStrike < underlyingPrice) {
    score += 1;
    signals.push({ type: 'bullish', reason: `Highest call OI at ${callStrike} (below spot ${underlyingPrice})` });
  }

  if (putStrike < underlyingPrice) {
    score += 1;
    signals.push({ type: 'bullish', reason: `Highest put OI at ${putStrike} (below spot ${underlyingPrice})` });
  } else if (putStrike > underlyingPrice) {
    score -= 1;
    signals.push({ type: 'bearish', reason: `Highest put OI at ${putStrike} (above spot ${underlyingPrice})` });
  }

  // 4. Change in OI at ATM
  const atmStrikes = findATMStrikes(ceData, peData, underlyingPrice);
  if (atmStrikes.ce && atmStrikes.pe) {
    const atmChangeCE = parseInt(atmStrikes.ce.change_oi) || 0;
    const atmChangePE = parseInt(atmStrikes.pe.change_oi) || 0;

    if (atmChangeCE > 0 && atmChangePE > 0) {
      score += 0;
      signals.push({ type: 'neutral', reason: 'Both CE and PE OI increasing at ATM (straddle building)' });
    } else if (atmChangeCE > 0) {
      score -= 1;
      signals.push({ type: 'bearish', reason: 'CE OI increasing at ATM (directional call buying)' });
    } else if (atmChangePE > 0) {
      score += 1;
      signals.push({ type: 'bullish', reason: 'PE OI increasing at ATM (directional put buying)' });
    }
  }

  // Determine overall sentiment
  let overall;
  if (score >= 3) {
    overall = 'strongly_bullish';
  } else if (score >= 1) {
    overall = 'bullish';
  } else if (score <= -3) {
    overall = 'strongly_bearish';
  } else if (score <= -1) {
    overall = 'bearish';
  } else {
    overall = 'neutral';
  }

  return {
    overall,
    score,
    signals,
  };
};

/**
 * Find support and resistance levels based on OI concentration.
 *
 * @param {Array} ceData - Call option data
 * @param {Array} peData - Put option data
 * @param {number} underlyingPrice - Current spot price
 * @returns {Object}
 */
const findSupportResistance = (ceData, peData, underlyingPrice) => {
  // Resistance: strikes above current price with high CE OI
  const resistanceStrikes = ceData
    .filter(d => parseFloat(d.strike_price) > underlyingPrice)
    .sort((a, b) => (parseInt(b.oi) || 0) - (parseInt(a.oi) || 0))
    .slice(0, 3)
    .map(d => ({
      strike: parseFloat(d.strike_price),
      oi: parseInt(d.oi) || 0,
      type: 'resistance',
    }));

  // Support: strikes below current price with high PE OI
  const supportStrikes = peData
    .filter(d => parseFloat(d.strike_price) < underlyingPrice)
    .sort((a, b) => (parseInt(b.oi) || 0) - (parseInt(a.oi) || 0))
    .slice(0, 3)
    .map(d => ({
      strike: parseFloat(d.strike_price),
      oi: parseInt(d.oi) || 0,
      type: 'support',
    }));

  return {
    resistance: resistanceStrikes,
    support: supportStrikes,
  };
};

/**
 * Calculate Max Pain (the strike where the total payout to option holders is maximized).
 *
 * @param {Array} data - All option chain data
 * @param {number} underlyingPrice - Current spot price
 * @returns {Object}
 */
const calculateMaxPain = (data, underlyingPrice) => {
  const strikes = [...new Set(data.map(d => parseFloat(d.strike_price)))].sort((a, b) => a - b);

  let minTotalPayout = Infinity;
  let maxPainStrike = 0;

  for (const strike of strikes) {
    let totalPayout = 0;

    for (const opt of data) {
      const optStrike = parseFloat(opt.strike_price);
      const optType = opt.option_type;

      if (optType === 'CE') {
        // Call payoff: max(0, strike - optStrike)
        totalPayout += Math.max(0, strike - optStrike) * (parseInt(opt.oi) || 0);
      } else {
        // Put payoff: max(0, optStrike - strike)
        totalPayout += Math.max(0, optStrike - strike) * (parseInt(opt.oi) || 0);
      }
    }

    if (totalPayout < minTotalPayout) {
      minTotalPayout = totalPayout;
      maxPainStrike = strike;
    }
  }

  return {
    strike: maxPainStrike,
    distanceFromSpot: underlyingPrice - maxPainStrike,
  };
};

/**
 * Find ATM strikes (closest to underlying price).
 *
 * @param {Array} ceData - Call option data
 * @param {Array} peData - Put option data
 * @param {number} underlyingPrice - Current spot price
 * @returns {Object}
 */
const findATMStrikes = (ceData, peData, underlyingPrice) => {
  const findClosest = (data, price) => {
    if (!data || data.length === 0) return null;
    return data.reduce((closest, d) => {
      const dStrike = parseFloat(d.strike_price);
      const cStrike = parseFloat(closest.strike_price);
      return Math.abs(dStrike - price) < Math.abs(cStrike - price) ? d : closest;
    });
  };

  return {
    ce: findClosest(ceData, underlyingPrice),
    pe: findClosest(peData, underlyingPrice),
  };
};

/**
 * Analyze OI concentration around ATM.
 *
 * @param {Array} data - All option chain data
 * @param {number} underlyingPrice - Current spot price
 * @returns {Object}
 */
const analyzeATMConcentration = (data, underlyingPrice) => {
  const strikes = [...new Set(data.map(d => parseFloat(d.strike_price)))].sort((a, b) => a - b);

  // Find ATM strike
  const atmStrike = strikes.reduce((closest, s) =>
    Math.abs(s - underlyingPrice) < Math.abs(closest - underlyingPrice) ? s : closest, strikes[0]);

  // Get OI within +/- 2 strikes of ATM
  const strikeStep = strikes[1] - strikes[0];
  const range = 2 * strikeStep;

  const atmOptions = data.filter(d => {
    const s = parseFloat(d.strike_price);
    return Math.abs(s - atmStrike) <= range;
  });

  const ceATM = atmOptions.filter(d => d.option_type === 'CE');
  const peATM = atmOptions.filter(d => d.option_type === 'PE');

  const ceOI = ceATM.reduce((sum, d) => sum + (parseInt(d.oi) || 0), 0);
  const peOI = peATM.reduce((sum, d) => sum + (parseInt(d.oi) || 0), 0);

  return {
    atmStrike,
    ceOI,
    peOI,
    totalOI: ceOI + peOI,
    pcr: ceOI > 0 ? (peOI / ceOI).toFixed(2) : 0,
  };
};

/**
 * Calculate PCR Analysis for a specific strike and surrounding window (e.g. 3 below + selected + 3 above).
 *
 * @param {Object} optionChain - Option chain data (raw data array or pre-processed strikes)
 * @param {number|null} selectedStrike - The chosen strike price (defaults to ATM if null/undefined)
 * @param {number} strikeRange - Number of strikes on each side (default: 3)
 * @returns {Object} PCR analysis result with strike-level details and aggregate metrics
 */
const calculateStrikePCRAnalysis = (optionChain, selectedStrike = null, strikeRange = 3) => {
  const rawData = optionChain.data || [];
  const underlyingPrice = parseFloat(optionChain.underlyingPrice) || 0;
  const range = Math.max(1, parseInt(strikeRange, 10) || 3);

  // Group CE and PE by strike price
  const strikesMap = new Map();
  for (const item of rawData) {
    const strike = parseFloat(item.strike_price);
    if (isNaN(strike)) continue;

    if (!strikesMap.has(strike)) {
      strikesMap.set(strike, {
        strikePrice: strike,
        callOI: 0,
        putOI: 0,
        callChangeOI: 0,
        putChangeOI: 0,
        callVolume: 0,
        putVolume: 0,
        callLtp: 0,
        putLtp: 0,
      });
    }

    const entry = strikesMap.get(strike);
    const optType = (item.option_type || '').toUpperCase();
    const oi = parseInt(item.oi, 10) || 0;
    const changeOI = parseInt(item.change_oi, 10) || 0;
    const volume = parseInt(item.volume, 10) || 0;
    const ltp = parseFloat(item.ltp) || 0;

    if (optType === 'CE') {
      entry.callOI = oi;
      entry.callChangeOI = changeOI;
      entry.callVolume = volume;
      entry.callLtp = ltp;
    } else if (optType === 'PE') {
      entry.putOI = oi;
      entry.putChangeOI = changeOI;
      entry.putVolume = volume;
      entry.putLtp = ltp;
    }
  }

  // Get sorted unique strike list
  const sortedStrikes = Array.from(strikesMap.keys()).sort((a, b) => a - b);
  if (sortedStrikes.length === 0) {
    return {
      symbol: optionChain.symbol || '',
      underlyingPrice,
      timestamp: optionChain.timestamp || new Date().toISOString(),
      selectedStrike: null,
      atmStrike: null,
      strikeRange: range,
      totalStrikesInWindow: 0,
      availableStrikes: [],
      strikes: [],
      aggregate: {
        totalCallOI: 0,
        totalPutOI: 0,
        totalCallChangeOI: 0,
        totalPutChangeOI: 0,
        aggregatePcrOI: null,
        aggregatePcrChangeOI: null,
        sentiment: 'neutral',
        interpretation: 'No strike data available',
      },
    };
  }

  // Find ATM strike (closest to underlying price)
  const atmStrike = sortedStrikes.reduce((closest, s) =>
    Math.abs(s - underlyingPrice) < Math.abs(closest - underlyingPrice) ? s : closest,
    sortedStrikes[0]
  );

  // Determine target strike: use user-selected strike if valid, else fallback to ATM
  let targetStrike = selectedStrike !== null && selectedStrike !== undefined && !isNaN(parseFloat(selectedStrike))
    ? parseFloat(selectedStrike)
    : atmStrike;

  // Find index of selected strike (or closest strike if exact number isn't in chain)
  let selectedIdx = sortedStrikes.indexOf(targetStrike);
  if (selectedIdx === -1) {
    targetStrike = sortedStrikes.reduce((closest, s) =>
      Math.abs(s - targetStrike) < Math.abs(closest - targetStrike) ? s : closest,
      sortedStrikes[0]
    );
    selectedIdx = sortedStrikes.indexOf(targetStrike);
  }

  // Select window: range strikes below + selected + range strikes above
  const startIndex = Math.max(0, selectedIdx - range);
  const endIndex = Math.min(sortedStrikes.length - 1, selectedIdx + range);
  const windowStrikes = sortedStrikes.slice(startIndex, endIndex + 1);

  // Build item-level calculation
  const strikeResults = windowStrikes.map(strike => {
    const data = strikesMap.get(strike);
    const callOI = data.callOI;
    const putOI = data.putOI;
    const callChangeOI = data.callChangeOI;
    const putChangeOI = data.putChangeOI;

    // Safe PCR calculations (handling division by zero and missing data)
    // PCR based on OI = Put OI / Call OI
    let pcrOI = null;
    if (callOI > 0) {
      pcrOI = parseFloat((putOI / callOI).toFixed(4));
    }

    // PCR based on Change in OI = Put Change OI / Call Change OI
    let pcrChangeOI = null;
    if (callChangeOI !== 0) {
      pcrChangeOI = parseFloat((putChangeOI / callChangeOI).toFixed(4));
    }

    return {
      strikePrice: strike,
      callOI,
      putOI,
      callChangeOI,
      putChangeOI,
      pcrOI,
      pcrChangeOI,
      isSelected: strike === targetStrike,
      isAtm: strike === atmStrike,
      position: strike === targetStrike ? 'SELECTED' : strike < targetStrike ? 'BELOW' : 'ABOVE',
    };
  });

  // Calculate Aggregate metrics across all strikes in window
  const totalCallOI = strikeResults.reduce((sum, s) => sum + s.callOI, 0);
  const totalPutOI = strikeResults.reduce((sum, s) => sum + s.putOI, 0);
  const totalCallChangeOI = strikeResults.reduce((sum, s) => sum + s.callChangeOI, 0);
  const totalPutChangeOI = strikeResults.reduce((sum, s) => sum + s.putChangeOI, 0);

  const aggregatePcrOI = totalCallOI > 0 ? parseFloat((totalPutOI / totalCallOI).toFixed(4)) : null;
  const aggregatePcrChangeOI = totalCallChangeOI !== 0 ? parseFloat((totalPutChangeOI / totalCallChangeOI).toFixed(4)) : null;

  // Sentiment Interpretation based on Aggregate PCR
  let sentiment = 'neutral';
  let interpretation = 'Neutral market bias across selected strikes';

  if (aggregatePcrOI !== null) {
    if (aggregatePcrOI > 1.3) {
      sentiment = 'strongly_bullish';
      interpretation = `Strongly Bullish bias (PCR: ${aggregatePcrOI.toFixed(2)}) - Heavy Put writing indicates strong floor support.`;
    } else if (aggregatePcrOI >= 1.05) {
      sentiment = 'bullish';
      interpretation = `Bullish bias (PCR: ${aggregatePcrOI.toFixed(2)}) - Put accumulation exceeds Call positions.`;
    } else if (aggregatePcrOI < 0.7) {
      sentiment = 'strongly_bearish';
      interpretation = `Strongly Bearish bias (PCR: ${aggregatePcrOI.toFixed(2)}) - Heavy Call writing indicates strong overhead resistance.`;
    } else if (aggregatePcrOI <= 0.95) {
      sentiment = 'bearish';
      interpretation = `Bearish bias (PCR: ${aggregatePcrOI.toFixed(2)}) - Call writing outweighs Put interest.`;
    } else {
      sentiment = 'neutral';
      interpretation = `Neutral / Range-bound bias (PCR: ${aggregatePcrOI.toFixed(2)}) - Balanced Call & Put positioning.`;
    }
  }

  return {
    symbol: optionChain.symbol || '',
    underlyingPrice,
    timestamp: optionChain.timestamp || new Date().toISOString(),
    selectedStrike: targetStrike,
    atmStrike,
    strikeRange: range,
    totalStrikesInWindow: strikeResults.length,
    availableStrikes: sortedStrikes,
    strikes: strikeResults,
    aggregate: {
      totalCallOI,
      totalPutOI,
      totalCallChangeOI,
      totalPutChangeOI,
      aggregatePcrOI,
      aggregatePcrChangeOI,
      sentiment,
      interpretation,
    },
  };
};

/**
 * Calculate Average PCR based on Pre-Market Open price and its corresponding ATM strike price.
 *
 * Example:
 * Pre-market open = 23,410
 * ATM Strike = 23,450
 * Strike Range = 3 (±3 strikes around ATM)
 * Selected Strikes: [23300, 23350, 23400, 23450, 23500, 23550, 23600]
 * Total Call OI = SUM(Call OI of selected strikes)
 * Total Put OI = SUM(Put OI of selected strikes)
 * Average PCR = Total Put OI / Total Call OI
 *
 * @param {Object} optionChain - Option chain data (raw data array or pre-processed strikes)
 * @param {number} preMarketOpen - Pre-market open price (e.g. 23410)
 * @param {number} [strikeRange=3] - Number of strikes on each side of ATM (default 3)
 * @param {number} [configuredStep] - Optional strike interval (50 or 100)
 * @returns {Object} Pre-market PCR analysis data
 */
const calculatePreMarketPCR = (optionChain, preMarketOpen, strikeRange = 3, configuredStep = null) => {
  const rawData = optionChain?.data || [];
  const range = Math.max(1, parseInt(strikeRange, 10) || 3);
  const openPrice = parseFloat(preMarketOpen);

  if (isNaN(openPrice) || openPrice <= 0) {
    return {
      preMarketOpen: 0,
      atmStrike: 0,
      strikeRange: range,
      selectedStrikes: [],
      totalCallOI: 0,
      totalPutOI: 0,
      averagePCR: 0,
    };
  }

  // 1. Group CE and PE by strike price (handles duplicate records by summing)
  const strikesMap = new Map();
  for (const item of rawData) {
    const strike = parseFloat(item.strike_price ?? item.strikePrice);
    if (isNaN(strike)) continue;

    if (!strikesMap.has(strike)) {
      strikesMap.set(strike, {
        strikePrice: strike,
        callOI: 0,
        putOI: 0,
      });
    }

    const entry = strikesMap.get(strike);
    const optType = (item.option_type || '').toUpperCase();
    const oi = parseInt(item.oi ?? (optType === 'CE' ? item.ce?.oi : item.pe?.oi) ?? 0, 10) || 0;

    if (optType === 'CE') {
      entry.callOI += oi;
    } else if (optType === 'PE') {
      entry.putOI += oi;
    } else {
      // If item contains both CE and PE objects (like transformed strikes)
      if (item.ce?.oi) entry.callOI += parseInt(item.ce.oi, 10) || 0;
      if (item.pe?.oi) entry.putOI += parseInt(item.pe.oi, 10) || 0;
    }
  }

  // Sorted unique strikes
  let sortedStrikes = Array.from(strikesMap.keys()).sort((a, b) => a - b);

  // Determine strike step (50 for NIFTY, 100 for BANKNIFTY)
  let step = configuredStep;
  if (!step || isNaN(step)) {
    if (sortedStrikes.length >= 2) {
      step = Math.abs(sortedStrikes[1] - sortedStrikes[0]);
    } else {
      const sym = (optionChain?.symbol || '').toUpperCase();
      step = sym === 'BANKNIFTY' ? 100 : 50;
    }
  }

  // 2. Determine ATM Strike from Pre-market Open
  // Rule: first strike >= openPrice (e.g. for 23,410 with step 50, first strike >= 23,410 is 23,450)
  let atmStrike = null;
  if (sortedStrikes.length > 0) {
    const match = sortedStrikes.find((s) => s >= openPrice);
    if (match !== undefined) {
      atmStrike = match;
    } else {
      atmStrike = sortedStrikes[sortedStrikes.length - 1];
    }
  } else {
    atmStrike = Math.ceil(openPrice / step) * step;
  }

  // If sortedStrikes is empty, return structured fallback
  let selectedStrikes = [];
  if (sortedStrikes.length === 0) {
    for (let i = -range; i <= range; i++) {
      selectedStrikes.push(atmStrike + i * step);
    }
    return {
      preMarketOpen: openPrice,
      atmStrike,
      strikeRange: range,
      selectedStrikes,
      totalCallOI: 0,
      totalPutOI: 0,
      averagePCR: 0,
    };
  }

  // 3. Select ATM ± N strikes
  let atmIdx = sortedStrikes.indexOf(atmStrike);
  if (atmIdx === -1) {
    atmStrike = sortedStrikes.reduce((closest, s) =>
      Math.abs(s - atmStrike) < Math.abs(closest - atmStrike) ? s : closest,
      sortedStrikes[0]
    );
    atmIdx = sortedStrikes.indexOf(atmStrike);
  }

  const startIdx = Math.max(0, atmIdx - range);
  const endIdx = Math.min(sortedStrikes.length - 1, atmIdx + range);
  selectedStrikes = sortedStrikes.slice(startIdx, endIdx + 1);

  // 4. Calculate Total Call OI & Total Put OI
  let totalCallOI = 0;
  let totalPutOI = 0;

  for (const s of selectedStrikes) {
    const data = strikesMap.get(s);
    if (data) {
      totalCallOI += data.callOI || 0;
      totalPutOI += data.putOI || 0;
    }
  }

  // 5. Calculate Average PCR = Total Put OI / Total Call OI
  const averagePCR = totalCallOI > 0
    ? parseFloat((totalPutOI / totalCallOI).toFixed(2))
    : 0;

  return {
    preMarketOpen: openPrice,
    atmStrike,
    strikeRange: range,
    selectedStrikes,
    totalCallOI,
    totalPutOI,
    averagePCR,
  };
};

module.exports = {
  analyzeOI,
  determineSentiment,
  findSupportResistance,
  calculateMaxPain,
  findATMStrikes,
  analyzeATMConcentration,
  calculateStrikePCRAnalysis,
  calculatePreMarketPCR,
};