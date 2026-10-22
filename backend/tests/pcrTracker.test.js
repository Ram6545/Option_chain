/**
 * Unit tests for PCR Tracker calculations, trend determination, safe zero handling,
 * and support/resistance identification.
 */

const {
  calculateSafePCR,
  determinePCRTrend,
  calculateSnapshotPCR,
  getPCRTracking,
} = require('../services/historicalReplayService');

describe('PCR Tracker Calculations & Logic', () => {
  describe('calculateSafePCR()', () => {
    it('should calculate correct PCR = Put OI / Call OI', () => {
      const pcr = calculateSafePCR(2800000, 3500000);
      expect(pcr).toBe(0.8);
    });

    it('should calculate PCR with precise decimals', () => {
      const pcr = calculateSafePCR(100, 300);
      expect(pcr).toBe(0.3333);
    });

    it('should safely handle zero Call OI by returning null (avoiding division by zero / Infinity)', () => {
      const pcr = calculateSafePCR(50000, 0);
      expect(pcr).toBeNull();
      expect(Number.isFinite(pcr)).toBe(false);
    });

    it('should return 0 when both Put OI and Call OI are 0', () => {
      const pcr = calculateSafePCR(0, 0);
      expect(pcr).toBe(0);
    });

    it('should safely handle missing or invalid inputs without crashing', () => {
      expect(calculateSafePCR(null, 1000)).toBe(0);
      expect(calculateSafePCR(undefined, 1000)).toBe(0);
      expect(calculateSafePCR(NaN, 1000)).toBe(0);
      expect(calculateSafePCR(500, null)).toBeNull();
      expect(calculateSafePCR(500, undefined)).toBeNull();
      expect(calculateSafePCR(500, -100)).toBeNull();
    });
  });

  describe('determinePCRTrend()', () => {
    it('should return "Increasing" when PCR change > +0.02', () => {
      expect(determinePCRTrend(0.05)).toBe('Increasing');
      expect(determinePCRTrend(0.021)).toBe('Increasing');
    });

    it('should return "Decreasing" when PCR change < -0.02', () => {
      expect(determinePCRTrend(-0.05)).toBe('Decreasing');
      expect(determinePCRTrend(-0.021)).toBe('Decreasing');
    });

    it('should return "Stable" when PCR change is within [-0.02, +0.02]', () => {
      expect(determinePCRTrend(0.01)).toBe('Stable');
      expect(determinePCRTrend(-0.01)).toBe('Stable');
      expect(determinePCRTrend(0)).toBe('Stable');
      expect(determinePCRTrend(0.02)).toBe('Stable');
      expect(determinePCRTrend(-0.02)).toBe('Stable');
    });

    it('should return "Stable" for null or undefined change', () => {
      expect(determinePCRTrend(null)).toBe('Stable');
      expect(determinePCRTrend(undefined)).toBe('Stable');
    });
  });

  describe('calculateSnapshotPCR()', () => {
    const mockStrikes = [
      {
        strikePrice: 22400,
        ce: { oi: 50000, changeOI: 5000 },
        pe: { oi: 100000, changeOI: 15000 },
      },
      {
        strikePrice: 22500,
        ce: { oi: 150000, changeOI: 20000 },
        pe: { oi: 200000, changeOI: 25000 },
      },
      {
        strikePrice: 22600,
        ce: { oi: 200000, changeOI: -10000 },
        pe: { oi: 100000, changeOI: -5000 },
      },
    ];

    it('should calculate total Call OI, total Put OI, and change OI', () => {
      const res = calculateSnapshotPCR(mockStrikes, 22500, 1);
      expect(res.totalCallOI).toBe(400000);
      expect(res.totalPutOI).toBe(400000);
      expect(res.totalCallChangeOI).toBe(15000);
      expect(res.totalPutChangeOI).toBe(35000);
      expect(res.pcr).toBe(1);
    });

    it('should safely handle empty strikes array', () => {
      const res = calculateSnapshotPCR([], 22500, 1);
      expect(res.pcr).toBe(0);
      expect(res.totalCallOI).toBe(0);
      expect(res.totalPutOI).toBe(0);
      expect(res.totalCallChangeOI).toBe(0);
      expect(res.totalPutChangeOI).toBe(0);
    });
  });

  describe('getPCRTracking() Integration', () => {
    it('should return valid structured PCR tracking data for NIFTY on recorded date 2026-10-22', async () => {
      const result = await getPCRTracking('NIFTY', { date: '2026-10-22', timeFrame: 5 });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.symbol).toBe('NIFTY');
      expect(result.date).toBe('2026-10-22');
      expect(Array.isArray(result.intervals)).toBe(true);
      expect(result.totalIntervals).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
      expect(typeof result.summary.currentPCR === 'number' || result.summary.currentPCR === null).toBe(true);
      expect(result.summary.totalPutOI).toBeGreaterThan(0);
      expect(result.summary.totalCallOI).toBeGreaterThan(0);
      expect(['Increasing', 'Decreasing', 'Stable']).toContain(result.summary.trend);

      // Verify each interval has all required attributes
      const first = result.intervals[0];
      expect(first.timestamp).toBeDefined();
      expect(first.spotPrice).toBeGreaterThan(0);
      expect(first.putOI).toBeGreaterThan(0);
      expect(first.callOI).toBeGreaterThan(0);
      expect(['Increasing', 'Decreasing', 'Stable']).toContain(first.trend);

      // Verify support & resistance inference
      if (result.supportResistance) {
        expect(result.supportResistance.majorSupport).toBeDefined();
        expect(result.supportResistance.majorResistance).toBeDefined();
        expect(result.supportResistance.majorSupport.type).toBe('inferred');
        expect(result.supportResistance.majorResistance.type).toBe('inferred');
      }
    });
  });
});
