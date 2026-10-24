import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AdvanceDeclineComponent } from './advance-decline.component';
import { MarketDataService } from '../../services/market-data.service';
import { MarketBreadthResponse } from '../../models/market-breadth.model';

describe('AdvanceDeclineComponent', () => {
  let component: AdvanceDeclineComponent;
  let fixture: ComponentFixture<AdvanceDeclineComponent>;

  const mockResponse: MarketBreadthResponse = {
    success: true,
    index: 'NIFTY 50',
    timestamp: '2026-10-24 15:30:00',
    summary: {
      total: 3,
      advances: 2,
      declines: 1,
      unchanged: 0,
      advancePercent: 66.7,
      declinePercent: 33.3,
      unchangedPercent: 0,
      adRatio: 2,
    },
    data: [
      {
        symbol: 'RELIANCE',
        companyName: 'Reliance Industries',
        price: 2950,
        closePrice: 2936.5,
        change: 13.5,
        changePercent: 0.46,
        contributionPoints: 12.5,
        category: 'advance',
      },
      {
        symbol: 'TCS',
        companyName: 'Tata Consultancy Services',
        price: 3850,
        closePrice: 3815,
        change: 35,
        changePercent: 0.92,
        contributionPoints: 8.0,
        category: 'advance',
      },
      {
        symbol: 'GRASIM',
        companyName: 'Grasim Industries',
        price: 2600,
        closePrice: 2600.26,
        change: -0.26,
        changePercent: -0.01,
        contributionPoints: -0.8,
        category: 'decline',
      },
    ],
  };

  const mockService = {
    getMarketBreadth: (_index?: string, _refresh?: boolean) => of(mockResponse),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdvanceDeclineComponent],
      providers: [
        { provide: MarketDataService, useValue: mockService },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdvanceDeclineComponent);
    component = fixture.componentInstance;
  });

  it('should create AdvanceDeclineComponent and load data', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.stocks().length).toBe(3);
    expect(component.summary()?.advances).toBe(2);
    expect(component.summary()?.declines).toBe(1);
  });

  it('should filter stocks when search term changes', () => {
    fixture.detectChanges();
    component.onSearchChange('TCS');
    const filtered = component.filteredStocks();
    expect(filtered.length).toBe(1);
    expect(filtered[0].symbol).toBe('TCS');
  });

  it('should filter stocks by category', () => {
    fixture.detectChanges();
    component.onCategoryChange('decline');
    const filtered = component.filteredStocks();
    expect(filtered.length).toBe(1);
    expect(filtered[0].symbol).toBe('GRASIM');
  });

  it('should sort stocks by percentage change descending by default', () => {
    fixture.detectChanges();
    const filtered = component.filteredStocks();
    expect(filtered[0].symbol).toBe('TCS'); // +0.92%
    expect(filtered[1].symbol).toBe('RELIANCE'); // +0.46%
    expect(filtered[2].symbol).toBe('GRASIM'); // -0.01%
  });

  it('should sort stocks ascending when direction is toggled', () => {
    fixture.detectChanges();
    component.onSortDirectionToggle();
    const filtered = component.filteredStocks();
    expect(filtered[0].symbol).toBe('GRASIM'); // -0.01%
    expect(filtered[2].symbol).toBe('TCS'); // +0.92%
  });
});
