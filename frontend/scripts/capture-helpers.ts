import { rankingWeeks } from '../src/app/utils/player-rankings';

// The capture script's pure parts, kept apart from it so Vitest can import them without running a
// capture.

// The NFL season to capture when SEASON isn't set: this year from March on, last year before, so a
// January run captures the season that's ending.
export function defaultSeason(now: Date): number {
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// Whether there's anything to capture this week: nothing before week 1 (no scoring period yet, or
// no players rostered because the league hasn't drafted) or once the fantasy playoffs are over.
export type CaptureWindow = 'before' | 'open' | 'after';

export function captureWindow(
  scoringPeriod: number,
  scoringPeriodsByMatchupPeriod: Record<string, number[]>,
  rosteredPlayers: number,
): CaptureWindow {
  if (scoringPeriod < 1 || rosteredPlayers === 0) return 'before';
  return rankingWeeks(scoringPeriod, scoringPeriodsByMatchupPeriod).length ? 'open' : 'after';
}

// A backend answer other than 2xx, with the problem's title when it sent one.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// POSTs body as JSON to the backend at apiUrl and returns the parsed answer, or throws an HttpError.
// Shared by the capture scripts; the only part here that touches the network.
export async function postJson<T>(
  apiUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // The backend's problem titles never echo cookies back, so they're safe to log.
    const title = await response
      .json()
      .then((problem: { title?: string }) => problem.title)
      .catch(() => undefined);
    throw new HttpError(response.status, `${path} answered ${response.status}${title ? `: ${title}` : ''}`);
  }
  return (await response.json()) as T;
}

// Network failures and 5xx answers (ESPN errors come back as 502) are worth another try; a 4xx,
// such as expired cookies or a bad league id, isn't.
export function isRetryable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status >= 500;
}

// Runs attempt, retrying up to retries more times with doubling waits (2s, 4s, 8s by default) while
// the failure is retryable.
export async function withRetries<T>(
  attempt: () => Promise<T>,
  retries = 3,
  firstDelayMs = 2000,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= retries || !isRetryable(error)) throw error;
      await sleep(firstDelayMs * 2 ** tries);
    }
  }
}
