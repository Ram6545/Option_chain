/**
 * Option Chain Data Models
 *
 * These models define the structure of option chain data
 * exchanged between the Angular frontend and Node.js backend.
 */

/**
 * Individual option data (CE or PE) for a single strike price.
 */
export interface OptionData {
  ltp: number;
  change?: number;
  ltpChgPercent?: number;
  volume: number;
  oi: number;
  changeOI: number;
  changeOIPercent?: number;
  oiInValue?: number;
  iv: number;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
}

/**
 * Strike price data containing both CE and PE options.
 */
export interface StrikeData {
  strikePrice: number;
  ce: OptionData | null;
  pe: OptionData | null;
}

/**
 * Full option chain response from the API.
 */
export interface OptionChainResponse {
  success: boolean;
  data: {
    symbol: string;
    indexId: number | null;
    snapshotId: number | null;
    underlyingPrice: number;
    timestamp: string;
    atmStrike: number | null;
    strikes: StrikeData[];
  };
}

/**
 * Live option chain response from NSE API (bypasses database).
 * Fetches real-time data directly from the NSE India option-chain-v3 API.
 */
export interface LiveOptionChainResponse {
  success: boolean;
  source: string;
  data: {
    symbol: string;
    indexId: number | null;
    snapshotId: number | null;
    underlyingPrice: number;
    timestamp: string;
    atmStrike: number | null;
    strikes: StrikeData[];
  };
}

/**
 * Index information.
 */
export interface Index {
  id: number;
  name: string;
  symbol: string;
  display_name: string;
  lot_size: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Indices response from the API.
 */
export interface IndicesResponse {
  success: boolean;
  count: number;
  data: Index[];
}

/**
 * Sentiment analysis result.
 */
export interface Sentiment {
  overall: 'strongly_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strongly_bearish';
  score: number;
  signals: Signal[];
}

/**
 * Individual sentiment signal.
 */
export interface Signal {
  type: 'bullish' | 'bearish' | 'neutral';
  reason: string;
}

/**
 * Support/Resistance level.
 */
export interface Level {
  strike: number;
  oi: number;
  type: 'support' | 'resistance';
}

/**
 * Support/Resistance analysis.
 */
export interface SupportResistance {
  resistance: Level[];
  support: Level[];
}

/**
 * Max Pain calculation result.
 */
export interface MaxPain {
  strike: number;
  distanceFromSpot: number;
}

/**
 * ATM OI concentration analysis.
 */
export interface AtmOIAnalysis {
  atmStrike: number;
  ceOI: number;
  peOI: number;
  totalOI: number;
  pcr: string;
}

/**
 * OI Analysis response from the API.
 */
export interface OIAnalysisResponse {
  success: boolean;
  data: {
    underlyingPrice: number;
    timestamp: string;
    totalOI: {
      calls: number;
      puts: number;
      total: number;
    };
    totalVolume: {
      calls: number;
      puts: number;
    };
    pcr: {
      oi: number;
      volume: number;
    };
    maxOISTrikes: {
      call: { strike: number; oi: number };
      put: { strike: number; oi: number };
    };
    oiChange: {
      calls: number;
      puts: number;
      net: number;
    };
    sentiment: Sentiment;
    supportResistance: SupportResistance;
    maxPain: MaxPain;
    atmOIAnalysis: AtmOIAnalysis;
  };
}

/**
 * Refresh response from the API.
 */
export interface RefreshResponse {
  success: boolean;
  message: string;
  data: {
    snapshotId: number;
    indexId: number;
    symbol: string;
    underlyingPrice: number;
    timestamp: string;
    dataCount: number;
  };
}

/**
 * Underlying price response.
 */
export interface UnderlyingPriceResponse {
  success: boolean;
  data: {
    id: number;
    index_id: number;
    price: number;
    timestamp: string;
    created_at: string;
  };
}

/**
 * NSE underlying price response (real-time from NSE API).
 */
export interface NSEUnderlyingPriceResponse {
  success: boolean;
  source: string;
  data: {
    symbol: string;
    price: number;
    timestamp: string;
  };
}

/**
 * Historical price data point.
 */
export interface HistoricalPrice {
  id: number;
  index_id: number;
  price: number;
  timestamp: string;
  created_at: string;
}

/**
 * Historical prices response.
 */
export interface HistoricalPricesResponse {
  success: boolean;
  count: number;
  data: HistoricalPrice[];
}

/**
 * Snapshot information.
 */
export interface Snapshot {
  id: number;
  index_id: number;
  underlying_price: number;
  timestamp: string;
  created_at: string;
}

/**
 * Snapshots response.
 */
export interface SnapshotsResponse {
  success: boolean;
  count: number;
  data: Snapshot[];
}

/**
 * Strike prices response from NSE API.
 */
export interface StrikePricesResponse {
  success: boolean;
  source: string;
  count: number;
  data: number[];
}

/**
 * Expiry dates response from NSE API.
 */
export interface ExpiriesResponse {
  success: boolean;
  source: string;
  count: number;
  data: string[];
  nearestExpiry: string | null;
}

/**
 * Contract info response from NSE API.
 */
export interface ContractInfoResponse {
  success: boolean;
  source: string;
  data: {
    symbol: string;
    strikePrices: number[];
    expiryDates: string[];
    timestamp: string;
  };
}

/**
 * Individual Strike Item in PCR Analysis
 */
export interface StrikePCRItem {
  strikePrice: number;
  callOI: number;
  putOI: number;
  callChangeOI: number;
  putChangeOI: number;
  pcrOI: number | null;
  pcrChangeOI: number | null;
  isSelected: boolean;
  isAtm: boolean;
  position: 'BELOW' | 'SELECTED' | 'ABOVE';
}

/**
 * Aggregate PCR Data across the selected strike window
 */
export interface AggregatePCR {
  totalCallOI: number;
  totalPutOI: number;
  totalCallChangeOI: number;
  totalPutChangeOI: number;
  aggregatePcrOI: number | null;
  aggregatePcrChangeOI: number | null;
  sentiment: 'strongly_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strongly_bearish';
  interpretation: string;
}

/**
 * Full PCR Analysis Data Payload
 */
export interface StrikePCRAnalysisData {
  symbol: string;
  underlyingPrice: number;
  marketOpenPrice?: number;
  currentSpotPrice?: number;
  timestamp: string;
  selectedStrike: number;
  atmStrike: number;
  strikeRange: number;
  totalStrikesInWindow: number;
  availableStrikes: number[];
  strikes: StrikePCRItem[];
  aggregate: AggregatePCR;
  preMarket?: PreMarketPCRData;
}

/**
 * API Response for PCR Analysis
 */
export interface StrikePCRAnalysisResponse {
  success: boolean;
  data: StrikePCRAnalysisData;
}

/**
 * Pre-Market Open ATM Average PCR Data
 */
export interface PreMarketPCRData {
  preMarketOpen: number;
  atmStrike: number;
  strikeRange: number;
  selectedStrikes: number[];
  totalCallOI: number;
  totalPutOI: number;
  averagePCR: number;
}

/**
 * API Response for Pre-Market PCR Analysis
 */
export interface PreMarketPCRResponse {
  success: boolean;
  data: PreMarketPCRData;
}

/**
 * Historical Option Chain Replay Interval Item
 */
export interface HistoricalReplayItem {
  timestamp: string; // e.g. "09:15"
  niftyPrice: number;
  atmStrike: number;
  pcr: number;
  averagePCR: number;
  totalCallOI: number;
  totalPutOI: number;
  optionChain: StrikeData[];
}

/**
 * Historical Option Chain Replay Response
 */
export interface HistoricalReplayResponse {
  success: boolean;
  source?: string;
  symbol: string;
  date: string;
  expiry?: string | null;
  timeFrame: number;
  startTime: string;
  endTime: string;
  totalIntervals: number;
  data: HistoricalReplayItem[];
}

/**
 * Expiry Cycle Details
 */
export interface ExpiryCycleData {
  id: number;
  index_id: number;
  symbol: string;
  cycle_start_date: string;
  expiry_date: string;
  expiryDateNSE?: string;
  status: 'ACTIVE' | 'EXPIRED' | 'ARCHIVED';
  is_current: boolean;
  created_at: string;
}

export interface ExpiryCycleResponse {
  success: boolean;
  symbol: string;
  activeCycle: ExpiryCycleData;
  availableExpiries: string[];
  nextCycleRule: string;
}

export interface HistoricalDatesResponse {
  success: boolean;
  symbol: string;
  count: number;
  data: string[];
}

export interface HistoricalExpiriesResponse {
  success: boolean;
  symbol: string;
  date: string | null;
  count: number;
  data: string[];
}


