import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A read that was asked before an edit must not come back looking newer than the edit
describe('api cache and edits', () => {
  let answers: Record<string, string[]>, held: (() => void)[];
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'http://x', href: 'http://x/', hash: '' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('dispatchEvent', () => true);
    answers = { '/api/v1/accounts': ['old', 'new'] }; held = [];
    vi.stubGlobal('fetch', (u: URL, init: RequestInit) => {
      if (init.method !== 'GET') return Promise.resolve(new Response('{}', { status: 200 }));
      const body = JSON.stringify({ v: answers[u.pathname].shift() });      // what Firefly holds when the read arrives
      return new Promise<Response>(res => held.push(() => res(new Response(body, { status: 200 }))));
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('does not keep a read that was asked before an edit as if it were fresh', async () => {
    const { api } = await import('../app/src/core/api');
    const early = api('/accounts');                  // asked before the edit, answered after it
    await vi.waitFor(() => expect(held.length).toBe(1));
    await new Promise(r => setTimeout(r, 5));
    await api('/transactions', { method: 'POST', body: {} });
    held.shift()!();
    expect((await early).v).toBe('old');
    const later = api('/accounts');                  // asked after the edit: must go to Firefly again
    await vi.waitFor(() => expect(held.length).toBe(1));
    held.shift()!();
    expect((await later).v).toBe('new');
  });

  it('does not hand a read made after an edit the one that was already on its way', async () => {
    const { api } = await import('../app/src/core/api');
    const early = api('/accounts');
    await vi.waitFor(() => expect(held.length).toBe(1));
    await api('/transactions', { method: 'POST', body: {} });
    const later = api('/accounts');
    await vi.waitFor(() => expect(held.length).toBe(2));
    held.forEach(f => f());
    expect((await early).v).toBe('old');
    expect((await later).v).toBe('new');
  });
});
