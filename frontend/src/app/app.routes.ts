import { Routes } from '@angular/router';
import { OptionChainComponent } from './components/option-chain/option-chain.component';
import { OIAnalysisComponent } from './components/oi-analysis/oi-analysis.component';
import { StrikePcrComponent } from './components/strike-pcr/strike-pcr.component';

export const routes: Routes = [
  { path: '', redirectTo: '/option-chain', pathMatch: 'full' },
  { path: 'option-chain', component: OptionChainComponent },
  { path: 'oi-analysis', component: OIAnalysisComponent },
  { path: 'strike-pcr', component: StrikePcrComponent },
  { path: 'pcr-analysis', redirectTo: '/strike-pcr', pathMatch: 'full' },
  { path: '**', redirectTo: '/option-chain' },
];