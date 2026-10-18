/* ---------------------------------------------------------------------------
 * Scénario de référence OBLIGATOIRE du cahier des charges (§5 et §10)
 *
 * Capital initial : 40 000 FCFA.
 * Achat de 21 pantalons à 1 500 FCFA = 31 500 FCFA. Transport = 2 000 FCFA.
 * Publicité = 600 FCFA. Total décaissé = 34 100 FCFA.
 * Budget restant avant vente = 5 900 FCFA.
 * Vente de 20 pantalons à 2 500 FCFA = 50 000 FCFA. Stock restant = 1 pantalon.
 *   • Coût d'acquisition unitaire = (31 500 + 2 000) / 21 ≈ 1 595,24 FCFA
 *   • Coût des 20 vendus ≈ 31 904,76 FCFA
 *   • Résultat estimé ≈ 50 000 − 31 904,76 − 600 = 17 495,24 FCFA
 *   • Trésorerie finale = 55 900 FCFA
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityBudget,
  computeKpis,
  costOfGoodsSold,
  estimatedResult,
  grossMargin,
  periodOperatingExpenses,
  revenue,
  treasuryBalance,
} from '../src/services/finance.js';
import { computeProductStock, stockValue } from '../src/services/stock.js';
import {
  addExpense,
  addProduct,
  addPurchase,
  addSale,
  createWorld,
  worldStock,
} from './helpers.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-31', preset: 'month' };

function buildScenario() {
  const { world, activity, account } = createWorld({ capital: 40000, date: '2026-10-01' });
  const pantalon = addProduct(world, { name: 'Pantalon jean', cost: 1500, price: 2500, unit: 'pièce' });

  const purchase = addPurchase(world, {
    lines: [{ product: pantalon, quantity: 21, unitPrice: 1500 }],
    transportCost: 2000,
    status: 'received',
    pay: 33500,
    date: '2026-10-01',
  });

  const publicite = addExpense(world, { category: 'Publicité', amount: 600, nature: 'operating', date: '2026-10-02' });

  const sale = addSale(world, {
    items: [{ product: pantalon, quantity: 20, unitPrice: 2500 }],
    pay: 50000,
    date: '2026-10-05',
  });

  return { world, activity, account, pantalon, purchase, publicite, sale };
}

test('coût d’acquisition unitaire : (31 500 + 2 000) ÷ 21 ≈ 1 595,24 FCFA', () => {
  const { purchase } = buildScenario();
  const unitCost = purchase.lines[0].allocatedUnitCost;
  assert.equal(Number(unitCost.toFixed(2)), 1595.24);
  // la précision complète est conservée en interne
  assert.ok(Math.abs(unitCost - 33500 / 21) < 1e-9);
});

test('total de l’achat et coût des 20 vendus', () => {
  const { world, purchase, sale } = buildScenario();
  assert.equal(purchase.total, 33500);
  assert.equal(sale.lines[0].unitCost, purchase.lines[0].allocatedUnitCost);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters: PERIOD }), 31904.76);
});

test('chiffre d’affaires, marge brute et résultat estimé', () => {
  const { world, activity } = buildScenario();
  const filters = { activityId: activity.id, ...PERIOD };

  assert.equal(revenue({ sales: world.sales, returns: world.returns, filters }), 50000);
  assert.equal(grossMargin({ sales: world.sales, returns: world.returns, filters }), 18095.24);
  assert.equal(periodOperatingExpenses({ expenses: world.expenses, filters }), 600);
  assert.equal(estimatedResult({ sales: world.sales, returns: world.returns, expenses: world.expenses, filters }), 17495.24);
});

test('stock restant : un pantalon valorisé au coût d’acquisition', () => {
  const { world, pantalon } = buildScenario();
  const entry = computeProductStock(world.stockMovements, pantalon.id, pantalon.cost);
  assert.equal(entry.quantity, 1);
  assert.equal(Number(entry.value.toFixed(2)), 1595.24);
  assert.equal(stockValue(worldStock(world)), 1595.24);
});

test('trésorerie finale = 55 900 FCFA (34 100 décaissés, 50 000 encaissés)', () => {
  const { world } = buildScenario();
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 55900);
});

test('budget restant avant vente = 5 900 FCFA, distinct de la trésorerie', () => {
  const { world, activity } = buildScenario();
  const budget = activityBudget(activity, { cashMovements: world.cashMovements });
  assert.equal(budget.available, 40000);
  assert.equal(budget.consumed, 34100);
  assert.equal(budget.remaining, 5900);
  assert.equal(budget.breakdown.purchasesPaid, 33500);
  assert.equal(budget.breakdown.expensesPaid, 600);

  const kpis = computeKpis(world, { activityId: activity.id, period: PERIOD });
  assert.equal(kpis.treasury, 55900);
  assert.notEqual(kpis.treasury, budget.remaining);
});

test('les frais d’approvisionnement ne sont pas déduits deux fois', () => {
  const { world, activity } = buildScenario();
  const filters = { activityId: activity.id, ...PERIOD };
  // 2 000 FCFA de transport sont déjà dans le coût d'acquisition :
  // ils ne doivent pas apparaître une seconde fois dans les dépenses d'exploitation.
  assert.equal(periodOperatingExpenses({ expenses: world.expenses, filters }), 600);
  assert.equal(estimatedResult({ sales: world.sales, returns: world.returns, expenses: world.expenses, filters }), 17495.24);
  // et le stock restant (1 pantalon) n'est pas déduit du bénéfice
  assert.equal(stockValue(worldStock(world)), 1595.24);
});

test('les KPI du tableau de bord sont cohérents avec le scénario', () => {
  const { world, activity } = buildScenario();
  const kpis = computeKpis(world, { activityId: activity.id, period: PERIOD });
  assert.equal(kpis.revenue, 50000);
  assert.equal(kpis.costOfGoodsSold, 31904.76);
  assert.equal(kpis.grossMargin, 18095.24);
  assert.equal(kpis.operatingExpenses, 600);
  assert.equal(kpis.estimatedResult, 17495.24);
  assert.equal(kpis.stockValue, 1595.24);
  assert.equal(kpis.treasury, 55900);
  assert.equal(kpis.cashIn, 50000);
  assert.equal(kpis.cashOut, 34100);
  assert.equal(kpis.contributions, 40000);
  assert.equal(kpis.salesCount, 1);
  assert.equal(kpis.averageBasket, 50000);
});

test('une dépense d’approvisionnement n’est jamais comptée dans le résultat', () => {
  const { world, activity } = createWorld({ capital: 20000 });
  const riz = addProduct(world, { name: 'Riz 25 kg', cost: 9000, price: 11000 });
  addPurchase(world, { lines: [{ product: riz, quantity: 2, unitPrice: 9000 }], status: 'received', pay: 18000 });
  addExpense(world, { category: 'Transport', amount: 1500, nature: 'supply', date: '2026-10-02' });
  addSale(world, { items: [{ product: riz, quantity: 2, unitPrice: 11000 }], pay: 22000, date: '2026-10-06' });

  const filters = { activityId: activity.id, ...PERIOD };
  assert.equal(periodOperatingExpenses({ expenses: world.expenses, filters }), 0);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters }), 18000);
  assert.equal(estimatedResult({ sales: world.sales, returns: world.returns, expenses: world.expenses, filters }), 4000);
  // la trésorerie, elle, tient bien compte des 1 500 FCFA payés
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 20000 - 18000 - 1500 + 22000);
});

test('un investissement et un retrait personnel impactent la trésorerie sans toucher au résultat', () => {
  const { world, activity } = createWorld({ capital: 50000 });
  const article = addProduct(world, { name: 'Chemise', cost: 2000, price: 4000, quantity: 10, unitCost: 2000 });
  addSale(world, { items: [{ product: article, quantity: 5, unitPrice: 4000 }], pay: 20000, date: '2026-10-05' });
  addExpense(world, { category: 'Autres', amount: 12000, nature: 'investment', date: '2026-10-03' });
  addExpense(world, { category: 'Autres', amount: 5000, nature: 'personal', date: '2026-10-04' });

  const filters = { activityId: activity.id, ...PERIOD };
  assert.equal(periodOperatingExpenses({ expenses: world.expenses, filters }), 0);
  assert.equal(estimatedResult({ sales: world.sales, returns: world.returns, expenses: world.expenses, filters }), 10000);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 50000 + 20000 - 12000 - 5000);
});
