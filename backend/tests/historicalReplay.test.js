/**
 * Backend Historical Replay & Trading Day Validation Unit Tests
 */

const {
  validateTradingDate,
  findNearestTradingDate,
  generateTimeSlots,
  timeToMinutes,
  minutesToTime,
} = require('../services/historicalReplayService');

describe('Backend Historical Replay & Trading Calendar Validation', () => {
  describe('Weekend Validation', () => {
    it('should reject Saturday (2026-09-12) as a non-trading day and return Friday (2026-09-11)', () => {
      const res = validateTradingDate('2026-09-12');
      expect(res.isValid).toBe(false);
      expect(res.isWeekend).toBe(true);
      expect(res.reason).toContain('Saturday (Weekend - Market Closed)');
      expect(res.nearestValidDate).toBe('2026-09-11');
    });

    it('should reject Sunday (2026-09-13) and return Friday (2026-09-11)', () => {
      const res = validateTradingDate('2026-09-13');
      expect(res.isValid).toBe(false);
      expect(res.isWeekend).toBe(true);
      expect(res.reason).toContain('Sunday (Weekend - Market Closed)');
      expect(res.nearestValidDate).toBe('2026-09-11');
    });
  });

  describe('Market Holiday Validation', () => {
    it('should reject Independence Day (2025-08-15) as an NSE market holiday', () => {
      const res = validateTradingDate('2025-08-15');
      expect(res.isValid).toBe(false);
      expect(res.isHoliday).toBe(true);
      expect(res.holidayName).toBe('Independence Day');
      expect(res.nearestValidDate).toBe('2025-08-14');
    });

    it('should reject Gandhi Jayanti (2025-10-02)', () => {
      const res = validateTradingDate('2025-10-02');
      expect(res.isValid).toBe(false);
      expect(res.isHoliday).toBe(true);
      expect(res.nearestValidDate).toBe('2025-10-01');
    });

    it('should accept regular weekday trading sessions', () => {
      const res = validateTradingDate('2026-09-10'); // Thursday
      expect(res.isValid).toBe(true);
    });
  });

  describe('Time Slots Generation', () => {
    it('should generate 376 slots for 1-minute interval from 09:15 to 15:30', () => {
      const slots = generateTimeSlots('09:15', '15:30', 1);
      expect(slots.length).toBe(376);
      expect(slots[0]).toBe('09:15');
      expect(slots[slots.length - 1]).toBe('15:30');
    });

    it('should generate 76 slots for 5-minute intervals', () => {
      const slots = generateTimeSlots('09:15', '15:30', 5);
      expect(slots.length).toBe(76);
      expect(slots[0]).toBe('09:15');
      expect(slots[1]).toBe('09:20');
      expect(slots[slots.length - 1]).toBe('15:30');
    });
  });
});
