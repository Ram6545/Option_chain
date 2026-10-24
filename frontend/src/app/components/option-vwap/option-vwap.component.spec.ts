import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { OptionVWAPComponent } from './option-vwap.component';
import { OptionChainService } from '../../services/option-chain.service';
import { OptionVWAPResponse } from '../../models/option-vwap.model';

describe('OptionVWAPComponent', () => {
  let component: OptionVWAPComponent;
  let fixture: ComponentFixture<OptionVWAPComponent>;

  const mockVWAPResponse: OptionVWAPResponse = {
    success: true,
    symbol: 'NIFTY',
    spotPrice: 25012.5,
    atmStrike: 25000,
    strikeInterval: 50,
    expiry: '27-Oct-2026',
    tradingDate: '2026-10-23',
    availableDates: ['2026-10-23', '2026-10-22'],
    lastUpdated: '2026-10-24T15:30:00.000Z',
    marketBreadth: {
      index: 'NIFTY 50',
      total: 50,
      advances: 28,
      declines: 22,
      unchanged: 0,
      adRatio: 1.27,
      advancePercent: 56,
      declinePercent: 44,
      sentiment: 'bullish',
    },
    data: [
      {
        strikePrice: 24750,
        isATM: false,
        ce: { instrumentKey: 'CE24750', ltp: 320, vwap: 310, difference: 10, differencePct: 3.23, volume: 10000, status: 'available' },
        pe: { instrumentKey: 'PE24750', ltp: 40, vwap: 50, difference: -10, differencePct: -20, volume: 8000, status: 'available' },
      },
      {
        strikePrice: 24800,
        isATM: false,
        ce: { instrumentKey: 'CE24800', ltp: 280, vwap: 270, difference: 10, differencePct: 3.7, volume: 12000, status: 'available' },
        pe: { instrumentKey: 'PE24800', ltp: 55, vwap: 65, difference: -10, differencePct: -15.38, volume: 9000, status: 'available' },
      },
      {
        strikePrice: 24850,
        isATM: false,
        ce: { instrumentKey: 'CE24850', ltp: 240, vwap: 235, difference: 5, differencePct: 2.13, volume: 14000, status: 'available' },
        pe: { instrumentKey: 'PE24850', ltp: 75, vwap: 80, difference: -5, differencePct: -6.25, volume: 11000, status: 'available' },
      },
      {
        strikePrice: 24900,
        isATM: false,
        ce: { instrumentKey: 'CE24900', ltp: 200, vwap: 195, difference: 5, differencePct: 2.56, volume: 18000, status: 'available' },
        pe: { instrumentKey: 'PE24900', ltp: 95, vwap: 100, difference: -5, differencePct: -5, volume: 13000, status: 'available' },
      },
      {
        strikePrice: 24950,
        isATM: false,
        ce: { instrumentKey: 'CE24950', ltp: 165, vwap: 160, difference: 5, differencePct: 3.13, volume: 22000, status: 'available' },
        pe: { instrumentKey: 'PE24950', ltp: 120, vwap: 125, difference: -5, differencePct: -4, volume: 16000, status: 'available' },
      },
      {
        strikePrice: 25000,
        isATM: true,
        ce: { instrumentKey: 'CE25000', ltp: 130, vwap: 135, difference: -5, differencePct: -3.7, volume: 30000, status: 'available' },
        pe: { instrumentKey: 'PE25000', ltp: 145, vwap: 140, difference: 5, differencePct: 3.57, volume: 25000, status: 'available' },
      },
      {
        strikePrice: 25050,
        isATM: false,
        ce: { instrumentKey: 'CE25050', ltp: 100, vwap: 108, difference: -8, differencePct: -7.41, volume: 25000, status: 'available' },
        pe: { instrumentKey: 'PE25050', ltp: 180, vwap: 175, difference: 5, differencePct: 2.86, volume: 20000, status: 'available' },
      },
      {
        strikePrice: 25100,
        isATM: false,
        ce: { instrumentKey: 'CE25100', ltp: 75, vwap: 85, difference: -10, differencePct: -11.76, volume: 20000, status: 'available' },
        pe: { instrumentKey: 'PE25100', ltp: 220, vwap: 215, difference: 5, differencePct: 2.33, volume: 17000, status: 'available' },
      },
      {
        strikePrice: 25150,
        isATM: false,
        ce: { instrumentKey: 'CE25150', ltp: 55, vwap: 65, difference: -10, differencePct: -15.38, volume: 16000, status: 'available' },
        pe: { instrumentKey: 'PE25150', ltp: 260, vwap: 250, difference: 10, differencePct: 4, volume: 13000, status: 'available' },
      },
      {
        strikePrice: 25200,
        isATM: false,
        ce: { instrumentKey: 'CE25200', ltp: 38, vwap: 48, difference: -10, differencePct: -20.83, volume: 12000, status: 'available' },
        pe: { instrumentKey: 'PE25200', ltp: 305, vwap: 295, difference: 10, differencePct: 3.39, volume: 10000, status: 'available' },
      },
      {
        strikePrice: 25250,
        isATM: false,
        ce: { instrumentKey: 'CE25250', ltp: 25, vwap: 35, difference: -10, differencePct: -28.57, volume: 9000, status: 'available' },
        pe: { instrumentKey: 'PE25250', ltp: 350, vwap: 340, difference: 10, differencePct: 2.94, volume: 8000, status: 'available' },
      },
    ],
  };

  const mockService = {
    getOptionChainVWAP: (_sym?: string, _opts?: any) => of(mockVWAPResponse),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionVWAPComponent],
      providers: [
        { provide: OptionChainService, useValue: mockService },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionVWAPComponent);
    component = fixture.componentInstance;
  });

  it('should create the OptionVWAPComponent and load 11 strike rows', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.rows().length).toBe(11);
    expect(component.spotPrice()).toBe(25012.5);
    expect(component.atmStrike()).toBe(25000);
  });

  it('should render exactly 11 strike rows in the DOM', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('tbody tr.strike-row');
    expect(rows.length).toBe(11);
  });

  it('should identify and highlight the ATM strike row', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const atmRow = el.querySelector('tr.atm-row');
    expect(atmRow).toBeTruthy();
    expect(atmRow?.getAttribute('data-strike')).toBe('25000');
    expect(atmRow?.querySelector('.atm-badge')?.textContent?.trim()).toBe('ATM');
  });

  it('should display CE columns on left and PE columns on right with strike in center', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const atmRow = el.querySelector('tr.atm-row');

    const ceVwap = atmRow?.querySelector('.td-ce-vwap')?.textContent?.trim();
    const ceLtp = atmRow?.querySelector('.td-ce-ltp')?.textContent?.trim();
    const strike = atmRow?.querySelector('.td-strike-center .strike-number')?.textContent?.trim();
    const peLtp = atmRow?.querySelector('.td-pe-ltp')?.textContent?.trim();
    const peVwap = atmRow?.querySelector('.td-pe-vwap')?.textContent?.trim();

    expect(ceVwap).toBe('135.00');
    expect(ceLtp).toContain('130.00');
    expect(strike).toBe('25,000.00');
    expect(peLtp).toContain('145.00');
    expect(peVwap).toBe('140.00');
  });

  it('should display the Market Breadth Advance-Decline correlation section', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const breadthStrip = el.querySelector('.breadth-strip');
    expect(breadthStrip).toBeTruthy();

    const adRatio = el.querySelector('.sentiment-pill')?.textContent;
    expect(adRatio).toContain('1.27');
    expect(adRatio).toContain('BULLISH');

    const advances = el.querySelector('.advance-stat .stat-val')?.textContent?.trim();
    const declines = el.querySelector('.decline-stat .stat-val')?.textContent?.trim();
    expect(advances).toBe('28');
    expect(declines).toBe('22');
  });

  it('should toggle auto-refresh on and off', () => {
    fixture.detectChanges();
    expect(component.autoRefreshEnabled()).toBe(true);
    component.toggleAutoRefresh();
    expect(component.autoRefreshEnabled()).toBe(false);
    component.toggleAutoRefresh();
    expect(component.autoRefreshEnabled()).toBe(true);
  });
});
