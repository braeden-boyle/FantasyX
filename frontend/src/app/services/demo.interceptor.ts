import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { DemoModeService } from './demo-mode.service';
import { DEMO_LEAGUE_ID } from '../utils/demo';

const ESPN_API = `${environment.apiBaseUrl}/api/espn/`;

// Answers the demo league's backend calls from its fixtures (see DemoModeService), so the demo
// never reaches the backend or ESPN. Only requests for league DEMO_LEAGUE_ID are answered; anything
// else, a real import started from the demo included, goes on to the backend as usual.
export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  const body = req.body as Record<string, unknown> | null;
  if (!req.url.startsWith(ESPN_API) || body?.['leagueId'] !== DEMO_LEAGUE_ID) {
    return next(req);
  }

  // Shaped like the backend's problem answers, which the pages read their messages from.
  const notInDemo = (status: number) =>
    new HttpErrorResponse({ status, url: req.url, error: { title: 'That isn’t part of the demo league.' } });

  const route = inject(DemoModeService).route(req.url.slice(ESPN_API.length), body);
  if (!route) {
    return throwError(() => notInDemo(404));
  }
  return next(new HttpRequest('GET', route.path, { responseType: 'json' })).pipe(
    map((event) => (event instanceof HttpResponse && route.select ? event.clone({ body: route.select(event.body) }) : event)),
    catchError((err: HttpErrorResponse) => throwError(() => notInDemo(err.status || 404))),
  );
};
