import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import {
  MarketBreadthResponse,
  MarketBreadthStock,
  MarketBreadthSummaryData,
  StockCategory,
} from '../models/market-breadth.model';

@Injectable({
  providedIn: 'root',
})
export class MarketDataService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api';

  /**
   * Fetch market breadth / advance-decline data for an index.
   * Leverages the backend proxy to bypass CORS and anti-bot restrictions while fetching live NSE data.
   */
  getMarketBreadth(index: string = 'NIFTY 50', forceRefresh: boolean = false): Observable<MarketBreadthResponse> {
    const encodedIndex = encodeURIComponent(index.trim());
    const refreshParam = forceRefresh ? '&refresh=true' : '';
    const url = `${this.apiUrl}/advance-decline?index=${encodedIndex}${refreshParam}`;

    return this.http.get<any>(url).pipe(
      map((response) => this.normalizeResponse(response, index)),
      catchError((error) => {
        console.error('MarketDataService error:', error);
        return throwError(() => new Error(error.error?.error || error.message || 'Failed to fetch market breadth data'));
      })
    );
  }

  /**
   * Normalization function that converts raw or proxy API responses into a consistent internal structure.
   * Handles:
   * - Symbol: `symbol` or `icSymbol`
   * - Company Name: `companyName` or `icSecurity`
   * - LTP: `price` or `lastTradedPrice`
   * - Close: `closePrice`
   * - % Change: `changePercent` or `changePer`
   * - Contribution points: `contributionPoints` or `changePoints`
   * - Mathematically derives price change: LTP - Close Price
   * - Determines category ('advance' | 'decline' | 'unchanged') strictly from stock-level price change
   */
  normalizeResponse(res: any, defaultIndex: string): MarketBreadthResponse {
    if (!res) {
      throw new Error('Empty response received from server');
    }

    const rawList: any[] = Array.isArray(res.data) ? res.data : [];
    const normalizedStocks: MarketBreadthStock[] = rawList.map((item) => {
      const symbol = (item.symbol || item.icSymbol || '').trim();
      const companyName = (item.companyName || item.icSecurity || symbol).trim();
      const price = parseFloat(item.price ?? item.lastTradedPrice ?? 0);
      const closePrice = parseFloat(item.closePrice ?? 0);
      const changePercent = parseFloat(item.changePercent ?? item.changePer ?? 0);
      const contributionPoints = parseFloat(item.contributionPoints ?? item.changePoints ?? 0);

      // Mathematically derive price change
      let change = 0;
      if (item.change !== undefined && typeof item.change === 'number') {
        change = item.change;
      } else if (price > 0 && closePrice > 0) {
        change = Math.round((price - closePrice) * 100) / 100;
      } else if (closePrice > 0 && changePercent !== 0) {
        change = Math.round(((closePrice * changePercent) / 100) * 100) / 100;
      }

      // Safe category determination based strictly on stock price / % change
      let category: StockCategory = 'unchanged';
      if (changePercent > 0.0001 || change > 0.0001) {
        category = 'advance';
      } else if (changePercent < -0.0001 || change < -0.0001) {
        category = 'decline';
      } else {
        category = 'unchanged';
      }

      return {
        symbol: symbol || 'UNKNOWN',
        companyName,
        price: isNaN(price) ? 0 : price,
        closePrice: isNaN(closePrice) ? 0 : closePrice,
        change: isNaN(change) ? 0 : change,
        changePercent: isNaN(changePercent) ? 0 : changePercent,
        contributionPoints: isNaN(contributionPoints) ? undefined : contributionPoints,
        category,
        isPositive: item.isPositive || (category === 'advance' ? 'Y' : 'N'),
        rnPositive: item.rnPositive !== undefined ? item.rnPositive : null,
        rnNegative: item.rnNegative !== undefined ? item.rnNegative : null,
      };
    });

    // Recompute or verify summary counts
    const advances = normalizedStocks.filter((s) => s.category === 'advance').length;
    const declines = normalizedStocks.filter((s) => s.category === 'decline').length;
    const unchanged = normalizedStocks.filter((s) => s.category === 'unchanged').length;
    const total = normalizedStocks.length;

    let adRatio = 0;
    if (declines > 0) {
      adRatio = parseFloat((advances / declines).toFixed(2));
    } else if (advances > 0) {
      adRatio = advances;
    } else {
      adRatio = 1.0;
    }

    const advancePercent = total > 0 ? parseFloat(((advances / total) * 100).toFixed(1)) : 0;
    const declinePercent = total > 0 ? parseFloat(((declines / total) * 100).toFixed(1)) : 0;
    const unchangedPercent = total > 0 ? parseFloat(((unchanged / total) * 100).toFixed(1)) : 0;

    const summary: MarketBreadthSummaryData = {
      total,
      advances,
      declines,
      unchanged,
      adRatio,
      advancePercent,
      declinePercent,
      unchangedPercent,
    };

    return {
      success: res.success !== false,
      index: res.index || defaultIndex,
      timestamp: res.timestamp || new Date().toISOString(),
      summary,
      data: normalizedStocks,
    };
  }

  /**
   * Format numbers into Indian currency format (e.g. ₹ 1,23,456.75)
   */
  formatIndianPrice(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return '₹ 0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  }

  /**
   * Format percentage with explicit + or - sign
   */
  formatPercent(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return '0.00%';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  }

  /**
   * Format price change with currency sign and + / - prefix
   */
  formatPriceChange(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return '₹0.00';
    const sign = val > 0 ? '+' : val < 0 ? '-' : '';
    const absVal = Math.abs(val);
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absVal);
    return `${sign}₹${formatted}`;
  }
}
