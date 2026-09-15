/**
 * Historical Option Chain Replay & Timestamp Mapper Unit Tests
 *
 * Covers all required test cases:
 * 1.  9:15 AM (Market open, elapsed 0 min, target 09:15)
 * 2.  9:16 AM (1 min elapsed, target 09:16)
 * 3.  9:32 AM (17 min elapsed, target 09:32)
 * 4. 12:00 PM (165 min elapsed, target 12:00)
 * 5.  3:29 PM (374 min elapsed, target 15:29)
 * 6.  3:30 PM (375 min elapsed, target 15:30)
 * 7. Before 9:15 AM (e.g. 8:45 AM, 9:00 AM, 9:14 AM - elapsed 0, PRE_MARKET, opening snapshot)
 * 8. After 3:30 PM (e.g. 3:31 PM, 4:15 PM, 6:00 PM - capped at 15:30 / 375 min, POST_MARKET, no further advance)
 * 9. Missing historical timestamps (e.g. available [09:30, 09:32, 09:35], target 09:33 -> selects 09:32, NEVER 09:35)
 * 10. Weekends (Saturday / Sunday correctly rejected with nearest trading day)
 * 11. Market holidays (NSE official holidays correctly rejected with nearest trading day)
 * 12. Manual replay overriding live synchronization (user action switches mode to MANUAL_REPLAY, resume reactivates LIVE_SYNC)
 */

import {
  mapSessionToHistoricalTimestamp,
  findClosestHistoricalSnapshot,
} from './historical-timestamp-mapper';
import {
  calculateSessionElapsedMinutes,
  getSessionState,
  calculateSessionProgressPercent,
  timeToMinutes,
  minutesToTime,
} from './market-clock.manager';
import {
  validateTradingDay,
  isWeekend,
  isMarketHoliday,
  getNearestValidTradingDate,
} from './historical-date.manager';
import { HistoricalDataStore } from './historical-data.store';
import { ReplayController } from './replay.controller';
import { AutoSyncController } from './auto-sync.controller';

describe('Historical Option Chain Replay System', () => {
  // Mock standard 1-minute historical snapshot timeline (09:15 to 15:30)
  const fullTimeline: string[] = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 30; m++) {
    fullTimeline.push(minutesToTime(m));
  }

  // =========================================================================
  // Test 1: 9:15 AM (Market Open)
  // =========================================================================
  describe('Test Case 1: 9:15 AM (Market Open)', () => {
    it('should map 9:15 AM to 0 elapsed minutes and select the 09:15 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('09:15', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(0);
      expect(result.targetHistoricalTime).toBe('09:15');
      expect(result.selectedHistoricalTime).toBe('09:15');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.sessionProgressPercent).toBe(0);
      expect(result.statusText).toBe('0 min after market open');
    });
  });

  // =========================================================================
  // Test 2: 9:16 AM (1 Minute Elapsed)
  // =========================================================================
  describe('Test Case 2: 9:16 AM', () => {
    it('should map 9:16 AM to 1 elapsed minute and select the 09:16 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('09:16', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(1);
      expect(result.targetHistoricalTime).toBe('09:16');
      expect(result.selectedHistoricalTime).toBe('09:16');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.statusText).toBe('1 min after market open');
    });
  });

  // =========================================================================
  // Test 3: 9:32 AM (17 Minutes Elapsed)
  // =========================================================================
  describe('Test Case 3: 9:32 AM', () => {
    it('should map 9:32 AM to 17 elapsed minutes and select the 09:32 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('09:32', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(17);
      expect(result.targetHistoricalTime).toBe('09:32');
      expect(result.selectedHistoricalTime).toBe('09:32');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.statusText).toBe('17 min after market open');
    });
  });

  // =========================================================================
  // Test 4: 12:00 PM (Mid-Session)
  // =========================================================================
  describe('Test Case 4: 12:00 PM', () => {
    it('should map 12:00 PM to 165 elapsed minutes and select the 12:00 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('12:00', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(165); // 12*60 - (9*60+15) = 720 - 555 = 165
      expect(result.targetHistoricalTime).toBe('12:00');
      expect(result.selectedHistoricalTime).toBe('12:00');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.statusText).toBe('165 min after market open');
    });
  });

  // =========================================================================
  // Test 5: 3:29 PM (Final Trading Minute)
  // =========================================================================
  describe('Test Case 5: 3:29 PM', () => {
    it('should map 3:29 PM (15:29) to 374 elapsed minutes and select the 15:29 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('15:29', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(374); // 929 - 555 = 374
      expect(result.targetHistoricalTime).toBe('15:29');
      expect(result.selectedHistoricalTime).toBe('15:29');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.statusText).toBe('374 min after market open');
    });
  });

  // =========================================================================
  // Test 6: 3:30 PM (Session Close)
  // =========================================================================
  describe('Test Case 6: 3:30 PM', () => {
    it('should map 3:30 PM (15:30) to 375 elapsed minutes and select the 15:30 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('15:30', fullTimeline);

      expect(result.sessionElapsedMinutes).toBe(375); // 930 - 555 = 375
      expect(result.targetHistoricalTime).toBe('15:30');
      expect(result.selectedHistoricalTime).toBe('15:30');
      expect(result.sessionStatus).toBe('OPEN');
      expect(result.isExactMatch).toBe(true);
      expect(result.sessionProgressPercent).toBe(100);
      expect(result.statusText).toBe('375 min after market open');
    });
  });

  // =========================================================================
  // Test 7: Before 9:15 AM (Pre-Market)
  // =========================================================================
  describe('Test Case 7: Before 9:15 AM', () => {
    it('should never calculate negative session elapsed time for 8:45 AM', () => {
      const elapsed = calculateSessionElapsedMinutes('08:45');
      expect(elapsed).toBe(0);
      expect(elapsed).not.toBeLessThan(0);
    });

    it('should identify session state as PRE_MARKET and show 09:15 opening snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('08:45', fullTimeline);

      expect(result.sessionStatus).toBe('PRE_MARKET');
      expect(result.sessionElapsedMinutes).toBe(0);
      expect(result.targetHistoricalTime).toBe('09:15');
      expect(result.selectedHistoricalTime).toBe('09:15');
      expect(result.statusText).toBe('Market has not opened yet');
    });

    it('should handle 09:14 AM immediately prior to open without negative offset', () => {
      const result = mapSessionToHistoricalTimestamp('09:14', fullTimeline);

      expect(result.sessionStatus).toBe('PRE_MARKET');
      expect(result.sessionElapsedMinutes).toBe(0);
      expect(result.targetHistoricalTime).toBe('09:15');
      expect(result.selectedHistoricalTime).toBe('09:15');
      expect(result.statusText).toBe('Market has not opened yet');
    });
  });

  // =========================================================================
  // Test 8: After 3:30 PM (Post-Market)
  // =========================================================================
  describe('Test Case 8: After 3:30 PM', () => {
    it('should cap elapsed time at 375 minutes for 4:15 PM and stop advancing', () => {
      const elapsed = calculateSessionElapsedMinutes('16:15');
      expect(elapsed).toBe(375);
    });

    it('should identify session state as POST_MARKET and stop at 15:30 snapshot', () => {
      const result = mapSessionToHistoricalTimestamp('16:15', fullTimeline);

      expect(result.sessionStatus).toBe('POST_MARKET');
      expect(result.sessionElapsedMinutes).toBe(375);
      expect(result.targetHistoricalTime).toBe('15:30');
      expect(result.selectedHistoricalTime).toBe('15:30');
      expect(result.statusText).toBe('Market closed');
    });

    it('should stop at 15:30 for late evening times like 20:00 (8:00 PM)', () => {
      const result = mapSessionToHistoricalTimestamp('20:00', fullTimeline);

      expect(result.sessionStatus).toBe('POST_MARKET');
      expect(result.sessionElapsedMinutes).toBe(375);
      expect(result.targetHistoricalTime).toBe('15:30');
      expect(result.selectedHistoricalTime).toBe('15:30');
      expect(result.statusText).toBe('Market closed');
    });
  });

  // =========================================================================
  // Test 9: Missing Historical Timestamps
  // =========================================================================
  describe('Test Case 9: Missing Historical Timestamps', () => {
    it('should select closest prior snapshot (09:32) when 09:33 is requested and never future (09:35)', () => {
      // Discrete snapshots with gaps
      const sparseTimeline = ['09:30', '09:32', '09:35'];
      const targetMinutes = timeToMinutes('09:33'); // 573

      const match = findClosestHistoricalSnapshot(sparseTimeline, targetMinutes);

      expect(match).not.toBeNull();
      expect(match!.time).toBe('09:32'); // Must be 09:32
      expect(match!.time).not.toBe('09:35'); // NEVER future 09:35
      expect(match!.isExact).toBe(false);
    });

    it('should match exact timestamp when available', () => {
      const sparseTimeline = ['09:30', '09:32', '09:35'];
      const targetMinutes = timeToMinutes('09:32');

      const match = findClosestHistoricalSnapshot(sparseTimeline, targetMinutes);

      expect(match).not.toBeNull();
      expect(match!.time).toBe('09:32');
      expect(match!.isExact).toBe(true);
    });

    it('should select 5-minute bucket prior to target (e.g., target 10:14 with 5m intervals -> 10:10)', () => {
      const fiveMinTimeline = ['10:00', '10:05', '10:10', '10:15', '10:20'];
      const targetMinutes = timeToMinutes('10:14');

      const match = findClosestHistoricalSnapshot(fiveMinTimeline, targetMinutes);

      expect(match).not.toBeNull();
      expect(match!.time).toBe('10:10');
      expect(match!.time).not.toBe('10:15');
    });
  });

  // =========================================================================
  // Test 10: Weekends
  // =========================================================================
  describe('Test Case 10: Weekends', () => {
    it('should identify Saturday and Sunday as non-trading days', () => {
      // 2026-09-12 is Saturday, 2026-09-13 is Sunday
      expect(isWeekend('2026-09-12')).toBe(true);
      expect(isWeekend('2026-09-13')).toBe(true);
      // 2026-09-11 is Friday
      expect(isWeekend('2026-09-11')).toBe(false);
    });

    it('should reject Saturday with clear message and return Friday as nearest trading day', () => {
      const validation = validateTradingDay('2026-09-12'); // Saturday

      expect(validation.isValid).toBe(false);
      expect(validation.isWeekend).toBe(true);
      expect(validation.reason).toContain('Saturday (Weekend - Market Closed)');
      expect(validation.nearestValidDate).toBe('2026-09-11'); // Friday
    });

    it('should reject Sunday and resolve nearest trading day to Friday', () => {
      const validation = validateTradingDay('2026-09-13'); // Sunday

      expect(validation.isValid).toBe(false);
      expect(validation.isWeekend).toBe(true);
      expect(validation.reason).toContain('Sunday (Weekend - Market Closed)');
      expect(validation.nearestValidDate).toBe('2026-09-11'); // Friday
    });
  });

  // =========================================================================
  // Test 11: Market Holidays
  // =========================================================================
  describe('Test Case 11: Market Holidays', () => {
    it('should detect Independence Day (August 15) as an official NSE market holiday', () => {
      const holidayCheck = isMarketHoliday('2025-08-15');
      expect(holidayCheck.isHoliday).toBe(true);
      expect(holidayCheck.holidayName).toBe('Independence Day');
    });

    it('should reject Mahatma Gandhi Jayanti (October 2) and provide nearest trading day', () => {
      const validation = validateTradingDay('2025-10-02');

      expect(validation.isValid).toBe(false);
      expect(validation.isHoliday).toBe(true);
      expect(validation.holidayName).toContain('Mahatma Gandhi Jayanti');
      expect(validation.nearestValidDate).toBe('2025-10-01'); // Wednesday preceding
    });

    it('should reject Republic Day (January 26)', () => {
      const validation = validateTradingDay('2026-01-26');

      expect(validation.isValid).toBe(false);
      expect(validation.isHoliday).toBe(true);
      expect(validation.holidayName).toBe('Republic Day');
    });

    it('should accept regular trading days without errors', () => {
      const validation = validateTradingDay('2026-09-10'); // Thursday
      expect(validation.isValid).toBe(true);
      expect(validation.isWeekend).toBe(false);
      expect(validation.isHoliday).toBe(false);
    });
  });

  // =========================================================================
  // Test 12: Manual Replay Overriding Live Synchronization
  // =========================================================================
  describe('Test Case 12: Manual Replay Overriding Live Synchronization', () => {
    let dataStore: HistoricalDataStore;
    let replayController: ReplayController;
    let autoSyncController: AutoSyncController;

    beforeEach(() => {
      dataStore = new HistoricalDataStore();
      replayController = new ReplayController(dataStore);
      autoSyncController = new AutoSyncController(dataStore, replayController);

      // Populate dummy dataset
      const dummyItems = fullTimeline.map((ts, idx) => ({
        timestamp: ts,
        niftyPrice: 24000 + idx,
        atmStrike: 24000,
        pcr: 1.0,
        averagePCR: 1.0,
        totalCallOI: 100000,
        totalPutOI: 100000,
        optionChain: [],
      }));

      dataStore.loadDataset('NIFTY', '2026-09-10', null, 1, dummyItems);
    });

    afterEach(() => {
      replayController.destroy();
      autoSyncController.destroy();
    });

    it('should initialize in LIVE_SYNC mode', () => {
      expect(autoSyncController.mode()).toBe('LIVE_SYNC');
      expect(autoSyncController.isLiveSync()).toBe(true);
    });

    it('should switch mode to MANUAL_REPLAY when user triggers Play', () => {
      expect(autoSyncController.mode()).toBe('LIVE_SYNC');

      replayController.play(true); // User clicks Play

      expect(autoSyncController.mode()).toBe('MANUAL_REPLAY');
      expect(autoSyncController.isLiveSync()).toBe(false);
    });

    it('should switch mode to MANUAL_REPLAY when user seeks to a timestamp', () => {
      expect(autoSyncController.mode()).toBe('LIVE_SYNC');

      replayController.seekTo(10); // User drags slider

      expect(autoSyncController.mode()).toBe('MANUAL_REPLAY');
      expect(autoSyncController.isLiveSync()).toBe(false);
      expect(dataStore.currentIndex()).toBe(10);
    });

    it('should switch mode to MANUAL_REPLAY on step previous or next', () => {
      expect(autoSyncController.mode()).toBe('LIVE_SYNC');

      replayController.stepNext();

      expect(autoSyncController.mode()).toBe('MANUAL_REPLAY');
      expect(autoSyncController.isLiveSync()).toBe(false);
    });

    it('should resume LIVE_SYNC and immediately re-align to live market elapsed time when resumeLiveSync is invoked', () => {
      // 1. Enter manual mode
      replayController.seekTo(10);
      expect(autoSyncController.mode()).toBe('MANUAL_REPLAY');

      // 2. Resume live sync
      autoSyncController.resumeLiveSync();

      expect(autoSyncController.mode()).toBe('LIVE_SYNC');
      expect(autoSyncController.isLiveSync()).toBe(true);
      expect(replayController.isPlaying()).toBe(false);
    });

    it('should never allow seeking or advancing into future snapshots beyond current live market time', () => {
      const maxAllowed = replayController.getMaxAllowedIndex();
      expect(maxAllowed).toBeGreaterThanOrEqual(0);

      // Attempting to seek beyond current live session ceiling should clamp to maxAllowed
      replayController.seekTo(maxAllowed + 50);
      expect(dataStore.currentIndex()).toBeLessThanOrEqual(maxAllowed);
    });
  });
});
