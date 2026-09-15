/**
 * Replay Controller
 *
 * Manages manual playback transport:
 * - Play / Pause / Toggle
 * - Restart (reset to session start 09:15)
 * - Previous minute (|◀) / Next minute (▶|)
 * - Playback speeds: 0.5x, 1x, 2x, 5x, 10x
 * - Timeline seeking
 * - Enforces "Never select a future historical snapshot": stops when catching up with live market time
 * - Emits onManualAction hook to allow AutoSyncController to switch to MANUAL REPLAY
 */

import { signal } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { HistoricalDataStore } from './historical-data.store';
import { getMaxAllowedIndex } from './market-clock.manager';

export class ReplayController {
  readonly isPlaying = signal<boolean>(false);
  readonly playbackSpeed = signal<number>(1);
  readonly speedOptions: number[] = [0.5, 1, 2, 5, 10];

  private timerSub?: Subscription;

  /**
   * Callback invoked whenever a manual interaction occurs (seek, step, restart)
   */
  public onManualAction?: () => void;

  /**
   * Callback invoked when playback catches up with current live market time
   */
  public onReachedLiveEdge?: () => void;

  constructor(private dataStore: HistoricalDataStore) {}

  /**
   * Get maximum allowed snapshot index based on current market session.
   * Prevents advancing into future snapshots.
   */
  public getMaxAllowedIndex(): number {
    return getMaxAllowedIndex(this.dataStore.availableTimestamps(), new Date());
  }

  /**
   * Start or resume playback forward in time.
   * Stops automatically when reaching the current real-world market position.
   */
  play(triggerManualNotice = true): void {
    const total = this.dataStore.totalFrames();
    if (total === 0) return;

    const maxAllowed = this.getMaxAllowedIndex();
    const current = this.dataStore.currentIndex();

    // If already at or beyond live edge, restart from 0 to allow reviewing the morning session
    if (current >= maxAllowed) {
      this.dataStore.setCurrentIndex(0);
    }

    if (triggerManualNotice && this.onManualAction) {
      this.onManualAction();
    }

    this.isPlaying.set(true);
    this.startTimer();
  }

  /**
   * Pause playback.
   */
  pause(triggerManualNotice = true): void {
    if (triggerManualNotice && this.onManualAction) {
      this.onManualAction();
    }

    this.isPlaying.set(false);
    this.stopTimer();
  }

  /**
   * Toggle between Play and Pause.
   */
  togglePlay(): void {
    if (this.isPlaying()) {
      this.pause(true);
    } else {
      this.play(true);
    }
  }

  /**
   * Restart from first historical interval (index 0 / 09:15 AM).
   */
  restart(): void {
    this.pause(true);
    this.dataStore.setCurrentIndex(0);
  }

  /**
   * Step backward by 1 snapshot.
   */
  stepPrevious(): void {
    this.pause(true);
    const curr = this.dataStore.currentIndex();
    if (curr > 0) {
      this.dataStore.setCurrentIndex(curr - 1);
    }
  }

  /**
   * Step forward by 1 snapshot (capped at current live market session).
   */
  stepNext(): void {
    this.pause(true);
    const curr = this.dataStore.currentIndex();
    const maxAllowed = this.getMaxAllowedIndex();
    if (curr < maxAllowed) {
      this.dataStore.setCurrentIndex(curr + 1);
    }
  }

  /**
   * Jump directly to a timestamp index (capped at current live market session).
   */
  seekTo(index: number): void {
    this.pause(true);
    const maxAllowed = this.getMaxAllowedIndex();
    const clamped = Math.max(0, Math.min(index, maxAllowed));
    this.dataStore.setCurrentIndex(clamped);
  }

  /**
   * Change playback speed.
   */
  changeSpeed(speed: number): void {
    this.playbackSpeed.set(speed);
    if (this.isPlaying()) {
      this.startTimer();
    }
  }

  private startTimer(): void {
    this.stopTimer();
    const intervalMs = Math.max(50, Math.round(1000 / this.playbackSpeed()));

    this.timerSub = interval(intervalMs).subscribe(() => {
      const current = this.dataStore.currentIndex();
      const maxAllowed = this.getMaxAllowedIndex();

      if (current < maxAllowed) {
        this.dataStore.setCurrentIndex(current + 1);
      } else {
        // Reached current live session edge - stop playback and hand over to live sync!
        this.pause(false);
        if (this.onReachedLiveEdge) {
          this.onReachedLiveEdge();
        }
      }
    });
  }

  private stopTimer(): void {
    if (this.timerSub) {
      this.timerSub.unsubscribe();
      this.timerSub = undefined;
    }
  }

  destroy(): void {
    this.stopTimer();
  }
}
