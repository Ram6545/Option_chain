import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription, interval } from 'rxjs';
import Chart from 'chart.js/auto';

import { OptionChainService } from '../../services/option-chain.service';
import {
  PCRTrackerResponse,
  PCRTrackerInterval,
  PCRTrackerSummary,
  PCRTrackerSupportResistance,
  IndicesResponse,
} from '../../models/option-chain.model';

@Component({
  selector: 'app-pcr-tracker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatSelectModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
    MatMenuModule,
  ],
  templateUrl: './pcr-tracker.component.html',
  styleUrls: ['./pcr-tracker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PCRTrackerComponent implements OnInit, AfterViewInit, OnDestroy {
  private optionChainService = inject(OptionChainService);
  private snackBar = inject(MatSnackBar);

  // Canvas ViewChild references for the 4 interactive graphs
  @ViewChild('pcrTrendCanvas') pcrTrendCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('oiCompCanvas') oiCompCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('priceCompCanvas') priceCompCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('oiChangeCanvas') oiChangeCanvas!: ElementRef<HTMLCanvasElement>;

  // Chart instances
  private pcrTrendChart: Chart | null = null;
  private oiCompChart: Chart | null = null;
  private priceCompChart: Chart | null = null;
  private oiChangeChart: Chart | null = null;

  // Primary State Signals
  selectedSymbol = signal<string>('NIFTY');
  selectedExpiry = signal<string | null>(null);
  selectedDate = signal<string | null>(null);
  timeFrame = signal<number>(1); // 1, 3, 5, 15, 30, 60 minutes
  isLiveMode = signal<boolean>(false);
  autoRefreshEnabled = signal<boolean>(false);
  autoRefreshInterval = signal<number>(30); // seconds: 15, 30, 60, 120
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  // Configurable Sentiment Thresholds (Educational context)
  bullishThreshold = signal<number>(1.0);
  bearishThreshold = signal<number>(0.8);

  // UI View Controls
  activeChartTab = signal<'all' | 'pcr-trend' | 'oi-comp' | 'price-comp' | 'oi-change'>('all');

  // Table State Signals
  tableSearchQuery = signal<string>('');
  tableSortColumn = signal<string>('timestamp');
  tableSortDirection = signal<'asc' | 'desc'>('desc');
  tablePage = signal<number>(1);
  tablePageSize = signal<number>(10);

  // Data Payloads
  pcrData = signal<PCRTrackerResponse | null>(null);
  indices = signal<IndicesResponse['data']>([]);
  availableDates = signal<string[]>([]);
  availableExpiries = signal<string[]>([]);

  // Subscriptions
  private refreshSub: Subscription | null = null;

  // Computed Values
  summary = computed<PCRTrackerSummary | null>(() => this.pcrData()?.summary || null);
  intervals = computed<PCRTrackerInterval[]>(() => this.pcrData()?.intervals || []);
  supportResistance = computed<PCRTrackerSupportResistance | null>(() => this.pcrData()?.supportResistance || null);
  totalIntervals = computed<number>(() => this.intervals().length);

  // Filtered and Sorted Table Data
  filteredTableData = computed(() => {
    let rows = [...this.intervals()];
    const query = this.tableSearchQuery().trim().toLowerCase();

    if (query) {
      rows = rows.filter(
        (r) =>
          r.timestamp.toLowerCase().includes(query) ||
          r.spotPrice.toString().includes(query) ||
          (r.pcr !== null && r.pcr.toString().includes(query)) ||
          r.trend.toLowerCase().includes(query)
      );
    }

    const col = this.tableSortColumn();
    const dir = this.tableSortDirection() === 'asc' ? 1 : -1;

    rows.sort((a, b) => {
      let valA: any = (a as any)[col];
      let valB: any = (b as any)[col];

      if (valA === null || valA === undefined) valA = -Infinity;
      if (valB === null || valB === undefined) valB = -Infinity;

      if (typeof valA === 'string') {
        return valA.localeCompare(valB) * dir;
      }
      return (valA - valB) * dir;
    });

    return rows;
  });

  totalPages = computed(() => {
    const total = this.filteredTableData().length;
    const size = this.tablePageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  paginatedRows = computed(() => {
    const rows = this.filteredTableData();
    const page = this.tablePage();
    const size = this.tablePageSize();
    const start = (page - 1) * size;
    return rows.slice(start, start + size);
  });

  // Sentiment interpretation badge based on configurable thresholds
  sentimentBadge = computed(() => {
    const pcr = this.summary()?.currentPCR;
    if (pcr === null || pcr === undefined) return { label: 'Neutral', class: 'neutral', icon: 'remove' };
    if (pcr >= this.bullishThreshold()) {
      return { label: 'Bullish Bias', class: 'bullish', icon: 'trending_up' };
    }
    if (pcr <= this.bearishThreshold()) {
      return { label: 'Bearish Bias', class: 'bearish', icon: 'trending_down' };
    }
    return { label: 'Neutral Bias', class: 'neutral', icon: 'trending_flat' };
  });

  ngOnInit(): void {
    this.loadIndices();
    this.fetchPCRData();
  }

  ngAfterViewInit(): void {
    // If data was already loaded before view init, render charts
    if (this.pcrData()) {
      setTimeout(() => this.renderAllCharts(), 100);
    }
  }

  ngOnDestroy(): void {
    this.destroyCharts();
    if (this.refreshSub) {
      this.refreshSub.unsubscribe();
      this.refreshSub = null;
    }
  }

  /**
   * Load supported active indices from database
   */
  loadIndices(): void {
    this.optionChainService.getIndices().subscribe({
      next: (res) => {
        if (res && res.data) {
          this.indices.set(res.data);
        }
      },
      error: () => {
        // Fallback standard indices
        this.indices.set([
          { id: 1, symbol: 'NIFTY', name: 'NIFTY 50', display_name: 'NIFTY 50', lot_size: 65, strike_step: 50, is_active: true },
          { id: 2, symbol: 'BANKNIFTY', name: 'BANK NIFTY', display_name: 'BANK NIFTY', lot_size: 15, strike_step: 100, is_active: true },
          { id: 3, symbol: 'FINNIFTY', name: 'FIN NIFTY', display_name: 'FIN NIFTY', lot_size: 65, strike_step: 50, is_active: true },
          { id: 4, symbol: 'MIDCPNIFTY', name: 'MIDCAP NIFTY', display_name: 'MIDCAP NIFTY', lot_size: 120, strike_step: 25, is_active: true },
          { id: 5, symbol: 'NIFTYNXT50', name: 'NIFTY NEXT 50', display_name: 'NIFTY NEXT 50', lot_size: 25, strike_step: 100, is_active: true },
        ]);
      },
    });
  }

  /**
   * Fetch PCR Tracker Data from backend
   */
  fetchPCRData(): void {
    this.isLoading.set(true);
    this.error.set(null);

    const symbol = this.selectedSymbol();
    const date = this.selectedDate() || undefined;
    const expiry = this.selectedExpiry() || undefined;
    const timeFrame = this.timeFrame();

    this.optionChainService
      .getPCRTrackerData(symbol, {
        date,
        expiry,
        timeFrame,
      })
      .subscribe({
        next: (res) => {
          this.isLoading.set(false);
          if (res && res.success) {
            this.pcrData.set(res);
            this.availableDates.set(res.availableDates || []);
            this.availableExpiries.set(res.availableExpiries || []);

            if (!this.selectedDate() && res.date) {
              this.selectedDate.set(res.date);
            }
            if (!this.selectedExpiry() && res.expiry) {
              this.selectedExpiry.set(res.expiry);
            }

            // Render charts on next tick
            setTimeout(() => this.renderAllCharts(), 50);
          } else {
            this.error.set(res?.message || 'Failed to load PCR data');
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          const msg = err.error?.error || err.message || 'Error communicating with backend PCR service';
          this.error.set(msg);
          this.snackBar.open(msg, 'Close', { duration: 4000, panelClass: 'error-snackbar' });
        },
      });
  }

  /**
   * Filter Changes
   */
  onSymbolChange(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.selectedDate.set(null);
    this.selectedExpiry.set(null);
    this.tablePage.set(1);
    this.fetchPCRData();
  }

  onDateChange(date: string): void {
    this.selectedDate.set(date);
    this.tablePage.set(1);
    this.fetchPCRData();
  }

  onExpiryChange(expiry: string): void {
    this.selectedExpiry.set(expiry);
    this.tablePage.set(1);
    this.fetchPCRData();
  }

  onTimeFrameChange(tf: number): void {
    this.timeFrame.set(tf);
    this.tablePage.set(1);
    this.fetchPCRData();
  }

  onTabChange(tab: 'all' | 'pcr-trend' | 'oi-comp' | 'price-comp' | 'oi-change'): void {
    this.activeChartTab.set(tab);
    setTimeout(() => this.renderAllCharts(), 100);
  }

  /**
   * Auto-refresh controls
   */
  toggleAutoRefresh(): void {
    const nextState = !this.autoRefreshEnabled();
    this.autoRefreshEnabled.set(nextState);

    if (this.refreshSub) {
      this.refreshSub.unsubscribe();
      this.refreshSub = null;
    }

    if (nextState) {
      const ms = this.autoRefreshInterval() * 1000;
      this.refreshSub = interval(ms).subscribe(() => {
        this.fetchPCRData();
      });
      this.snackBar.open(`Auto-refresh active (${this.autoRefreshInterval()}s)`, 'OK', {
        duration: 2000,
        panelClass: 'success-snackbar',
      });
    } else {
      this.snackBar.open('Auto-refresh paused', 'OK', {
        duration: 2000,
        panelClass: 'warning-snackbar',
      });
    }
  }

  changeAutoRefreshInterval(seconds: number): void {
    this.autoRefreshInterval.set(seconds);
    if (this.autoRefreshEnabled()) {
      this.toggleAutoRefresh(); // stop
      this.toggleAutoRefresh(); // restart with new interval
    }
  }

  /**
   * Live Mode toggle
   */
  toggleLiveMode(): void {
    const nextMode = !this.isLiveMode();
    this.isLiveMode.set(nextMode);
    this.fetchPCRData();
    this.snackBar.open(nextMode ? 'Live Tracking Mode Enabled' : 'Historical Snapshot Mode Enabled', 'OK', {
      duration: 2500,
      panelClass: nextMode ? 'success-snackbar' : 'warning-snackbar',
    });
  }

  /**
   * Threshold configuration updates
   */
  setThresholds(bullish: number, bearish: number): void {
    this.bullishThreshold.set(bullish);
    this.bearishThreshold.set(bearish);
    this.renderChartA(); // re-render reference lines
  }

  /**
   * Table Sorting & Pagination
   */
  sortTable(column: string): void {
    if (this.tableSortColumn() === column) {
      this.tableSortDirection.set(this.tableSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.tableSortColumn.set(column);
      this.tableSortDirection.set('desc');
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.tablePage.set(page);
    }
  }

  setPageSize(size: number): void {
    this.tablePageSize.set(size);
    this.tablePage.set(1);
  }

  /**
   * Export Table Data as CSV
   */
  exportCSV(): void {
    const data = this.filteredTableData();
    if (!data || data.length === 0) {
      this.snackBar.open('No data available to export', 'Close', { duration: 3000 });
      return;
    }

    const headers = [
      'Timestamp',
      'Spot Price',
      'Spot Change',
      'Put OI',
      'Call OI',
      'Put OI Change',
      'Call OI Change',
      'PCR',
      'PCR Change',
      'PCR Change %',
      'Trend',
    ];

    const rows = data.map((r) => [
      r.timestamp,
      r.spotPrice,
      r.spotChange,
      r.putOI,
      r.callOI,
      r.putOIChange,
      r.callOIChange,
      r.pcr !== null ? r.pcr : 'N/A',
      r.pcrChange,
      r.pcrChangePercent + '%',
      r.trend,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    const symbol = this.selectedSymbol();
    const date = this.selectedDate() || 'data';
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `PCR_Tracking_${symbol}_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.snackBar.open('CSV export downloaded successfully', 'OK', {
      duration: 3000,
      panelClass: 'success-snackbar',
    });
  }

  // =========================================================================
  // Chart.js Rendering Logic
  // =========================================================================

  private destroyCharts(): void {
    if (this.pcrTrendChart) {
      this.pcrTrendChart.destroy();
      this.pcrTrendChart = null;
    }
    if (this.oiCompChart) {
      this.oiCompChart.destroy();
      this.oiCompChart = null;
    }
    if (this.priceCompChart) {
      this.priceCompChart.destroy();
      this.priceCompChart = null;
    }
    if (this.oiChangeChart) {
      this.oiChangeChart.destroy();
      this.oiChangeChart = null;
    }
  }

  renderAllCharts(): void {
    const tab = this.activeChartTab();
    if (tab === 'all' || tab === 'pcr-trend') this.renderChartA();
    if (tab === 'all' || tab === 'oi-comp') this.renderChartB();
    if (tab === 'all' || tab === 'price-comp') this.renderChartC();
    if (tab === 'all' || tab === 'oi-change') this.renderChartD();
  }

  /**
   * Chart A: PCR Trend Chart (Line Chart over time with tooltips and trend points)
   */
  private renderChartA(): void {
    if (!this.pcrTrendCanvas?.nativeElement) return;
    if (this.pcrTrendChart) {
      this.pcrTrendChart.destroy();
      this.pcrTrendChart = null;
    }

    const intervals = this.intervals();
    if (intervals.length === 0) return;

    const labels = intervals.map((i) => i.timestamp);
    const pcrValues = intervals.map((i) => i.pcr);
    const pointColors = intervals.map((i) => {
      if (i.trend === 'Increasing') return '#10b981'; // green
      if (i.trend === 'Decreasing') return '#ef4444'; // red
      return '#6366f1'; // neutral indigo
    });

    const ctx = this.pcrTrendCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');

    const bullThresh = this.bullishThreshold();
    const bearThresh = this.bearishThreshold();

    this.pcrTrendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Put-Call Ratio (PCR)',
            data: pcrValues,
            borderColor: '#6366f1',
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: pointColors,
            pointBorderColor: '#ffffff',
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: `Bullish Threshold (${bullThresh.toFixed(2)})`,
            data: Array(labels.length).fill(bullThresh),
            borderColor: '#10b981',
            borderWidth: 1.5,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
          },
          {
            label: `Bearish Threshold (${bearThresh.toFixed(2)})`,
            data: Array(labels.length).fill(bearThresh),
            borderColor: '#ef4444',
            borderWidth: 1.5,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11, weight: 600 }, color: '#334155' },
          },
          tooltip: {
            callbacks: {
              afterLabel: (tooltipItem) => {
                if (tooltipItem.datasetIndex === 0) {
                  const idx = tooltipItem.dataIndex;
                  const item = intervals[idx];
                  return [
                    `Change: ${item.pcrChange > 0 ? '+' : ''}${item.pcrChange.toFixed(4)} (${item.pcrChangePercent}%)`,
                    `Trend: ${item.trend}`,
                  ];
                }
                return '';
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { color: '#64748b', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: (val) => Number(val).toFixed(2),
            },
          },
        },
      },
    });
  }

  /**
   * Chart B: Put OI vs Call OI Chart (Dual line / area comparison)
   */
  private renderChartB(): void {
    if (!this.oiCompCanvas?.nativeElement) return;
    if (this.oiCompChart) {
      this.oiCompChart.destroy();
      this.oiCompChart = null;
    }

    const intervals = this.intervals();
    if (intervals.length === 0) return;

    const labels = intervals.map((i) => i.timestamp);
    const putOIs = intervals.map((i) => i.putOI);
    const callOIs = intervals.map((i) => i.callOI);

    const ctx = this.oiCompCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.oiCompChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Put OI (Support Floor)',
            data: putOIs,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            borderWidth: 2.2,
            fill: true,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: 'Total Call OI (Resistance Ceiling)',
            data: callOIs,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderWidth: 2.2,
            fill: true,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11, weight: 600 }, color: '#334155' },
          },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                if (items.length >= 2) {
                  const put = items[0].raw as number;
                  const call = items[1].raw as number;
                  const diff = put - call;
                  return [`Net OI Diff (Put - Call): ${diff > 0 ? '+' : ''}${diff.toLocaleString('en-IN')}`];
                }
                return [];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { color: '#64748b', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: (val) => {
                const num = Number(val);
                if (num >= 10000000) return (num / 10000000).toFixed(1) + ' Cr';
                if (num >= 100000) return (num / 100000).toFixed(1) + ' L';
                return num.toLocaleString();
              },
            },
          },
        },
      },
    });
  }

  /**
   * Chart C: PCR and NIFTY Price Comparison (Dual-axis Line Chart)
   */
  private renderChartC(): void {
    if (!this.priceCompCanvas?.nativeElement) return;
    if (this.priceCompChart) {
      this.priceCompChart.destroy();
      this.priceCompChart = null;
    }

    const intervals = this.intervals();
    if (intervals.length === 0) return;

    const labels = intervals.map((i) => i.timestamp);
    const pcrValues = intervals.map((i) => i.pcr);
    const spotPrices = intervals.map((i) => i.spotPrice);

    const ctx = this.priceCompCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.priceCompChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'PCR (Left Axis)',
            data: pcrValues,
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2.4,
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: `${this.selectedSymbol()} Spot Price (Right Axis)`,
            data: spotPrices,
            borderColor: '#0284c7',
            backgroundColor: 'rgba(2, 132, 199, 0.08)',
            borderWidth: 2.4,
            yAxisID: 'y1',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11, weight: 600 }, color: '#334155' },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: { color: '#64748b', font: { size: 11 } },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Put-Call Ratio', color: '#8b5cf6', font: { weight: 700 } },
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: {
              color: '#8b5cf6',
              font: { size: 11 },
              callback: (val) => Number(val).toFixed(2),
            },
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Index Spot Price (₹)', color: '#0284c7', font: { weight: 700 } },
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#0284c7',
              font: { size: 11 },
              callback: (val) => Number(val).toLocaleString('en-IN'),
            },
          },
        },
      },
    });
  }

  /**
   * Chart D: OI Change & Strike Concentration Chart (Grouped Bars around ATM)
   */
  private renderChartD(): void {
    if (!this.oiChangeCanvas?.nativeElement) return;
    if (this.oiChangeChart) {
      this.oiChangeChart.destroy();
      this.oiChangeChart = null;
    }

    const dist = this.pcrData()?.oiDistribution || [];
    if (dist.length === 0) return;

    const labels = dist.map((d) => `${d.strikePrice}${d.isAtm ? ' (ATM)' : ''}`);
    const putChanges = dist.map((d) => d.putChangeOI);
    const callChanges = dist.map((d) => d.callChangeOI);

    const ctx = this.oiChangeCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.oiChangeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Put OI Change (Bullish addition when positive)',
            data: putChanges,
            backgroundColor: '#10b981',
            borderRadius: 3,
          },
          {
            label: 'Call OI Change (Bearish addition when positive)',
            data: callChanges,
            backgroundColor: '#ef4444',
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11, weight: 600 }, color: '#334155' },
          },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const strikeObj = dist[idx];
                return [
                  `Total Put OI: ${strikeObj.putOI.toLocaleString('en-IN')}`,
                  `Total Call OI: ${strikeObj.callOI.toLocaleString('en-IN')}`,
                  `Strike PCR: ${strikeObj.pcr !== null ? strikeObj.pcr.toFixed(2) : 'N/A'}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#64748b',
              font: { size: 10 },
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: (val) => {
                const num = Number(val);
                if (Math.abs(num) >= 10000000) return (num / 10000000).toFixed(1) + ' Cr';
                if (Math.abs(num) >= 100000) return (num / 100000).toFixed(1) + ' L';
                return num.toLocaleString();
              },
            },
          },
        },
      },
    });
  }

  // =========================================================================
  // Formatting Utilities
  // =========================================================================

  formatOI(val: number | undefined | null): string {
    if (val === null || val === undefined) return '0';
    return Number(val).toLocaleString('en-IN');
  }

  formatPCR(val: number | undefined | null): string {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toFixed(2);
  }

  formatPrice(val: number | undefined | null): string {
    if (val === null || val === undefined) return '0.00';
    return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
