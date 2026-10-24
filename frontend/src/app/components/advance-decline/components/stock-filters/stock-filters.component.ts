import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FilterCategory,
  IndexOption,
  SortDirection,
  SortField,
} from '../../../../models/market-breadth.model';

@Component({
  selector: 'app-stock-filters',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './stock-filters.component.html',
  styleUrls: ['./stock-filters.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockFiltersComponent {
  @Input({ required: true }) searchTerm: string = '';
  @Input({ required: true }) selectedCategory: FilterCategory = 'all';
  @Input({ required: true }) sortField: SortField = 'changePercent';
  @Input({ required: true }) sortDirection: SortDirection = 'desc';
  @Input() counts = { all: 0, advance: 0, decline: 0, unchanged: 0 };
  @Input() lastUpdated: Date | null = null;
  @Input() isRefreshing: boolean = false;
  @Input() selectedIndex: string = 'NIFTY 50';
  @Input() availableIndices: IndexOption[] = [
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
  @Input() autoRefreshEnabled: boolean = true;
  @Input() countdown: number = 30;
  @Input() density: 'dense' | 'standard' | 'cozy' = 'dense';

  @Output() searchChange = new EventEmitter<string>();
  @Output() categoryChange = new EventEmitter<FilterCategory>();
  @Output() sortFieldChange = new EventEmitter<SortField>();
  @Output() sortDirectionToggle = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() indexChange = new EventEmitter<string>();
  @Output() autoRefreshToggle = new EventEmitter<void>();
  @Output() densityChange = new EventEmitter<'dense' | 'standard' | 'cozy'>();

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchChange.emit(val);
  }

  clearSearch(): void {
    this.searchChange.emit('');
  }

  setCategory(cat: FilterCategory): void {
    this.categoryChange.emit(cat);
  }

  setSortField(field: SortField): void {
    this.sortFieldChange.emit(field);
  }

  toggleDirection(): void {
    this.sortDirectionToggle.emit();
  }

  onIndexSelect(val: string): void {
    this.indexChange.emit(val);
  }

  onRefresh(): void {
    if (!this.isRefreshing) {
      this.refreshClick.emit();
    }
  }

  onToggleAutoRefresh(): void {
    this.autoRefreshToggle.emit();
  }

  setDensity(d: 'dense' | 'standard' | 'cozy'): void {
    this.densityChange.emit(d);
  }
}
