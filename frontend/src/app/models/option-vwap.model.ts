export type VWAPStatus = 'available' | 'no_volume' | 'unavailable';

export interface OptionVWAPContract {
  instrumentKey: string;
  ltp: number;
  vwap: number | null;
  difference: number;
  differencePct: number;
  volume: number;
  status: VWAPStatus;
}

export interface OptionVWAPRow {
  strikePrice: number;
  isATM: boolean;
  ce: OptionVWAPContract;
  pe: OptionVWAPContract;
}

export interface OptionVWAPMarketBreadth {
  index: string;
  total: number;
  advances: number;
  declines: number;
  unchanged: number;
  adRatio: number;
  advancePercent: number;
  declinePercent: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface OptionVWAPResponse {
  success: boolean;
  symbol: string;
  spotPrice: number;
  atmStrike: number;
  strikeInterval: number;
  expiry: string;
  tradingDate: string;
  availableDates: string[];
  lastUpdated: string;
  marketBreadth?: OptionVWAPMarketBreadth;
  data: OptionVWAPRow[];
  error?: string;
}
