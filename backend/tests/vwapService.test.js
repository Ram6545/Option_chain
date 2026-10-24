const {
  determineStrikeInterval,
  selectAtmAndSurroundingStrikes,
  calculateContractVWAP,
  generateInstrumentKey,
  getOptionChainVWAP,
} = require('../services/vwapService');

describe('Option Chain VWAP Service Unit Tests', () => {
  describe('1. Strike Interval Determination', () => {
    it('should determine strike interval 50 for NIFTY strikes', () => {
      const strikes = [24800, 24850, 24900, 24950, 25000, 25050];
      const interval = determineStrikeInterval('NIFTY', strikes);
      expect(interval).toBe(50);
    });

    it('should determine strike interval 100 for BANKNIFTY strikes', () => {
      const strikes = [51000, 51100, 51200, 51300, 51400];
      const interval = determineStrikeInterval('BANKNIFTY', strikes);
      expect(interval).toBe(100);
    });

    it('should fallback to defaults if fewer than 2 strikes provided', () => {
      expect(determineStrikeInterval('NIFTY', [])).toBe(50);
      expect(determineStrikeInterval('BANKNIFTY', [50000])).toBe(100);
    });
  });

  describe('2. ATM and Surrounding Strikes Selection', () => {
    it('should select ATM strike and exactly 5 strikes below + 5 strikes above (11 strikes)', () => {
      const availableStrikes = [
        24700, 24750, 24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300,
      ];
      const spotPrice = 25012.5;
      const result = selectAtmAndSurroundingStrikes(spotPrice, availableStrikes, 50, 5);

      expect(result.atmStrike).toBe(25000);
      expect(result.strikeInterval).toBe(50);
      expect(result.selectedStrikes.length).toBe(11);
      expect(result.selectedStrikes).toEqual([
        24750, 24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200, 25250,
      ]);
    });

    it('should dynamically calculate ATM when spot price moves', () => {
      const availableStrikes = [
        24700, 24750, 24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200, 25250, 25300,
        25350, 25400, 25450,
      ];
      const spotPrice = 25140.0; // Closes to 25150
      const result = selectAtmAndSurroundingStrikes(spotPrice, availableStrikes, 50, 5);

      expect(result.atmStrike).toBe(25150);
      expect(result.selectedStrikes.length).toBe(11);
      expect(result.selectedStrikes[5]).toBe(25150); // ATM at center index 5
    });

    it('should generate grid if availableStrikes is empty', () => {
      const spotPrice = 22600;
      const result = selectAtmAndSurroundingStrikes(spotPrice, [], 50, 5);
      expect(result.atmStrike).toBe(22600);
      expect(result.selectedStrikes.length).toBe(11);
      expect(result.selectedStrikes[0]).toBe(22350);
      expect(result.selectedStrikes[10]).toBe(22850);
    });
  });

  describe('3. VWAP Mathematical Calculation', () => {
    it('should return no_volume if intervals have zero volume', () => {
      const rows = [
        { ltp: 100, volume: 0 },
        { ltp: 102, volume: 0 },
      ];
      const result = calculateContractVWAP(rows);
      expect(result.vwap).toBeNull();
      expect(result.totalVolume).toBe(0);
      expect(result.status).toBe('no_volume');
    });

    it('should compute VWAP accurately based on OHLCV typical price and incremental volume', () => {
      const rows = [
        { ltp: 100, volume: 1000 },
        { ltp: 110, volume: 2000 },
      ];
      const result = calculateContractVWAP(rows);
      expect(result.status).toBe('available');
      expect(result.totalVolume).toBe(2000);
      expect(result.vwap).toBe(103.33);
    });

    it('should prevent negative delta volume if cumulative volume resets or stalls', () => {
      const rows = [
        { ltp: 50, volume: 100 },
        { ltp: 52, volume: 90 }, // anomalous drop
        { ltp: 54, volume: 150 },
      ];
      const result = calculateContractVWAP(rows);
      expect(result.totalVolume).toBe(160);
      expect(result.vwap).toBeGreaterThan(0);
    });
  });

  describe('4. Instrument Identifier Formatting', () => {
    it('should format standard NSE instrument key', () => {
      const key = generateInstrumentKey('NIFTY', '27-Oct-2026', 'CE', 22600);
      expect(key).toBe('OPTIDXNIFTY27-Oct-2026CE22600.00');
    });
  });

  describe('5. Full Option Chain VWAP Integration', () => {
    it('should return complete 11 strike rows with CE and PE contracts', async () => {
      const result = await getOptionChainVWAP('NIFTY');
      expect(result.success).toBe(true);
      expect(result.symbol).toBe('NIFTY');
      expect(result.spotPrice).toBeGreaterThan(0);
      expect(result.atmStrike).toBeGreaterThan(0);
      expect(result.data.length).toBe(11);

      // Verify ATM row exists
      const atmRow = result.data.find((r) => r.isATM);
      expect(atmRow).toBeDefined();
      expect(atmRow.strikePrice).toBe(result.atmStrike);

      // Verify contracts contain required fields
      expect(atmRow.ce).toHaveProperty('ltp');
      expect(atmRow.ce).toHaveProperty('vwap');
      expect(atmRow.ce).toHaveProperty('difference');
      expect(atmRow.ce).toHaveProperty('differencePct');
      expect(atmRow.ce).toHaveProperty('status');

      expect(atmRow.pe).toHaveProperty('ltp');
      expect(atmRow.pe).toHaveProperty('vwap');
      expect(atmRow.pe).toHaveProperty('difference');
      expect(atmRow.pe).toHaveProperty('differencePct');
      expect(atmRow.pe).toHaveProperty('status');

      // Verify Market Breadth is included
      expect(result).toHaveProperty('marketBreadth');
      expect(result.marketBreadth).toHaveProperty('adRatio');
    }, 25000);
  });
});
