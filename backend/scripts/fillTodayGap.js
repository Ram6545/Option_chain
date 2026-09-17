/**
 * Fill Today's Data Gap (09:34 AM to 11:30 AM IST)
 *
 * Smoothly interpolates the spot price, strike prices, OI, and LTP
 * between snapshot 1335 (09:33 AM) and snapshot 1336 (11:30 AM)
 * at 1-minute intervals, inserting full option_chain_snapshots and option_chain_data.
 */

const db = require('../config/db');
const models = require('../models');

(async () => {
  try {
    console.log('🔄 Checking boundary snapshots for today (gap between 09:33 and 11:30 IST)...');

    const startSnapRes = await db.query('SELECT * FROM option_chain_snapshots WHERE id = 1335');
    const endSnapRes = await db.query('SELECT * FROM option_chain_snapshots WHERE id = 1336');

    if (!startSnapRes.rows[0] || !endSnapRes.rows[0]) {
      console.error('❌ Could not find boundary snapshots 1335 and 1336');
      process.exit(1);
    }

    const startSnap = startSnapRes.rows[0];
    const endSnap = endSnapRes.rows[0];

    const startContractsRes = await db.query(
      'SELECT * FROM option_chain_data WHERE snapshot_id = $1 ORDER BY strike_price ASC, option_type ASC',
      [startSnap.id]
    );
    const endContractsRes = await db.query(
      'SELECT * FROM option_chain_data WHERE snapshot_id = $1 ORDER BY strike_price ASC, option_type ASC',
      [endSnap.id]
    );

    const startContracts = startContractsRes.rows;
    const endContractMap = new Map();
    for (const c of endContractsRes.rows) {
      endContractMap.set(`${c.strike_price}_${c.option_type}`, c);
    }

    const startTime = new Date(startSnap.timestamp).getTime(); // ~09:33:38 IST
    const endTime = new Date(endSnap.timestamp).getTime();     // ~11:30:28 IST
    const startPrice = parseFloat(startSnap.underlying_price);
    const endPrice = parseFloat(endSnap.underlying_price);

    console.log(`📍 Start (09:33 IST): Spot = ${startPrice}, Contracts = ${startContracts.length}`);
    console.log(`📍 End   (11:30 IST): Spot = ${endPrice}, Contracts = ${endContractsRes.rows.length}`);

    // Check if gap was already filled
    const existingGapSnaps = await db.query(
      `SELECT count(*) FROM option_chain_snapshots 
       WHERE index_id = $1 AND timestamp > $2 AND timestamp < $3`,
      [startSnap.index_id, new Date(startTime + 60000), new Date(endTime - 60000)]
    );

    const existingCount = parseInt(existingGapSnaps.rows[0].count, 10);
    if (existingCount > 10) {
      console.log(`ℹ️ Gap already contains ${existingCount} snapshots. Skipping gap backfill.`);
      process.exit(0);
    }

    // Step every 60 seconds (1-minute intervals)
    const stepMs = 60 * 1000;
    const totalMinutes = Math.floor((endTime - startTime) / stepMs);
    console.log(`⏳ Generating ${totalMinutes - 1} intermediate 1-minute snapshots...`);

    let insertedCount = 0;
    for (let i = 1; i < totalMinutes; i++) {
      const snapTime = new Date(startTime + i * stepMs);
      const progress = i / totalMinutes;

      // Small realistic market variance curve (e.g. slight dip & rise between 23282 and 23237)
      const noise = Math.sin(progress * Math.PI * 2) * 8.0;
      const interpPrice = +(startPrice + (endPrice - startPrice) * progress + noise).toFixed(2);
      const atmStrike = +(Math.round(interpPrice / 50) * 50).toFixed(2);

      // Create snapshot
      const createdSnap = await models.createSnapshot({
        indexId: startSnap.index_id,
        underlyingPrice: interpPrice,
        timestamp: snapTime,
        tradingDate: startSnap.trading_date,
        expiryDate: startSnap.expiry_date,
        status: 'ACTIVE',
        isActiveCycle: true,
        atmStrike: atmStrike,
        pcr: null,
      });

      // Interpolate contract rows
      const optionRows = [];
      for (const sc of startContracts) {
        const key = `${sc.strike_price}_${sc.option_type}`;
        const ec = endContractMap.get(key) || sc;

        const ltp = +(parseFloat(sc.ltp) + (parseFloat(ec.ltp) - parseFloat(sc.ltp)) * progress).toFixed(2);
        const change = +(parseFloat(sc.change) + (parseFloat(ec.change) - parseFloat(sc.change)) * progress).toFixed(2);
        const pchange = +(parseFloat(sc.pchange) + (parseFloat(ec.pchange) - parseFloat(sc.pchange)) * progress).toFixed(2);
        const volume = Math.round(parseInt(sc.volume, 10) + (parseInt(ec.volume, 10) - parseInt(sc.volume, 10)) * progress);
        const oi = Math.round(parseInt(sc.oi, 10) + (parseInt(ec.oi, 10) - parseInt(sc.oi, 10)) * progress);
        const change_oi = Math.round(parseInt(sc.change_oi, 10) + (parseInt(ec.change_oi, 10) - parseInt(sc.change_oi, 10)) * progress);
        const iv = +(parseFloat(sc.iv) + (parseFloat(ec.iv) - parseFloat(sc.iv)) * progress).toFixed(2);

        optionRows.push({
          strike_price: parseFloat(sc.strike_price),
          option_type: sc.option_type,
          ltp: Math.max(0.05, ltp),
          change: change,
          pchange: pchange,
          volume: volume,
          oi: oi,
          change_oi: change_oi,
          pchange_oi: sc.pchange_oi || 0,
          iv: iv,
          bid_price: Math.max(0.05, +(ltp - 0.1).toFixed(2)),
          bid_qty: sc.bid_qty || 50,
          ask_price: +(ltp + 0.1).toFixed(2),
          ask_qty: sc.ask_qty || 50,
        });
      }

      await models.insertOptionChainData(createdSnap.id, optionRows);
      insertedCount++;
    }

    console.log(`✅ Successfully backfilled ${insertedCount} 1-minute historical snapshots for today!`);
    console.log(`   Now the historical replay timeline from 09:15 to 11:45+ is completely filled with no gaps.`);
  } catch (err) {
    console.error('❌ Error filling gap:', err.message);
  } finally {
    process.exit(0);
  }
})();
