/**
 * Admin roles and permissions. Roles come from configuration (ADMIN_ROLES), never from the browser or the session cookie,
 * so changing a role or removing an address takes effect on the very next request.
 *
 *   owner    everything (coupons.*, recovery.* (cart recovery) and finance.* (business intelligence, costs, expenses) are owner-only: no other role is granted them), including deletes, price changes, delivery charges and areas, publishing (status and review sign-off), exports, the audit log and the team page
 *   manager  prepares the catalogue and runs stock and orders day to day; cannot publish, delete data, export personal data or change prices (delivery charges count as prices: managers can look at delivery areas, not change them)
 *   support  answers messages and problem reports, looks things up and adds order notes; read-only elsewhere
 */
export const ROLES = ['owner', 'manager', 'support'] as const;
export type AdminRole = (typeof ROLES)[number];
export const isRole = (v: unknown): v is AdminRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const ROLE_LABELS: Record<AdminRole, string> = { owner: 'Owner', manager: 'Manager', support: 'Support' };

export const PERMISSIONS = [
  'subscribers.read',
  'subscribers.delete',
  'subscribers.export',
  'messages.read',
  'messages.update',
  'messages.delete',
  'issues.read',
  'issues.update',
  'issues.delete',
  'products.read',
  'products.create',
  'products.edit',
  'products.status',
  'products.price',
  'inventory.read',
  'inventory.write',
  'orders.read',
  'orders.note',
  'orders.write',
  'orders.export',
  'shipments.read',
  'shipments.write',
  'delivery.read',
  'delivery.write',
  'refunds.read',
  'refunds.write',
  'refunds.approve',
  'payments.read',
  'payments.write',
  'coupons.read',
  'coupons.write',
  'bundles.read',
  'bundles.write',
  'members.read',
  'members.export',
  'members.delete',
  'audit.read',
  'audit.export',
  'team.read',
  'team.manage',
  'reviews.read',
  'reviews.moderate',
  'reviews.reply',
  'recovery.read',
  'recovery.manage',
  'finance.read',
  'finance.write',
  'finance.export',
  'ai.intelligence',
  'ai.content',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER: readonly Permission[] = PERMISSIONS;
const MANAGER: readonly Permission[] = [
  'subscribers.read',
  'messages.read',
  'messages.update',
  'issues.read',
  'issues.update',
  'products.read',
  'products.create',
  'products.edit',
  'inventory.read',
  'inventory.write',
  'orders.read',
  'orders.note',
  'orders.write',
  'shipments.read',
  'shipments.write',
  'delivery.read',
  'refunds.read',
  'refunds.write',
  'payments.read',
  'payments.write',
  'members.read',
  'reviews.read',
  'reviews.moderate',
  'reviews.reply',
  'ai.content',
];
const SUPPORT: readonly Permission[] = [
  'subscribers.read',
  'messages.read',
  'messages.update',
  'issues.read',
  'issues.update',
  'products.read',
  'inventory.read',
  'orders.read',
  'orders.note',
  'shipments.read',
  'delivery.read',
  'refunds.read',
  'payments.read',
  'members.read',
  'reviews.read',
  'reviews.reply',
];

const MATRIX: Record<AdminRole, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  manager: new Set(MANAGER),
  support: new Set(SUPPORT),
};

export const can = (role: AdminRole, permission: Permission): boolean => MATRIX[role].has(permission);
export const permissionsOf = (role: AdminRole): Permission[] => PERMISSIONS.filter((p) => MATRIX[role].has(p));

export interface RolesResult {
  ok: boolean;
  /** email (lower case) to role, for every address in the allowlist */
  roles: Record<string, AdminRole>;
  problems: string[];
}

/**
 * ADMIN_ROLES is "email:role,email:role". It is optional:
 *  - not set: every address in ADMIN_EMAILS is an owner (exactly how the panel behaved before roles existed);
 *  - set: listed addresses get their role, unlisted allowlisted addresses fall back to support (least privilege),
 *    and there must be at least one owner. Any mistake makes the whole value invalid and the admin API fails closed,
 *    because silently guessing on a security setting is worse than a clear setup message.
 */
export function parseAdminRoles(raw: string | undefined, admins: string[]): RolesResult {
  const roles: Record<string, AdminRole> = {};
  const problems: string[] = [];
  const text = (raw ?? '').trim();
  if (text === '') {
    // Fail closed: a missing ADMIN_ROLES never grants anyone owner access. No roles are assigned, so nobody can sign in
    // to the admin until the owner states every role explicitly.
    problems.push('ADMIN_ROLES is required: list every admin as email:role, with at least one owner');
    return { ok: false, roles, problems };
  }
  const explicit: Record<string, AdminRole> = {};
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.lastIndexOf(':');
    const email = (i > 0 ? part.slice(0, i) : '').trim().toLowerCase();
    const role = (i > 0 ? part.slice(i + 1) : '').trim().toLowerCase();
    if (!email || !isRole(role)) {
      problems.push(`"${part}" is not email:role with a role of owner, manager or support`);
      continue;
    }
    if (!admins.includes(email)) problems.push(`${email} has a role but is not in ADMIN_EMAILS`);
    if (explicit[email] && explicit[email] !== role) problems.push(`${email} is given two different roles`);
    explicit[email] = role;
  }
  for (const a of admins) roles[a] = explicit[a] ?? 'support';
  if (!admins.some((a) => roles[a] === 'owner')) problems.push('ADMIN_ROLES needs at least one owner');
  return { ok: problems.length === 0, roles, problems };
}
