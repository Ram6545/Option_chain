/**
 * Background Collector Service
 *
 * Automatically and autonomously fetches live option chain data from NSE
 * and persists snapshots into PostgreSQL database tables at regular intervals
 * during market trading hours (09:15 AM to 03:30 PM IST, Monday - Friday).
 *
 * Runs completely independent of frontend web clients.
 */

const db = require('../config/db');

class BackgroundCollectorService {
  constructor() {
    this.intervalMs = parseInt(process.env.COLLECTOR_INTERVAL_MS, 10) || 60000; // Default: every 60 seconds
    this.symbols = ['NIFTY', 'BANKNIFTY'];
    this.marketHoursOnly = process.env.COLLECTOR_FORCE !== 'true';
    this.timer = null;
    this.isCollecting = false;
    this.getOptionChainFn = null;
    this.expiryCycleService = null;

    this.stats = {
      status: 'stopped',
      startedAt: null,
      totalCyclesRun: 0,
      totalSnapshotsSaved: 0,
      lastRunTime: null,
      lastSuccessTime: null,
      lastError: null,
      symbolStats: {
        NIFTY: { lastSaved: null, spot: null, strikes: 0 },
        BANKNIFTY: { lastSaved: null, spot: null, strikes: 0 },
      },
    };
  }

  /**
   * Check if Indian Stock Market (NSE) is currently open.
   * Trading hours: 09:15 AM to 03:30 PM IST, Monday to Friday.
   */
  isMarketOpen() {
    if (!this.marketHoursOnly) {
      return true; // Force collection active (e.g. test or debug mode)
    }

    const now = new Date();
    // Convert to IST (UTC + 5 hours 30 minutes)
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const day = istTime.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    // Weekend check
    if (day === 0 || day === 6) {
      return false;
    }

    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();
    const currentMinutes = hours * 60 + minutes;

    const marketOpenMinutes = 9 * 60 + 15;  // 09:15 AM IST
    const marketCloseMinutes = 15 * 60 + 30; // 03:30 PM IST

    return currentMinutes >= marketOpenMinutes && currentMinutes <= marketCloseMinutes;
  }

  /**
   * Get formatted IST time string
   */
  getISTString(date = new Date()) {
    return date.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * Initialize and start the autonomous collector
   */
  init({ getOptionChain, expiryCycleService, intervalMs = 60000, symbols = ['NIFTY', 'BANKNIFTY'] }) {
    this.getOptionChainFn = getOptionChain;
    this.expiryCycleService = expiryCycleService;
    if (intervalMs) this.intervalMs = intervalMs;
    if (symbols && symbols.length > 0) this.symbols = symbols;

    console.log(`🤖 [BackgroundCollector] Initializing autonomous background recorder...`);
    console.log(`   ⏱️ Polling interval: ${this.intervalMs / 1000}s | Symbols: ${this.symbols.join(', ')} | MarketHoursOnly: ${this.marketHoursOnly}`);

    this.start();
  }

  /**
   * Start the timer
   */
  start() {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.stats.status = 'running';
    this.stats.startedAt = new Date().toISOString();

    // Trigger first collection shortly after boot (5 seconds)
    setTimeout(() => {
      this.collectCycle('BOOT_IMMEDIATE');
    }, 5000);

    // Run periodically on configured interval
    this.timer = setInterval(() => {
      this.collectCycle('SCHEDULED');
    }, this.intervalMs);

    console.log(`✅ [BackgroundCollector] Autonomous data collector started successfully. Will record data whenever backend is running.`);
  }

  /**
   * Stop the timer
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stats.status = 'stopped';
    console.log(`⏸️ [BackgroundCollector] Collector paused.`);
  }

  /**
   * Execute a single collection cycle across all tracked symbols
   */
  async collectCycle(triggerSource = 'SCHEDULED') {
    if (this.isCollecting) {
      console.log(`⏳ [BackgroundCollector] Previous collection cycle still in progress, skipping tick.`);
      return;
    }

    const marketOpen = this.isMarketOpen();
    if (!marketOpen && triggerSource !== 'MANUAL_TRIGGER') {
      // Market closed, log sparingly (e.g. once every 30 cycles)
      if (this.stats.totalCyclesRun % 30 === 0) {
        console.log(`🌙 [BackgroundCollector] Market closed (${this.getISTString()} IST). Waiting for next market open (09:15 AM IST)...`);
      }
      this.stats.totalCyclesRun++;
      return;
    }

    this.isCollecting = true;
    this.stats.lastRunTime = new Date().toISOString();
    this.stats.totalCyclesRun++;

    try {
      for (const symbol of this.symbols) {
        await this.collectSymbol(symbol);
        // Small delay between symbols to prevent bursting NSE endpoints
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      this.stats.lastSuccessTime = new Date().toISOString();
      this.stats.lastError = null;
    } catch (err) {
      console.warn(`⚠️ [BackgroundCollector] Cycle error:`, err.message);
      this.stats.lastError = err.message;
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Fetch and save data for a single symbol
   */
  async collectSymbol(symbol) {
    const upper = symbol.toUpperCase().trim();
    try {
      if (!this.getOptionChainFn || !this.expiryCycleService) {
        throw new Error('Collector dependencies not initialized');
      }

      // Fetch live option chain
      const chain = await this.getOptionChainFn(upper);
      if (!chain || !chain.strikes || chain.strikes.length === 0) {
        console.warn(`⚠️ [BackgroundCollector] Empty option chain received for ${upper}`);
        return null;
      }

      // Save snapshot to PostgreSQL
      const saved = await this.expiryCycleService.saveSnapshotWithCycle(upper, chain);

      this.stats.totalSnapshotsSaved++;
      this.stats.symbolStats[upper] = {
        lastSaved: new Date().toISOString(),
        spot: chain.underlyingPrice,
        strikes: chain.strikes.length,
        snapshotId: saved?.snapshotId,
        istTime: this.getISTString(),
      };

      console.log(
        `💾 [BackgroundCollector] Saved ${upper} snapshot #${saved?.snapshotId || ''} | Spot: ${chain.underlyingPrice} | Contracts: ${saved?.contractRows || chain.strikes.length * 2} | Time: ${this.getISTString()} IST`
      );

      return saved;
    } catch (err) {
      console.warn(`⚠️ [BackgroundCollector] Failed to collect ${upper}: ${err.message}`);
      return null;
    }
  }

  /**
   * Get collector diagnostic information
   */
  getStatus() {
    return {
      ...this.stats,
      isMarketOpen: this.isMarketOpen(),
      currentIST: this.getISTString(),
      intervalSeconds: this.intervalMs / 1000,
      symbols: this.symbols,
      marketHoursOnly: this.marketHoursOnly,
      isCollectingNow: this.isCollecting,
    };
  }
}

const backgroundCollectorService = new BackgroundCollectorService();
module.exports = backgroundCollectorService;
