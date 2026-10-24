import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MarketBreadthStock } from '../../../../models/market-breadth.model';

@Component({
  selector: 'app-stock-card',
  standalone: true,
  imports: [CommonModule, MatTooltipModule],
  templateUrl: './stock-card.component.html',
  styleUrls: ['./stock-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockCardComponent {
  @Input({ required: true }) stock!: MarketBreadthStock;

  get formattedPrice(): string {
    if (!this.stock || isNaN(this.stock.price)) return '₹ 0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.stock.price);
  }

  get formattedPercent(): string {
    if (!this.stock || isNaN(this.stock.changePercent)) return '0.00%';
    const sign = this.stock.changePercent > 0 ? '+' : '';
    return `${sign}${this.stock.changePercent.toFixed(2)}%`;
  }

  get formattedChange(): string {
    if (!this.stock || isNaN(this.stock.change)) return '₹0.00';
    const sign = this.stock.change > 0 ? '+' : this.stock.change < 0 ? '-' : '';
    const absVal = Math.abs(this.stock.change);
    return `${sign}₹${absVal.toFixed(2)}`;
  }

  getTooltipText(): string {
    if (!this.stock) return '';
    let text = `${this.stock.companyName || this.stock.symbol}\n`;
    text += `LTP: ${this.formattedPrice} (${this.formattedPercent})\n`;
    text += `Change: ${this.formattedChange}\n`;
    text += `Prev Close: ₹${this.stock.closePrice.toFixed(2)}`;
    if (this.stock.contributionPoints !== undefined && this.stock.contributionPoints !== null) {
      text += `\nIndex Contribution: ${this.stock.contributionPoints > 0 ? '+' : ''}${this.stock.contributionPoints} pts`;
    }
    return text;
  }

  getAriaLabel(): string {
    if (!this.stock) return '';
    return `${this.stock.symbol}, ${this.formattedPrice}, change ${this.formattedPercent}, ${this.stock.category}`;
  }
}
