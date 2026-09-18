/**
 * Market Clock & Session Manager
 *
 * Implements Indian Market session timing rules:
 * - Market Open:  09:15:00 AM IST
 * - Market Close: 03:30:00 PM IST (15:30)
 * - Session Length: 375 minutes (6 hours 15 minutes)
 *
 * Provides real-time clock tracking, elapsed session time calculation,
 * progress percentage, and session phase state.
 */

export const MARKET_OPEN_TIME = '09:15';
export const MARKET_CLOSE_TIME = '15:30';
export const MARKET_OPEN_MINUTES = 9 * 60 + 15; // 555
export const MARKET_CLOSE_MINUTES = 15 * 60 + 30; // 930
export const TOTAL_SESSION_MINUTES = MARKET_CLOSE_MINUTES - MARKET_OPEN_MINUTES; // 375

export type SessionState = 'PRE_MARKET' | 'OPEN' | 'POST_MARKET';

export interface LiveClockState {
  rawDate: Date;
  timeStr: string; // "HH:mm" (24-hr)
  timeWithSeconds: string; // "HH:mm:ss"
  displayStr: string; // "09:32:15 AM"
  sessionState: SessionState;
  minutes: number; // Total minutes from midnight (0..1439)
  elapsedMinutes: number; // 0 to 375
  progressPercent: number; // 0 to 100
  statusMessage: string; // e.g., "17 min after market open", "Market has not opened yet", "Market closed"
}

/**
 * Convert "HH:mm" or "HH:mm:ss" string to minutes from midnight.
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  // Handle possible AM/PM suffix
  const isPM = /pm/i.test(timeStr);
  const isAM = /am/i.test(timeStr);
  const cleaned = timeStr.replace(/(am|pm)/i, '').trim();
  const parts = cleaned.split(':').map((p) => parseInt(p, 10));
  let h = parts[0] || 0;
  const m = parts[1] || 0;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return h * 60 + m;
}

/**
 * Convert total minutes from midnight to "HH:mm" string.
 */
export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convert a Date object or time string to total minutes from midnight.
 */
export function extractMinutesFromInput(input: Date | string): number {
  if (input instanceof Date) {
    return input.getHours() * 60 + input.getMinutes();
  }
  return timeToMinutes(input);
}

/**
 * Determine Indian market session phase:
 * - PRE_MARKET: before 09:15:00
 * - OPEN: between 09:15:00 and 15:30:00
 * - POST_MARKET: after 15:30:00
 */
export function getSessionState(input: Date | string): SessionState {
  const currentMin = extractMinutesFromInput(input);
  if (currentMin < MARKET_OPEN_MINUTES) {
    return 'PRE_MARKET';
  }
  if (currentMin > MARKET_CLOSE_MINUTES) {
    return 'POST_MARKET';
  }
  return 'OPEN';
}

/**
 * Calculate elapsed session minutes from market open (09:15 AM).
 *
 * Rules:
 * 1. Before 09:15 AM: returns 0 (never negative!).
 * 2. Between 09:15 and 15:30: returns currentTime - 09:15.
 * 3. After 15:30 PM: capped at 375 minutes (market close).
 */
export function calculateSessionElapsedMinutes(input: Date | string): number {
  const currentMin = extractMinutesFromInput(input);

  if (currentMin < MARKET_OPEN_MINUTES) {
    return 0; // No negative session offset
  }

  if (currentMin >= MARKET_CLOSE_MINUTES) {
    return TOTAL_SESSION_MINUTES; // Capped at 375 minutes
  }

  return currentMin - MARKET_OPEN_MINUTES;
}

/**
 * Calculate session progress percentage (0% to 100%).
 */
export function calculateSessionProgressPercent(input: Date | string): number {
  const elapsed = calculateSessionElapsedMinutes(input);
  const pct = (elapsed / TOTAL_SESSION_MINUTES) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Format a Date to 12-hour display string "hh:mm:ss A".
 */
export function format12HourTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  const strHours = String(hours).padStart(2, '0');
  const strMinutes = String(minutes).padStart(2, '0');
  const strSeconds = String(seconds).padStart(2, '0');
  return `${strHours}:${strMinutes}:${strSeconds} ${ampm}`;
}

/**
 * Get full live clock status from a Date object.
 */
export function getLiveClockInfo(date: Date = new Date()): LiveClockState {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const totalMinutes = hours * 60 + minutes;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const timeWithSeconds = `${timeStr}:${String(seconds).padStart(2, '0')}`;
  const displayStr = format12HourTime(date);

  const sessionState = getSessionState(date);
  const elapsedMinutes = calculateSessionElapsedMinutes(date);
  const progressPercent = calculateSessionProgressPercent(date);

  let statusMessage = '';
  if (sessionState === 'PRE_MARKET') {
    statusMessage = 'Market has not opened yet';
  } else if (sessionState === 'POST_MARKET') {
    statusMessage = 'Market closed';
  } else {
    statusMessage = `${elapsedMinutes} min after market open`;
  }

  return {
    rawDate: date,
    timeStr,
    timeWithSeconds,
    displayStr,
    sessionState,
    minutes: totalMinutes,
    elapsedMinutes,
    progressPercent,
    statusMessage,
  };
}

/**
 * Calculate the maximum allowed historical timestamp in minutes from midnight.
 * Rule: "Never select a future historical snapshot."
 * - If before 09:15 AM: returns 09:15 AM (555 minutes)
 * - If after 15:30 PM: returns 15:30 PM (930 minutes - full session available)
 * - If during market hours (09:15 to 15:30): ceiling is CURRENT REAL-WORLD TIME!
 */
export function getMaxAllowedLiveMinutes(now: Date = new Date()): number {
  const sessionState = getSessionState(now);
  if (sessionState === 'PRE_MARKET') {
    return MARKET_OPEN_MINUTES;
  }
  if (sessionState === 'POST_MARKET') {
    return MARKET_CLOSE_MINUTES;
  }
  return extractMinutesFromInput(now);
}

/**
 * Calculate the maximum allowed index in the historical dataset based on current live time.
 * Enforces "Never select a future historical snapshot."
 */
export function getMaxAllowedIndex(
  availableTimestamps: string[],
  now: Date = new Date()
): number {
  if (!availableTimestamps || availableTimestamps.length === 0) return 0;
  const maxMinutes = getMaxAllowedLiveMinutes(now);

  for (let i = availableTimestamps.length - 1; i >= 0; i--) {
    if (timeToMinutes(availableTimestamps[i]) <= maxMinutes) {
      return i;
    }
  }
  return 0;
}


