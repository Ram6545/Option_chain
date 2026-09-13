/**
 * Seed Data Script
 *
 * Generates and inserts complete historical option chain snapshots for NIFTY and BANK NIFTY
 * directly into the PostgreSQL database. Run with: npm run seed
 */

require('dotenv').config();
const db = require('../config/db');
const models = require('../models');
const historicalReplayService = require('../services/historicalReplayService');

const seedData = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Initialize database tables
    await models.initializeDatabase();

    const dates = ['2026-09-11', '2026-09-10'];
    const symbols = ['NIFTY', 'BANKNIFTY'];

    for (const symbol of symbols) {
      for (const dateStr of dates) {
        console.log(`📊 Populating historical session snapshots for ${symbol} on ${dateStr} in PostgreSQL...`);
        await historicalReplayService.seedHistoricalDateToDB(symbol, dateStr);
      }
    }

    const countRes = await db.query('SELECT COUNT(*) as count FROM option_chain_snapshots');
    const optionsRes = await db.query('SELECT COUNT(*) as count FROM option_chain_data');

    console.log('\n✅ Database seeding completed successfully!');
    console.log(`📋 Total option_chain_snapshots in PostgreSQL: ${countRes.rows[0].count}`);
    console.log(`📋 Total option_chain_data rows in PostgreSQL: ${optionsRes.rows[0].count}`);
    console.log('\n🚀 Your database is now populated with real historical records!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedData();