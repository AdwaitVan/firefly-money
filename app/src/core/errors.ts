/* ================= Unexpected errors =================
   The app handles the failures it expects (Firefly down, a refused save). Anything else, a bug that throws or a
   promise nobody caught, would otherwise vanish into a console nobody has open on a phone. Those are kept here, in
   memory only and never sent anywhere, so Settings → About can show that something went wrong and copy the details. */
export type Problem = { at: number, what: string, stack: string };
export const PROBLEMS: Problem[] = [];
const KEEP = 20;

// Noise that isn't a bug: the sign-in prompt (AuthError), and the browser's harmless layout-loop notices
const IGNORED = /^(ResizeObserver loop|Script error\.?$)|AuthError|Please sign in again/;

export function noteProblem(e: unknown, now = Date.now()): boolean {
  const err = e as { message?: unknown, name?: unknown, stack?: unknown } | null | undefined;
  const what = (err && typeof err === 'object' ? [err.name, err.message].filter(Boolean).join(': ') : String(e)).slice(0, 300) || 'Unknown error';
  if (IGNORED.test(what) || (err && typeof err === 'object' && err.name === 'AuthError')) return false;
  const stack = err && typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 6).join('\n') : '';
  const last = PROBLEMS[PROBLEMS.length - 1];
  if (last && last.what === what && now - last.at < 1000) return false;      // the same one in a loop
  PROBLEMS.push({ at: now, what, stack });
  if (PROBLEMS.length > KEEP) PROBLEMS.shift();
  return true;
}

// What to paste into a bug report
export function problemReport(version: string): string {
  const head = ['Money ' + (version || 'local build'), navigator.userAgent, new Date().toISOString(), ''];
  return head.concat(PROBLEMS.map(p => new Date(p.at).toISOString() + '  ' + p.what + (p.stack ? '\n' + p.stack : ''))).join('\n');
}

addEventListener('error', e => { noteProblem(e.error || e.message); });
addEventListener('unhandledrejection', e => { noteProblem(e.reason); });
