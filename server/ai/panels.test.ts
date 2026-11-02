import { describe, expect, it } from 'vitest';
import type { Snapshot } from './data.js';
import { buildPanels, topicsFor } from './panels.js';

const snap: Snapshot = {
  today: '2026-10-24',
  sales: { windowDays: 30, orders: 12, revenue: '₹10,000.00', averageOrder: '₹833.33', cancelled: 1, revenueChangeVsPreviousPeriod: null, topProducts: [{ name: 'Tulsi Syrup', units: 7, revenue: '₹1,746.50' }], awaitingPayment: 2, paidToFulfil: 3, note: 'Before refunds.' },
  inventory: { packSizes: 4, sellableUnitsOnHand: 80, outOfStock: [{ product: 'Aloe Gel', pack: '100 g' }], lowStock: [{ product: 'Tulsi Syrup', pack: '200 ml', units: 3 }], expiredUnits: 0, expiringUnits: 5, roughDaysOfCover: [], note: 'Rough guide.' },
  operations: { shipments: { delayed: [{ shipment_no: 'SH-1', status: 'in_transit', daysLate: 2 }], inMotion: 4 }, refundQueue: { awaitingDecision: 1, approvedNotYetPaid: 0 }, paymentsNeedingReview: 0 },
  unavailableSections: ['finance and profit (owner only)'],
  incompleteSections: [],
};

describe('admin info panels', () => {
  it('picks topics from the question, and every topic for a broad or unclear one', () => {
    expect(topicsFor('Which products need restocking?')).toEqual(expect.arrayContaining(['stock']));
    expect(topicsFor('Which products are selling fastest?')).toEqual(['sales']);
    expect(topicsFor('What needs my attention today?')).toHaveLength(4);
    expect(topicsFor('hmm')).toHaveLength(4);
  });
  it('copies the verified figures exactly, never calculating anything', () => {
    const p = buildPanels(snap, 'Which products are selling fastest?');
    expect(p.map((x) => x.id)).toEqual(['sales', 'top-products']);
    expect(p[0]?.rows).toContainEqual(['Revenue', '₹10,000.00']);
    expect(p[0]?.rows).toContainEqual(['Change vs previous period', 'Not enough data']);
    expect(p[1]?.rows).toEqual([['Tulsi Syrup', '7', '₹1,746.50']]);
  });
  it('lists stock problems and operations, and leaves out sections the role cannot read', () => {
    const stock = buildPanels(snap, 'what needs restocking');
    expect(stock[0]?.rows).toEqual([['Aloe Gel', '100 g', 'Out of stock'], ['Tulsi Syrup', '200 ml', '3 left (low)']]);
    const all = buildPanels(snap, 'summarise my business');
    expect(all.some((x) => x.id === 'finance')).toBe(false);
    expect(all.find((x) => x.id === 'delayed')?.rows).toEqual([['SH-1', 'in_transit', '2']]);
  });
});
