import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap, catchError, shareReplay } from 'rxjs/operators';
import {
  OptionChainResponse,
  IndicesResponse,
  OIAnalysisResponse,
  RefreshResponse,
  UnderlyingPriceResponse,
  NSEUnderlyingPriceResponse,
  HistoricalPricesResponse,
  SnapshotsResponse,
  StrikePricesResponse,
  ExpiriesResponse,
  ContractInfoResponse,
  LiveOptionChainResponse,
  StrikePCRAnalysisResponse,
  PreMarketPCRResponse,
} from '../models/option-chain.model';

/**
 * Option Chain Service
 *
 * Provides methods to interact with the Option Chain REST API.
 * Handles data fetching, caching, and auto-refresh functionality.
 */
@Injectable({
  providedIn: 'root',
})
export class OptionChainService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:5000/api';

  /**
   * Get all active indices.
   */
  getIndices(): Observable<IndicesResponse> {
    return this.http.get<IndicesResponse>(`${this.apiUrl}/indices`);
  }

  /**
   * Get the latest option chain data for a given index symbol.
   * @param symbol - Index symbol (e.g., 'NIFTY', 'BANKNIFTY')
   * @param limit - Optional limit on number of strikes to return
   * @param expiry - Optional expiry date
   */
  getOptionChain(symbol: string, limit?: number, expiry?: string): Observable<OptionChainResponse> {
    const queryParams: string[] = [];
    if (limit) queryParams.push(`limit=${limit}`);
    if (expiry) queryParams.push(`expiry=${encodeURIComponent(expiry)}`);
    const params = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
    return this.http.get<OptionChainResponse>(`${this.apiUrl}/option-chain/${symbol}${params}`);
  }

  /**
   * Get live option chain data from NSE (bypasses database).
   * Fetches real-time data directly from the NSE India option-chain-v3 API.
   * @param symbol - Index symbol (e.g., 'NIFTY', 'BANKNIFTY')
   * @param options - Optional parameters:
   *   - expiry: Filter by expiry date (e.g., '18-Aug-2026')
   *   - limit: Limit number of strikes to return
   */
  getLiveOptionChain(
    symbol: string,
    options?: { expiry?: string; limit?: number }
  ): Observable<LiveOptionChainResponse> {
    let params = '';
    const queryParams: string[] = [];
    if (options?.expiry) {
      queryParams.push(`expiry=${encodeURIComponent(options.expiry)}`);
    }
    if (options?.limit) {
      queryParams.push(`limit=${options.limit}`);
    }
    if (queryParams.length > 0) {
      params = `?${queryParams.join('&')}`;
    }
    return this.http.get<LiveOptionChainResponse>(
      `${this.apiUrl}/option-chain/${symbol}/live${params}`
    );
  }

  /**
   * Get OI analysis for a given index symbol.
   * @param symbol - Index symbol
   */
  getOIAnalysis(symbol: string): Observable<OIAnalysisResponse> {
    return this.http.get<OIAnalysisResponse>(`${this.apiUrl}/option-chain/${symbol}/analysis`);
  }

  /**
   * Refresh option chain data for a given index symbol.
   * @param symbol - Index symbol
   */
  refreshOptionChain(symbol: string): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${this.apiUrl}/option-chain/${symbol}/refresh`, {});
  }

  /**
   * Get the latest underlying price for a given index symbol.
   * @param symbol - Index symbol
   */
  getUnderlyingPrice(symbol: string): Observable<UnderlyingPriceResponse> {
    return this.http.get<UnderlyingPriceResponse>(`${this.apiUrl}/underlying/${symbol}`);
  }

  /**
   * Get real-time underlying price from NSE for a given index symbol.
   * Falls back to database price if NSE is unavailable.
   * @param symbol - Index symbol
   */
  getNSEUnderlyingPrice(symbol: string): Observable<NSEUnderlyingPriceResponse> {
    return this.http.get<NSEUnderlyingPriceResponse>(`${this.apiUrl}/underlying/${symbol}/nse`);
  }

  /**
   * Get historical underlying prices for a given index symbol.
   * @param symbol - Index symbol
   * @param limit - Maximum number of records to return
   */
  getHistoricalPrices(symbol: string, limit: number = 100): Observable<HistoricalPricesResponse> {
    return this.http.get<HistoricalPricesResponse>(
      `${this.apiUrl}/underlying/${symbol}/history?limit=${limit}`
    );
  }

  /**
   * Get all snapshots for a given index symbol.
   * @param symbol - Index symbol
   * @param limit - Maximum number of snapshots to return
   * @param offset - Offset for pagination
   */
  getSnapshots(symbol: string, limit: number = 50, offset: number = 0): Observable<SnapshotsResponse> {
    return this.http.get<SnapshotsResponse>(
      `${this.apiUrl}/option-chain/${symbol}/snapshots?limit=${limit}&offset=${offset}`
    );
  }

  /**
   * Get available strike prices for an index from NSE.
   * @param symbol - Index symbol (e.g., 'NIFTY', 'BANKNIFTY')
   * @param options - Optional parameters:
   *   - expiry: Filter by expiry date (e.g., '18-Aug-2026')
   *   - atmRange: Get strikes around ATM (e.g., 10 for 10 strikes above/below)
   */
  getStrikePrices(
    symbol: string,
    options?: { expiry?: string; atmRange?: number }
  ): Observable<StrikePricesResponse> {
    let params = '';
    if (options?.expiry) {
      params = `?expiry=${encodeURIComponent(options.expiry)}`;
    } else if (options?.atmRange) {
      params = `?atmRange=${options.atmRange}`;
    }
    return this.http.get<StrikePricesResponse>(
      `${this.apiUrl}/strike-prices/${symbol}${params}`
    );
  }

  /**
   * Get available expiry dates for an index from NSE.
   * @param symbol - Index symbol
   */
  getExpiries(symbol: string): Observable<ExpiriesResponse> {
    return this.http.get<ExpiriesResponse>(
      `${this.apiUrl}/strike-prices/${symbol}/expiries`
    );
  }

  /**
   * Get full contract info (strike prices + expiry dates) for an index from NSE.
   * @param symbol - Index symbol
   */
  getContractInfo(symbol: string): Observable<ContractInfoResponse> {
    return this.http.get<ContractInfoResponse>(
      `${this.apiUrl}/strike-prices/${symbol}/contract-info`
    );
  }

  /**
   * Auto-refresh option chain data at a specified interval.
   * @param symbol - Index symbol
   * @param intervalMs - Refresh interval in milliseconds
   */
  autoRefreshOptionChain(symbol: string, intervalMs: number = 30000): Observable<OptionChainResponse> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.getOptionChain(symbol)),
      shareReplay(1)
    );
  }

  /**
   * Auto-refresh OI analysis at a specified interval.
   * @param symbol - Index symbol
   * @param intervalMs - Refresh interval in milliseconds
   */
  autoRefreshOIAnalysis(symbol: string, intervalMs: number = 30000): Observable<OIAnalysisResponse> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.getOIAnalysis(symbol)),
      shareReplay(1)
    );
  }

  /**
   * Get Options Chain PCR Analysis for a specific strike price and surrounding window.
   * Calculates strike-by-strike PCR (OI & Change in OI) and aggregate PCR.
   *
   * @param symbol - Index symbol (e.g., 'NIFTY', 'BANKNIFTY')
   * @param options - Optional parameters:
   *   - selectedStrike: Center strike price to analyze
   *   - strikeRange: Number of strikes above and below (default 3 => 7 total strikes)
   *   - expiry: Filter by expiry date
   *   - live: Force live fetch from NSE
   */
  getStrikePCRAnalysis(
    symbol: string,
    options?: {
      selectedStrike?: number;
      strikeRange?: number;
      expiry?: string;
      live?: boolean;
    }
  ): Observable<StrikePCRAnalysisResponse> {
    const queryParams: string[] = [];
    if (options?.selectedStrike !== undefined && options.selectedStrike !== null) {
      queryParams.push(`selectedStrike=${options.selectedStrike}`);
    }
    if (options?.strikeRange !== undefined && options.strikeRange !== null) {
      queryParams.push(`strikeRange=${options.strikeRange}`);
    }
    if (options?.expiry) {
      queryParams.push(`expiry=${encodeURIComponent(options.expiry)}`);
    }
    if (options?.live !== undefined) {
      queryParams.push(`live=${options.live}`);
    }
    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
    return this.http.get<StrikePCRAnalysisResponse>(
      `${this.apiUrl}/option-chain/${symbol}/pcr-analysis${queryString}`
    );
  }

  /**
   * Auto-refresh Strike PCR Analysis at a specified interval.
   * @param symbol - Index symbol
   * @param options - Strike PCR options
   * @param intervalMs - Refresh interval in milliseconds
   */
  autoRefreshStrikePCRAnalysis(
    symbol: string,
    options?: {
      selectedStrike?: number;
      strikeRange?: number;
      expiry?: string;
      live?: boolean;
    },
    intervalMs: number = 30000
  ): Observable<StrikePCRAnalysisResponse> {
    return timer(0, intervalMs).pipe(
      switchMap(() => this.getStrikePCRAnalysis(symbol, options)),
      shareReplay(1)
    );
  }

  /**
   * Get Pre-Market Open ATM Average PCR analysis.
   * @param symbol - Index symbol (e.g. 'NIFTY')
   * @param options - Optional parameters: preMarketOpen, strikeRange, expiry, live
   */
  getPreMarketPCR(
    symbol: string,
    options?: {
      preMarketOpen?: number;
      strikeRange?: number;
      expiry?: string;
      live?: boolean;
    }
  ): Observable<PreMarketPCRResponse> {
    const queryParams: string[] = [];
    if (options?.preMarketOpen !== undefined && options.preMarketOpen !== null) {
      queryParams.push(`preMarketOpen=${options.preMarketOpen}`);
    }
    if (options?.strikeRange !== undefined && options.strikeRange !== null) {
      queryParams.push(`strikeRange=${options.strikeRange}`);
    }
    if (options?.expiry) {
      queryParams.push(`expiry=${encodeURIComponent(options.expiry)}`);
    }
    if (options?.live !== undefined) {
      queryParams.push(`live=${options.live}`);
    }
    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
    return this.http.get<PreMarketPCRResponse>(
      `${this.apiUrl}/option-chain/${symbol}/pre-market-pcr${queryString}`
    );
  }

  /**
   * Save or update pre-market open price in the backend.
   * @param symbol - Index symbol
   * @param preMarketOpen - Open price
   * @param tradeDate - Optional trade date string
   */
  savePreMarketOpen(
    symbol: string,
    preMarketOpen: number,
    tradeDate?: string
  ): Observable<any> {
    return this.http.post(`${this.apiUrl}/option-chain/${symbol}/pre-market-open`, {
      preMarketOpen,
      tradeDate,
    });
  }
}
