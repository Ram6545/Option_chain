import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
  let service: MarketDataService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MarketDataService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(MarketDataService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should format Indian prices correctly', () => {
    const formatted = service.formatIndianPrice(123456.78);
    expect(formatted).toContain('1,23,456.78');
  });

  it('should format percentages with explicit + sign for positive values', () => {
    expect(service.formatPercent(4.25)).toBe('+4.25%');
    expect(service.formatPercent(-0.01)).toBe('-0.01%');
    expect(service.formatPercent(0.0)).toBe('0.00%');
  });

  it('should normalize raw NSE API data correctly into advances, declines, and unchanged', () => {
    const rawNSEData = {
      data: [
        {
          changePer: 4.25,
          changePoints: 20.31,
          closePrice: 304.45,
          icSecurity: 'Eternal Ltd.',
          icSymbol: 'ETERNAL',
          isPositive: 'Y',
          lastTradedPrice: 317.4,
        },
        {
          changePer: -0.01,
          changePoints: -0.03,
          closePrice: 2894.4,
          icSecurity: 'Grasim Industries Ltd.',
          icSymbol: 'GRASIM',
          isPositive: 'N',
          lastTradedPrice: 2894.0,
        },
        {
          changePer: 0.0,
          changePoints: 0.0,
          closePrice: 100.0,
          icSecurity: 'Flat Corp',
          icSymbol: 'FLAT',
          isPositive: 'N',
          lastTradedPrice: 100.0,
        },
      ],
    };

    const normalized = service.normalizeResponse(rawNSEData, 'NIFTY 50');

    expect(normalized.data.length).toBe(3);
    expect(normalized.summary.advances).toBe(1);
    expect(normalized.summary.declines).toBe(1);
    expect(normalized.summary.unchanged).toBe(1);
    expect(normalized.summary.total).toBe(3);

    // Verify stock fields
    const stock1 = normalized.data[0];
    expect(stock1.symbol).toBe('ETERNAL');
    expect(stock1.companyName).toBe('Eternal Ltd.');
    expect(stock1.price).toBe(317.4);
    expect(stock1.change).toBe(12.95);
    expect(stock1.changePercent).toBe(4.25);
    expect(stock1.category).toBe('advance');

    const stock2 = normalized.data[1];
    expect(stock2.symbol).toBe('GRASIM');
    expect(stock2.category).toBe('decline');
    expect(stock2.changePercent).toBe(-0.01);
  });
});
