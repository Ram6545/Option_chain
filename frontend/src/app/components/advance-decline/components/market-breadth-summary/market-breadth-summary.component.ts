import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MarketBreadthSummaryData } from '../../../../models/market-breadth.model';

@Component({
  selector: 'app-market-breadth-summary',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './market-breadth-summary.component.html',
  styleUrls: ['./market-breadth-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketBreadthSummaryComponent {
  @Input({ required: true }) summary!: MarketBreadthSummaryData | null;
  @Input() indexName: string = 'NIFTY 50';

  get sentimentClass(): string {
    if (!this.summary) return 'neutral';
    if (this.summary.adRatio >= 1.2) return 'bullish';
    if (this.summary.adRatio <= 0.8) return 'bearish';
    return 'neutral';
  }

  get sentimentLabel(): string {
    if (!this.summary) return 'Neutral';
    if (this.summary.adRatio >= 1.2) return 'Bullish Breadth';
    if (this.summary.adRatio <= 0.8) return 'Bearish Breadth';
    return 'Neutral Breadth';
  }

  get formattedRatio(): string {
    if (!this.summary) return '0.00';
    if (this.summary.declines === 0) {
      return this.summary.advances > 0 ? `${this.summary.advances}.00` : '1.00';
    }
    return this.summary.adRatio.toFixed(2);
  }
}
