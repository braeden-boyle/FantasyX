import { Routes } from '@angular/router';
import { AdviceComponent } from './advice.component';
import { StartSitComponent } from '../start-sit/start-sit.component';

// /advice and its tools, loaded together on first visit. Waivers (#27) and trades (#28) add their
// routes here when they ship.
export const ADVICE_ROUTES: Routes = [
  {
    path: '',
    component: AdviceComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'start-sit' },
      { path: 'start-sit', component: StartSitComponent },
    ],
  },
];
