-- ============================================================
-- Option Chain Database Schema
-- NIFTY / Bank NIFTY Option Chain Application
-- ============================================================

-- Indices table: stores NIFTY, BANK NIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50
CREATE TABLE IF NOT EXISTS indices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    lot_size INTEGER,
    strike_step INTEGER DEFAULT 50,
    pre_market_open DECIMAL(12,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Pre-market data: stores daily pre-market open prices
CREATE TABLE IF NOT EXISTS pre_market_data (
    id SERIAL PRIMARY KEY,
    index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
    pre_market_open DECIMAL(12,2) NOT NULL,
    trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
    timestamp TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_index_trade_date UNIQUE (index_id, trade_date)
);

-- Underlying prices: tracks spot price of the index over time
CREATE TABLE IF NOT EXISTS underlying_prices (
    id SERIAL PRIMARY KEY,
    index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
    price DECIMAL(12,2) NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Expiry cycles table: tracks weekly/monthly expiry cycles (e.g. Tuesday expiry, Wednesday new cycle)
CREATE TABLE IF NOT EXISTS expiry_cycles (
    id SERIAL PRIMARY KEY,
    index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    cycle_start_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'ARCHIVED'
    is_current BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    CONSTRAINT uq_index_cycle_expiry UNIQUE (index_id, expiry_date)
);

-- Option chain snapshots: a point-in-time capture of the full chain
CREATE TABLE IF NOT EXISTS option_chain_snapshots (
    id SERIAL PRIMARY KEY,
    index_id INTEGER NOT NULL REFERENCES indices(id) ON DELETE CASCADE,
    underlying_price DECIMAL(12,2) NOT NULL,
    trading_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE,
    status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'ARCHIVED'
    is_active_cycle BOOLEAN DEFAULT true,
    atm_strike DECIMAL(12,2),
    pcr DECIMAL(6,2),
    timestamp TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Option chain data: individual option contracts within a snapshot
CREATE TABLE IF NOT EXISTS option_chain_data (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES option_chain_snapshots(id) ON DELETE CASCADE,
    strike_price DECIMAL(12,2) NOT NULL,
    option_type VARCHAR(10) NOT NULL CHECK (option_type IN ('CE', 'PE')),
    ltp DECIMAL(12,2),
    change DECIMAL(12,2) DEFAULT 0,
    pchange DECIMAL(12,2) DEFAULT 0,
    volume INTEGER DEFAULT 0,
    oi INTEGER DEFAULT 0,
    change_oi INTEGER DEFAULT 0,
    pchange_oi DECIMAL(12,2) DEFAULT 0,
    iv DECIMAL(12,2),
    bid_price DECIMAL(12,2),
    bid_qty INTEGER DEFAULT 0,
    ask_price DECIMAL(12,2),
    ask_qty INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance & historical replay
CREATE INDEX IF NOT EXISTS idx_option_chain_data_snapshot ON option_chain_data(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_option_chain_data_strike ON option_chain_data(strike_price);
CREATE INDEX IF NOT EXISTS idx_option_chain_data_type ON option_chain_data(option_type);
CREATE INDEX IF NOT EXISTS idx_chain_data_snapshot_strike ON option_chain_data(snapshot_id, strike_price ASC, option_type);
CREATE INDEX IF NOT EXISTS idx_snapshots_index ON option_chain_snapshots(index_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON option_chain_snapshots(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_date_expiry_time ON option_chain_snapshots(index_id, trading_date, expiry_date, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_snapshots_active_cycle ON option_chain_snapshots(index_id, is_active_cycle) WHERE is_active_cycle = TRUE;
CREATE INDEX IF NOT EXISTS idx_expiry_cycles_status ON expiry_cycles(index_id, status, is_current);
CREATE INDEX IF NOT EXISTS idx_underlying_index ON underlying_prices(index_id);
CREATE INDEX IF NOT EXISTS idx_underlying_timestamp ON underlying_prices(timestamp DESC);

-- Insert / Upsert default indices
INSERT INTO indices (name, symbol, display_name, lot_size, strike_step) VALUES
    ('NIFTY 50', 'NIFTY', 'NIFTY 50', 65, 50),
    ('BANK NIFTY', 'BANKNIFTY', 'BANK NIFTY', 15, 100),
    ('NIFTY FINANCIAL SERVICES', 'FINNIFTY', 'FIN NIFTY', 65, 50),
    ('NIFTY MIDCAP SELECT', 'MIDCPNIFTY', 'MIDCAP NIFTY', 120, 25),
    ('NIFTY NEXT 50', 'NIFTYNXT50', 'NIFTY NEXT 50', 25, 100)
ON CONFLICT (symbol) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    lot_size = EXCLUDED.lot_size,
    strike_step = EXCLUDED.strike_step;