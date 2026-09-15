/**
 * Option-Chain Historical Data Store
 *
 * Efficiently caches and indexes historical option chain datasets.
 * Prevents reloading data on every second/tick.
 * Offers O(1) timestamp indexing and reactive signals for the UI.
 */

import { signal, computed } from '@angular/core';
import { HistoricalReplayItem, StrikeData } from '../../models/option-chain.model';

export interface Top2Values {
  max1: number;
  max2: number;
}

export class HistoricalDataStore {
  // Primary state signals
  readonly dataset = signal<HistoricalReplayItem[]>([]);
  readonly currentIndex = signal<number>(0);
  readonly selectedDate = signal<string>('');
  readonly selectedExpiry = signal<string>('');
  readonly symbol = signal<string>('NIFTY');

  // Fast In-memory cache for loaded days: key -> HistoricalReplayItem[]
  private cache = new Map<string, HistoricalReplayItem[]>();

  // Computed signals
  readonly totalFrames = computed(() => this.dataset().length);

  readonly availableTimestamps = computed(() => {
    return this.dataset().map((item) => item.timestamp);
  });

  readonly currentFrame = computed<HistoricalReplayItem | null>(() => {
    const items = this.dataset();
    const idx = this.currentIndex();
    if (!items || items.length === 0) return null;
    return items[Math.min(Math.max(0, idx), items.length - 1)] || null;
  });

  readonly previousFrame = computed<HistoricalReplayItem | null>(() => {
    const items = this.dataset();
    const idx = this.currentIndex();
    if (!items || items.length === 0 || idx <= 0) return null;
    return items[idx - 1] || null;
  });

  readonly previousTimestamp = computed(() => this.previousFrame()?.timestamp ?? '');

  readonly previousStrikeMap = computed<Map<number, StrikeData>>(() => {
    const prev = this.previousFrame();
    const map = new Map<number, StrikeData>();
    if (prev && prev.optionChain) {
      for (const s of prev.optionChain) {
        map.set(s.strikePrice, s);
      }
    }
    return map;
  });

  readonly currentTimestamp = computed(() => this.currentFrame()?.timestamp ?? '09:15');
  readonly currentSpot = computed(() => this.currentFrame()?.niftyPrice ?? 0);
  readonly currentATM = computed(() => this.currentFrame()?.atmStrike ?? 0);
  readonly currentPCR = computed(() => this.currentFrame()?.pcr ?? 0);
  readonly currentAveragePCR = computed(() => this.currentFrame()?.averagePCR ?? 0);
  readonly currentStrikes = computed<StrikeData[]>(() => this.currentFrame()?.optionChain ?? []);
  readonly totalCallOI = computed(() => this.currentFrame()?.totalCallOI ?? 0);
  readonly totalPutOI = computed(() => this.currentFrame()?.totalPutOI ?? 0);

  // Top 2 computation helper
  private computeTop2(values: (number | undefined)[]): Top2Values {
    const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
    if (valid.length === 0) return { max1: 0, max2: 0 };
    const sorted = Array.from(new Set(valid)).sort((a, b) => b - a);
    return {
      max1: sorted[0] || 0,
      max2: sorted[1] || 0,
    };
  }

  readonly callOITop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.ce?.oi)));
  readonly putOITop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.pe?.oi)));
  readonly callChgOITop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.ce?.changeOI)));
  readonly putChgOITop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.pe?.changeOI)));
  readonly callVolTop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.ce?.volume)));
  readonly putVolTop2 = computed(() => this.computeTop2(this.currentStrikes().map((s) => s.pe?.volume)));

  /**
   * Build cache key.
   */
  private makeKey(symbol: string, date: string, expiry?: string | null, timeFrame: number = 1): string {
    return `${symbol.toUpperCase()}_${date}_${expiry || 'ALL'}_${timeFrame}`;
  }

  /**
   * Check if a dataset is already in memory cache.
   */
  hasCached(symbol: string, date: string, expiry?: string | null, timeFrame: number = 1): boolean {
    return this.cache.has(this.makeKey(symbol, date, expiry, timeFrame));
  }

  /**
   * Get cached dataset.
   */
  getCached(symbol: string, date: string, expiry?: string | null, timeFrame: number = 1): HistoricalReplayItem[] | undefined {
    return this.cache.get(this.makeKey(symbol, date, expiry, timeFrame));
  }

  /**
   * Load and cache dataset into store.
   */
  loadDataset(
    symbol: string,
    date: string,
    expiry: string | undefined | null,
    timeFrame: number,
    items: HistoricalReplayItem[]
  ): void {
    this.symbol.set(symbol);
    this.selectedDate.set(date);
    this.selectedExpiry.set(expiry || '');
    this.cache.set(this.makeKey(symbol, date, expiry, timeFrame), items);
    this.dataset.set(items);
  }

  /**
   * Set the active snapshot index.
   */
  setCurrentIndex(index: number): boolean {
    const total = this.totalFrames();
    if (total === 0) return false;
    const clamped = Math.max(0, Math.min(index, total - 1));
    if (this.currentIndex() !== clamped) {
      this.currentIndex.set(clamped);
      return true;
    }
    return false;
  }

  /**
   * Set active snapshot by timestamp string (e.g. "09:32").
   * Returns true if changed.
   */
  setCurrentTimestamp(timestamp: string): boolean {
    const timestamps = this.availableTimestamps();
    const idx = timestamps.indexOf(timestamp);
    if (idx !== -1) {
      return this.setCurrentIndex(idx);
    }
    return false;
  }

  /**
   * Clear active data.
   */
  clear(): void {
    this.dataset.set([]);
    this.currentIndex.set(0);
  }
}
