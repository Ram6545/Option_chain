import { Routes } from '@angular/router';
import { OptionChainComponent } from './components/option-chain/option-chain.component';
import { OIAnalysisComponent } from './components/oi-analysis/oi-analysis.component';
import { StrikePcrComponent } from './components/strike-pcr/strike-pcr.component';
import { PCRTrackerComponent } from './components/pcr-tracker/pcr-tracker.component';
import { HistoricalReplayComponent } from './components/historical-replay/historical-replay.component';
import { AdvanceDeclineComponent } from './components/advance-decline/advance-decline.component';
import { OptionVWAPComponent } from './components/option-vwap/option-vwap.component';

export const routes: Routes = [
  { path: '', redirectTo: '/option-chain', pathMatch: 'full' },
  { path: 'advance-decline', component: AdvanceDeclineComponent },
  { path: 'market-breadth', redirectTo: '/advance-decline', pathMatch: 'full' },
  { path: 'vwap', component: OptionVWAPComponent },
  { path: 'option-chain-vwap', redirectTo: '/vwap', pathMatch: 'full' },
  { path: 'options/vwap', redirectTo: '/vwap', pathMatch: 'full' },
  { path: 'option-chain', component: OptionChainComponent },
  { path: 'oi-analysis', component: OIAnalysisComponent },
  { path: 'strike-pcr', component: StrikePcrComponent },
  { path: 'pcr-analysis', redirectTo: '/strike-pcr', pathMatch: 'full' },
  { path: 'pcr-tracker', component: PCRTrackerComponent },
  { path: 'pcr', redirectTo: '/pcr-tracker', pathMatch: 'full' },
  { path: 'historical-replay', component: HistoricalReplayComponent },
  { path: '**', redirectTo: '/option-chain' },
];