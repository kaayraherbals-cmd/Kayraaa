// Minimal stand-in for vitest (describe/it/expect/beforeEach/afterEach). NOT vitest: supplementary evidence only.
import { isDeepStrictEqual, inspect } from 'node:util';
type Fn = () => unknown | Promise<unknown>;
interface Suite { name: string; tests: { name: string; fn: Fn }[]; children: Suite[]; before: Fn[]; after: Fn[]; parent: Suite | null }
const root: Suite = { name: '', tests: [], children: [], before: [], after: [], parent: null };
let cur = root;
export function describe(name: string, fn: () => void) { const s: Suite = { name, tests: [], children: [], before: [], after: [], parent: cur }; cur.children.push(s); const p = cur; cur = s; fn(); cur = p; }
export function it(name: string, fn: Fn) { cur.tests.push({ name, fn }); }
export const test = it;
export function beforeEach(fn: Fn) { cur.before.push(fn); }
export function afterEach(fn: Fn) { cur.after.push(fn); }
function match(a: any, e: any): boolean {
  if (e === null || typeof e !== 'object') return a === e;
  if (Array.isArray(e)) return Array.isArray(a) && a.length === e.length && e.every((x, i) => match(a[i], x));
  if (a === null || typeof a !== 'object') return false;
  return Object.keys(e).every((k) => match(a[k], e[k]));
}
const eq = (a: any, b: any) => { const strip = (v: any): any => JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined ? undefined : x))); try { return isDeepStrictEqual(strip(a), strip(b)); } catch { return isDeepStrictEqual(a, b); } };
export function expect(actual: any) {
  const mk = (neg: boolean) => {
    const chk = (ok: boolean, msg: string) => { if (ok === neg) throw new Error(`${neg ? 'NOT ' : ''}${msg}\n   actual: ${inspect(actual, { depth: 4, maxStringLength: 300 })}`); };
    return {
      toBe: (e: any) => chk(Object.is(actual, e), `expected ${inspect(e)}`),
      toEqual: (e: any) => chk(eq(actual, e), `expected equal to ${inspect(e, { depth: 4 })}`),
      toContain: (e: any) => chk(typeof actual === 'string' ? actual.includes(e) : Array.isArray(actual) ? actual.includes(e) : false, `expected to contain ${inspect(e)}`),
      toHaveLength: (n: number) => chk(actual?.length === n, `expected length ${n}, got ${actual?.length}`),
      toMatchObject: (e: any) => chk(match(actual, e), `expected to match ${inspect(e, { depth: 4 })}`),
      toMatch: (re: RegExp | string) => chk(typeof actual === 'string' && (typeof re === 'string' ? actual.includes(re) : re.test(actual)), `expected to match ${re}`),
      toBeNull: () => chk(actual === null, 'expected null'),
      toBeUndefined: () => chk(actual === undefined, 'expected undefined'),
      toBeTruthy: () => chk(!!actual, 'expected truthy'),
      toBeGreaterThan: (n: number) => chk(actual > n, `expected > ${n}`),
      toBeGreaterThanOrEqual: (n: number) => chk(actual >= n, `expected >= ${n}`),
      toBeLessThanOrEqual: (n: number) => chk(actual <= n, `expected <= ${n}`),
      toBeLessThan: (n: number) => chk(actual < n, `expected < ${n}`),
      toBeInstanceOf: (c: any) => chk(actual instanceof c, `expected instance of ${c?.name}`),
      toThrow: () => { let threw = false; try { actual(); } catch { threw = true; } chk(threw, 'expected to throw'); },
    };
  };
  return { ...mk(false), not: mk(true) };
}
export async function run(file: string) {
  let pass = 0, fail = 0; const fails: string[] = [];
  const hooks = (s: Suite, k: 'before' | 'after'): Fn[] => { const chain: Suite[] = []; for (let x: Suite | null = s; x; x = x.parent) chain.push(x); return (k === 'before' ? chain.reverse() : chain).flatMap((x) => x[k]); };
  async function walk(s: Suite, path: string[]) {
    for (const t of s.tests) {
      const name = [...path, t.name].join(' > ');
      try { for (const h of hooks(s, 'before')) await h(); await t.fn(); pass++; }
      catch (e: any) { fail++; fails.push(`${name}\n   ${String(e?.message ?? e).split('\n').slice(0, 4).join('\n   ')}`); }
      finally { try { for (const h of hooks(s, 'after')) await h(); } catch { /* ignore */ } }
    }
    for (const c of s.children) await walk(c, [...path, c.name]);
  }
  await walk(root, []);
  console.log(`RESULT ${file} pass=${pass} fail=${fail}`);
  for (const f of fails) console.log(`FAIL ${f}`);
}
