import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarketBreadthSummaryComponent } from './market-breadth-summary.component';
import { MarketBreadthSummaryData } from '../../../../models/market-breadth.model';

describe('MarketBreadthSummaryComponent', () => {
  let component: MarketBreadthSummaryComponent;
  let fixture: ComponentFixture<MarketBreadthSummaryComponent>;

  const mockSummary: MarketBreadthSummaryData = {
    total: 50,
    advances: 14,
    declines: 36,
    unchanged: 0,
    adRatio: 0.39,
    advancePercent: 28.0,
    declinePercent: 72.0,
    unchangedPercent: 0.0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarketBreadthSummaryComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarketBreadthSummaryComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    component.summary = mockSummary;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render correct counts for advances, declines, and total', () => {
    component.summary = mockSummary;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.advance-pill .pill-count')?.textContent?.trim()).toBe('14');
    expect(el.querySelector('.decline-pill .pill-count')?.textContent?.trim()).toBe('36');
    expect(el.querySelector('.total-pill .pill-count')?.textContent?.trim()).toBe('50');
    expect(el.querySelector('.ratio-pill .pill-count')?.textContent?.trim()).toBe('0.39');
  });

  it('should render breadth progress bar segments with correct widths', () => {
    component.summary = mockSummary;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const advSegment = el.querySelector('.advance-segment') as HTMLElement;
    const decSegment = el.querySelector('.decline-segment') as HTMLElement;

    expect(advSegment.style.width).toBe('28%');
    expect(decSegment.style.width).toBe('72%');
  });

  it('should handle zero declines safely without division by zero', () => {
    component.summary = {
      total: 50,
      advances: 50,
      declines: 0,
      unchanged: 0,
      adRatio: 50,
      advancePercent: 100,
      declinePercent: 0,
      unchangedPercent: 0,
    };
    fixture.detectChanges();

    expect(component.formattedRatio).toBe('50.00');
    expect(component.sentimentClass).toBe('bullish');
  });
});
