import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StockCardComponent } from './stock-card.component';
import { MarketBreadthStock } from '../../../../models/market-breadth.model';

describe('StockCardComponent', () => {
  let component: StockCardComponent;
  let fixture: ComponentFixture<StockCardComponent>;

  const mockAdvanceStock: MarketBreadthStock = {
    symbol: 'RELIANCE',
    companyName: 'Reliance Industries Ltd.',
    price: 1190.0,
    closePrice: 1184.5,
    change: 5.5,
    changePercent: 0.46,
    contributionPoints: 7.9,
    category: 'advance',
    isPositive: 'Y',
  };

  const mockDeclineStock: MarketBreadthStock = {
    symbol: 'GRASIM',
    companyName: 'Grasim Industries Ltd.',
    price: 2894.0,
    closePrice: 2894.4,
    change: -0.4,
    changePercent: -0.01,
    contributionPoints: -0.03,
    category: 'decline',
    isPositive: 'N',
  };

  const mockUnchangedStock: MarketBreadthStock = {
    symbol: 'NTPC',
    companyName: 'NTPC Ltd.',
    price: 350.0,
    closePrice: 350.0,
    change: 0.0,
    changePercent: 0.0,
    category: 'unchanged',
    isPositive: 'N',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StockCardComponent);
    component = fixture.componentInstance;
  });

  it('should create the stock card', () => {
    component.stock = mockAdvanceStock;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render symbol in top-left and price in bottom-left and % in bottom-right', () => {
    component.stock = mockAdvanceStock;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const symbol = el.querySelector('.stock-symbol')?.textContent?.trim();
    const price = el.querySelector('.stock-price')?.textContent?.trim();
    const percent = el.querySelector('.stock-percent')?.textContent?.trim();

    expect(symbol).toBe('RELIANCE');
    expect(price).toContain('1,190.00');
    expect(percent).toBe('+0.46%');
  });

  it('should apply positive class for advance stock', () => {
    component.stock = mockAdvanceStock;
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.stock-card');
    expect(card.classList.contains('positive')).toBe(true);
    expect(card.classList.contains('negative')).toBe(false);
  });

  it('should apply negative class for decline stock', () => {
    component.stock = mockDeclineStock;
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.stock-card');
    expect(card.classList.contains('negative')).toBe(true);
    expect(card.classList.contains('positive')).toBe(false);
  });

  it('should apply neutral class for unchanged stock', () => {
    component.stock = mockUnchangedStock;
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.stock-card');
    expect(card.classList.contains('neutral')).toBe(true);
  });
});
