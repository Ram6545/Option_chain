/**
 * Historical Timestamp Mapper
 *
 * Standalone pure logic for mapping a real-world clock time onto a historical
 * market session timeline.
 *
 * Guarantees:
 * - Calculates session elapsed time: currentTime - 09:15:00
 * - Clamps before 09:15 to 09:15 (elapsed = 0, no negative offset)
 * - Clamps after 15:30 to 15:30 (elapsed = 375, does not advance further)
 * - Prefers exact timestamp match
 * - If exact match unavailable, selects closest snapshot <= target timestamp
 * - Never selects a future historical snapshot
 * - Completely independent of Angular UI/DOM for isolated unit testing
 */

import {
  MARKET_OPEN_MINUTES,
  MARKET_CLOSE_MINUTES,
  TOTAL_SESSION_MINUTES,
  timeToMinutes,
  minutesToTime,
  extractMinutesFromInput,
  getSessionState,
  calculateSessionElapsedMinutes,
  calculateSessionProgressPercent,
  SessionState,
} from './market-clock.manager';

export interface TimestampMappingResult {
  liveTimeStr: string; // e.g. "09:32"
  targetHistoricalTime: string; // e.g. "09:32"
  selectedHistoricalTime: string; // e.g. "09:32"
  selectedIndex: number; // index into availableTimestamps array (-1 if empty)
  sessionElapsedMinutes: number; // e.g. 17
  sessionProgressPercent: number; // e.g. 4.5%
  sessionStatus: SessionState; // 'PRE_MARKET' | 'OPEN' | 'POST_MARKET'
  isExactMatch: boolean;
  statusText: string; // "17 min after market open" | "Market has not opened yet" | "Market closed"
}

/**
 * Find the latest historical timestamp that is <= targetMinutes from an array of timestamps.
 * Rule: Prefer exact match. If unavailable, select closest <= target. Never select future.
 *
 * @param availableTimestamps - sorted or unsorted list of "HH:mm" timestamps
 * @param targetMinutes - minutes from midnight for target time
 * @returns { time: string; index: number; isExact: boolean } | null
 */
export function findClosestHistoricalSnapshot(
  availableTimestamps: string[],
  targetMinutes: number
): { time: string; index: number; isExact: boolean } | null {
  if (!availableTimestamps || availableTimestamps.length === 0) {
    return null;
  }

  // Parse and track original indices
  const parsed = availableTimestamps.map((t, idx) => ({
    time: t,
    minutes: timeToMinutes(t),
    originalIndex: idx,
  }));

  // Check for exact match first
  const exact = parsed.find((p) => p.minutes === targetMinutes);
  if (exact) {
    return {
      time: exact.time,
      index: exact.originalIndex,
      isExact: true,
    };
  }

  // Filter only snapshots at or before target (<= targetMinutes). Never future!
  const validPrior = parsed.filter((p) => p.minutes <= targetMinutes);

  if (validPrior.length > 0) {
    // Select the maximum timestamp among those <= targetMinutes
    validPrior.sort((a, b) => b.minutes - a.minutes);
    const closest = validPrior[0];
    return {
      time: closest.time,
      index: closest.originalIndex,
      isExact: false,
    };
  }

  // If targetMinutes is earlier than even the first available snapshot,
  // select the earliest available snapshot (e.g. 09:15 opening snapshot)
  parsed.sort((a, b) => a.minutes - b.minutes);
  const earliest = parsed[0];
  return {
    time: earliest.time,
    index: earliest.originalIndex,
    isExact: false,
  };
}

/**
 * Map a live clock time into a historical session timestamp.
 *
 * @param currentLiveTime - "HH:mm", "HH:mm:ss", or Date object
 * @param availableTimestamps - list of available timestamps in historical dataset (e.g. ["09:15", "09:16", ...])
 * @returns TimestampMappingResult
 */
export function mapSessionToHistoricalTimestamp(
  currentLiveTime: Date | string,
  availableTimestamps: string[] = []
): TimestampMappingResult {
  const liveMinutes = extractMinutesFromInput(currentLiveTime);
  const liveTimeStr = minutesToTime(liveMinutes);

  const sessionStatus = getSessionState(currentLiveTime);
  const sessionElapsedMinutes = calculateSessionElapsedMinutes(currentLiveTime);
  const sessionProgressPercent = calculateSessionProgressPercent(currentLiveTime);

  // Calculate target historical minutes:
  // Historical session starts at 09:15 (555 minutes).
  // Target = 09:15 + sessionElapsedMinutes
  let targetMinutes = MARKET_OPEN_MINUTES + sessionElapsedMinutes;

  // Clamp strictly between 09:15 and 15:30
  if (targetMinutes < MARKET_OPEN_MINUTES) {
    targetMinutes = MARKET_OPEN_MINUTES;
  } else if (targetMinutes > MARKET_CLOSE_MINUTES) {
    targetMinutes = MARKET_CLOSE_MINUTES;
  }

  const targetHistoricalTime = minutesToTime(targetMinutes);

  let statusText = '';
  if (sessionStatus === 'PRE_MARKET') {
    statusText = 'Market has not opened yet';
  } else if (sessionStatus === 'POST_MARKET') {
    statusText = 'Market closed';
  } else {
    statusText = `${sessionElapsedMinutes} min after market open`;
  }

  // If no available timestamps provided in dataset yet, return defaults
  if (availableTimestamps.length === 0) {
    return {
      liveTimeStr,
      targetHistoricalTime,
      selectedHistoricalTime: targetHistoricalTime,
      selectedIndex: -1,
      sessionElapsedMinutes,
      sessionProgressPercent,
      sessionStatus,
      isExactMatch: false,
      statusText,
    };
  }

  // Find best matching snapshot
  const match = findClosestHistoricalSnapshot(availableTimestamps, targetMinutes);

  if (match) {
    return {
      liveTimeStr,
      targetHistoricalTime,
      selectedHistoricalTime: match.time,
      selectedIndex: match.index,
      sessionElapsedMinutes,
      sessionProgressPercent,
      sessionStatus,
      isExactMatch: match.isExact,
      statusText,
    };
  }

  return {
    liveTimeStr,
    targetHistoricalTime,
    selectedHistoricalTime: targetHistoricalTime,
    selectedIndex: 0,
    sessionElapsedMinutes,
    sessionProgressPercent,
    sessionStatus,
    isExactMatch: false,
    statusText,
  };
}
