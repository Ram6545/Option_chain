/**
 * Seed Data Script
 *
 * Generates and inserts realistic mock option chain data for NIFTY and BANK NIFTY
 * into the PostgreSQL database. Run with: npm run seed
 */

require('dotenv').config();
const db = require('../config/db');
const { initializeDatabase } = require('../models');
const marketDataService = require('../services/marketDataService');

const seedData = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Initialize database tables
    await initializeDatabase();

    // Seed data for both indices
    const indices = ['NIFTY', 'BANKNIFTY'];

    for (const symbol of indices) {
      console.log(`📊 Generating option chain data for ${symbol}...`);

      // Generate 5 snapshots with slightly different underlying prices
      for (let i = 0; i < 5; i++) {
        const isNifty = symbol === 'NIFTY';
        const basePrice = isNifty ? 24000 : 55000;
        // Vary the price slightly for each snapshot
        const underlyingPrice = basePrice + (Math.random() - 0.5) * basePrice * 0.03;

        const marketData = marketDataService.generateMockOptionChain(
          symbol,
          parseFloat(underlyingPrice.toFixed(2))
        );

        // Store in database
        const index = await require('../models').getIndexBySymbol(symbol);
        await require('../models').insertUnderlyingPrice(index.id, marketData.underlyingPrice);

        const snapshot = await require('../models').createSnapshot({
          indexId: index.id,
          underlyingPrice: marketData.underlyingPrice,
          timestamp: new Date(Date.now() - (4 - i) * 60000), // 1 min apart
        });

        await require('../models').insertOptionChainData(snapshot.id, marketData.data);

        console.log(`  ✅ Snapshot ${i + 1}/5 created (underlying: ${marketData.underlyingPrice})`);
      }
    }

    console.log('✅ Database seeding completed successfully!');
    console.log('\n📋 Summary:');
    console.log('  - Indices: NIFTY, BANK NIFTY');
    console.log('  - Snapshots per index: 5');
    console.log('  - Strikes per snapshot: 25');
    console.log('  - Options per snapshot: 50 (25 CE + 25 PE)');
    console.log('\n🚀 API is ready at http://localhost:5000/api');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedData();