import { Routes } from '@angular/router';
import { AdviceComponent } from './advice.component';
import { StartSitComponent } from '../start-sit/start-sit.component';
import { TradesComponent } from '../trades/trades.component';
import { WaiversComponent } from '../waivers/waivers.component';

// /advice and its tools, loaded together on first visit.
export const ADVICE_ROUTES: Routes = [
  {
    path: '',
    component: AdviceComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'start-sit' },
      { path: 'start-sit', component: StartSitComponent },
      { path: 'waivers', component: WaiversComponent },
      { path: 'trades', component: TradesComponent },
    ],
  },
];
