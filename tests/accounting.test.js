/* ---------------------------------------------------------------------------
 * Tests du journal comptable simplifié (L9) et de la comparaison de périodes (L11).
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAccountingJournal } from '../src/services/accounting.js';
import { comparePeriods } from '../src/services/reports.js';
import { addExpense, addProduct, addPurchase, addSale, createWorld } from './helpers.js';

function buildWorld() {
  const { world } = createWorld({ capital: 40000 });
  const product = addProduct(world, { name: 'Pantalon', cost: 1500, price: 2500, quantity: 21, unitCost: 1500 });
  addPurchase(world, { lines: [{ product, quantity: 5, unitPrice: 1500 }], pay: 5000, date: '2026-10-02' });
  addSale(world, { items: [{ product, quantity: 2, unitPrice: 2500 }], pay: 5000, date: '2026-10-05' });
  addExpense(world, { category: 'Publicité', amount: 600, date: '2026-10-03' });
  return world;
}

test('le journal comptable est équilibré (débit = crédit)', () => {
  const world = buildWorld();
  const journal = buildAccountingJournal(world, { period: { from: '2026-10-01', to: '2026-10-31' } });
  assert.ok(journal.rows.length > 0);
  assert.equal(journal.balanced, true);
  assert.equal(journal.totals.debit, journal.totals.credit);
  assert.ok(journal.rows.every((row) => row.date >= '2026-10-01' && row.date <= '2026-10-31'));
});

test('le journal comptable contient ventes, achats, paiements et dépenses', () => {
  const world = buildWorld();
  const journal = buildAccountingJournal(world, {});
  const accounts = new Set(journal.rows.map((row) => row.account));
  assert.ok(accounts.has('411'));
  assert.ok(accounts.has('701'));
  assert.ok(accounts.has('401'));
  assert.ok(accounts.has('601'));
  assert.ok(accounts.has('606'));
  assert.ok(accounts.has('571'));
  assert.ok(journal.rows.some((row) => row.source === 'sale'));
  assert.ok(journal.rows.some((row) => row.source === 'payment'));
});

test('le journal comptable respecte le filtre d’activité', () => {
  const world = buildWorld();
  const journal = buildAccountingJournal(world, { activityId: 'act_inconnue' });
  assert.equal(journal.rows.length, 0);
  assert.equal(journal.balanced, true);
});

test('la comparaison N vs N−1 calcule les écarts', () => {
  const world = buildWorld();
  const comparison = comparePeriods(world, { period: { from: '2026-10-01', to: '2026-10-31', preset: 'custom' } });
  assert.ok(comparison);
  assert.equal(comparison.previous.to, '2026-09-30');
  assert.equal(comparison.previous.from, '2026-08-31');
  const revenue = comparison.metrics.find((metric) => metric.key === 'revenue');
  assert.ok(revenue.current > 0);
  assert.equal(revenue.previous, 0);
  assert.equal(revenue.percent, null);
  assert.equal(revenue.delta, revenue.current);
});

test('la comparaison est indisponible pour tout l’historique', () => {
  const world = buildWorld();
  assert.equal(comparePeriods(world, { period: { from: '2026-01-01', to: '2026-12-31', preset: 'all' } }), null);
});
