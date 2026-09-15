import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
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
  HistoricalReplayResponse,
  IndicesResponse,
} from '../../models/option-chain.model';
import {
  HistoricalDataStore,
  ReplayController,
  AutoSyncController,
  ReplayMode,
  validateTradingDay,
  formatDisplayDate,
  toISODateString,
  timeToMinutes,
} from '../../services/replay';

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

  // Track key to auto-scroll when historical data loads or changes
  private lastScrolledATMKey = '';

  // Collapsible configuration to keep playback controls and table in viewport simultaneously
  isConfigCollapsed = signal<boolean>(false);

  toggleConfigCollapse(): void {
    this.isConfigCollapsed.update((v) => !v);
  }

  constructor() {
    // Automatically auto-scroll to ATM strike row when historical replay data is loaded
    effect(() => {
      const strikes = this.currentStrikes();
      const atm = this.currentATM();
      const symbol = this.symbol();
      const date = this.selectedDate();
      const key = `${symbol}_${date}_${atm}_${strikes ? strikes.length : 0}`;
      if (strikes && strikes.length > 0 && atm > 0 && this.lastScrolledATMKey !== key) {
        this.lastScrolledATMKey = key;
        this.scrollToATMStrike();
      }
    });
  }

  // Replay System Subsystems
  public readonly dataStore = new HistoricalDataStore();
  public readonly replayController = new ReplayController(this.dataStore);
  public readonly autoSyncController = new AutoSyncController(
    this.dataStore,
    this.replayController
  );

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

  // Auto-Refresh State Signals
  autoRefreshEnabled = signal<boolean>(true);
  autoRefreshInterval = signal<number>(15); // in seconds
  isBackgroundRefreshing = signal<boolean>(false);
  lastRefreshedTime = signal<string>('');
  private autoRefreshSub?: Subscription;

  // UI State Signals
  isLoading = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  dataSourceInfo = signal<string>('');
  indices = signal<{ symbol: string; display_name: string }[]>([]);

  // Validation of selected trading day (weekends and holidays)
  dateValidation = computed(() => validateTradingDay(this.selectedDate()));
  isNonTradingDay = computed(() => !this.dateValidation().isValid);

  // Exposed Data Store Signals
  totalFrames = this.dataStore.totalFrames;
  currentIndex = this.dataStore.currentIndex;
  currentFrame = this.dataStore.currentFrame;
  currentSpot = this.dataStore.currentSpot;
  currentATM = this.dataStore.currentATM;
  currentPCR = this.dataStore.currentPCR;
  currentAveragePCR = this.dataStore.currentAveragePCR;
  currentTimestamp = this.dataStore.currentTimestamp;
  currentStrikes = this.dataStore.currentStrikes;
  totalCallOI = this.dataStore.totalCallOI;
  totalPutOI = this.dataStore.totalPutOI;

  // Top 2 Highlights
  callOITop2 = this.dataStore.callOITop2;
  putOITop2 = this.dataStore.putOITop2;
  callChgOITop2 = this.dataStore.callChgOITop2;
  putChgOITop2 = this.dataStore.putChgOITop2;
  callVolTop2 = this.dataStore.callVolTop2;
  putVolTop2 = this.dataStore.putVolTop2;

  // Replay Controller Signals
  isPlaying = this.replayController.isPlaying;
  playbackSpeed = this.replayController.playbackSpeed;
  speedOptions = this.replayController.speedOptions;

  // Auto-Sync Controller Signals
  syncMode = this.autoSyncController.mode;
  isLiveSync = this.autoSyncController.isLiveSync;
  liveClock = this.autoSyncController.liveClock;
  mappingResult = this.autoSyncController.mappingResult;

  // Display strings
  formattedHistoricalDate = computed(() => formatDisplayDate(this.selectedDate()));

  // Timeline Progress percentage (0 to 100)
  progressPercent = computed(() => {
    const total = this.totalFrames();
    if (total <= 1) return 0;
    return (this.currentIndex() / (total - 1)) * 100;
  });

  // Session progress percentage based on market clock
  sessionProgressPercent = computed(() => {
    return this.liveClock().progressPercent;
  });

  // Maximum allowed index based on current market clock (enforces "Never select a future historical snapshot")
  maxAllowedSliderIndex = computed(() => {
    const total = this.totalFrames();
    if (total === 0) return 0;
    const maxIdx = this.replayController.getMaxAllowedIndex();
    return Math.min(maxIdx, total - 1);
  });

  // Sync position display detail
  syncStatusDetail = computed(() => {
    if (this.isLiveSync()) {
      return `${this.liveClock().elapsedMinutes} min after market open (Live: ${this.liveClock().timeStr})`;
    }
    const currMin = timeToMinutes(this.currentTimestamp());
    const openMin = 9 * 60 + 15;
    const diff = Math.max(0, currMin - openMin);
    return `${diff} min after market open (Live: ${this.liveClock().timeStr})`;
  });

  ngOnInit(): void {
    this.loadIndices();
    this.loadActiveExpiryCycle();
    this.loadHistoricalDates();
    this.loadHistoricalExpiries();
    this.loadReplayData();
    this.setupAutoRefresh();

    // Hook auto-sync minute rollover to trigger automatic refresh whenever real clock advances into a new minute
    this.autoSyncController.onMinuteRollover = () => {
      if (this.autoRefreshEnabled() && !this.isPlaying()) {
        this.refreshHistoricalData(true);
      }
    };
  }

  ngOnDestroy(): void {
    this.replayController.destroy();
    this.autoSyncController.destroy();
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
      this.autoRefreshSub = undefined;
    }
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
    const iso = toISODateString(newDate);
    this.selectedDate.set(iso);
    this.loadHistoricalExpiries();
    this.loadReplayData();
  }

  onExpiryChange(newExp: string): void {
    this.selectedExpiry.set(newExp);
    this.loadReplayData();
  }

  /**
   * Switch to nearest valid trading day when a weekend or holiday is selected.
   */
  selectNearestValidDate(): void {
    const validInfo = this.dateValidation();
    if (validInfo.nearestValidDate) {
      this.onDateChange(validInfo.nearestValidDate);
    }
  }

  /**
   * Load historical option chain replay dataset.
   * Checks cache first to avoid redundant network roundtrips.
   * If non-trading day, warns user and avoids fake data generation.
   */
  loadReplayData(): void {
    this.lastScrolledATMKey = '';

    // 1. Validate Trading Day
    const validation = this.dateValidation();
    if (!validation.isValid) {
      this.replayController.pause(false);
      this.dataStore.clear();
      this.errorMessage.set(validation.reason || 'Selected date is not a trading day.');
      this.snackBar.open(
        validation.reason || 'Market closed on selected date',
        'Select Nearest Day',
        { duration: 5000, panelClass: ['warning-snackbar'] }
      ).onAction().subscribe(() => this.selectNearestValidDate());
      return;
    }

    // 2. Validate time range
    if (this.startTime() >= this.endTime()) {
      this.snackBar.open('Start Time must be earlier than End Time', 'Dismiss', {
        duration: 3500,
        panelClass: ['warning-snackbar'],
      });
      return;
    }

    // 3. Check DataStore in-memory cache
    if (
      this.dataStore.hasCached(
        this.symbol(),
        this.selectedDate(),
        this.selectedExpiry(),
        this.timeFrame()
      )
    ) {
      const cached = this.dataStore.getCached(
        this.symbol(),
        this.selectedDate(),
        this.selectedExpiry(),
        this.timeFrame()
      )!;
      this.dataStore.loadDataset(
        this.symbol(),
        this.selectedDate(),
        this.selectedExpiry(),
        this.timeFrame(),
        cached
      );
      this.errorMessage.set(null);
      this.dataSourceInfo.set(`Instant Cache: ${cached.length} intervals loaded`);
      // Re-align with live clock if in LIVE_SYNC mode
      if (this.isLiveSync()) {
        this.autoSyncController.syncHistoricalToLive(new Date());
      }
      this.scrollToATMStrike();
      return;
    }

    this.replayController.pause(false);
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
            this.dataStore.loadDataset(
              this.symbol(),
              this.selectedDate(),
              this.selectedExpiry(),
              this.timeFrame(),
              res.data
            );
            this.dataSourceInfo.set(
              res.source === 'database'
                ? `Loaded ${res.data.length} snapshots from Database (${res.expiry ? 'Expiry: ' + res.expiry : 'Active Expiry'})`
                : `Loaded ${res.data.length} historical playback snapshots`
            );

            // If in LIVE_SYNC mode, immediately synchronize to the current live clock
            if (this.isLiveSync()) {
              const mapping = this.autoSyncController.syncHistoricalToLive(new Date());
              this.snackBar.open(
                `Replay session synchronized to live clock: ${mapping.selectedHistoricalTime} (${mapping.statusText})`,
                'OK',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Replay session ready: ${res.data.length} intervals (${this.timeFrame()}m interval)`,
                'OK',
                { duration: 2500 }
              );
            }
            this.scrollToATMStrike();
          } else {
            this.dataStore.clear();
            const msg = (res as any)?.message || 'No historical data found for the selected date.';
            this.errorMessage.set(msg);
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          this.dataStore.clear();
          const errReason = err.error?.message || 'Failed to fetch historical option chain data.';
          this.errorMessage.set(errReason);
          this.snackBar.open(errReason, 'Close', {
            duration: 4000,
            panelClass: ['error-snackbar'],
          });
        },
      });
  }

  // --- Auto-Refresh Engine ---

  /**
   * Setup continuous auto-refresh polling timer (default every 15s).
   */
  setupAutoRefresh(): void {
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
    }
    this.autoRefreshSub = interval(this.autoRefreshInterval() * 1000).subscribe(() => {
      if (this.autoRefreshEnabled() && !this.isPlaying()) {
        this.refreshHistoricalData(true);
      }
    });
  }

  /**
   * Toggle auto-refresh ON / OFF.
   */
  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.set(!this.autoRefreshEnabled());
    const state = this.autoRefreshEnabled() ? 'ON' : 'OFF';
    this.snackBar.open(`Auto-refresh ${state} (${this.autoRefreshInterval()}s interval)`, 'OK', { duration: 2000 });
  }

  /**
   * Change auto-refresh interval (10s, 15s, 30s, 60s).
   */
  changeAutoRefreshInterval(sec: number): void {
    this.autoRefreshInterval.set(sec);
    this.setupAutoRefresh();
    this.snackBar.open(`Auto-refresh interval set to ${sec}s`, 'OK', { duration: 2000 });
  }

  /**
   * Refresh historical data automatically or manually.
   * In silent background mode, updates the dataset without interrupting UI or showing blocking spinner.
   */
  refreshHistoricalData(silent: boolean = true): void {
    const validation = this.dateValidation();
    if (!validation.isValid) return;

    if (this.isLoading() || this.isBackgroundRefreshing()) return;

    if (silent) {
      this.isBackgroundRefreshing.set(true);
    } else {
      this.isLoading.set(true);
    }

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
          this.isBackgroundRefreshing.set(false);
          if (res.success && res.data && res.data.length > 0) {
            this.dataStore.loadDataset(
              this.symbol(),
              this.selectedDate(),
              this.selectedExpiry(),
              this.timeFrame(),
              res.data
            );
            this.lastRefreshedTime.set(this.liveClock().timeWithSeconds);

            // If in LIVE_SYNC mode, sync immediately to the current live clock minute
            if (this.isLiveSync()) {
              this.autoSyncController.syncHistoricalToLive(new Date());
            }

            if (!silent) {
              this.snackBar.open(`Historical option chain refreshed (${res.data.length} snapshots)`, 'OK', { duration: 2000 });
            }
          }
        },
        error: () => {
          this.isLoading.set(false);
          this.isBackgroundRefreshing.set(false);
        },
      });
  }

  // --- Transport Controls ---

  togglePlay(): void {
    if (this.isLiveSync()) {
      // Pause live sync at current timestamp and enter manual replay
      this.autoSyncController.switchToManualReplay();
      this.snackBar.open(`Manual Replay mode active at ${this.currentTimestamp()}`, 'Dismiss', { duration: 2000 });
    } else {
      if (this.isPlaying()) {
        this.replayController.pause(true);
      } else {
        // Collapse configuration to ensure top playback hub and table are both visible
        this.isConfigCollapsed.set(true);
        // If already at or beyond max allowed live ceiling, resume live sync!
        if (this.currentIndex() >= this.maxAllowedSliderIndex()) {
          this.resumeLiveSync();
        } else {
          this.replayController.play(true);
        }
        this.scrollToATMStrike();
      }
    }
  }

  restart(): void {
    this.replayController.restart();
  }

  stepBackward(): void {
    this.replayController.stepPrevious();
  }

  stepForward(): void {
    if (this.currentIndex() < this.maxAllowedSliderIndex()) {
      this.replayController.stepNext();
    } else {
      this.snackBar.open('Cannot advance beyond current live market session time', 'OK', { duration: 2000 });
    }
  }

  seekTo(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.maxAllowedSliderIndex()));
    this.replayController.seekTo(clamped);
  }

  onSliderInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && target.value !== undefined) {
      this.seekTo(parseInt(target.value, 10));
    }
  }

  changeSpeed(speed: number): void {
    this.replayController.changeSpeed(speed);
  }

  // --- Live Sync Controls ---

  resumeLiveSync(): void {
    this.autoSyncController.resumeLiveSync();
    this.snackBar.open('Live Clock Synchronization Resumed', 'OK', { duration: 2000 });
  }

  toggleLiveSync(): void {
    this.autoSyncController.toggleMode();
  }

  // --- Configuration Handlers ---

  changeTimeFrame(tf: number): void {
    if (this.timeFrame() !== tf) {
      this.timeFrame.set(tf);
      this.loadReplayData();
    }
  }

  changeSymbol(sym: string): void {
    if (this.symbol() !== sym) {
      this.symbol.set(sym);
      this.loadReplayData();
    }
  }

  // --- Table Formatting & Highlights ---

  formatNumber(val?: number): string {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return Number(val).toLocaleString('en-IN');
  }

  formatDecimal(val?: number, digits = 2): string {
    if (val === undefined || val === null || isNaN(val)) return '-';
    return Number(val).toFixed(digits);
  }

  isATM(strike: number): boolean {
    return strike === this.currentATM();
  }

  /**
   * Automatically scroll the table container smoothly to center on the ATM (current strike price) row
   */
  scrollToATMStrike(): void {
    const doScroll = () => {
      const container = document.querySelector('.historical-replay-container .table-responsive-container') as HTMLElement;
      const targetRow = (document.getElementById('historical-atm-strike-row') ||
        document.querySelector('.historical-replay-container .atm-highlight-row')) as HTMLElement;

      if (container && targetRow) {
        // Calculate offset relative to table container
        const rowOffsetTop = targetRow.offsetTop;
        const rowHeight = targetRow.offsetHeight || 38;
        const containerHeight = container.clientHeight || 450;
        const targetScrollTop = Math.max(0, rowOffsetTop - (containerHeight / 2) + (rowHeight / 2));

        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth',
        });
        return true;
      }
      return false;
    };

    setTimeout(() => {
      if (!doScroll()) {
        setTimeout(() => doScroll(), 250);
      }
    }, 150);
  }

  isCallITM(strike: number): boolean {
    const spot = this.currentSpot();
    return spot > 0 && strike < spot;
  }

  isPutITM(strike: number): boolean {
    const spot = this.currentSpot();
    return spot > 0 && strike > spot;
  }

  formatStrikePrice(strike: number): string {
    if (!strike && strike !== 0) return '-';
    return Number(strike).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  getPCRSentiment(pcr: number): { label: string; class: string } {
    if (pcr >= 1.25) return { label: 'Strong Bullish', class: 'bullish' };
    if (pcr >= 1.05) return { label: 'Mild Bullish', class: 'mild-bullish' };
    if (pcr >= 0.95) return { label: 'Neutral', class: 'neutral' };
    if (pcr >= 0.75) return { label: 'Mild Bearish', class: 'mild-bearish' };
    return { label: 'Strong Bearish', class: 'bearish' };
  }

  isMaxCallOI(val?: number): boolean {
    return !!val && val > 0 && val === this.callOITop2().max1;
  }
  isSecondMaxCallOI(val?: number): boolean {
    return !!val && val > 0 && val === this.callOITop2().max2;
  }

  isMaxPutOI(val?: number): boolean {
    return !!val && val > 0 && val === this.putOITop2().max1;
  }
  isSecondMaxPutOI(val?: number): boolean {
    return !!val && val > 0 && val === this.putOITop2().max2;
  }

  isMaxCallChgOI(val?: number): boolean {
    return !!val && val > 0 && val === this.callChgOITop2().max1;
  }
  isSecondMaxCallChgOI(val?: number): boolean {
    return !!val && val > 0 && val === this.callChgOITop2().max2;
  }

  isMaxPutChgOI(val?: number): boolean {
    return !!val && val > 0 && val === this.putChgOITop2().max1;
  }
  isSecondMaxPutChgOI(val?: number): boolean {
    return !!val && val > 0 && val === this.putChgOITop2().max2;
  }

  isMaxCallVol(val?: number): boolean {
    return !!val && val > 0 && val === this.callVolTop2().max1;
  }
  isSecondMaxCallVol(val?: number): boolean {
    return !!val && val > 0 && val === this.callVolTop2().max2;
  }

  isMaxPutVol(val?: number): boolean {
    return !!val && val > 0 && val === this.putVolTop2().max1;
  }
  isSecondMaxPutVol(val?: number): boolean {
    return !!val && val > 0 && val === this.putVolTop2().max2;
  }
}
