/** GSTIN (India GST Identification Number) checks. Pure, no I/O. Format: 2-digit state code, 10-character PAN, entity number, "Z", check character. */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

/** The check character for the first 14 characters (GSTN's base-36 weighted checksum). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(value: string): boolean {
  const g = value.trim().toUpperCase();
  const m = SHAPE.exec(g);
  if (!m) return false;
  const state = Number(m[1]);
  if (state < 1 || state > 99) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}
