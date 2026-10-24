import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Subject, Subscription, timer } from 'rxjs';
import { takeUntil, switchMap } from 'rxjs/operators';
import { MarketDataService } from '../../services/market-data.service';
import {
  FilterCategory,
  IndexOption,
  MarketBreadthResponse,
  MarketBreadthStock,
  MarketBreadthSummaryData,
  SortDirection,
  SortField,
} from '../../models/market-breadth.model';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { MarketBreadthSummaryComponent } from './components/market-breadth-summary/market-breadth-summary.component';
import { StockFiltersComponent } from './components/stock-filters/stock-filters.component';
import { OptionVWAPComponent } from '../option-vwap/option-vwap.component';

@Component({
  selector: 'app-advance-decline',
  standalone: true,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    StockCardComponent,
    MarketBreadthSummaryComponent,
    StockFiltersComponent,
    OptionVWAPComponent,
  ],
  templateUrl: './advance-decline.component.html',
  styleUrls: ['./advance-decline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvanceDeclineComponent implements OnInit, OnDestroy {
  private marketDataService = inject(MarketDataService);
  private destroy$ = new Subject<void>();
  private autoRefreshSub: Subscription | null = null;
  private countdownSub: Subscription | null = null;

  // Option Chain VWAP integration toggle
  showVwap = signal<boolean>(false);

  toggleVwap(): void {
    this.showVwap.update((v) => !v);
  }

  // Primary State Signals
  stocks = signal<MarketBreadthStock[]>([]);
  summary = signal<MarketBreadthSummaryData | null>(null);
  selectedIndex = signal<string>('NIFTY 50');
  lastUpdated = signal<Date | null>(null);

  // UI & Request Signals
  isLoading = signal<boolean>(true);
  isRefreshing = signal<boolean>(false);
  errorMessage = signal<string | null>(null);

  // Filter, Sort & Layout Signals
  searchTerm = signal<string>('');
  selectedCategory = signal<FilterCategory>('all');
  sortField = signal<SortField>('changePercent');
  sortDirection = signal<SortDirection>('desc');
  density = signal<'dense' | 'standard' | 'cozy'>('dense');

  // Auto Refresh Settings
  autoRefreshEnabled = signal<boolean>(true);
  autoRefreshInterval = signal<number>(30); // 30 seconds
  countdown = signal<number>(30);

  // Available Indices
  availableIndices: IndexOption[] = [
    { symbol: 'NIFTY 50', name: 'NIFTY 50', displayName: 'NIFTY 50' },
    { symbol: 'NIFTY BANK', name: 'NIFTY BANK', displayName: 'BANK NIFTY' },
    { symbol: 'NIFTY NEXT 50', name: 'NIFTY NEXT 50', displayName: 'NIFTY NEXT 50' },
    { symbol: 'NIFTY MIDCAP 50', name: 'NIFTY MIDCAP 50', displayName: 'MIDCAP 50' },
    { symbol: 'NIFTY IT', name: 'NIFTY IT', displayName: 'NIFTY IT' },
    { symbol: 'NIFTY AUTO', name: 'NIFTY AUTO', displayName: 'NIFTY AUTO' },
    { symbol: 'NIFTY FMCG', name: 'NIFTY FMCG', displayName: 'NIFTY FMCG' },
    { symbol: 'NIFTY METAL', name: 'NIFTY METAL', displayName: 'NIFTY METAL' },
    { symbol: 'NIFTY PHARMA', name: 'NIFTY PHARMA', displayName: 'NIFTY PHARMA' },
  ];

  // Category counts computed from raw stock data
  categoryCounts = computed(() => {
    const list = this.stocks();
    const advance = list.filter((s) => s.category === 'advance').length;
    const decline = list.filter((s) => s.category === 'decline').length;
    const unchanged = list.filter((s) => s.category === 'unchanged').length;
    return {
      all: list.length,
      advance,
      decline,
      unchanged,
    };
  });

  // Filtered & Sorted Stocks for rendering
  filteredStocks = computed(() => {
    let list = [...this.stocks()];
    const query = this.searchTerm().trim().toLowerCase();
    const cat = this.selectedCategory();
    const field = this.sortField();
    const dir = this.sortDirection();

    // 1. Filter by category
    if (cat !== 'all') {
      list = list.filter((s) => s.category === cat);
    }

    // 2. Filter by search query (symbol or companyName)
    if (query) {
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(query) ||
          s.companyName.toLowerCase().includes(query)
      );
    }

    // 3. Sorting
    list.sort((a, b) => {
      let comparison = 0;
      if (field === 'symbol') {
        comparison = a.symbol.localeCompare(b.symbol);
      } else if (field === 'price') {
        comparison = a.price - b.price;
      } else if (field === 'changePercent') {
        comparison = a.changePercent - b.changePercent;
      }
      return dir === 'desc' ? -comparison : comparison;
    });

    return list;
  });

  ngOnInit(): void {
    this.fetchData(false);
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopAutoRefresh();
  }

  /**
   * Fetch market breadth data from the service.
   */
  fetchData(isManualRefresh: boolean = false): void {
    if (isManualRefresh) {
      this.isRefreshing.set(true);
    } else if (this.stocks().length === 0) {
      this.isLoading.set(true);
    }

    this.errorMessage.set(null);

    this.marketDataService
      .getMarketBreadth(this.selectedIndex(), isManualRefresh)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: MarketBreadthResponse) => {
          this.stocks.set(res.data);
          this.summary.set(res.summary);
          this.lastUpdated.set(new Date(res.timestamp));
          this.isLoading.set(false);
          this.isRefreshing.set(false);
          this.resetCountdown();
        },
        error: (err: any) => {
          console.error('Failed to load market breadth:', err);
          this.errorMessage.set(
            err.message || 'Unable to connect to market breadth API. Please check backend service.'
          );
          this.isLoading.set(false);
          this.isRefreshing.set(false);
        },
      });
  }

  /**
   * Handle user manual refresh request
   */
  onManualRefresh(): void {
    this.fetchData(true);
  }

  /**
   * Handle index change
   */
  onIndexChange(index: string): void {
    if (index !== this.selectedIndex()) {
      this.selectedIndex.set(index);
      this.fetchData(false);
    }
  }

  /**
   * Handle category filter change
   */
  onCategoryChange(cat: FilterCategory): void {
    this.selectedCategory.set(cat);
  }

  /**
   * Handle search text change
   */
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  /**
   * Handle sort field change
   */
  onSortFieldChange(field: SortField): void {
    this.sortField.set(field);
  }

  /**
   * Toggle sort direction
   */
  onSortDirectionToggle(): void {
    this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
  }

  onDensityChange(d: 'dense' | 'standard' | 'cozy'): void {
    this.density.set(d);
  }

  /**
   * Toggle auto-refresh on/off
   */
  onAutoRefreshToggle(): void {
    const nextVal = !this.autoRefreshEnabled();
    this.autoRefreshEnabled.set(nextVal);
    if (nextVal) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  /**
   * Clear all active search and category filters
   */
  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedCategory.set('all');
  }

  /**
   * Setup auto-refresh and countdown timer
   */
  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.autoRefreshEnabled()) return;

    this.countdown.set(this.autoRefreshInterval());

    // 1-second interval for ticker countdown
    this.countdownSub = timer(1000, 1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const cur = this.countdown();
        if (cur > 1) {
          this.countdown.set(cur - 1);
        } else {
          this.countdown.set(this.autoRefreshInterval());
          this.fetchData(true);
        }
      });
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
      this.autoRefreshSub = null;
    }
    if (this.countdownSub) {
      this.countdownSub.unsubscribe();
      this.countdownSub = null;
    }
  }

  private resetCountdown(): void {
    this.countdown.set(this.autoRefreshInterval());
  }
}
