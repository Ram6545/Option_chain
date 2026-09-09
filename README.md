# NIFTY / Bank NIFTY Option Chain Application

A fully functional **NIFTY/Bank NIFTY Option Chain** application built with **Angular frontend, Node.js/Express backend, and PostgreSQL database**.

## Features

### Option Chain Data
- **Live option-chain data** with CE/PE, Strike Price, LTP, Volume, OI, Change in OI, IV, Bid/Ask
- **Calls on left, Put on right, Strike Price in center** - Professional trading layout
- **ATM strike highlighting** - Visual identification of At-The-Money strikes
- **Automatic sorting/filtering and refresh** - Sort by OI, Change in OI, Volume; auto-refresh every 30 seconds
- **Bullish/Bearish OI analysis** - Sentiment analysis, PCR, Max Pain, Support/Resistance levels

### Backend (Node.js/Express)
- RESTful API endpoints for option chain data
- PostgreSQL database for storing option chain data
- Real API-ready architecture (mock data generator simulates market data API)
- OI analysis service with sentiment, PCR, max pain, and support/resistance calculations

### Frontend (Angular)
- Responsive professional trading UI
- Clean Angular components, services, and models
- Angular Material design
- Mobile-responsive card view for smaller screens

## Architecture

```
optionchain/
├── backend/                    # Node.js/Express backend
│   ├── config/
│   │   └── db.js              # PostgreSQL connection
│   ├── models/
│   │   └── index.js           # Database models
│   ├── services/
│   │   ├── marketDataService.js    # Market data fetching (mock/real API)
│   │   └── oiAnalysisService.js    # OI analysis calculations
│   ├── controllers/
│   │   └── optionChainController.js # API controllers
│   ├── routes/
│   │   └── optionChain.js     # API routes
│   ├── seeds/
│   │   └── seedData.js        # Database seeding
│   ├── init.sql               # Database initialization
│   ├── server.js              # Express server
│   ├── package.json
│   └── .env                   # Environment configuration
├── frontend/                   # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── models/
│   │   │   │   └── option-chain.model.ts  # TypeScript models
│   │   │   ├── services/
│   │   │   │   └── option-chain.service.ts # API service
│   │   │   ├── components/
│   │   │   │   ├── option-chain/           # Option chain table
│   │   │   │   └── oi-analysis/            # OI analysis dashboard
│   │   │   ├── app.config.ts
│   │   │   ├── app.routes.ts
│   │   │   ├── app.ts
│   │   │   ├── app.html
│   │   │   ├── app.scss
│   │   │   └── app.spec.ts
│   │   ├── styles.scss
│   │   └── index.html
│   ├── angular.json
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml          # Docker configuration
└── README.md
```

## Database Schema

### Tables
1. **indices** - Stores index information (NIFTY, BANKNIFTY)
2. **underlying_prices** - Historical underlying prices
3. **option_chain_snapshots** - Snapshot metadata (timestamp, underlying price)
4. **option_chain_data** - Individual option data (CE/PE) for each strike

## API Endpoints

### Indices
- `GET /api/indices` - Get all active indices

### Option Chain
- `GET /api/option-chain/:symbol` - Get latest option chain data
- `GET /api/option-chain/:symbol/snapshots` - Get all snapshots (paginated)
- `GET /api/option-chain/:symbol/snapshot/:snapshotId` - Get specific snapshot data
- `GET /api/option-chain/:symbol/analysis` - Get OI analysis
- `POST /api/option-chain/:symbol/refresh` - Refresh option chain data

### Underlying Prices
- `GET /api/underlying/:symbol` - Get latest underlying price
- `GET /api/underlying/:symbol/history` - Get historical prices

## Setup & Installation

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose
- npm

### Quick Start

1. **Start PostgreSQL database:**
   ```bash
   docker-compose up -d
   ```

2. **Install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

3. **Seed the database:**
   ```bash
   node seeds/seedData.js
   ```

4. **Start the backend server:**
   ```bash
   node server.js
   ```
   Backend runs on `http://localhost:5000`

5. **Install frontend dependencies:**
   ```bash
   cd ../frontend
   npm install
   ```

6. **Start the frontend dev server:**
   ```bash
   ng serve --port 4200
   ```
   Frontend runs on `http://localhost:4200`

## Environment Configuration

Backend `.env` file:
```
PORT=5000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=optionchain
REFRESH_INTERVAL=30
```

## Connecting to a Real Market Data API

The application is designed with a real API-ready architecture. To connect to a real market data API:

1. Update the `fetchFromMarketAPI` function in `backend/services/marketDataService.js`
2. Add your API credentials to the `.env` file:
   ```
   MARKET_DATA_API_KEY=your_api_key_here
   MARKET_DATA_API_URL=https://api.example.com/v1
   ```
3. Replace the mock data generation with actual API calls

## Technologies Used

- **Frontend:** Angular 22, Angular Material, SCSS
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL 16
- **Containerization:** Docker, Docker Compose
- **API Architecture:** RESTful APIs with JSON

## License

MIT License