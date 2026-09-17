const db = require('../config/db');
(async () => {
  try {
    const fake = await db.query(`SELECT count(*) FROM option_chain_snapshots WHERE pcr IS NOT NULL`);
    console.log('Snapshots where pcr IS NOT NULL:', fake.rows[0].count);
    const real = await db.query(`SELECT count(*) FROM option_chain_snapshots WHERE pcr IS NULL`);
    console.log('Snapshots where pcr IS NULL (Genuine):', real.rows[0].count);
    const del = await db.query(`DELETE FROM option_chain_snapshots WHERE pcr IS NOT NULL`);
    console.log(`Deleted ${del.rowCount} fake snapshots with non-null PCR!`);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
})();
