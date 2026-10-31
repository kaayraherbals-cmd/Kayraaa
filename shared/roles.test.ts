import { describe, expect, it } from 'vitest';
import { PERMISSIONS, can, parseAdminRoles, permissionsOf } from './roles.js';

describe('role permissions', () => {
  it('gives the owner everything', () => {
    for (const p of PERMISSIONS) expect(can('owner', p)).toBe(true);
  });
  it('keeps destructive, publishing, price, export, audit and team actions with the owner', () => {
    for (const p of ['subscribers.delete', 'subscribers.export', 'products.status', 'messages.delete', 'issues.delete', 'products.price', 'orders.export', 'members.export', 'members.delete', 'audit.read', 'audit.export', 'team.read', 'team.manage'] as const) {
      expect(can('manager', p)).toBe(false);
      expect(can('support', p)).toBe(false);
    }
  });
  it('lets a manager run catalogue, stock and orders', () => {
    for (const p of ['products.create', 'products.edit', 'inventory.write', 'orders.write', 'orders.note'] as const) expect(can('manager', p)).toBe(true);
  });
  it('keeps support to reading, replying and notes', () => {
    expect(can('support', 'messages.update')).toBe(true);
    expect(can('support', 'orders.note')).toBe(true);
    for (const p of ['products.edit', 'products.status', 'inventory.write', 'orders.write'] as const) expect(can('support', p)).toBe(false);
  });
  it('lets every role read members, since they answer account questions', () => {
    for (const r of ['owner', 'manager', 'support'] as const) expect(can(r, 'members.read')).toBe(true);
  });
  it('lets managers ask for refunds but only the owner decide them, and support only look', () => {
    expect(can('manager', 'refunds.write')).toBe(true);
    expect(can('support', 'refunds.write')).toBe(false);
    for (const r of ['manager', 'support'] as const) expect(can(r, 'refunds.approve')).toBe(false);
    for (const r of ['owner', 'manager', 'support'] as const) expect(can(r, 'refunds.read')).toBe(true);
  });
  it('lists permissions in a stable order', () => {
    expect(permissionsOf('support')).toEqual(PERMISSIONS.filter((p) => can('support', p)));
  });
});

describe('delivery areas', () => {
  it('lets every role look, and only the owner change charges, free-delivery amounts and which PIN codes are on', () => {
    for (const r of ['owner', 'manager', 'support'] as const) expect(can(r, 'delivery.read')).toBe(true);
    expect(can('owner', 'delivery.write')).toBe(true);
    for (const r of ['manager', 'support'] as const) expect(can(r, 'delivery.write')).toBe(false);
  });
});

describe('parseAdminRoles', () => {
  const admins = ['boss@kaayra.in', 'ops@kaayra.in', 'help@kaayra.in'];
  it('never grants owner (or any role) when ADMIN_ROLES is missing or blank: it fails closed', () => {
    for (const raw of [undefined, '', '  ']) {
      const r = parseAdminRoles(raw, admins);
      expect(r.ok).toBe(false);
      expect(r.roles).toEqual({});
      expect(r.problems.join(' ')).toMatch(/ADMIN_ROLES is required/);
    }
  });
  it('assigns listed roles case-insensitively and defaults the rest to support', () => {
    const r = parseAdminRoles('Boss@Kaayra.in:Owner, ops@kaayra.in:manager', admins);
    expect(r.ok).toBe(true);
    expect(r.roles).toEqual({ 'boss@kaayra.in': 'owner', 'ops@kaayra.in': 'manager', 'help@kaayra.in': 'support' });
  });
  it('is invalid without an owner', () => {
    const r = parseAdminRoles('ops@kaayra.in:manager', admins);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/at least one owner/);
  });
  it('rejects typos, unknown roles, strangers and conflicts instead of guessing', () => {
    expect(parseAdminRoles('boss@kaayra.in:owner,ops@kaayra.in:admin', admins).ok).toBe(false);
    expect(parseAdminRoles('boss@kaayra.in:owner,ops@kaayra.in', admins).ok).toBe(false);
    expect(parseAdminRoles('boss@kaayra.in:owner,stranger@x.co:manager', admins).ok).toBe(false);
    expect(parseAdminRoles('boss@kaayra.in:owner,boss@kaayra.in:support', admins).ok).toBe(false);
  });
});

describe('shipment permissions', () => {
  it('lets owner and manager manage shipments and support only look', () => {
    expect(can('owner', 'shipments.write')).toBe(true);
    expect(can('manager', 'shipments.read') && can('manager', 'shipments.write')).toBe(true);
    expect(can('support', 'shipments.read')).toBe(true);
    expect(can('support', 'shipments.write')).toBe(false);
  });
});

describe('bundles permissions (Stage 7E)', () => {
  it('only the owner can read or change bundles', () => {
    expect(can('owner', 'bundles.read')).toBe(true);
    expect(can('owner', 'bundles.write')).toBe(true);
    for (const r of ['manager', 'support'] as const) for (const p of ['bundles.read', 'bundles.write'] as const) expect(can(r, p)).toBe(false);
  });
});
