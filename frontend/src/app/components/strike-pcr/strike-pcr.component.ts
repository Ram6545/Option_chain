import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatInputModule } from '@angular/material/input';
import { Subscription, interval } from 'rxjs';

import { OptionChainService } from '../../services/option-chain.service';
import {
  StrikePCRAnalysisData,
  StrikePCRItem,
  AggregatePCR,
  IndicesResponse,
} from '../../models/option-chain.model';

export interface MarketPressureAnalysis {
  callWritingStatus: 'Increasing' | 'Decreasing';
  putWritingStatus: 'Increasing' | 'Decreasing';
  callWritingDelta: number;
  putWritingDelta: number;
  marketDirection: 'BEARISH PRESSURE' | 'BULLISH PRESSURE' | 'MIXED / RANGE-BOUND' | 'NEUTRAL / UNCLEAR';
  reason: string;
  badgeClass: string;
  cardClass: string;
  textClass: string;
  icon: string;
  callWritingDesc: string;
  putWritingDesc: string;
}

@Component({
  selector: 'app-strike-pcr',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
  ],
  templateUrl: './strike-pcr.component.html',
  styleUrls: ['./strike-pcr.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StrikePcrComponent implements OnInit, OnDestroy {
  private optionChainService = inject(OptionChainService);
  private snackBar = inject(MatSnackBar);

  // Core State Signals
  pcrData = signal<StrikePCRAnalysisData | null>(null);
  indices = signal<IndicesResponse['data']>([]);
  expiries = signal<string[]>([]);

  selectedSymbol = signal<string>('NIFTY');
  selectedStrike = signal<number | null>(null);
  marketOpenPrice = signal<number | null>(null);
  strikeRange = signal<number>(3); // Configurable: 3 strikes on each side by default (7 total)
  selectedExpiry = signal<string | null>(null);
  isLiveMode = signal<boolean>(false);
  autoRefreshEnabled = signal<boolean>(true);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  // Range options available for selection
  rangeOptions: { label: string; value: number; total: number }[] = [
    { label: '3 Strikes (7 total)', value: 3, total: 7 },
    { label: '5 Strikes (11 total)', value: 5, total: 11 },
    { label: '7 Strikes (15 total)', value: 7, total: 15 },
    { label: '10 Strikes (21 total)', value: 10, total: 21 },
  ];

  private refreshSub: Subscription | null = null;

  // Computed Values
  strikes = computed<StrikePCRItem[]>(() => this.pcrData()?.strikes || []);
  aggregate = computed<AggregatePCR | null>(() => this.pcrData()?.aggregate || null);
  underlyingPrice = computed<number>(() => this.marketOpenPrice() || this.pcrData()?.marketOpenPrice || this.pcrData()?.underlyingPrice || 0);
  atmStrike = computed<number | null>(() => this.pcrData()?.atmStrike || null);
  availableStrikes = computed<number[]>(() => this.pcrData()?.availableStrikes || []);

  // Previous aggregate snapshot to track writing changes tick-over-tick
  previousAggregate = signal<AggregatePCR | null>(null);

  /**
   * Market Direction & Pressure Analysis based on Call Writing and Put Writing Activity:
   * 1. Call Writing increases + Put Writing decreases => BEARISH PRESSURE (Red)
   * 2. Call Writing decreases + Put Writing increases => BULLISH PRESSURE (Green)
   * 3. Call Writing increases + Put Writing increases => MIXED / RANGE-BOUND (Yellow/Orange)
   * 4. Call Writing decreases + Put Writing decreases => NEUTRAL / UNCLEAR (Gray)
   */
  marketPressure = computed<MarketPressureAnalysis>(() => {
    const curr = this.aggregate();
    if (!curr) {
      return {
        callWritingStatus: 'Decreasing',
        putWritingStatus: 'Decreasing',
        callWritingDelta: 0,
        putWritingDelta: 0,
        marketDirection: 'NEUTRAL / UNCLEAR',
        reason: 'Both resistance and support may be weakening, so there is no clear directional signal.',
        badgeClass: 'pressure-neutral',
        cardClass: 'pressure-card-neutral',
        textClass: 'pressure-text-neutral',
        icon: 'remove_circle_outline',
        callWritingDesc: 'Data unavailable',
        putWritingDesc: 'Data unavailable',
      };
    }

    const prev = this.previousAggregate();
    const currCallChg = curr.totalCallChangeOI || 0;
    const currPutChg = curr.totalPutChangeOI || 0;

    let callWritingIncreasing: boolean;
    let putWritingIncreasing: boolean;
    let callDelta = currCallChg;
    let putDelta = currPutChg;

    // Compare with previous tick if available and values differ, otherwise use intraday cumulative change in OI
    if (prev && (prev.totalCallChangeOI !== currCallChg || prev.totalPutChangeOI !== currPutChg)) {
      callDelta = currCallChg - (prev.totalCallChangeOI || 0);
      putDelta = currPutChg - (prev.totalPutChangeOI || 0);
      callWritingIncreasing = callDelta >= 0;
      putWritingIncreasing = putDelta >= 0;
    } else {
      // Intraday accumulation: positive change in OI indicates active writing / position addition
      callWritingIncreasing = currCallChg >= 0;
      putWritingIncreasing = currPutChg >= 0;
    }

    const callWritingStatus: 'Increasing' | 'Decreasing' = callWritingIncreasing ? 'Increasing' : 'Decreasing';
    const putWritingStatus: 'Increasing' | 'Decreasing' = putWritingIncreasing ? 'Increasing' : 'Decreasing';

    // 1. Call Writing increases + Put Writing decreases => BEARISH PRESSURE (Red)
    if (callWritingIncreasing && !putWritingIncreasing) {
      return {
        callWritingStatus,
        putWritingStatus,
        callWritingDelta: callDelta,
        putWritingDelta: putDelta,
        marketDirection: 'BEARISH PRESSURE',
        reason: 'Call Writing is increasing, indicating stronger resistance, while Put Writing is decreasing, indicating relatively weaker support.',
        badgeClass: 'pressure-bearish',
        cardClass: 'pressure-card-bearish',
        textClass: 'pressure-text-bearish',
        icon: 'trending_down',
        callWritingDesc: 'Call Writing is increasing, indicating stronger resistance',
        putWritingDesc: 'Put Writing is decreasing, indicating relatively weaker support',
      };
    }

    // 2. Call Writing decreases + Put Writing increases => BULLISH PRESSURE (Green)
    if (!callWritingIncreasing && putWritingIncreasing) {
      return {
        callWritingStatus,
        putWritingStatus,
        callWritingDelta: callDelta,
        putWritingDelta: putDelta,
        marketDirection: 'BULLISH PRESSURE',
        reason: 'Call Writing is decreasing, indicating weaker resistance, while Put Writing is increasing, indicating stronger support.',
        badgeClass: 'pressure-bullish',
        cardClass: 'pressure-card-bullish',
        textClass: 'pressure-text-bullish',
        icon: 'trending_up',
        callWritingDesc: 'Call Writing is decreasing, indicating weaker resistance',
        putWritingDesc: 'Put Writing is increasing, indicating stronger support',
      };
    }

    // 3. Call Writing increases + Put Writing increases => MIXED / RANGE-BOUND (Yellow/Orange)
    if (callWritingIncreasing && putWritingIncreasing) {
      return {
        callWritingStatus,
        putWritingStatus,
        callWritingDelta: callDelta,
        putWritingDelta: putDelta,
        marketDirection: 'MIXED / RANGE-BOUND',
        reason: 'Both Call Writing and Put Writing are increasing, suggesting both resistance and support may be increasing.',
        badgeClass: 'pressure-mixed',
        cardClass: 'pressure-card-mixed',
        textClass: 'pressure-text-mixed',
        icon: 'compare_arrows',
        callWritingDesc: 'Call Writing is increasing, indicating resistance building',
        putWritingDesc: 'Put Writing is increasing, indicating support building',
      };
    }

    // 4. Call Writing decreases + Put Writing decreases => NEUTRAL / UNCLEAR (Gray)
    return {
      callWritingStatus,
      putWritingStatus,
      callWritingDelta: callDelta,
      putWritingDelta: putDelta,
      marketDirection: 'NEUTRAL / UNCLEAR',
      reason: 'Both Call Writing and Put Writing are decreasing, suggesting both resistance and support may be weakening, so there is no clear directional signal.',
      badgeClass: 'pressure-neutral',
      cardClass: 'pressure-card-neutral',
      textClass: 'pressure-text-neutral',
      icon: 'remove_circle_outline',
      callWritingDesc: 'Call Writing is decreasing, indicating resistance unwinding',
      putWritingDesc: 'Put Writing is decreasing, indicating support unwinding',
    };
  });

  private getTop2Values(values: (number | undefined)[]): { max1: number; max2: number } {
    const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
    if (valid.length === 0) return { max1: 0, max2: 0 };
    const sorted = Array.from(new Set(valid)).sort((a, b) => b - a);
    return { max1: sorted[0] || 0, max2: sorted[1] || 0 };
  }

  callOITop2 = computed(() => this.getTop2Values(this.strikes().map((s) => s.callOI)));
  putOITop2 = computed(() => this.getTop2Values(this.strikes().map((s) => s.putOI)));
  callChgOITop2 = computed(() => this.getTop2Values(this.strikes().map((s) => s.callChangeOI)));
  putChgOITop2 = computed(() => this.getTop2Values(this.strikes().map((s) => s.putChangeOI)));

  maxCallOI = computed(() => this.callOITop2().max1);
  maxPutOI = computed(() => this.putOITop2().max1);
  maxCallChangeOI = computed(() => this.callChgOITop2().max1);
  maxPutChangeOI = computed(() => this.putChgOITop2().max1);

  isMaxCallOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.callOITop2().max1;
  }

  isSecondMaxCallOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.callOITop2().max2;
  }

  isMaxPutOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.putOITop2().max1;
  }

  isSecondMaxPutOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.putOITop2().max2;
  }

  isMaxCallChangeOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.callChgOITop2().max1;
  }

  isSecondMaxCallChangeOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.callChgOITop2().max2;
  }

  isMaxPutChangeOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.putChgOITop2().max1;
  }

  isSecondMaxPutChangeOI(val: number | undefined): boolean {
    return !!val && val > 0 && val === this.putChgOITop2().max2;
  }

  ngOnInit(): void {
    this.loadIndices();
    this.loadExpiries();
    this.fetchPCRAnalysis();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  /**
   * Load available indices (NIFTY, BANKNIFTY, etc.)
   */
  loadIndices(): void {
    this.optionChainService.getIndices().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.indices.set(res.data);
        }
      },
      error: (err) => console.error('Failed to load indices:', err),
    });
  }

  /**
   * Load available expiry dates for selected symbol
   */
  loadExpiries(): void {
    this.optionChainService.getExpiries(this.selectedSymbol()).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.expiries.set(res.data);
          if (!this.selectedExpiry() && res.nearestExpiry) {
            this.selectedExpiry.set(res.nearestExpiry);
          }
        }
      },
      error: (err) => console.error('Failed to load expiries:', err),
    });
  }

  /**
   * Fetch PCR Analysis from Node.js API
   */
  fetchPCRAnalysis(isBackground: boolean = false): void {
    if (!isBackground) {
      this.isLoading.set(true);
    }
    this.error.set(null);

    this.optionChainService
      .getStrikePCRAnalysis(this.selectedSymbol(), {
        selectedStrike: this.selectedStrike() ?? undefined,
        strikeRange: this.strikeRange(),
        expiry: this.selectedExpiry() ?? undefined,
        live: this.isLiveMode(),
        marketOpenPrice: this.marketOpenPrice() ?? undefined,
      })
      .subscribe({
        next: (response) => {
          this.isLoading.set(false);
          if (response.success && response.data) {
            if (this.pcrData()?.aggregate) {
              this.previousAggregate.set(this.pcrData()!.aggregate);
            }
            this.pcrData.set(response.data);
            if (this.marketOpenPrice() === null && (response.data.marketOpenPrice || response.data.underlyingPrice)) {
              this.marketOpenPrice.set(response.data.marketOpenPrice || response.data.underlyingPrice);
            }
            // Sync selected strike with server response if not explicitly set
            if (this.selectedStrike() === null) {
              this.selectedStrike.set(response.data.selectedStrike);
            }
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          const errorMsg =
            err.error?.error || 'Failed to fetch PCR Analysis data from server.';
          this.error.set(errorMsg);
          this.snackBar.open(errorMsg, 'Close', {
            duration: 4000,
            panelClass: ['error-snackbar'],
          });
        },
      });
  }

  /**
   * Handle Symbol Change
   */
  onSymbolChange(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.selectedStrike.set(null); // Reset to ATM of new symbol
    this.marketOpenPrice.set(null); // Reset to 9:15 AM opening price of new symbol
    this.previousAggregate.set(null); // Reset tick history for new symbol
    this.loadExpiries();
    this.fetchPCRAnalysis();
  }

  /**
   * Handle Market Open Price (9:15 AM) change
   */
  onOpenPriceChange(val: string | number): void {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num) || num <= 0) return;
    this.marketOpenPrice.set(num);
    this.selectedStrike.set(null); // Recalculate initial ATM strike from new open price
    this.fetchPCRAnalysis();
    this.snackBar.open(
      `Market Open Price updated to ₹${num.toFixed(2)} - Recalculated Initial ATM Strike`,
      'OK',
      { duration: 3000 }
    );
  }

  /**
   * Handle Strike Selection Change
   */
  onStrikeChange(strike: number): void {
    this.selectedStrike.set(strike);
    this.fetchPCRAnalysis();
  }

  /**
   * Handle Strike Range Change (e.g. 3, 5, 10)
   */
  onRangeChange(range: number): void {
    this.strikeRange.set(range);
    this.fetchPCRAnalysis();
  }

  /**
   * Handle Expiry Date Change
   */
  onExpiryChange(expiry: string): void {
    this.selectedExpiry.set(expiry);
    this.fetchPCRAnalysis();
  }

  /**
   * Toggle Live NSE Mode
   */
  toggleLiveMode(): void {
    this.isLiveMode.update((prev) => !prev);
    this.fetchPCRAnalysis();
    this.snackBar.open(
      this.isLiveMode() ? 'Live NSE fetch enabled' : 'Switched to snapshot data',
      'OK',
      { duration: 2500 }
    );
  }

  /**
   * Jump directly to ATM Strike
   */
  selectATMStrike(): void {
    const atm = this.atmStrike();
    if (atm !== null) {
      this.selectedStrike.set(atm);
      this.fetchPCRAnalysis();
    }
  }

  /**
   * Shift Selected Strike Up by 1 step in available strikes
   */
  shiftStrikeUp(): void {
    const strikes = this.availableStrikes();
    const current = this.selectedStrike() ?? this.atmStrike();
    if (!current || strikes.length === 0) return;

    const idx = strikes.indexOf(current);
    if (idx < strikes.length - 1) {
      this.selectedStrike.set(strikes[idx + 1]);
      this.fetchPCRAnalysis();
    }
  }

  /**
   * Shift Selected Strike Down by 1 step in available strikes
   */
  shiftStrikeDown(): void {
    const strikes = this.availableStrikes();
    const current = this.selectedStrike() ?? this.atmStrike();
    if (!current || strikes.length === 0) return;

    const idx = strikes.indexOf(current);
    if (idx > 0) {
      this.selectedStrike.set(strikes[idx - 1]);
      this.fetchPCRAnalysis();
    }
  }

  /**
   * Toggle Auto Refresh
   */
  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.update((prev) => !prev);
    if (this.autoRefreshEnabled()) {
      this.setupAutoRefresh();
      this.snackBar.open('Auto-refresh (30s) enabled', 'OK', { duration: 2000 });
    } else {
      this.stopAutoRefresh();
      this.snackBar.open('Auto-refresh paused', 'OK', { duration: 2000 });
    }
  }

  private setupAutoRefresh(): void {
    this.stopAutoRefresh();
    this.refreshSub = interval(30000).subscribe(() => {
      if (this.autoRefreshEnabled()) {
        this.fetchPCRAnalysis(true);
      }
    });
  }

  private stopAutoRefresh(): void {
    if (this.refreshSub) {
      this.refreshSub.unsubscribe();
      this.refreshSub = null;
    }
  }

  /**
   * Helpers for formatting and UI indicators
   */
  formatNumber(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return val.toLocaleString('en-IN');
  }

  formatPCR(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return val.toFixed(2);
  }

  getPCRClass(val: number | null | undefined): string {
    if (val === null || val === undefined || isNaN(val)) return 'pcr-na';
    if (val > 1.2) return 'pcr-bullish';
    if (val < 0.8) return 'pcr-bearish';
    return 'pcr-neutral';
  }

  getChangeClass(val: number | null | undefined): string {
    if (val === null || val === undefined || val === 0) return 'change-neutral';
    return val > 0 ? 'change-positive' : 'change-negative';
  }

  getSentimentBadgeClass(sentiment: string | undefined): string {
    switch (sentiment) {
      case 'strongly_bullish':
      case 'bullish':
        return 'badge-bullish';
      case 'strongly_bearish':
      case 'bearish':
        return 'badge-bearish';
      default:
        return 'badge-neutral';
    }
  }
}
