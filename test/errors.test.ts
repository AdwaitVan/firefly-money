import { beforeEach, describe, expect, it } from 'vitest';
import { PROBLEMS, noteProblem, problemReport } from '../app/src/core/errors';

describe('unexpected errors', () => {
  beforeEach(() => { PROBLEMS.length = 0; });

  it('keeps what went wrong with the top of the stack', () => {
    const e = new TypeError('x is undefined');
    expect(noteProblem(e, 1000)).toBe(true);
    expect(PROBLEMS[0].what).toBe('TypeError: x is undefined');
    expect(PROBLEMS[0].stack.split('\n').length).toBeLessThanOrEqual(6);
  });

  it('keeps things that are not Error objects', () => {
    noteProblem('boom', 1000); noteProblem(undefined, 2000); noteProblem({ message: 'plain object' }, 3000);
    expect(PROBLEMS.map(p => p.what)).toEqual(['boom', 'undefined', 'plain object']);
  });

  it('ignores the sign-in prompt and harmless browser notices', () => {
    expect(noteProblem(new Error('Please sign in again.'))).toBe(false);
    expect(noteProblem('ResizeObserver loop completed with undelivered notifications.')).toBe(false);
    expect(noteProblem('Script error.')).toBe(false);
    expect(PROBLEMS).toHaveLength(0);
  });

  it('does not fill up with one error repeating in a loop, and keeps only the latest 20', () => {
    for (let i = 0; i < 50; i++) noteProblem(new Error('same'), 5000 + i);
    expect(PROBLEMS).toHaveLength(1);
    for (let i = 0; i < 30; i++) noteProblem(new Error('e' + i), 10000 + i * 2000);
    expect(PROBLEMS).toHaveLength(20);
    expect(PROBLEMS[19].what).toBe('Error: e29');
  });

  it('catches an uncaught error and an unhandled promise rejection', () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('thrown'), message: 'thrown' }));
    const rej = new Event('unhandledrejection') as Event & { reason?: unknown };
    rej.reason = new Error('rejected'); window.dispatchEvent(rej);
    expect(PROBLEMS.map(p => p.what)).toEqual(['Error: thrown', 'Error: rejected']);
  });

  it('writes a report to paste into a bug report', () => {
    noteProblem(new Error('bad'), Date.parse('2026-11-03T12:00:00Z'));
    const r = problemReport('abc123 · 2026-11-03');
    expect(r).toContain('Money abc123 · 2026-11-03');
    expect(r).toContain('2026-11-03T12:00:00.000Z  Error: bad');
  });
});
