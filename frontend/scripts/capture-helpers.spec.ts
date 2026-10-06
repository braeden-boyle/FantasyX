import { describe, expect, it } from 'vitest';
import { HttpError, captureWindow, defaultSeason, withRetries } from './capture-helpers';

describe('defaultSeason', () => {
  it('is this year from March on and last year before', () => {
    expect(defaultSeason(new Date(Date.UTC(2027, 0, 13)))).toBe(2026);
    expect(defaultSeason(new Date(Date.UTC(2027, 1, 28, 23, 59)))).toBe(2026);
    expect(defaultSeason(new Date(Date.UTC(2027, 2, 1)))).toBe(2027);
    expect(defaultSeason(new Date(Date.UTC(2026, 9, 7)))).toBe(2026);
  });
});

describe('captureWindow', () => {
  // Regular season weeks 1-14, then two playoff rounds, the last one two weeks long.
  const periods = { ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`${i + 1}`, [i + 1]])), '15': [15], '16': [16, 17] };

  it('has nothing before week 1', () => {
    expect(captureWindow(0, periods, 150)).toBe('before');
    expect(captureWindow(1, periods, 0)).toBe('before');
  });

  it('is open from week 1 through the last playoff week', () => {
    expect(captureWindow(1, periods, 150)).toBe('open');
    expect(captureWindow(17, periods, 150)).toBe('open');
  });

  it('has nothing after the last playoff week', () => {
    expect(captureWindow(18, periods, 150)).toBe('after');
  });
});

describe('withRetries', () => {
  const noWait = () => Promise.resolve();

  it('retries network failures and 5xx answers, then gives up', async () => {
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new HttpError(502, 'ESPN API returned an unexpected error'));
    };
    await expect(withRetries(failing, 3, 1, noWait)).rejects.toThrow('unexpected error');
    expect(calls).toBe(4);
  });

  it('doesn’t retry a 4xx answer', async () => {
    let calls = 0;
    const unauthorized = () => {
      calls++;
      return Promise.reject(new HttpError(401, 'League could not be read'));
    };
    await expect(withRetries(unauthorized, 3, 1, noWait)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('returns once an attempt succeeds, waiting longer each time', async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky = () => (++calls < 3 ? Promise.reject(new Error('fetch failed')) : Promise.resolve('ok'));
    await expect(withRetries(flaky, 3, 100, (ms) => (waits.push(ms), Promise.resolve()))).resolves.toBe('ok');
    expect(waits).toEqual([100, 200]);
  });
});
