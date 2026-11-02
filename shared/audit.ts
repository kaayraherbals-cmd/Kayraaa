/** Audit log: the actions we record, readable names for them, and the filters the viewer accepts. */
export const AUDIT_ACTIONS: Record<string, string> = {
  login: 'Signed in',
  login_denied: 'Sign-in refused',
  permission_denied: 'Blocked by role',
  mfa_enroll_started: 'Two-step setup started',
  mfa_enabled: 'Two-step verification turned on',
  mfa_verified: 'Two-step code accepted',
  mfa_failed: 'Two-step code refused',
  mfa_recovery_used: 'Recovery code used',
  mfa_reset: 'Two-step reset by an owner',
  login_passkey: 'Signed in with a passkey',
  passkey_added: 'Passkey added',
  passkey_renamed: 'Passkey renamed',
  passkey_removed: 'Passkey removed',
  passkey_removed_by_owner: 'Passkey removed by an owner',
  passkey_failed: 'Passkey refused',
  delete_subscriber: 'Launch-list entry deleted',
  export_subscribers: 'Launch list exported',
  update_message: 'Message updated',
  delete_message: 'Message deleted',
  update_issue: 'Problem report updated',
  delete_issue: 'Problem report deleted',
  product_create: 'Product created',
  product_update: 'Product updated',
  product_update_blocked: 'Product change blocked',
  product_image_upload: 'Photo uploaded',
  product_gallery_update: 'Photos changed',
  variant_create: 'Pack size added',
  variant_update: 'Pack size changed',
  variant_delete: 'Pack size deleted',
  batch_receive: 'Stock received',
  batch_adjust: 'Stock adjusted',
  batch_status: 'Batch status changed',
  order_create: 'Order created',
  order_status: 'Order status changed',
  order_note: 'Order note added',
  export_orders: 'Orders exported',
  refund_create: 'Refund requested',
  refund_status: 'Refund decision recorded',
  delivery_area_add: 'Delivery PIN code added',
  delivery_area_update: 'Delivery PIN code changed',
  delivery_area_toggle: 'Delivery PIN code switched on or off',
  delivery_areas_bulk: 'Delivery PIN codes added in bulk',
  export_delivery_areas: 'Delivery areas exported',
  delete_member: 'Member account deleted',
  export_members: 'Members exported',
  export_audit: 'Audit log exported',
};
export const auditLabel = (action: string): string => AUDIT_ACTIONS[action] ?? action;

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
}

export interface AuditQuery {
  actor: string;
  action: string;
  /** inclusive start day, YYYY-MM-DD, India time */
  from: string;
  /** inclusive end day, YYYY-MM-DD, India time */
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string): boolean => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Reads the viewer's filters from a query string. Anything unrecognised is dropped rather than passed to the database. */
export function parseAuditQuery(q: Record<string, unknown>): AuditQuery {
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
  const actor = str('actor').replace(/[^A-Za-z0-9@._+-]/g, '').slice(0, 80);
  const action = Object.hasOwn(AUDIT_ACTIONS, str('action')) ? str('action') : '';
  const from = validDate(str('from')) ? str('from') : '';
  const to = validDate(str('to')) ? str('to') : '';
  return { actor, action, from, to };
}

const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** PostgREST filter string for the parsed query. The day range is in India time, so the offset is part of the timestamp. */
export function auditFilter(q: AuditQuery): string {
  let f = '';
  if (q.actor) f += `&actor=ilike.*${q.actor}*`;
  if (q.action) f += `&action=eq.${q.action}`;
  if (q.from) f += `&at=gte.${encodeURIComponent(`${q.from}T00:00:00+05:30`)}`;
  if (q.to) f += `&at=lt.${encodeURIComponent(`${nextDay(q.to)}T00:00:00+05:30`)}`;
  return f;
}

const SECRET_KEY_RE = /(password|secret|token|recovery|otp|hash|cookie)/i;

/** One readable line for the table. Keys that look secret are masked in case one is ever logged by mistake. */
export function summariseDetail(detail: unknown, max = 220): string {
  if (typeof detail !== 'object' || detail === null) return '';
  const parts = Object.entries(detail as Record<string, unknown>).map(([k, v]) => {
    if (SECRET_KEY_RE.test(k)) return `${k}: ••••`;
    const val = typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}: ${val}`;
  });
  const line = parts.join(' · ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const AUDIT_CSV_HEADERS = ['id', 'at', 'actor', 'action', 'what', 'detail'] as const;
/** One CSV row. Detail goes through summariseDetail, so keys that look secret are masked here as well as in the viewer. */
export function auditCsvRow(r: AuditRow): Record<string, unknown> {
  return { id: r.id, at: r.at, actor: r.actor, action: r.action, what: auditLabel(r.action), detail: summariseDetail(r.detail, 2000) };
}
