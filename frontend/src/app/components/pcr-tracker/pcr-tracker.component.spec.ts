import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { PCRTrackerComponent } from './pcr-tracker.component';
import { OptionChainService } from '../../services/option-chain.service';
import { PCRTrackerResponse } from '../../models/option-chain.model';

describe('PCRTrackerComponent', () => {
  let component: PCRTrackerComponent;
  let fixture: ComponentFixture<PCRTrackerComponent>;
  let optionChainService: OptionChainService;

  const mockPCRResponse: PCRTrackerResponse = {
    success: true,
    symbol: 'NIFTY',
    date: '2026-10-22',
    availableDates: ['2026-10-22', '2026-10-21'],
    availableExpiries: ['2026-10-29', '2026-11-05'],
    expiry: '2026-10-29',
    timeFrame: 1,
    startTime: '09:15',
    endTime: '15:30',
    totalIntervals: 3,
    source: 'database',
    isLive: false,
    lastUpdated: '2026-10-22T10:00:00.000Z',
    summary: {
      currentPCR: 0.85,
      previousPCR: 0.82,
      pcrChange: 0.03,
      pcrChangePercent: 3.66,
      totalPutOI: 2900000,
      totalCallOI: 3410000,
      totalPutOIChange: 150000,
      totalCallOIChange: 20000,
      trend: 'Increasing',
      spotPrice: 22680.5,
      previousSpotPrice: 22650.0,
      spotChange: 30.5,
      spotChangePercent: 0.13,
      atmStrike: 22700,
      interpretation: 'Rising PCR: Increasing put open interest relative to call open interest.',
    },
    intervals: [
      {
        timestamp: '09:15',
        spotPrice: 22650.0,
        spotChange: 0,
        atmStrike: 22650,
        putOI: 2750000,
        callOI: 3400000,
        putOIChange: 0,
        callOIChange: 0,
        pcr: 0.8088,
        previousPCR: 0.8088,
        pcrChange: 0,
        pcrChangePercent: 0,
        trend: 'Stable',
      },
      {
        timestamp: '09:16',
        spotPrice: 22665.0,
        spotChange: 15.0,
        atmStrike: 22650,
        putOI: 2820000,
        callOI: 3410000,
        putOIChange: 70000,
        callOIChange: 10000,
        pcr: 0.827,
        previousPCR: 0.8088,
        pcrChange: 0.0182,
        pcrChangePercent: 2.25,
        trend: 'Stable',
      },
      {
        timestamp: '09:17',
        spotPrice: 22680.5,
        spotChange: 15.5,
        atmStrike: 22700,
        putOI: 2900000,
        callOI: 3410000,
        putOIChange: 80000,
        callOIChange: 0,
        pcr: 0.8504,
        previousPCR: 0.827,
        pcrChange: 0.0234,
        pcrChangePercent: 2.83,
        trend: 'Increasing',
      },
    ],
    oiDistribution: [
      {
        strikePrice: 22600,
        isAtm: false,
        callOI: 100000,
        putOI: 350000,
        callChangeOI: 5000,
        putChangeOI: 45000,
        pcr: 3.5,
      },
      {
        strikePrice: 22700,
        isAtm: true,
        callOI: 250000,
        putOI: 280000,
        callChangeOI: 15000,
        putChangeOI: 25000,
        pcr: 1.12,
      },
      {
        strikePrice: 22800,
        isAtm: false,
        callOI: 400000,
        putOI: 90000,
        callChangeOI: 50000,
        putChangeOI: 5000,
        pcr: 0.225,
      },
    ],
    supportResistance: {
      majorSupport: { strike: 22500, oi: 450000, label: 'Major Support (Max Put OI)', type: 'inferred' },
      secondarySupport: { strike: 22600, oi: 350000, label: 'Secondary Support', type: 'inferred' },
      majorResistance: { strike: 23000, oi: 500000, label: 'Major Resistance (Max Call OI)', type: 'inferred' },
      secondaryResistance: { strike: 22800, oi: 400000, label: 'Secondary Resistance', type: 'inferred' },
      maxPutAddition: { strike: 22600, changeOI: 45000, label: 'Max Put Addition', type: 'inferred' },
      maxCallAddition: { strike: 22800, changeOI: 50000, label: 'Max Call Addition', type: 'inferred' },
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PCRTrackerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();

    optionChainService = TestBed.inject(OptionChainService);
    // Mock service calls
    vi.spyOn(optionChainService, 'getIndices').mockReturnValue(
      of({
        success: true,
        count: 1,
        source: 'test',
        data: [{ id: 1, symbol: 'NIFTY', name: 'NIFTY 50', display_name: 'NIFTY 50', lot_size: 65, strike_step: 50, is_active: true }],
      })
    );
    vi.spyOn(optionChainService, 'getPCRTrackerData').mockReturnValue(of(mockPCRResponse));

    fixture = TestBed.createComponent(PCRTrackerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the PCRTrackerComponent', () => {
    expect(component).toBeTruthy();
  });

  describe('PCR Calculations and Formatting', () => {
    it('should format standard PCR correctly with two decimal places', () => {
      expect(component.formatPCR(0.8504)).toBe('0.85');
      expect(component.formatPCR(1.2345)).toBe('1.23');
    });

    it('should safely format null, undefined, or NaN PCR as "N/A"', () => {
      expect(component.formatPCR(null)).toBe('N/A');
      expect(component.formatPCR(undefined)).toBe('N/A');
      expect(component.formatPCR(NaN)).toBe('N/A');
    });

    it('should format open interest in Indian numbering format', () => {
      expect(component.formatOI(2900000)).toBe('29,00,000');
      expect(component.formatOI(0)).toBe('0');
      expect(component.formatOI(null)).toBe('0');
    });

    it('should format index prices with two decimals', () => {
      expect(component.formatPrice(22680.5)).toBe('22,680.50');
      expect(component.formatPrice(null)).toBe('0.00');
    });
  });

  describe('Sentiment and Thresholds', () => {
    it('should evaluate Bullish Bias when PCR >= bullishThreshold', () => {
      component.setThresholds(1.0, 0.8);
      component.pcrData.set({
        ...mockPCRResponse,
        summary: { ...mockPCRResponse.summary, currentPCR: 1.15 },
      });
      const badge = component.sentimentBadge();
      expect(badge.label).toBe('Bullish Bias');
      expect(badge.class).toBe('bullish');
    });

    it('should evaluate Bearish Bias when PCR <= bearishThreshold', () => {
      component.setThresholds(1.0, 0.8);
      component.pcrData.set({
        ...mockPCRResponse,
        summary: { ...mockPCRResponse.summary, currentPCR: 0.75 },
      });
      const badge = component.sentimentBadge();
      expect(badge.label).toBe('Bearish Bias');
      expect(badge.class).toBe('bearish');
    });

    it('should evaluate Neutral Bias when PCR is between thresholds', () => {
      component.setThresholds(1.0, 0.8);
      component.pcrData.set({
        ...mockPCRResponse,
        summary: { ...mockPCRResponse.summary, currentPCR: 0.9 },
      });
      const badge = component.sentimentBadge();
      expect(badge.label).toBe('Neutral Bias');
      expect(badge.class).toBe('neutral');
    });
  });

  describe('Table Filtering, Sorting, and Pagination', () => {
    it('should filter table rows by search query', () => {
      component.pcrData.set(mockPCRResponse);
      component.tableSearchQuery.set('09:17');
      const filtered = component.filteredTableData();
      expect(filtered.length).toBe(1);
      expect(filtered[0].timestamp).toBe('09:17');
    });

    it('should sort table rows ascending and descending by column', () => {
      component.pcrData.set(mockPCRResponse);
      component.tableSearchQuery.set('');

      // Sort by spotPrice ascending
      component.tableSortColumn.set('spotPrice');
      component.tableSortDirection.set('asc');
      const asc = component.filteredTableData();
      expect(asc[0].spotPrice).toBe(22650.0);
      expect(asc[asc.length - 1].spotPrice).toBe(22680.5);

      // Sort by spotPrice descending
      component.tableSortDirection.set('desc');
      const desc = component.filteredTableData();
      expect(desc[0].spotPrice).toBe(22680.5);
      expect(desc[desc.length - 1].spotPrice).toBe(22650.0);
    });

    it('should paginate table rows accurately', () => {
      component.pcrData.set(mockPCRResponse);
      component.setPageSize(2);
      expect(component.totalPages()).toBe(2);

      component.goToPage(1);
      expect(component.paginatedRows().length).toBe(2);

      component.goToPage(2);
      expect(component.paginatedRows().length).toBe(1);
    });
  });

  describe('Filter Changes', () => {
    it('should trigger fetchPCRData when changing instrument symbol', () => {
      const spy = vi.spyOn(component, 'fetchPCRData');
      component.onSymbolChange('BANKNIFTY');
      expect(component.selectedSymbol()).toBe('BANKNIFTY');
      expect(spy).toHaveBeenCalled();
    });

    it('should trigger fetchPCRData when changing timeframe', () => {
      const spy = vi.spyOn(component, 'fetchPCRData');
      component.onTimeFrameChange(5);
      expect(component.timeFrame()).toBe(5);
      expect(spy).toHaveBeenCalled();
    });

    it('should toggle auto-refresh status', () => {
      expect(component.autoRefreshEnabled()).toBe(false);
      component.toggleAutoRefresh();
      expect(component.autoRefreshEnabled()).toBe(true);
      component.toggleAutoRefresh();
      expect(component.autoRefreshEnabled()).toBe(false);
    });
  });
});
