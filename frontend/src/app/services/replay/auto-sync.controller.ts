/**
 * Auto-Sync Controller
 *
 * Coordinates real-time clock synchronization between the user's current
 * real-world time and the historical market session:
 *
 * - Mode: 'LIVE_SYNC' (LIVE SYNC: ON) vs 'MANUAL_REPLAY' (MANUAL REPLAY)
 * - Ticks every 1 second, updating live clock and elapsed session time
 * - When in LIVE_SYNC: mirrors current live session elapsed minutes to the
 *   historical date and automatically updates displayed snapshot without page reload
 * - At 9:32 AM -> displays 9:32 snapshot; at 9:33 AM -> automatically advances to 9:33
 * - Allows manual replay override whenever user operates controls
 * - Resume Live Sync snaps historical clock back to current live market position
 */

import { signal, computed } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { LiveClockState, getLiveClockInfo } from './market-clock.manager';
import {
  mapSessionToHistoricalTimestamp,
  TimestampMappingResult,
} from './historical-timestamp-mapper';
import { HistoricalDataStore } from './historical-data.store';
import { ReplayController } from './replay.controller';

export type ReplayMode = 'LIVE_SYNC' | 'MANUAL_REPLAY';

export class AutoSyncController {
  readonly mode = signal<ReplayMode>('LIVE_SYNC');
  readonly isLiveSync = computed(() => this.mode() === 'LIVE_SYNC');

  // Real-time live clock state updated every second
  readonly liveClock = signal<LiveClockState>(getLiveClockInfo());

  // Active timestamp mapping result
  readonly mappingResult = signal<TimestampMappingResult | null>(null);

  private clockTimerSub?: Subscription;
  private lastMinute = -1;

  /**
   * Callback invoked whenever a new minute arrives (e.g. 10:36 -> 10:37)
   */
  public onMinuteRollover?: (now: Date) => void;

  constructor(
    private dataStore: HistoricalDataStore,
    private replayController: ReplayController
  ) {
    // When manual actions occur in ReplayController, switch to MANUAL_REPLAY
    this.replayController.onManualAction = () => {
      this.switchToManualReplay();
    };

    // When manual playback reaches live market edge, smoothly resume LIVE_SYNC
    this.replayController.onReachedLiveEdge = () => {
      this.resumeLiveSync();
    };

    this.startClock();
  }

  /**
   * Start 1-second clock loop.
   */
  private startClock(): void {
    if (this.clockTimerSub) {
      this.clockTimerSub.unsubscribe();
    }

    // Ticks every 1000ms
    this.clockTimerSub = interval(1000).subscribe(() => {
      this.onClockTick();
    });

    // Run initial tick immediately
    this.onClockTick();
  }

  /**
   * Clock tick execution.
   */
  public onClockTick(now: Date = new Date()): void {
    const clockInfo = getLiveClockInfo(now);
    this.liveClock.set(clockInfo);

    const currentMin = now.getMinutes();
    const isNewMinute = this.lastMinute !== -1 && this.lastMinute !== currentMin;
    this.lastMinute = currentMin;

    // If currently in LIVE_SYNC mode, strictly sync historical market clock with real-world clock
    if (this.mode() === 'LIVE_SYNC') {
      this.syncHistoricalToLive(now);
    }

    // Trigger minute rollover hook if the minute changed
    if (isNewMinute && this.onMinuteRollover) {
      this.onMinuteRollover(now);
    }
  }

  /**
   * Synchronize the historical dataset to the given live time.
   */
  public syncHistoricalToLive(time: Date = new Date()): TimestampMappingResult {
    const timestamps = this.dataStore.availableTimestamps();
    const result = mapSessionToHistoricalTimestamp(time, timestamps);
    this.mappingResult.set(result);

    if (result.selectedIndex >= 0) {
      this.dataStore.setCurrentIndex(result.selectedIndex);
    }

    return result;
  }

  /**
   * User manually operated playback (dragged slider, clicked play/pause, step).
   * Temporarily disables auto-sync and enters MANUAL_REPLAY mode.
   */
  public switchToManualReplay(): void {
    if (this.mode() !== 'MANUAL_REPLAY') {
      this.mode.set('MANUAL_REPLAY');
      this.replayController.enforceLiveCeiling.set(false);
    }
  }

  /**
   * Resume Live Synchronization.
   * Stops any manual playback timer, sets mode to LIVE_SYNC,
   * and immediately snaps to current live session position.
   */
  public resumeLiveSync(): void {
    this.replayController.pause(false);
    this.mode.set('LIVE_SYNC');
    this.replayController.enforceLiveCeiling.set(true);
    this.syncHistoricalToLive(new Date());
  }

  /**
   * Toggle between LIVE_SYNC and MANUAL_REPLAY.
   */
  public toggleMode(): void {
    if (this.isLiveSync()) {
      this.switchToManualReplay();
    } else {
      this.resumeLiveSync();
    }
  }

  destroy(): void {
    if (this.clockTimerSub) {
      this.clockTimerSub.unsubscribe();
      this.clockTimerSub = undefined;
    }
  }
}
