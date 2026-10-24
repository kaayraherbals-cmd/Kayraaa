/** Helpers shared by the admin API and its tests. */

/** Keep only characters that are safe inside a PostgREST ilike filter. */
export function sanitiseSearch(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[^A-Za-z0-9@._+\- ]/g, '')
    .trim()
    .slice(0, 80);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function parsePage(raw: unknown, max = 100000): number {
  const n = Number.parseInt(typeof raw === 'string' ? raw : '', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1;
}
