const db = require('../config/db');
const h = require('../services/historicalReplayService');
const models = require('../models');

(async () => {
  try {
    const indexRecord = await models.getIndexBySymbol('NIFTY');
    console.log('Index ID:', indexRecord.id);

    // 1. Insert 23128.00 into underlying_prices
    await db.query(
      `INSERT INTO underlying_prices (index_id, price, timestamp) VALUES ($1, $2, NOW())`,
      [indexRecord.id, 23128.00]
    );
    console.log('✅ Inserted current spot price 23128.00 into underlying_prices');

    // 2. Delete existing 2026-09-16 snapshots for NIFTY to force re-seed
    const delRes = await db.query(
      `DELETE FROM option_chain_snapshots WHERE index_id = $1 AND (trading_date = '2026-09-16' OR timestamp::date = '2026-09-16')`,
      [indexRecord.id]
    );
    console.log(`Deleted ${delRes.rowCount} old snapshots for 2026-09-16`);

    // 3. Re-seed with basePrice 23128.00
    await h.seedHistoricalDateToDB('NIFTY', '2026-09-16', '2026-09-22', 23128.00);

    // 4. Verify new snapshots
    const check = await h.getHistoricalReplay('NIFTY', {
      date: '2026-09-16',
      expiry: '22-Sep-2026',
      timeFrame: 1,
    });
    console.log('Verified 2026-09-16 Replay:');
    console.log('Total intervals:', check.data?.length);
    console.log('Slot 0 (09:15): spot =', check.data?.[0]?.niftyPrice, 'atm =', check.data?.[0]?.atmStrike);
    console.log('Slot 30 (09:45): spot =', check.data?.[30]?.niftyPrice, 'atm =', check.data?.[30]?.atmStrike);
    console.log('Slot 30 strikes:', check.data?.[30]?.optionChain?.map(s => s.strikePrice));
  } catch (e) {
    console.error('Reseed error:', e);
  }
  process.exit(0);
})();
