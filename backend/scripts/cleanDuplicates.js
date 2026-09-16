/**
 * Standalone Database Deduplication & Constraint Enforcement Script
 * 
 * Cleans up existing duplicate data in PostgreSQL:
 * 1. underlying_prices (duplicate index_id + timestamp)
 * 2. option_chain_snapshots (duplicate index_id + expiry_date + timestamp)
 * 3. option_chain_data (duplicate snapshot_id + strike_price + option_type)
 * 4. orphaned option_chain_data (pointing to non-existent snapshots)
 * 
 * Applies unique constraints and indexes to permanently reject/upsert duplicates.
 * 
 * Usage: node scripts/cleanDuplicates.js
 */

const db = require('../config/db');

async function cleanDuplicatesAndApplyConstraints() {
  console.log('🔄 [Deduplication] Connecting to database...');
  await db.testConnection();

  try {
    console.log('🧹 [1/5] Removing duplicate underlying_prices...');
    const dupPricesRes = await db.query(`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY index_id, timestamp 
                 ORDER BY id DESC
               ) as rnum
        FROM underlying_prices
      )
      DELETE FROM underlying_prices
      WHERE id IN (SELECT id FROM duplicates WHERE rnum > 1)
      RETURNING id;
    `);
    const deletedPricesCount = dupPricesRes?.rows?.length ?? dupPricesRes?.rowCount ?? 0;
    console.log(`✅ [1/5] Removed ${deletedPricesCount} duplicate underlying_prices.`);

    console.log('🧹 [2/5] Removing duplicate option_chain_snapshots (cascading child data)...');
    const dupSnapsRes = await db.query(`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY index_id, COALESCE(expiry_date, '1970-01-01'::date), timestamp 
                 ORDER BY id DESC
               ) as rnum
        FROM option_chain_snapshots
      )
      DELETE FROM option_chain_snapshots
      WHERE id IN (SELECT id FROM duplicates WHERE rnum > 1)
      RETURNING id;
    `);
    const deletedSnapsCount = dupSnapsRes?.rows?.length ?? dupSnapsRes?.rowCount ?? 0;
    console.log(`✅ [2/5] Removed ${deletedSnapsCount} duplicate option_chain_snapshots.`);

    console.log('🧹 [3/5] Removing duplicate option_chain_data rows within existing snapshots...');
    const dupDataRes = await db.query(`
      WITH duplicates AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY snapshot_id, strike_price, option_type 
                 ORDER BY (volume + oi) DESC, id DESC
               ) as rnum
        FROM option_chain_data
      )
      DELETE FROM option_chain_data
      WHERE id IN (SELECT id FROM duplicates WHERE rnum > 1)
      RETURNING id;
    `);
    const deletedDataCount = dupDataRes?.rows?.length ?? dupDataRes?.rowCount ?? 0;
    console.log(`✅ [3/5] Removed ${deletedDataCount} duplicate option_chain_data rows.`);

    console.log('🧹 [4/5] Removing orphaned option_chain_data rows...');
    const orphanRes = await db.query(`
      DELETE FROM option_chain_data
      WHERE snapshot_id NOT IN (SELECT id FROM option_chain_snapshots)
      RETURNING id;
    `);
    const deletedOrphansCount = orphanRes?.rows?.length ?? orphanRes?.rowCount ?? 0;
    console.log(`✅ [4/5] Removed ${deletedOrphansCount} orphaned option_chain_data rows.`);

    console.log('🔒 [5/5] Creating unique indexes to permanently prevent future duplicates...');

    // 1. underlying_prices unique index
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_underlying_index_timestamp 
      ON underlying_prices(index_id, timestamp);
    `);
    console.log('  ✓ Unique index uq_underlying_index_timestamp active');

    // 2. option_chain_snapshots unique index
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_index_expiry_timestamp 
      ON option_chain_snapshots(index_id, COALESCE(expiry_date, '1970-01-01'::date), timestamp);
    `);
    console.log('  ✓ Unique index uq_snapshots_index_expiry_timestamp active');

    // 3. option_chain_data unique constraint / index
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_chain_data_snapshot_strike_type'
        ) THEN
          ALTER TABLE option_chain_data 
          ADD CONSTRAINT uq_chain_data_snapshot_strike_type 
          UNIQUE (snapshot_id, strike_price, option_type);
        END IF;
      END $$;
    `);
    console.log('  ✓ Unique constraint uq_chain_data_snapshot_strike_type active');

    console.log('\n🎉 [Deduplication Complete] All duplicate records cleaned and unique constraints applied successfully!');
    return {
      deletedPricesCount,
      deletedSnapsCount,
      deletedDataCount,
      deletedOrphansCount,
    };
  } catch (err) {
    console.error('❌ [Deduplication Error]:', err.message);
    throw err;
  }
}

if (require.main === module) {
  cleanDuplicatesAndApplyConstraints()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { cleanDuplicatesAndApplyConstraints };
