const request = require('supertest');
const app = require('../server');
const { initializeDatabase } = require('../models');

beforeAll(async () => {
  await initializeDatabase();
});

describe('Option Chain API Endpoints', () => {
  test('GET / - API health and endpoints', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.endpoints).toBeDefined();
  });

  test('GET /api/indices - list active indices', async () => {
    const res = await request(app).get('/api/indices');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const symbols = res.body.data.map(i => i.symbol);
    expect(symbols).toContain('NIFTY');
    expect(symbols).toContain('BANKNIFTY');
  });

  test('GET /api/option-chain/NIFTY - get latest option chain', async () => {
    const res = await request(app).get('/api/option-chain/NIFTY');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.symbol).toBe('NIFTY');
    expect(res.body.data.underlyingPrice).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.strikes)).toBe(true);
    expect(res.body.data.strikes.length).toBeGreaterThan(0);
  });

  test('GET /api/option-chain/NIFTY/live - get live or fallback option chain', async () => {
    const res = await request(app).get('/api/option-chain/NIFTY/live');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.symbol).toBe('NIFTY');
    expect(Array.isArray(res.body.data.strikes)).toBe(true);
  });

  test('GET /api/option-chain/NIFTY/analysis - get OI analysis', async () => {
    const res = await request(app).get('/api/option-chain/NIFTY/analysis');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pcr).toBeDefined();
    expect(res.body.data.sentiment).toBeDefined();
    expect(res.body.data.supportResistance).toBeDefined();
    expect(res.body.data.maxPain).toBeDefined();
  });

  test('GET /api/option-chain/NIFTY/pcr-analysis - get Strike PCR Analysis (default 3 below + selected + 3 above = 7 strikes)', async () => {
    const res = await request(app).get('/api/option-chain/NIFTY/pcr-analysis');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.strikes).toBeDefined();
    expect(res.body.data.strikes.length).toBe(7);
    expect(res.body.data.aggregate).toBeDefined();
    expect(res.body.data.aggregate.totalCallOI).toBeGreaterThanOrEqual(0);
    expect(res.body.data.aggregate.totalPutOI).toBeGreaterThanOrEqual(0);

    // Verify strike structure
    const firstStrike = res.body.data.strikes[0];
    expect(firstStrike.strikePrice).toBeDefined();
    expect(firstStrike.callOI).toBeDefined();
    expect(firstStrike.putOI).toBeDefined();
    expect(firstStrike.callChangeOI).toBeDefined();
    expect(firstStrike.putChangeOI).toBeDefined();
    expect(firstStrike.pcrOI !== undefined).toBe(true);
    expect(firstStrike.pcrChangeOI !== undefined).toBe(true);
  });

  test('GET /api/option-chain/NIFTY/pcr-analysis with custom strike and configurable range (e.g. 5 strikes)', async () => {
    const res = await request(app).get('/api/option-chain/NIFTY/pcr-analysis?selectedStrike=24250&strikeRange=5');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.strikeRange).toBe(5);
    expect(res.body.data.strikes.length).toBe(11); // 5 below + selected + 5 above = 11
    const selectedItem = res.body.data.strikes.find(s => s.isSelected);
    expect(selectedItem).toBeDefined();
  });

  test('POST /api/option-chain/NIFTY/refresh - refresh data', async () => {
    const res = await request(app).post('/api/option-chain/NIFTY/refresh');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.symbol).toBe('NIFTY');
  });

  test('GET /api/underlying/NIFTY - get underlying price', async () => {
    const res = await request(app).get('/api/underlying/NIFTY');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.price).toBeDefined();
  });

  test('GET /api/underlying/NIFTY/history - get price history', async () => {
    const res = await request(app).get('/api/underlying/NIFTY/history');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/invalid-endpoint - 404 handler', async () => {
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.statusCode).toBe(404);
  });
});
