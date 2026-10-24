export type StockCategory = 'advance' | 'decline' | 'unchanged';

export type FilterCategory = 'all' | 'advance' | 'decline' | 'unchanged';

export type SortField = 'symbol' | 'price' | 'changePercent';

export type SortDirection = 'asc' | 'desc';

export interface MarketBreadthStock {
  symbol: string;
  companyName: string;
  price: number;
  closePrice: number;
  change: number;
  changePercent: number;
  contributionPoints?: number;
  category: StockCategory;
  isPositive?: string;
  rnPositive?: number | null;
  rnNegative?: number | null;
}

export interface MarketBreadthSummaryData {
  total: number;
  advances: number;
  declines: number;
  unchanged: number;
  adRatio: number;
  advancePercent: number;
  declinePercent: number;
  unchangedPercent: number;
}

export interface MarketBreadthResponse {
  success: boolean;
  index: string;
  timestamp: string;
  summary: MarketBreadthSummaryData;
  data: MarketBreadthStock[];
  error?: string;
}

export interface IndexOption {
  symbol: string;
  name: string;
  displayName: string;
}
