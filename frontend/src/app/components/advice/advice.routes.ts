import { Routes } from '@angular/router';
import { AdviceComponent } from './advice.component';
import { StartSitComponent } from '../start-sit/start-sit.component';
import { WaiversComponent } from '../waivers/waivers.component';

// /advice and its tools, loaded together on first visit. Trades (#28) adds its route here when it
// ships.
export const ADVICE_ROUTES: Routes = [
  {
    path: '',
    component: AdviceComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'start-sit' },
      { path: 'start-sit', component: StartSitComponent },
      { path: 'waivers', component: WaiversComponent },
    ],
  },
];
