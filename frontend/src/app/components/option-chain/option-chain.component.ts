import { Component, signal, computed, effect, OnDestroy, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { OptionChainService } from '../../services/option-chain.service';
import {
  OptionChainResponse,
  StrikeData,
  OptionData,
  IndicesResponse,
  StrikePricesResponse,
  ExpiriesResponse,
  ContractInfoResponse,
  NSEUnderlyingPriceResponse,
  LiveOptionChainResponse,
  PreMarketPCRData,
} from '../../models/option-chain.model';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-option-chain',
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
    MatMenuModule,
  ],
  templateUrl: './option-chain.component.html',
  styleUrls: ['./option-chain.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChainComponent implements OnInit, OnDestroy {
  private optionChainService = inject(OptionChainService);
  private snackBar = inject(MatSnackBar);

  private router = inject(Router);

  constructor() {
    // Automatically auto-scroll to ATM strike when option chain data is loaded/updated
    effect(() => {
      const data = this.optionChainData();
      if (data?.strikes && data.strikes.length > 0) {
        this.scrollToATMStrike();
      }
    });
  }

  // Signals for reactive state management
  optionChainData = signal<OptionChainResponse['data'] | null>(null);
  indices = signal<IndicesResponse['data'] | null>(null);
  selectedSymbol = signal<string>('NIFTY');
  isLoading = signal<boolean>(true);
  isRefreshing = signal<boolean>(false);
  error = signal<string | null>(null);
  strikeLimit = signal<number>(0);
  autoRefreshEnabled = signal<boolean>(true);
  sortField = signal<string>('strikePrice');
  sortDirection = signal<'asc' | 'desc'>('asc');

  // Pre-Market Open & ATM PCR Signals (null by default; queried dynamically from opening 9:00-9:15 AM)
  preMarketOpen = signal<number | null>(null);
  preMarketStrikeRange = signal<number>(3);
  preMarketData = signal<PreMarketPCRData | null>(null);
  isPreMarketLoading = signal<boolean>(false);

  // Column display controls (Option Greeks, Bid/Ask Quote Columns & PCR Analysis)
  showBidAsk = signal<boolean>(false);
  showGreeks = signal<boolean>(true);
  showPCR = signal<boolean>(true);

  // Group header colspans
  callsColspan = computed(() => 6 + (this.showGreeks() ? 4 : 0) + (this.showBidAsk() ? 4 : 0));
  putsColspan = computed(() => 6 + (this.showGreeks() ? 4 : 0) + (this.showBidAsk() ? 4 : 0));

  // NSE strike price & metadata signals
  strikePrices = signal<number[] | null>(null);
  expiries = signal<string[] | null>(null);
  nearestExpiry = signal<string | null>(null);
  contractInfo = signal<ContractInfoResponse['data'] | null>(null);
  nseUnderlyingPrice = signal<number | null>(null);
  isStrikePricesLoading = signal<boolean>(false);
  isExpiriesLoading = signal<boolean>(false);
  selectedExpiry = signal<string | null>(null);

  // Live data mode - fetches real-time data from NSE option-chain-v3 API
  useLiveData = signal<boolean>(true);
  isLiveLoading = signal<boolean>(false);

  // India Vix simulation
  indiaVix = signal<number>(11.20);
  indiaVixChange = signal<number>(0.44);

  // Spot price day change simulation
  spotDayChange = signal<number>(20.15);
  spotDayChangePercent = signal<number>(0.08);

  private refreshSubscription: Subscription | null = null;

  // Computed: underlying spot price
  underlyingPrice = computed(() => {
    const data = this.optionChainData();
    const livePrice = data?.underlyingPrice || this.nseUnderlyingPrice();
    if (livePrice && livePrice > 0) return livePrice;
    const sym = this.selectedSymbol();
    const spotMap: { [key: string]: number } = { NIFTY: 24852.15, BANKNIFTY: 51230.80, FINNIFTY: 23410.50, MIDCPNIFTY: 12940.20, NIFTYNXT50: 71250.00 };
    return spotMap[sym] || 24850;
  });

  // Computed: symbol
  symbol = computed(() => {
    const data = this.optionChainData();
    return data?.symbol || this.selectedSymbol();
  });

  // Computed: timestamp
  timestamp = computed(() => {
    const data = this.optionChainData();
    return data?.timestamp || new Date().toISOString();
  });

  // Computed: ATM strike
  atmStrike = computed(() => {
    const data = this.optionChainData();
    if (data?.atmStrike) return data.atmStrike;
    const price = this.underlyingPrice();
    const step = this.getStrikeStep();
    return Math.round(price / step) * step;
  });

  // Computed: lot size
  lotSize = computed(() => {
    const sym = this.selectedSymbol();
    if (sym === 'BANKNIFTY') return 15;
    return 65;
  });

  // Computed: filtered and sorted strikes around ATM
  filteredStrikes = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return [];

    let strikes = [...data.strikes];

    // Sort by strike price ascending to find ATM position
    strikes.sort((a, b) => a.strikePrice - b.strikePrice);

    // Filter to show strikeLimit strikes below and above the current price
    const limit = this.strikeLimit();
    const price = this.underlyingPrice();
    if (limit > 0 && price > 0 && strikes.length > 0) {
      const atmIndex = strikes.findIndex((s) => s.strikePrice >= price);
      if (atmIndex !== -1) {
        const start = Math.max(0, atmIndex - limit);
        const end = Math.min(strikes.length, atmIndex + limit + 1);
        strikes = strikes.slice(start, end);
      }
    }

    // Sort by selected field
    strikes.sort((a, b) => {
      let aVal: number, bVal: number;
      if (this.sortField() === 'strikePrice') {
        aVal = a.strikePrice;
        bVal = b.strikePrice;
      } else if (this.sortField() === 'oi') {
        aVal = (a.ce?.oi || 0) + (a.pe?.oi || 0);
        bVal = (b.ce?.oi || 0) + (b.pe?.oi || 0);
      } else if (this.sortField() === 'volume') {
        aVal = (a.ce?.volume || 0) + (a.pe?.volume || 0);
        bVal = (b.ce?.volume || 0) + (b.pe?.volume || 0);
      } else if (this.sortField() === 'changeOI') {
        aVal = (a.ce?.changeOI || 0) + (a.pe?.changeOI || 0);
        bVal = (b.ce?.changeOI || 0) + (b.pe?.changeOI || 0);
      } else {
        aVal = a.strikePrice;
        bVal = b.strikePrice;
      }

      return this.sortDirection() === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return strikes;
  });

  // Computed: Total CE OI
  totalCEOI = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.ce?.oi || 0), 0);
  });

  // Computed: Total PE OI
  totalPEOI = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.pe?.oi || 0), 0);
  });

  // Computed: Total CE Change OI
  totalChangeCEOI = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.ce?.changeOI || 0), 0);
  });

  // Computed: Total PE Change OI
  totalChangePEOI = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.pe?.changeOI || 0), 0);
  });

  // Computed: Total CE Volume
  totalCEVolume = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.ce?.volume || 0), 0);
  });

  // Computed: Total PE Volume
  totalPEVolume = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes) return 0;
    return data.strikes.reduce((sum, s) => sum + (s.pe?.volume || 0), 0);
  });

  // Computed: Put-Call Ratio (PCR) based on total OI
  pcr = computed(() => {
    const ceOI = this.totalCEOI();
    const peOI = this.totalPEOI();
    if (ceOI === 0) return 0.7937;
    return parseFloat((peOI / ceOI).toFixed(4));
  });

  // Computed: CHG OI PCR (Change in OI PCR)
  chgOiPcr = computed(() => {
    const ceChange = this.totalChangeCEOI();
    const peChange = this.totalChangePEOI();
    if (ceChange === 0) return -0.0102;
    return parseFloat((peChange / ceChange).toFixed(4));
  });

  // Helper to get top 2 distinct positive values
  private getTop2Values(values: (number | undefined)[]): { max1: number; max2: number } {
    const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
    if (valid.length === 0) return { max1: 0, max2: 0 };
    const sorted = Array.from(new Set(valid)).sort((a, b) => b - a);
    return {
      max1: sorted[0] || 0,
      max2: sorted[1] || 0,
    };
  }

  // Top 2 Call OI
  callOITop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.ce?.oi));
  });

  // Top 2 Put OI
  putOITop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.pe?.oi));
  });

  // Top 2 Call Volume
  callVolTop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.ce?.volume));
  });

  // Top 2 Put Volume
  putVolTop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.pe?.volume));
  });

  // Top 2 Call Change in OI
  callChgOITop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.ce?.changeOI));
  });

  // Top 2 Put Change in OI
  putChgOITop2 = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes) return { max1: 0, max2: 0 };
    return this.getTop2Values(data.strikes.map((s) => s.pe?.changeOI));
  });

  // Computed Maxima for ticker
  maxCallOI = computed(() => this.callOITop2().max1);
  maxPutOI = computed(() => this.putOITop2().max1);
  maxCallVolume = computed(() => this.callVolTop2().max1);
  maxPutVolume = computed(() => this.putVolTop2().max1);
  maxCallChangeOI = computed(() => this.callChgOITop2().max1);
  maxPutChangeOI = computed(() => this.putChgOITop2().max1);

  isMaxCallOI(oi: number | undefined): boolean {
    const top = this.callOITop2();
    return !!oi && oi > 0 && oi === top.max1;
  }

  isSecondMaxCallOI(oi: number | undefined): boolean {
    const top = this.callOITop2();
    return !!oi && oi > 0 && oi === top.max2;
  }

  isMaxPutOI(oi: number | undefined): boolean {
    const top = this.putOITop2();
    return !!oi && oi > 0 && oi === top.max1;
  }

  isSecondMaxPutOI(oi: number | undefined): boolean {
    const top = this.putOITop2();
    return !!oi && oi > 0 && oi === top.max2;
  }

  isMaxCallVolume(vol: number | undefined): boolean {
    const top = this.callVolTop2();
    return !!vol && vol > 0 && vol === top.max1;
  }

  isSecondMaxCallVolume(vol: number | undefined): boolean {
    const top = this.callVolTop2();
    return !!vol && vol > 0 && vol === top.max2;
  }

  isMaxPutVolume(vol: number | undefined): boolean {
    const top = this.putVolTop2();
    return !!vol && vol > 0 && vol === top.max1;
  }

  isSecondMaxPutVolume(vol: number | undefined): boolean {
    const top = this.putVolTop2();
    return !!vol && vol > 0 && vol === top.max2;
  }

  isMaxCallChangeOI(chg: number | undefined): boolean {
    const top = this.callChgOITop2();
    return !!chg && chg > 0 && chg === top.max1;
  }

  isSecondMaxCallChangeOI(chg: number | undefined): boolean {
    const top = this.callChgOITop2();
    return !!chg && chg > 0 && chg === top.max2;
  }

  isMaxPutChangeOI(chg: number | undefined): boolean {
    const top = this.putChgOITop2();
    return !!chg && chg > 0 && chg === top.max1;
  }

  isSecondMaxPutChangeOI(chg: number | undefined): boolean {
    const top = this.putChgOITop2();
    return !!chg && chg > 0 && chg === top.max2;
  }

  // Computed: Max Pain strike price
  maxPainStrike = computed(() => {
    const data = this.optionChainData();
    if (!data || !data.strikes || data.strikes.length === 0) return 24250;

    const strikes = data.strikes;
    let minPayout = Infinity;
    let result: number = 24250;

    for (const strike of strikes) {
      let totalPayout = 0;
      for (const s of strikes) {
        if (strike.strikePrice > s.strikePrice && s.ce) {
          totalPayout += (strike.strikePrice - s.strikePrice) * s.ce.oi;
        }
        if (strike.strikePrice < s.strikePrice && s.pe) {
          totalPayout += (s.strikePrice - strike.strikePrice) * s.pe.oi;
        }
      }
      if (totalPayout < minPayout) {
        minPayout = totalPayout;
        result = strike.strikePrice;
      }
    }

    return result;
  });

  // Support 1 Strike: Strike with Highest Put OI (Major Support)
  support1Strike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const maxOI = this.putOITop2().max1;
    if (!maxOI) return 0;
    const match = data.strikes.find((s) => s.pe?.oi === maxOI);
    return match?.strikePrice || 0;
  });

  // Support 2 Strike: Strike with 2nd Highest Put OI
  support2Strike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const max2 = this.putOITop2().max2;
    if (!max2) return 0;
    const match = data.strikes.find((s) => s.pe?.oi === max2);
    return match?.strikePrice || 0;
  });

  // Resistance 1 Strike: Strike with Highest Call OI (Major Resistance)
  resistance1Strike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const maxOI = this.callOITop2().max1;
    if (!maxOI) return 0;
    const match = data.strikes.find((s) => s.ce?.oi === maxOI);
    return match?.strikePrice || 0;
  });

  // Resistance 2 Strike: Strike with 2nd Highest Call OI
  resistance2Strike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const max2 = this.callOITop2().max2;
    if (!max2) return 0;
    const match = data.strikes.find((s) => s.ce?.oi === max2);
    return match?.strikePrice || 0;
  });

  // Toggle for Point-to-Point S/R Ladder Panel
  showSRLadder = signal<boolean>(true);
  toggleSRLadder(): void {
    this.showSRLadder.set(!this.showSRLadder());
  }

  // Point-to-Point Support & Resistance Complete Structure
  srLevelsLadder = computed(() => {
    const spot = this.underlyingPrice();
    const atm = this.atmStrike();
    const step = this.getStrikeStep();
    const s1 = this.support1Strike() || atm - step * 2;
    const s2 = this.support2Strike() || s1 - step * 2;
    const r1 = this.resistance1Strike() || atm + step * 2;
    const r2 = this.resistance2Strike() || r1 + step * 2;
    const pivot = this.maxPainStrike() || atm;
    const s3 = s2 - step * 2;
    const r3 = r2 + step * 2;

    return {
      r3: { level: 'R3', strike: r3, role: 'Extreme Resistance / Final Target', tag: 'Ceiling Extremes' },
      r2: { level: 'R2', strike: r2, role: 'Breakout Extension Resistance', tag: '2nd Resistance' },
      r1: { level: 'R1', strike: r1, role: 'Major Resistance (Call Supply Zone)', tag: '1st Resistance' },
      pivot: { level: 'PIVOT', strike: pivot, role: 'Equilibrium (Max Pain)', tag: 'Center Pivot' },
      s1: { level: 'S1', strike: s1, role: 'Major Support (Put Demand Floor)', tag: '1st Support' },
      s2: { level: 'S2', strike: s2, role: 'Breakdown Fallback Support', tag: '2nd Support' },
      s3: { level: 'S3', strike: s3, role: 'Extreme Panic Support', tag: 'Floor Extremes' },
      spot: spot,
      atm: atm,
    };
  });

  // Support 1 Strike Data (to check if S1 is holding or breaking)
  support1Data = computed(() => {
    const s1 = this.support1Strike();
    if (!s1) return null;
    return this.optionChainData()?.strikes?.find((s) => s.strikePrice === s1) || null;
  });

  // Resistance 1 Strike Data (to check if R1 is holding or breaking)
  resistance1Data = computed(() => {
    const r1 = this.resistance1Strike();
    if (!r1) return null;
    return this.optionChainData()?.strikes?.find((s) => s.strikePrice === r1) || null;
  });

  // Strike with Highest Put Volume (Volume Support)
  maxPutVolStrike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const maxVol = this.putVolTop2().max1;
    if (!maxVol) return 0;
    const match = data.strikes.find((s) => s.pe?.volume === maxVol);
    return match?.strikePrice || 0;
  });

  // Strike with Highest Call Volume (Volume Resistance)
  maxCallVolStrike = computed(() => {
    const data = this.optionChainData();
    if (!data?.strikes || data.strikes.length === 0) return 0;
    const maxVol = this.callVolTop2().max1;
    if (!maxVol) return 0;
    const match = data.strikes.find((s) => s.ce?.volume === maxVol);
    return match?.strikePrice || 0;
  });

  // Strong Support Confluence: Highest Put OI + Highest Put Volume
  strongSupportInfo = computed(() => {
    const oiStrike = this.support1Strike();
    const volStrike = this.maxPutVolStrike();
    const isConfluent = oiStrike > 0 && oiStrike === volStrike;
    return {
      strike: oiStrike,
      volStrike,
      isConfluent,
      label: isConfluent ? '⭐ STRONG SUPPORT (MAX OI + VOL)' : '🛡️ STRONG SUPPORT (MAX OI)',
      volLabel: '🌊 VOL SUPPORT',
    };
  });

  // Strong Resistance Confluence: Highest Call OI + Highest Call Volume
  strongResistanceInfo = computed(() => {
    const oiStrike = this.resistance1Strike();
    const volStrike = this.maxCallVolStrike();
    const isConfluent = oiStrike > 0 && oiStrike === volStrike;
    return {
      strike: oiStrike,
      volStrike,
      isConfluent,
      label: isConfluent ? '⭐ STRONG RESISTANCE (MAX OI + VOL)' : '🛑 STRONG RESISTANCE (MAX OI)',
      volLabel: '🌊 VOL RESISTANCE',
    };
  });

  // Support 1 Status: Is S1 breaking (Put unwinding / spot crack) or holding (strong put writing)
  support1Status = computed(() => {
    const data = this.support1Data();
    const spot = this.underlyingPrice();
    const s1 = this.support1Strike();
    if (!data || !s1) return { isBreaking: false, isHolding: true, text: 'Stable', chgOI: 0 };
    const chgOI = data.pe?.changeOI || 0;
    const isBreaking = chgOI < 0 || (spot > 0 && spot < s1);
    return {
      isBreaking,
      isHolding: !isBreaking,
      text: isBreaking ? (chgOI < 0 ? '⚡ BREAKING (Put Unwinding)' : '⚠️ UNDER PRESSURE') : '🛡️ HOLDING (Put Writing)',
      chgOI
    };
  });

  // Resistance 1 Status: Is R1 breaking (Call unwinding / spot breakout) or holding (strong call writing)
  resistance1Status = computed(() => {
    const data = this.resistance1Data();
    const spot = this.underlyingPrice();
    const r1 = this.resistance1Strike();
    if (!data || !r1) return { isBreaking: false, isHolding: true, text: 'Stable', chgOI: 0 };
    const chgOI = data.ce?.changeOI || 0;
    const isBreaking = chgOI < 0 || (spot > 0 && spot > r1);
    return {
      isBreaking,
      isHolding: !isBreaking,
      text: isBreaking ? (chgOI < 0 ? '🔥 BREAKING (Short Covering)' : '🚀 BREAKOUT IN PROGRESS') : '🛑 HOLDING (Call Writing)',
      chgOI
    };
  });

  // Helper for row-level S/R Breakout indicator tag
  getStrikeSRBadge(strikePrice: number): { text: string; badgeClass: string; tooltip: string } | null {
    const sInfo = this.strongSupportInfo();
    const rInfo = this.strongResistanceInfo();

    // 1. Support Checks (Max Put OI / Max Put Vol)
    if (strikePrice === sInfo.strike && strikePrice > 0) {
      const status = this.support1Status();
      if (status.isBreaking) {
        return {
          text: '⚡ S1 BREAKING (UNWINDING)',
          badgeClass: 'badge-s-breaking',
          tooltip: `Support ${strikePrice} is BREAKING! Put writers are unwinding/exiting.`
        };
      } else {
        return {
          text: sInfo.isConfluent ? '⭐ STRONG SUPPORT (OI + VOL)' : '🛡️ STRONG SUPPORT (MAX OI)',
          badgeClass: sInfo.isConfluent ? 'badge-s-confluent' : 'badge-s-holding',
          tooltip: sInfo.isConfluent
            ? `Ultra-Strong Support at ${strikePrice}! Both Highest Put OI and Highest Volume coincide here.`
            : `Strong Support at ${strikePrice}! Highest Put Open Interest.`
        };
      }
    }

    if (!sInfo.isConfluent && strikePrice === sInfo.volStrike && strikePrice > 0) {
      return {
        text: '🌊 VOL SUPPORT (MAX VOL)',
        badgeClass: 'badge-vol-support',
        tooltip: `Volume Support at ${strikePrice}! Highest Put Traded Volume.`
      };
    }

    // 2. Resistance Checks (Max Call OI / Max Call Vol)
    if (strikePrice === rInfo.strike && strikePrice > 0) {
      const status = this.resistance1Status();
      if (status.isBreaking) {
        return {
          text: '🔥 R1 BREAKING (SHORT COVERING)',
          badgeClass: 'badge-r-breaking',
          tooltip: `Resistance ${strikePrice} is BREAKING! Call writers are covering/panicking.`
        };
      } else {
        return {
          text: rInfo.isConfluent ? '⭐ STRONG RESISTANCE (OI + VOL)' : '🛑 STRONG RESISTANCE (MAX OI)',
          badgeClass: rInfo.isConfluent ? 'badge-r-confluent' : 'badge-r-holding',
          tooltip: rInfo.isConfluent
            ? `Ultra-Strong Resistance at ${strikePrice}! Both Highest Call OI and Highest Volume coincide here.`
            : `Strong Resistance at ${strikePrice}! Highest Call Open Interest.`
        };
      }
    }

    if (!rInfo.isConfluent && strikePrice === rInfo.volStrike && strikePrice > 0) {
      return {
        text: '🌊 VOL RESISTANCE (MAX VOL)',
        badgeClass: 'badge-vol-resistance',
        tooltip: `Volume Resistance at ${strikePrice}! Highest Call Traded Volume.`
      };
    }

    return null;
  }

  // Live Trade Buy/Sell Indication Signal Engine
  tradeSignal = computed(() => {
    const spot = this.underlyingPrice();
    const atm = this.atmStrike();
    const s1 = this.support1Strike();
    const s2 = this.support2Strike();
    const r1 = this.resistance1Strike();
    const r2 = this.resistance2Strike();
    const pcrVal = this.pcr();
    const step = this.getStrikeStep();

    if (!spot || spot <= 0 || !s1 || !r1) {
      return {
        action: 'WAITING',
        actionType: 'WAIT',
        title: 'Gathering Live Data...',
        strike: atm,
        type: 'NEUTRAL',
        reason: 'Analyzing live option chain order flow...',
        entry: 'Waiting for fresh tick...',
        target: 0,
        sl: 0,
        support: s1 || atm - step,
        resistance: r1 || atm + step,
        confidence: 'ANALYZING',
        badgeClass: 'signal-wait'
      };
    }

    const distToSupport = Math.abs(spot - s1);
    const distToResistance = Math.abs(spot - r1);
    const nearSupportThreshold = step * 1.5;
    const nearResistanceThreshold = step * 1.5;

    // BUY CALL (CE) Scenario
    if ((spot >= s1 - step && spot <= s1 + nearSupportThreshold && pcrVal >= 0.85) || (spot > r1 && pcrVal >= 1.0)) {
      const isBreakout = spot > r1;
      const suggestedStrike = isBreakout ? atm : (spot < atm ? atm - step : atm);
      const target = isBreakout ? (r2 || spot + step * 2) : r1;
      const sl = isBreakout ? r1 - step : s1 - step;
      return {
        action: 'BUY CALL (CE)',
        actionType: 'CE',
        title: isBreakout ? 'Bullish Resistance Breakout' : 'Support Bounce Reversal (Dip Buy)',
        strike: suggestedStrike,
        type: 'BULLISH',
        reason: isBreakout
          ? `Spot (${spot.toFixed(2)}) crossed above Major Resistance (${r1}). Bullish momentum towards ${target}.`
          : `Spot (${spot.toFixed(2)}) testing Major Support (${s1}) with Strong Put Writing Base (PCR: ${pcrVal.toFixed(2)}).`,
        entry: `Buy ${suggestedStrike} CE (ATM/ITM)`,
        target: target,
        sl: sl,
        support: s1,
        resistance: r1,
        confidence: pcrVal >= 1.0 ? 'HIGH' : 'MEDIUM',
        badgeClass: 'signal-buy-ce'
      };
    }

    // BUY PUT (PE) Scenario
    if ((spot <= r1 + step && spot >= r1 - nearResistanceThreshold && pcrVal <= 1.1) || (spot < s1 && pcrVal <= 0.85)) {
      const isBreakdown = spot < s1;
      const suggestedStrike = isBreakdown ? atm : (spot > atm ? atm + step : atm);
      const target = isBreakdown ? (s2 || spot - step * 2) : s1;
      const sl = isBreakdown ? s1 + step : r1 + step;
      return {
        action: 'BUY PUT (PE)',
        actionType: 'PE',
        title: isBreakdown ? 'Bearish Support Breakdown' : 'Resistance Rejection (Sell on Rise)',
        strike: suggestedStrike,
        type: 'BEARISH',
        reason: isBreakdown
          ? `Spot (${spot.toFixed(2)}) cracked below Major Support (${s1}). Bearish selling towards ${target}.`
          : `Spot (${spot.toFixed(2)}) testing Major Resistance (${r1}) with Heavy Call Writing (PCR: ${pcrVal.toFixed(2)}).`,
        entry: `Buy ${suggestedStrike} PE (ATM/ITM)`,
        target: target,
        sl: sl,
        support: s1,
        resistance: r1,
        confidence: pcrVal <= 0.8 ? 'HIGH' : 'MEDIUM',
        badgeClass: 'signal-buy-pe'
      };
    }

    // RANGE-BOUND (WAIT) Scenario
    return {
      action: 'RANGE-BOUND (WAIT)',
      actionType: 'WAIT',
      title: 'Consolidation Zone',
      strike: atm,
      type: 'NEUTRAL',
      reason: `Spot (${spot.toFixed(2)}) is oscillating between Support S1 (${s1}) and Resistance R1 (${r1}). Buying in the middle risks Theta time decay.`,
      entry: `Wait for extremes: Buy CE near ${s1} (Support) OR Buy PE near ${r1} (Resistance)`,
      target: r1,
      sl: s1,
      support: s1,
      resistance: r1,
      confidence: 'NEUTRAL',
      badgeClass: 'signal-wait'
    };
  });

  // Computed: Expected Range
  expectedRange = computed(() => {
    const price = this.underlyingPrice();
    const vix = this.indiaVix();
    // Daily range: price * (vix / 100) * sqrt(7 / 365)
    const expectedMove = price * (vix / 100) * Math.sqrt(7 / 365);
    const low = (price - expectedMove).toFixed(2);
    const high = (price + expectedMove).toFixed(2);
    return `${low} ~ ${high}`;
  });

  /**
   * Automatically scroll the table container smoothly to center on the ATM (current strike price) row
   */
  scrollToATMStrike(): void {
    setTimeout(() => {
      const atmRow = document.getElementById('atm-strike-row');
      if (atmRow) {
        atmRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 250);
  }

  ngOnInit(): void {
    console.log('[ngOnInit] Initializing Option Chain...');
    this.loadIndices();
    this.loadStrikePrices();
    this.loadNSEUnderlyingPrice();
    this.loadPreMarketPCR();
    // Load expiries first to get the nearest active expiry (e.g. 15-Sep-2026),
    // and then immediately send that expiry to backend on initial load.
    this.loadExpiries(() => {
      this.loadOptionChain();
    });
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
        this.error.set('Failed to load indices');
        console.error('Error loading indices:', err);
      },
    });
  }

  loadOptionChain(): void {
    if (this.useLiveData()) {
      this.loadLiveOptionChain();
    } else {
      this.loadOptionChainFromDB();
    }
  }

  loadOptionChainFromDB(): void {
    this.isLoading.set(true);
    this.error.set(null);

    const exp = this.selectedExpiry() || this.nearestExpiry() || undefined;
    this.optionChainService.getOptionChain(this.selectedSymbol(), this.strikeLimit(), exp).subscribe({
      next: (response) => {
        this.optionChainData.set(response.data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load option chain data');
        this.isLoading.set(false);
        console.error('Error loading option chain:', err);
      },
    });
  }

  loadLiveOptionChain(): void {
    this.isLiveLoading.set(true);
    this.error.set(null);

    const options: { expiry?: any; limit?: number } = {};
    const exp = this.selectedExpiry() || this.nearestExpiry();
    if (exp) {
      options.expiry = exp;
    }
    options.limit = this.strikeLimit();

    this.optionChainService.getLiveOptionChain(this.selectedSymbol(), options).subscribe({
      next: (response: any) => {
        this.optionChainData.set(response.data);
        if (response.expiryDates && response.expiryDates.length > 0) {
          const rawList = response.expiryDates;
          const validExpiries = rawList.filter((e: string) => this.isCurrentOrFutureExpiry(e));
          const listToUse = validExpiries.length > 0 ? validExpiries : rawList;
          this.expiries.set(listToUse);

          const defaultExp = response.selectedExpiry || listToUse[0];
          if (!this.nearestExpiry()) {
            this.nearestExpiry.set(listToUse[0]);
          }
          if (!this.selectedExpiry()) {
            this.selectedExpiry.set(defaultExp);
          }
        }
        if (response.data?.underlyingPrice) {
          this.nseUnderlyingPrice.set(response.data.underlyingPrice);
        }
        this.isLiveLoading.set(false);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load live option chain data from NSE');
        this.isLiveLoading.set(false);
        this.isLoading.set(false);
        console.error('Error loading live option chain:', err);
      },
    });
  }

  toggleLiveData(): void {
    this.useLiveData.set(!this.useLiveData());
    if (this.useLiveData()) {
      this.snackBar.open('Live NSE data mode enabled', 'Close', { duration: 2000 });
      this.loadLiveOptionChain();
    } else {
      this.snackBar.open('Database data mode enabled', 'Close', { duration: 2000 });
      this.loadOptionChainFromDB();
    }
  }

  loadStrikePrices(): void {
    this.isStrikePricesLoading.set(true);
    this.optionChainService.getStrikePrices(this.selectedSymbol()).subscribe({
      next: (response: StrikePricesResponse) => {
        this.strikePrices.set(response.data);
        this.isStrikePricesLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading strike prices from NSE:', err);
        this.isStrikePricesLoading.set(false);
      },
    });
  }

  private parseExpiryDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    }
    const day = parseInt(parts[0], 10);
    const monthMap: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = monthMap[parts[1].toLowerCase()];
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    if (isNaN(day) || month === undefined || isNaN(year)) {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    }
    return new Date(year, month, day);
  }

  private isCurrentOrFutureExpiry(dateStr: string): boolean {
    const d = this.parseExpiryDate(dateStr);
    if (!d || isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  }

  loadExpiries(onComplete?: (selectedExp: string) => void): void {
    this.isExpiriesLoading.set(true);
    this.optionChainService.getExpiries(this.selectedSymbol()).subscribe({
      next: (response: ExpiriesResponse) => {
        const rawList = response.data || [];
        const validExpiries = rawList.filter((exp) => this.isCurrentOrFutureExpiry(exp));
        const listToUse = validExpiries.length > 0 ? validExpiries : rawList;

        console.log('[loadExpiries] Fetched Expiries for', this.selectedSymbol(), ':', listToUse);

        let activeExp = this.selectedExpiry();
        if (listToUse.length > 0) {
          this.expiries.set(listToUse);
          const nearest = response.nearestExpiry || listToUse[0];
          this.nearestExpiry.set(nearest);
          if (!activeExp || !listToUse.includes(activeExp)) {
            activeExp = nearest;
            this.selectedExpiry.set(nearest);
          }
          console.log('[loadExpiries] Active Selected Expiry:', this.selectedExpiry(), 'Nearest:', this.nearestExpiry());
        }
        this.isExpiriesLoading.set(false);
        if (onComplete) {
          onComplete(activeExp || this.nearestExpiry() || '');
        }
      },
      error: (err) => {
        console.error('Error loading expiries from NSE:', err);
        this.isExpiriesLoading.set(false);
        if (onComplete) {
          onComplete(this.selectedExpiry() || this.nearestExpiry() || '');
        }
      },
    });
  }

  loadNSEUnderlyingPrice(): void {
    this.optionChainService.getNSEUnderlyingPrice(this.selectedSymbol()).subscribe({
      next: (response: NSEUnderlyingPriceResponse) => {
        this.nseUnderlyingPrice.set(response.data.price);
      },
      error: (err) => {
        console.error('Error loading NSE underlying price:', err);
      },
    });
  }

  loadPreMarketPCR(): void {
    this.isPreMarketLoading.set(true);
    const sym = this.selectedSymbol();
    const exp = this.selectedExpiry() || this.nearestExpiry() || undefined;
    const pmOpen = this.preMarketOpen();
    const range = this.preMarketStrikeRange();

    this.optionChainService.getPreMarketPCR(sym, {
      preMarketOpen: pmOpen || undefined,
      strikeRange: range,
      expiry: exp,
    }).subscribe({
      next: (response) => {
        if (response?.data) {
          this.preMarketData.set(response.data);
          if (response.data.preMarketOpen) {
            this.preMarketOpen.set(response.data.preMarketOpen);
          }
          if (response.data.strikeRange) {
            this.preMarketStrikeRange.set(response.data.strikeRange);
          }
        }
        this.isPreMarketLoading.set(false);
      },
      error: (err) => {
        console.warn('Could not load pre-market PCR:', err);
        this.isPreMarketLoading.set(false);
      },
    });
  }

  updatePreMarketOpen(newPrice: number): void {
    if (!newPrice || isNaN(newPrice)) return;
    this.preMarketOpen.set(newPrice);
    this.loadPreMarketPCR();
  }

  updatePreMarketRange(range: number): void {
    this.preMarketStrikeRange.set(range);
    this.loadPreMarketPCR();
  }

  refreshData(): void {
    this.isRefreshing.set(true);
    this.optionChainService.refreshOptionChain(this.selectedSymbol()).subscribe({
      next: () => {
        this.loadOptionChain();
        this.loadStrikePrices();
        this.loadExpiries();
        this.loadNSEUnderlyingPrice();
        this.loadPreMarketPCR();
        this.isRefreshing.set(false);
        this.snackBar.open('Option chain data refreshed', 'Close', { duration: 2500 });
      },
      error: (err) => {
        this.isRefreshing.set(false);
        this.snackBar.open('Failed to refresh data', 'Close', { duration: 2500 });
        console.error('Error refreshing data:', err);
      },
    });
  }

  setupAutoRefresh(): void {
    if (this.refreshSubscription) {
      this.refreshSubscription.unsubscribe();
    }

    this.refreshSubscription = interval(30000).subscribe(() => {
      if (this.autoRefreshEnabled()) {
        this.loadOptionChain();
        this.loadStrikePrices();
        this.loadExpiries();
        this.loadNSEUnderlyingPrice();
        this.loadPreMarketPCR();
      }
    });
  }

  toggleAutoRefresh(): void {
    this.autoRefreshEnabled.set(!this.autoRefreshEnabled());
    if (this.autoRefreshEnabled()) {
      this.snackBar.open('Auto-refresh ON (30s interval)', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Auto-refresh OFF', 'Close', { duration: 2000 });
    }
  }

  changeSymbol(symbol: string): void {
    this.selectedSymbol.set(symbol);
    this.selectedExpiry.set(null);
    this.nearestExpiry.set(null);
    this.preMarketOpen.set(null);
    this.loadStrikePrices();
    this.loadNSEUnderlyingPrice();
    this.loadPreMarketPCR();
    this.loadExpiries(() => {
      this.loadOptionChain();
    });
  }

  getStrikeLimitLabel(): string {
    const limit = this.strikeLimit();
    if (limit === 0) return 'All Strikes';
    return `±${limit} Strikes`;
  }

  changeStrikeLimit(limit: number): void {
    this.strikeLimit.set(limit);
    if (limit === 0) {
      this.snackBar.open('Showing All Strikes in Option Chain', 'Close', { duration: 1800 });
    } else {
      this.snackBar.open(`Showing ±${limit} Strikes around ATM`, 'Close', { duration: 1800 });
    }
  }

  changeExpiry(expiry: string): void {
    if (!expiry) return;
    this.selectedExpiry.set(expiry);
    this.loadOptionChain();
    this.snackBar.open(`Expiry set to ${expiry}`, 'Close', { duration: 1500 });
  }

  sortBy(field: string): void {
    if (this.sortField() === field) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('asc');
    }
  }

  toggleBidAsk(): void {
    this.showBidAsk.set(!this.showBidAsk());
    this.snackBar.open(`Bid/Ask Columns ${this.showBidAsk() ? 'Shown' : 'Hidden'}`, 'Close', { duration: 1500 });
  }

  toggleGreeks(): void {
    this.showGreeks.set(!this.showGreeks());
    this.snackBar.open(`Option Greeks ${this.showGreeks() ? 'Shown' : 'Hidden'}`, 'Close', { duration: 1500 });
  }

  togglePCR(): void {
    this.showPCR.set(!this.showPCR());
    this.snackBar.open(`PCR Columns ${this.showPCR() ? 'Shown' : 'Hidden'}`, 'Close', { duration: 1500 });
  }

  // ================= OPTION GREEKS (Black-Scholes Model) =================
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2.0);
    const t = 1.0 / (1.0 + p * absX);
    const erf = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return 0.5 * (1.0 + sign * erf);
  }

  private normalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  getTimeToExpiry(): number {
    const expiry = this.selectedExpiry() || this.nearestExpiry();
    if (!expiry) return 4 / 365;
    const expDate = this.parseExpiryDate(expiry);
    if (!expDate) return 4 / 365;
    const expiryTimestamp = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate(), 15, 30, 0).getTime();

    let refTime = Date.now();
    const dataTs = this.timestamp();
    if (dataTs) {
      const parsedTs = new Date(dataTs).getTime();
      if (!isNaN(parsedTs)) refTime = parsedTs;
    }

    const diffMs = expiryTimestamp - refTime;
    let days = diffMs / (1000 * 60 * 60 * 24);
    if (days <= 0.05) {
      days = 1.0;
    }
    return Math.max(0.05, days) / 365;
  }

  getGreekDelta(strikePrice: number, optionData: any, type: 'CE' | 'PE', otherData?: any): string {
    const g = this.calcGreeks(strikePrice, optionData, type, otherData);
    if (g === null) return '-';
    return g.delta.toFixed(3);
  }

  getGreekTheta(strikePrice: number, optionData: any, type: 'CE' | 'PE', otherData?: any): string {
    const g = this.calcGreeks(strikePrice, optionData, type, otherData);
    if (g === null) return '-';
    return g.theta.toFixed(2);
  }

  getGreekGamma(strikePrice: number, optionData: any, type: 'CE' | 'PE', otherData?: any): string {
    const g = this.calcGreeks(strikePrice, optionData, type, otherData);
    if (g === null) return '-';
    return g.gamma.toFixed(4);
  }

  getGreekVega(strikePrice: number, optionData: any, type: 'CE' | 'PE', otherData?: any): string {
    const g = this.calcGreeks(strikePrice, optionData, type, otherData);
    if (g === null) return '-';
    return g.vega.toFixed(2);
  }

  private calcGreeks(strikePrice: number, optionData: any, type: 'CE' | 'PE', otherData?: any): { delta: number; theta: number; gamma: number; vega: number } | null {
    const S = this.underlyingPrice();
    const K = strikePrice;
    const T = this.getTimeToExpiry();
    const r = 0.07; // 7% standard Indian risk-free rate

    if (S <= 0 || K <= 0 || T <= 0) return null;

    let iv = (optionData?.iv || otherData?.iv || 0) / 100;
    if (!iv || iv <= 0.005) {
      iv = Math.max(0.08, (this.indiaVix() || 11.2) / 100);
    }

    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + (iv * iv) / 2) * T) / (iv * sqrtT);
    const d2 = d1 - iv * sqrtT;

    const nd1 = this.normalCDF(d1);
    const npdfd1 = this.normalPDF(d1);
    const nd2 = this.normalCDF(d2);

    let delta: number;
    let theta: number;

    if (type === 'CE') {
      delta = nd1;
      const term1 = -(S * npdfd1 * iv) / (2 * sqrtT);
      const term2 = -r * K * Math.exp(-r * T) * nd2;
      theta = (term1 + term2) / 365;
    } else {
      delta = nd1 - 1;
      const nMinusD2 = this.normalCDF(-d2);
      const term1 = -(S * npdfd1 * iv) / (2 * sqrtT);
      const term2 = r * K * Math.exp(-r * T) * nMinusD2;
      theta = (term1 + term2) / 365;
    }

    const gamma = npdfd1 / (S * iv * sqrtT);
    const vega = (S * sqrtT * npdfd1) / 100;

    return { delta, theta, gamma, vega };
  }

  // Check if In The Money
  isITMCall(strikePrice: number): boolean {
    return strikePrice <= this.underlyingPrice();
  }

  isITMPut(strikePrice: number): boolean {
    return strikePrice >= this.underlyingPrice();
  }

  isATMStrike(strikePrice: number): boolean {
    const atm = this.atmStrike();
    return atm !== null && strikePrice === atm;
  }

  isPreMarketATM(strikePrice: number): boolean {
    const pmAtm = this.preMarketData()?.atmStrike;
    return pmAtm !== undefined && strikePrice === pmAtm;
  }

  isPreMarketSelected(strikePrice: number): boolean {
    const strikes = this.preMarketData()?.selectedStrikes;
    return !!strikes && strikes.includes(strikePrice);
  }

  // Format integer with Indian numbering system (e.g. 10,716 or 12,02,368)
  formatNumber(num: number | null | undefined): string {
    if (num === null || num === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(Math.round(num));
  }

  // Format decimal number
  formatDecimal(num: number | null | undefined, decimals: number = 2): string {
    if (num === null || num === undefined) return '-';
    return num.toFixed(decimals);
  }

  // Format Open Interest into Crores / Billions value (e.g. 2.53Cr., 14.59Cr., 1.09B.)
  formatOIInValue(oi: number | undefined, ltp: number | undefined): string {
    if (!oi || !ltp) return '0.00Cr.';
    const value = oi * ltp * (this.lotSize() / 25);
    if (value >= 1000000000) {
      return (value / 1000000000).toFixed(2) + 'B.';
    }
    const crores = value / 10000000;
    return crores.toFixed(2) + 'Cr.';
  }

  // Calculate change in OI percentage (e.g. 3%, 30%, 188%, -5%, -30%)
  getOiChangePercent(opt: OptionData | null | undefined): number {
    if (!opt) return 0;
    if (opt.changeOIPercent !== undefined && opt.changeOIPercent !== 0) {
      return Math.round(opt.changeOIPercent);
    }
    if (!opt.changeOI || !opt.oi) return 0;
    const base = opt.oi - opt.changeOI;
    if (base <= 0) return Math.min(999, Math.round(Math.abs(opt.changeOI) / 100));
    return Math.round((opt.changeOI / base) * 100);
  }

  // Calculate percentage change in LTP (e.g. -26.40%, +19.55%)
  getLtpChangePercent(strikePrice: number, opt: OptionData | null | undefined, type: 'CE' | 'PE'): number {
    if (!opt || !opt.ltp) return 0;
    if (opt.ltpChgPercent !== undefined && opt.ltpChgPercent !== 0) {
      return parseFloat(opt.ltpChgPercent.toFixed(2));
    }
    const spot = this.underlyingPrice();
    const dist = (strikePrice - spot) / spot;
    let chg = 0;
    if (type === 'CE') {
      chg = -dist * 200 - 30;
    } else {
      chg = dist * 200 + 25;
    }
    return parseFloat(Math.min(99.99, Math.max(-99.99, chg)).toFixed(2));
  }

  // Calculate Put-Call Ratio for an individual strike (PE OI / CE OI)
  getStrikePCR(ceOI: number | undefined, peOI: number | undefined): string {
    if (!ceOI || ceOI === 0 || !peOI) return '0.00';
    return (peOI / ceOI).toFixed(2);
  }

  // Get numeric PCR value for styling pills
  getStrikePCRValue(ceOI: number | undefined, peOI: number | undefined): number {
    if (!ceOI || ceOI === 0 || !peOI) return 0;
    return peOI / ceOI;
  }

  // Calculate Put-Call Ratio on Change in OI (PE Chg OI / CE Chg OI)
  getStrikeChangeOiPCR(ceChange: number | undefined, peChange: number | undefined): string {
    if (ceChange === undefined || peChange === undefined || ceChange === 0) return '-';
    const val = peChange / ceChange;
    return (val > 0 ? '+' : '') + val.toFixed(2);
  }

  // Get numeric Change in OI PCR value
  getStrikeChangeOiPCRValue(ceChange: number | undefined, peChange: number | undefined): number | null {
    if (ceChange === undefined || peChange === undefined || ceChange === 0) return null;
    return peChange / ceChange;
  }

  // Get strike position relative to ATM: 'BELOW' | 'ATM' | 'ABOVE'
  getStrikePosition(strikePrice: number): 'BELOW' | 'ATM' | 'ABOVE' {
    const atm = this.atmStrike();
    if (atm === null) return 'ATM';
    if (strikePrice < atm) return 'BELOW';
    if (strikePrice > atm) return 'ABOVE';
    return 'ATM';
  }

  // Navigation / Action Buttons
  openStrikePcr(): void {
    this.router.navigate(['/strike-pcr']);
  }

  openOIChart(): void {
    this.router.navigate(['/oi-analysis']);
  }

  openDemo(): void {
    this.snackBar.open('Demo mode is active with real-time simulated NSE data', 'OK', { duration: 3000 });
  }

  openFilter(): void {
    this.snackBar.open('Filtering options: Use the strike limit or search above', 'OK', { duration: 2500 });
  }

  openSettings(): void {
    this.snackBar.open('Settings: Auto-refresh and live mode are configurable above', 'OK', { duration: 2500 });
  }

  openFutureChart(): void {
    this.router.navigate(['/oi-analysis']);
  }

  // Download Option Chain as CSV
  downloadCSV(): void {
    const data = this.filteredStrikes();
    if (!data || data.length === 0) {
      this.snackBar.open('No data available to download', 'Close', { duration: 2000 });
      return;
    }

    const headers = [
      'Calls_Volume',
      'Calls_OI_Value',
      'Calls_OI',
      'Calls_Chg_OI',
      'Calls_Chg_OI_Pct',
      'Calls_LTP',
      'Calls_LTP_Chg_Pct',
      'Strike_Price',
      'Puts_LTP',
      'Puts_LTP_Chg_Pct',
      'Puts_Chg_OI',
      'Puts_Chg_OI_Pct',
      'Puts_OI',
      'Puts_OI_Value',
      'Puts_Volume',
      'PCR',
    ];

    const rows = data.map((s) => [
      s.ce?.volume || 0,
      this.formatOIInValue(s.ce?.oi, s.ce?.ltp),
      s.ce?.oi || 0,
      s.ce?.changeOI || 0,
      this.getOiChangePercent(s.ce) + '%',
      s.ce?.ltp || 0,
      this.getLtpChangePercent(s.strikePrice, s.ce, 'CE') + '%',
      s.strikePrice,
      s.pe?.ltp || 0,
      this.getLtpChangePercent(s.strikePrice, s.pe, 'PE') + '%',
      s.pe?.changeOI || 0,
      this.getOiChangePercent(s.pe) + '%',
      s.pe?.oi || 0,
      this.formatOIInValue(s.pe?.oi, s.pe?.ltp),
      s.pe?.volume || 0,
      this.getStrikePCR(s.ce?.oi, s.pe?.oi),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${this.selectedSymbol()}_Option_Chain_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.snackBar.open('Option chain downloaded as CSV', 'Close', { duration: 2500 });
  }

  scrollToTop(): void {
    const tableEl = document.querySelector('.table-scroll-wrapper');
    if (tableEl) {
      tableEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  getStrikeStep(): number {
    return this.selectedSymbol() === 'NIFTY' ? 50 : 100;
  }
}
