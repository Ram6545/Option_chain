const express = require('express');
const router = express.Router();
const controller = require('../controllers/optionChainController');

router.get('/indices', controller.getIndices);

// GET /api/option-chain/historical & /api/option-chain/history - Historical Option Chain Replay
// Query params: ?date=2026-09-10&expiry=2026-09-15&startTime=09:15&endTime=15:30&timeFrame=1&strikeRange=3
router.get('/option-chain/historical', controller.getHistoricalReplayData);
router.get('/option-chain/:symbol/historical', controller.getHistoricalReplayData);
router.get('/option-chain/history', controller.getHistoricalReplayData);
router.get('/option-chain/history/dates', controller.getHistoricalDates);
router.get('/option-chain/:symbol/history/dates', controller.getHistoricalDates);
router.get('/option-chain/history/expiries', controller.getHistoricalExpiries);
router.get('/option-chain/:symbol/history/expiries', controller.getHistoricalExpiries);

// GET /api/option-chain/expiry - Active Expiry Cycle & Dynamic Expiries
router.get('/option-chain/expiry', controller.getActiveExpiryCycle);
router.get('/option-chain/:symbol/expiry', controller.getActiveExpiryCycle);

// POST /api/option-chain/cycle/rollover - Idempotent cycle transition
router.post('/option-chain/cycle/rollover', controller.triggerCycleRollover);
router.post('/option-chain/:symbol/cycle/rollover', controller.triggerCycleRollover);

// GET /api/option-chain/:symbol - Get latest option chain for an index
router.get('/option-chain/:symbol', controller.getOptionChain);

// GET /api/option-chain/:symbol/live - Get live option chain from NSE (bypasses DB)
// Query params: ?expiry=18-Aug-2026 | ?limit=15
router.get('/option-chain/:symbol/live', controller.getLiveOptionChain);

// GET /api/option-chain/:symbol/snapshots - Get all snapshots for an index
router.get('/option-chain/:symbol/snapshots', controller.getSnapshots);

// GET /api/option-chain/:symbol/snapshot/:snapshotId - Get specific snapshot data
router.get('/option-chain/:symbol/snapshot/:snapshotId', controller.getSnapshotData);

// GET /api/option-chain/:symbol/analysis - Get OI analysis
router.get('/option-chain/:symbol/analysis', controller.getOIAnalysis);

// GET /api/option-chain/:symbol/pcr-analysis - Get Strike-by-Strike & Aggregate PCR Analysis
// Query params: ?selectedStrike=24200&strikeRange=3&expiry=18-Aug-2026&live=false
router.get('/option-chain/:symbol/pcr-analysis', controller.getStrikePCRAnalysis);

// GET /api/option-chain/:symbol/pre-market-pcr - Get Average PCR based on Pre-Market Open ATM Strike
// Query params: ?strikeRange=3&expiry=15-Sep-2026&live=false
router.get('/option-chain/:symbol/pre-market-pcr', controller.getPreMarketPCR);

// POST /api/option-chain/:symbol/pre-market-open - Save/Update Pre-Market Open price
router.post('/option-chain/:symbol/pre-market-open', controller.savePreMarketOpen);

// POST /api/option-chain/:symbol/refresh - Refresh option chain data
// Query params: ?expiry=18-Aug-2026
router.post('/option-chain/:symbol/refresh', controller.refreshOptionChain);

// GET /api/underlying/:symbol - Get latest underlying price (from DB)
router.get('/underlying/:symbol', controller.getUnderlyingPrice);

// GET /api/underlying/:symbol/nse - Get real-time underlying price from NSE
router.get('/underlying/:symbol/nse', controller.getNSEUnderlyingPrice);

// GET /api/underlying/:symbol/history - Get historical underlying prices
router.get('/underlying/:symbol/history', controller.getHistoricalPrices);

// === NSE Strike Price Endpoints ===

// GET /api/strike-prices/:symbol - Get available strike prices from NSE
// Query params: ?expiry=18-Aug-2026 | ?atmRange=10
router.get('/strike-prices/:symbol', controller.getStrikePrices);

// GET /api/strike-prices/:symbol/expiries - Get available expiry dates from NSE
router.get('/strike-prices/:symbol/expiries', controller.getExpiries);

// GET /api/strike-prices/:symbol/contract-info - Get full contract info from NSE
router.get('/strike-prices/:symbol/contract-info', controller.getContractInfo);

module.exports = router;
