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
import { MatSliderModule } from '@angular/material/slider';
import { MatInputModule } from '@angular/material/input';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Subscription, interval } from 'rxjs';

import { OptionChainService } from '../../services/option-chain.service';
import {
  HistoricalReplayItem,
  HistoricalReplayResponse,
  StrikeData,
  IndicesResponse,
} from '../../models/option-chain.model';

@Component({
  selector: 'app-historical-replay',
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
    MatSliderModule,
    MatButtonToggleModule,
  ],
  templateUrl: './historical-replay.component.html',
  styleUrls: ['./historical-replay.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoricalReplayComponent implements OnInit, OnDestroy {
  private optionChainService = inject(OptionChainService);
  private snackBar = inject(MatSnackBar);

  // Configuration Signals
  symbol = signal<string>('NIFTY');
  selectedDate = signal<string>('2026-09-10');
  selectedExpiry = signal<string>('');
  activeExpiry = signal<string>('15-Sep-2026');
  availableExpiries = signal<string[]>([]);
  availableDates = signal<string[]>([]);
  startTime = signal<string>('09:15');
  endTime = signal<string>('15:30');
  timeFrame = signal<number>(1); // 1, 3, 5 minutes
  strikeRange = signal<number>(10); // strikes around ATM to display
  playbackSpeed = signal<number>(1); // 0.5, 1, 2, 5, 10

  // State Signals
  replayItems = signal<HistoricalReplayItem[]>([]);
  currentIndex = signal<number>(0);
  isPlaying = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  dataSourceInfo = signal<string>('');
  indices = signal<{ symbol: string; display_name: string }[]>([]);

  // Supported Speeds
  speedOptions: number[] = [0.5, 1, 2, 5, 10];

  // Playback timer subscription
  private timerSub?: Subscription;

  // Computed signals
  totalFrames = computed(() => this.replayItems().length);

  currentFrame = computed<HistoricalReplayItem | null>(() => {
    const items = this.replayItems();
    const idx = this.currentIndex();
    if (!items || items.length === 0) return null;
    return items[Math.min(idx, items.length - 1)] || null;
  });

  currentSpot = computed(() => this.currentFrame()?.niftyPrice ?? 0);
  currentATM = computed(() => this.currentFrame()?.atmStrike ?? 0);
  currentPCR = computed(() => this.currentFrame()?.pcr ?? 0);
  currentAveragePCR = computed(() => this.currentFrame()?.averagePCR ?? 0);
  currentTimestamp = computed(() => this.currentFrame()?.timestamp ?? this.startTime());
  currentStrikes = computed<StrikeData[]>(() => this.currentFrame()?.optionChain ?? []);
  totalCallOI = computed(() => this.currentFrame()?.totalCallOI ?? 0);
  totalPutOI = computed(() => this.currentFrame()?.totalPutOI ?? 0);

  // Helper to extract top 2 distinct positive values from an array
  private getTop2Values(values: (number | undefined)[]): { max1: number; max2: number } {
    const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
    if (valid.length === 0) return { max1: 0, max2: 0 };
    const sorted = Array.from(new Set(valid)).sort((a, b) => b - a);
    return {
      max1: sorted[0] || 0,
      max2: sorted[1] || 0,
    };
  }

  // Top 2 Call OI
  callOITop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.ce?.oi)));
  // Top 2 Put OI
  putOITop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.pe?.oi)));
  // Top 2 Call Change in OI
  callChgOITop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.ce?.changeOI)));
  // Top 2 Put Change in OI
  putChgOITop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.pe?.changeOI)));
  // Top 2 Call Volume
  callVolTop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.ce?.volume)));
  // Top 2 Put Volume
  putVolTop2 = computed(() => this.getTop2Values(this.currentStrikes().map((s) => s.pe?.volume)));

  // Methods to identify 1st Highest (Green) and 2nd Highest (Yellow)
  isMaxCallOI(val?: number): boolean {
    const top = this.callOITop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxCallOI(val?: number): boolean {
    const top = this.callOITop2();
    return !!val && val > 0 && val === top.max2;
  }

  isMaxPutOI(val?: number): boolean {
    const top = this.putOITop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxPutOI(val?: number): boolean {
    const top = this.putOITop2();
    return !!val && val > 0 && val === top.max2;
  }

  isMaxCallChgOI(val?: number): boolean {
    const top = this.callChgOITop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxCallChgOI(val?: number): boolean {
    const top = this.callChgOITop2();
    return !!val && val > 0 && val === top.max2;
  }

  isMaxPutChgOI(val?: number): boolean {
    const top = this.putChgOITop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxPutChgOI(val?: number): boolean {
    const top = this.putChgOITop2();
    return !!val && val > 0 && val === top.max2;
  }

  isMaxCallVol(val?: number): boolean {
    const top = this.callVolTop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxCallVol(val?: number): boolean {
    const top = this.callVolTop2();
    return !!val && val > 0 && val === top.max2;
  }

  isMaxPutVol(val?: number): boolean {
    const top = this.putVolTop2();
    return !!val && val > 0 && val === top.max1;
  }
  isSecondMaxPutVol(val?: number): boolean {
    const top = this.putVolTop2();
    return !!val && val > 0 && val === top.max2;
  }

  // Timeline Progress percentage
  progressPercent = computed(() => {
    const total = this.totalFrames();
    if (total <= 1) return 0;
    return (this.currentIndex() / (total - 1)) * 100;
  });

  ngOnInit(): void {
    this.loadIndices();
    this.loadActiveExpiryCycle();
    this.loadHistoricalDates();
    this.loadHistoricalExpiries();
    this.loadReplayData();
  }

  ngOnDestroy(): void {
    this.pause();
  }

  loadIndices(): void {
    this.optionChainService.getIndices().subscribe({
      next: (res: IndicesResponse) => {
        if (res.success && res.data) {
          this.indices.set(res.data);
        }
      },
      error: () => {},
    });
  }

  loadActiveExpiryCycle(): void {
    this.optionChainService.getActiveExpiryCycle(this.symbol()).subscribe({
      next: (res) => {
        if (res.success && res.activeCycle) {
          const nseExp = res.activeCycle.expiryDateNSE || res.activeCycle.expiry_date;
          this.activeExpiry.set(nseExp);
          if (res.availableExpiries && res.availableExpiries.length > 0) {
            this.availableExpiries.set(res.availableExpiries);
            if (!this.selectedExpiry()) {
              this.selectedExpiry.set(res.availableExpiries[0]);
            }
          }
        }
      },
      error: () => {
        // Fallback default
        this.activeExpiry.set('15-Sep-2026');
      },
    });
  }

  loadHistoricalDates(): void {
    this.optionChainService.getHistoricalDates(this.symbol()).subscribe({
      next: (res) => {
        if (res.success && res.data && res.data.length > 0) {
          this.availableDates.set(res.data);
          if (!res.data.includes(this.selectedDate())) {
            this.selectedDate.set(res.data[0]);
            this.loadHistoricalExpiries();
            this.loadReplayData();
          }
        }
      },
      error: () => {},
    });
  }

  loadHistoricalExpiries(): void {
    this.optionChainService.getHistoricalExpiries(this.symbol(), this.selectedDate()).subscribe({
      next: (res) => {
        if (res.success && res.data && res.data.length > 0) {
          this.availableExpiries.set(res.data);
        }
      },
      error: () => {},
    });
  }

  onDateChange(newDate: string): void {
    this.selectedDate.set(newDate);
    this.loadHistoricalExpiries();
    this.loadReplayData();
  }

  onExpiryChange(newExp: string): void {
    this.selectedExpiry.set(newExp);
    this.loadReplayData();
  }

  /**
   * Load historical option chain replay dataset for the selected date, expiry, and time range.
   * Loads the full day once so playback executes 100% locally with zero latency.
   */
  loadReplayData(): void {
    // Validate time range
    if (this.startTime() >= this.endTime()) {
      this.snackBar.open('Start Time must be earlier than End Time', 'Dismiss', {
        duration: 3500,
        panelClass: ['warning-snackbar'],
      });
      return;
    }

    this.pause();
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.optionChainService
      .getHistoricalReplay(this.symbol(), {
        date: this.selectedDate(),
        expiry: this.selectedExpiry() || undefined,
        startTime: this.startTime(),
        endTime: this.endTime(),
        timeFrame: this.timeFrame(),
        strikeRange: this.strikeRange(),
      })
      .subscribe({
        next: (res: HistoricalReplayResponse) => {
          this.isLoading.set(false);
          if (res.success && res.data && res.data.length > 0) {
            this.replayItems.set(res.data);
            this.currentIndex.set(0);
            this.dataSourceInfo.set(
              res.source === 'database'
                ? `Loaded ${res.data.length} snapshots from Database (${res.expiry ? 'Expiry: ' + res.expiry : 'Active Expiry'})`
                : `Loaded ${res.data.length} simulation playback snapshots`
            );
            this.snackBar.open(
              `Replay session ready: ${res.data.length} intervals (${this.timeFrame()}m interval)`,
              'OK',
              { duration: 2500 }
            );
          } else {
            this.replayItems.set([]);
            this.errorMessage.set('No historical data found for the selected date and range.');
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            err.error?.message || 'Failed to fetch historical option chain data from server.'
          );
          this.snackBar.open('Error loading historical session data', 'Close', {
            duration: 4000,
            panelClass: ['error-snackbar'],
          });
        },
      });
  }

  /**
   * Toggle between Play and Pause.
   */
  togglePlay(): void {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Start local playback forward in time.
   */
  play(): void {
    const total = this.totalFrames();
    if (total === 0) return;

    // If reached end, restart from 0
    if (this.currentIndex() >= total - 1) {
      this.currentIndex.set(0);
    }

    this.isPlaying.set(true);
    this.startPlaybackTimer();
  }

  /**
   * Pause playback. Keeps current timestamp unchanged.
   */
  pause(): void {
    this.isPlaying.set(false);
    if (this.timerSub) {
      this.timerSub.unsubscribe();
      this.timerSub = undefined;
    }
  }

  /**
   * Controlled playback timer: ticks every (1000 / playbackSpeed) ms.
   * Advances current index by 1 on each tick.
   */
  private startPlaybackTimer(): void {
    if (this.timerSub) {
      this.timerSub.unsubscribe();
    }

    const intervalMs = Math.max(50, Math.round(1000 / this.playbackSpeed()));
    this.timerSub = interval(intervalMs).subscribe(() => {
      const current = this.currentIndex();
      const total = this.totalFrames();

      if (current < total - 1) {
        this.currentIndex.set(current + 1);
      } else {
        // Reached end of playback
        this.pause();
        this.snackBar.open('Historical replay session completed.', 'Replay', {
          duration: 3000,
        }).onAction().subscribe(() => this.restart());
      }
    });
  }

  /**
   * Step backward by 1 interval.
   */
  stepBackward(): void {
    this.pause();
    const current = this.currentIndex();
    if (current > 0) {
      this.currentIndex.set(current - 1);
    }
  }

  /**
   * Step forward by 1 interval.
   */
  stepForward(): void {
    this.pause();
    const current = this.currentIndex();
    if (current < this.totalFrames() - 1) {
      this.currentIndex.set(current + 1);
    }
  }

  /**
   * Restart from the very first historical interval (index 0).
   */
  restart(): void {
    this.pause();
    this.currentIndex.set(0);
  }

  /**
   * Jump directly to a specific timestamp index via slider or click.
   */
  seekTo(index: number): void {
    const total = this.totalFrames();
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(index, total - 1));
    this.currentIndex.set(clamped);
  }

  /**
   * Handle slider drag / input change.
   */
  onSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && target.value !== undefined) {
      this.seekTo(parseInt(target.value, 10));
    }
  }

  /**
   * Change playback speed and adjust timer dynamically if currently playing.
   */
  changeSpeed(speed: number): void {
    this.playbackSpeed.set(speed);
    if (this.isPlaying()) {
      this.startPlaybackTimer();
    }
  }

  /**
   * Change time frame (1m, 3m, 5m) and reload dataset.
   */
  changeTimeFrame(tf: number): void {
    if (this.timeFrame() !== tf) {
      this.timeFrame.set(tf);
      this.loadReplayData();
    }
  }

  /**
   * Change symbol.
   */
  changeSymbol(symbol: string): void {
    if (this.symbol() !== symbol) {
      this.symbol.set(symbol);
      this.loadReplayData();
    }
  }

  /**
   * Format number for display.
   */
  formatNumber(val?: number): string {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return Number(val).toLocaleString('en-IN');
  }

  /**
   * Format decimal for display.
   */
  formatDecimal(val?: number, digits = 2): string {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return Number(val).toFixed(digits);
  }

  /**
   * Check if strike is ATM.
   */
  isATM(strike: number): boolean {
    return strike === this.currentATM();
  }

  /**
   * Check if Call is In The Money (ITM).
   * For Calls: Strike < Current Spot Price.
   */
  isCallITM(strike: number): boolean {
    const spot = this.currentSpot();
    return spot > 0 && strike < spot;
  }

  /**
   * Check if Put is In The Money (ITM).
   * For Puts: Strike > Current Spot Price.
   */
  isPutITM(strike: number): boolean {
    const spot = this.currentSpot();
    return spot > 0 && strike > spot;
  }

  /**
   * Format strike price with commas and 2 decimals like official NSE (e.g. 23,200.00).
   */
  formatStrikePrice(strike: number): string {
    if (!strike && strike !== 0) return '-';
    return Number(strike).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Determine PCR sentiment badge class.
   */
  getPCRSentiment(pcr: number): { label: string; class: string } {
    if (pcr >= 1.25) return { label: 'Strong Bullish', class: 'bullish' };
    if (pcr >= 1.05) return { label: 'Mild Bullish', class: 'mild-bullish' };
    if (pcr >= 0.95) return { label: 'Neutral', class: 'neutral' };
    if (pcr >= 0.75) return { label: 'Mild Bearish', class: 'mild-bearish' };
    return { label: 'Strong Bearish', class: 'bearish' };
  }
}
