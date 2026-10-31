/** Asks the server to translate page lines. Returns null when the service is off or unreachable (the page then stays in English). */
export async function translateLines(lang: string, items: string[]): Promise<(string | null)[] | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 30_000);
  try {
    const r = await fetch('/api/products?action=translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, items }), signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: string; items?: unknown };
    if (!Array.isArray(j.items)) return null;
    return j.items.map((x) => (typeof x === 'string' ? x : null));
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
