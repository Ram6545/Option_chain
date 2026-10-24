import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, interval } from 'rxjs';
import { OptionChainService } from '../../services/option-chain.service';
import {
  OptionVWAPResponse,
  OptionVWAPRow,
  OptionVWAPMarketBreadth,
} from '../../models/option-vwap.model';

@Component({
  selector: 'app-option-vwap',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './option-vwap.component.html',
  styleUrls: ['./option-vwap.component.scss'],
})
export class OptionVWAPComponent implements OnInit, OnDestroy {
  private optionChainService = inject(OptionChainService);

  // Configuration Signals
  symbol = signal<string>('NIFTY');
  availableIndices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];
  selectedExpiry = signal<string>('');
  availableExpiries = signal<string[]>([]);
  selectedDate = signal<string>('');
  availableDates = signal<string[]>([]);

  // Market & Strike Signals
  spotPrice = signal<number>(0);
  atmStrike = signal<number>(0);
  strikeInterval = signal<number>(50);
  tradingDate = signal<string>('');
  lastUpdated = signal<string>('');
  marketBreadth = signal<OptionVWAPMarketBreadth | null>(null);
  rows = signal<OptionVWAPRow[]>([]);

  // State Signals
  isLoading = signal<boolean>(false);
  isRefreshing = signal<boolean>(false);
  errorMessage = signal<string | null>(null);

  // Auto-Refresh
  autoRefreshEnabled = signal<boolean>(true);
  countdown = signal<number>(15);
  private timerSub?: Subscription;
  private autoRefreshSub?: Subscription;

  // Computed summary metrics
  callsAboveVWAP = computed(() =>
    this.rows().filter((r) => r.ce.status === 'available' && r.ce.difference > 0).length
  );
  callsBelowVWAP = computed(() =>
    this.rows().filter((r) => r.ce.status === 'available' && r.ce.difference < 0).length
  );
  putsAboveVWAP = computed(() =>
    this.rows().filter((r) => r.pe.status === 'available' && r.pe.difference > 0).length
  );
  putsBelowVWAP = computed(() =>
    this.rows().filter((r) => r.pe.status === 'available' && r.pe.difference < 0).length
  );

  vwapSentiment = computed(() => {
    const ca = this.callsAboveVWAP();
    const pa = this.putsAboveVWAP();
    if (ca > pa) return { label: 'CALL VWAP EXPANSION', class: 'bullish' };
    if (pa > ca) return { label: 'PUT VWAP EXPANSION', class: 'bearish' };
    return { label: 'BALANCED VWAP', class: 'neutral' };
  });

  ngOnInit(): void {
    this.loadVWAPData();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    this.clearSubscriptions();
  }

  setupAutoRefresh(): void {
    this.clearSubscriptions();

    this.timerSub = interval(1000).subscribe(() => {
      if (!this.autoRefreshEnabled() || this.isLoading()) return;
      const current = this.countdown();
      if (current <= 1) {
        this.countdown.set(15);
        this.loadVWAPData(true);
      } else {
        this.countdown.set(current - 1);
      }
    });
  }

  private clearSubscriptions(): void {
    if (this.timerSub) {
      this.timerSub.unsubscribe();
      this.timerSub = undefined;
    }
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
      this.autoRefreshSub = undefined;
    }
  }

  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.update((v) => !v);
    if (this.autoRefreshEnabled()) {
      this.countdown.set(15);
    }
  }

  onSymbolChange(sym: string): void {
    if (sym === this.symbol()) return;
    this.symbol.set(sym);
    this.selectedExpiry.set('');
    this.selectedDate.set('');
    this.loadVWAPData();
  }

  onExpiryChange(exp: string): void {
    this.selectedExpiry.set(exp);
    this.loadVWAPData(true);
  }

  onDateChange(d: string): void {
    this.selectedDate.set(d);
    this.loadVWAPData(true);
  }

  onManualRefresh(): void {
    this.countdown.set(15);
    this.loadVWAPData(true);
  }

  loadVWAPData(isManual: boolean = false): void {
    if (isManual) {
      this.isRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }
    this.errorMessage.set(null);

    const options = {
      expiry: this.selectedExpiry() || undefined,
      date: this.selectedDate() || undefined,
    };

    this.optionChainService.getOptionChainVWAP(this.symbol(), options).subscribe({
      next: (res: OptionVWAPResponse) => {
        this.isLoading.set(false);
        this.isRefreshing.set(false);

        if (res.success && res.data) {
          this.spotPrice.set(res.spotPrice);
          this.atmStrike.set(res.atmStrike);
          this.strikeInterval.set(res.strikeInterval);
          this.tradingDate.set(res.tradingDate);
          this.lastUpdated.set(res.lastUpdated);
          this.rows.set(res.data);

          if (res.marketBreadth) {
            this.marketBreadth.set(res.marketBreadth);
          }

          if (res.availableDates && res.availableDates.length > 0) {
            this.availableDates.set(res.availableDates);
            if (!this.selectedDate()) {
              this.selectedDate.set(res.tradingDate || res.availableDates[0]);
            }
          }

          if (res.expiry && !this.selectedExpiry()) {
            this.selectedExpiry.set(res.expiry);
          }
        } else {
          this.errorMessage.set(res.error || 'Failed to load Option Chain VWAP data.');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.isRefreshing.set(false);
        this.errorMessage.set(
          err.error?.error || err.message || 'Connection to Option Chain API failed.'
        );
      },
    });
  }

  formatPrice(val?: number | null): string {
    if (val === undefined || val === null || isNaN(val)) return '—';
    return Number(val).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  formatNumber(val?: number | null): string {
    if (val === undefined || val === null || isNaN(val)) return '—';
    return Number(val).toLocaleString('en-IN');
  }

  formatDiff(val?: number | null): string {
    if (val === undefined || val === null || isNaN(val)) return '—';
    const prefix = val > 0 ? '+' : '';
    return `${prefix}${val.toFixed(2)}`;
  }

  formatDiffPct(val?: number | null): string {
    if (val === undefined || val === null || isNaN(val)) return '—';
    const prefix = val > 0 ? '+' : '';
    return `${prefix}${val.toFixed(2)}%`;
  }
}
