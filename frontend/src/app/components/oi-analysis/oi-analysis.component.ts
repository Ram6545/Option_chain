import { Component, signal, computed, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
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
import { OptionChainService } from '../../services/option-chain.service';
import {
  OIAnalysisResponse,
  IndicesResponse,
  Sentiment,
} from '../../models/option-chain.model';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-oi-analysis',
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
  ],
  templateUrl: './oi-analysis.component.html',
  styleUrls: ['./oi-analysis.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OIAnalysisComponent implements OnInit, OnDestroy {
  private optionChainService = inject(OptionChainService);
  private snackBar = inject(MatSnackBar);

  // Signals
  analysisData = signal<OIAnalysisResponse['data'] | null>(null);
  indices = signal<IndicesResponse['data'] | null>(null);
  selectedSymbol = signal<string>('NIFTY');
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  autoRefreshEnabled = signal<boolean>(true);

  private refreshSubscription: Subscription | null = null;

  // Computed properties
  sentiment = computed(() => this.analysisData()?.sentiment || null);
  pcr = computed(() => this.analysisData()?.pcr || null);
  totalOI = computed(() => this.analysisData()?.totalOI || null);
  totalVolume = computed(() => this.analysisData()?.totalVolume || null);
  maxOISTrikes = computed(() => this.analysisData()?.maxOISTrikes || null);
  oiChange = computed(() => this.analysisData()?.oiChange || null);
  supportResistance = computed(() => this.analysisData()?.supportResistance || null);
  maxPain = computed(() => this.analysisData()?.maxPain || null);
  atmOIAnalysis = computed(() => this.analysisData()?.atmOIAnalysis || null);
  underlyingPrice = computed(() => this.analysisData()?.underlyingPrice || 0);
  timestamp = computed(() => this.analysisData()?.timestamp || null);

  // Computed: sentiment color
  sentimentColor = computed(() => {
    const s = this.sentiment();
    if (!s) return 'neutral';
    if (s.overall.includes('bullish')) return 'bullish';
    if (s.overall.includes('bearish')) return 'bearish';
    return 'neutral';
  });

  // Computed: sentiment icon
  sentimentIcon = computed(() => {
    const s = this.sentiment();
    if (!s) return 'help';
    if (s.overall === 'strongly_bullish') return 'trending_up';
    if (s.overall === 'bullish') return 'trending_up';
    if (s.overall === 'strongly_bearish') return 'trending_down';
    if (s.overall === 'bearish') return 'trending_down';
    return 'trending_flat';
  });

  // Computed: sentiment text
  sentimentText = computed(() => {
    const s = this.sentiment();
    if (!s) return 'N/A';
    const textMap: { [key: string]: string } = {
      strongly_bullish: 'Strongly Bullish',
      bullish: 'Bullish',
      neutral: 'Neutral',
      bearish: 'Bearish',
      strongly_bearish: 'Strongly Bearish',
    };
    return textMap[s.overall] || s.overall;
  });

  ngOnInit(): void {
    this.loadIndices();
    this.loadAnalysis();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }
  }

  loadIndices(): void {
    this.optionChainService.getIndices().subscribe({
      next: (response) => {
        this.indices.set(response.data);
      },
      error: (err) => {
        console.error('Error loading indices:', err);
      },
    });
  }

  loadAnalysis(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.optionChainService.getOIAnalysis(this.selectedSymbol()).subscribe({
      next: (response) => {
        this.analysisData.set(response.data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load OI analysis');
        this.isLoading.set(false);
        console.error('Error loading OI analysis:', err);
      },
    });
  }

  changeSymbol(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.loadAnalysis();
  }

  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.set(!this.autoRefreshEnabled());
    if (this.autoRefreshEnabled()) {
      this.snackBar.open('Auto-refresh enabled', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Auto-refresh disabled', 'Close', { duration: 2000 });
    }
  }

  setupAutoRefresh(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }

    this.refreshSubscription = interval(30000).subscribe(() => {
      if (this.autoRefreshEnabled()) {
        this.loadAnalysis();
      }
    });
  }

  formatNumber(num: number | null | undefined): string {
    if (num === null || num === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(Math.round(num));
  }

  formatDecimal(num: number | null | undefined, decimals: number = 2): string {
    if (num === null || num === undefined) return '-';
    return num.toFixed(decimals);
  }

  getSignalIcon(type: string): string {
    if (type === 'bullish') return 'trending_up';
    if (type === 'bearish') return 'trending_down';
    return 'trending_flat';
  }

  getSignalColor(type: string): string {
    if (type === 'bullish') return 'bullish';
    if (type === 'bearish') return 'bearish';
    return 'neutral';
  }

  getSymbolDisplayName(symbol: string): string {
    const displayNames: { [key: string]: string } = {
      NIFTY: 'NIFTY 50',
      BANKNIFTY: 'NIFTY Bank',
    };
    return displayNames[symbol] || symbol;
  }
}
