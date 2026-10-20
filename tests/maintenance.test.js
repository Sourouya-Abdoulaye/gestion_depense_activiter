/* ---------------------------------------------------------------------------
 * Tests de l'archivage par exercice et de la purge guidée (L4).
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dataVolume, planPurge } from '../src/services/maintenance.js';
import { computeStockState } from '../src/services/stock.js';
import { addExpense, addProduct, addPurchase, addSale, createWorld } from './helpers.js';

function cashBalance(world, movements = world.cashMovements) {
  return world.cashAccounts.reduce((total, account) => {
    const own = movements.filter((movement) => movement.accountId === account.id);
    return total + own.reduce(
      (balance, movement) => balance + (movement.direction === 'in' ? movement.amount : -movement.amount),
      account.initialBalance || 0,
    );
  }, 0);
}

test('la purge conserve les soldes de stock et de trésorerie', () => {
  const { world } = createWorld({ capital: 500000 });
  const product = addProduct(world, { name: 'Chemise', cost: 1000, price: 2500, quantity: 10, unitCost: 1000 });
  addPurchase(world, { lines: [{ product, quantity: 10, unitPrice: 1500 }], pay: 15000, date: '2026-01-10' });
  addSale(world, { items: [{ product, quantity: 4, unitPrice: 2500 }], pay: 10000, date: '2026-02-05' });
  addExpense(world, { amount: 5000, date: '2026-03-01' });
  addSale(world, { items: [{ product, quantity: 2, unitPrice: 2500 }], pay: 5000, date: '2026-10-05' });

  const stockBefore = computeStockState(world.stockMovements, world.products);
  const cashBefore = cashBalance(world);
  const plan = planPurge(world, '2026-09-01');

  assert.equal(plan.deletions.sales.length, 1);
  assert.equal(plan.deletions.purchases.length, 1);
  assert.equal(plan.deletions.expenses.length, 1);
  assert.equal(plan.deletions.stockMovements.length, 0);
  assert.equal(plan.kept.sales, 1);

  const stockAfter = computeStockState(world.stockMovements, world.products);
  assert.equal(stockAfter[product.id].quantity, stockBefore[product.id].quantity);
  assert.ok(Math.abs(stockAfter[product.id].value - stockBefore[product.id].value) < 0.01);

  const keptCash = world.cashMovements.filter((movement) => !plan.deletions.cashMovements.includes(movement.id));
  assert.ok(Math.abs(cashBalance(world, [...keptCash, ...plan.openingCashMovements]) - cashBefore) < 0.01);
});

test('une vente ancienne encore impayée est conservée avec ses paiements', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Sac', cost: 5000, price: 9000, quantity: 5, unitCost: 5000 });
  const sale = addSale(world, { items: [{ product, quantity: 1, unitPrice: 9000 }], pay: 4000, date: '2026-01-15' });
  const plan = planPurge(world, '2026-09-01');

  assert.equal(plan.deletions.sales.includes(sale.id), false);
  assert.equal(plan.kept.sales, 1);
  assert.equal(plan.deletions.payments.length, 0);
});

test('la purge refuse une date invalide', () => {
  const { world } = createWorld();
  assert.throws(() => planPurge(world, 'pas-une-date'), /date de clôture valide/);
});

test('la volumétrie résume les documents datés', () => {
  const { world } = createWorld({ capital: 1000 });
  const product = addProduct(world, { name: 'T-shirt', cost: 1000, price: 2000, quantity: 2, unitCost: 1000 });
  addSale(world, { items: [{ product, quantity: 1, unitPrice: 2000 }], pay: 2000, date: '2026-10-05' });
  const volume = dataVolume(world);
  assert.equal(volume.counts.sales, 1);
  assert.equal(volume.oldest, '2026-10-01');
  assert.equal(volume.newest, '2026-10-05');
  assert.equal(volume.master.products, 1);
});
