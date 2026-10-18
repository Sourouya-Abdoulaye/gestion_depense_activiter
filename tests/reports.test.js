/* ---------------------------------------------------------------------------
 * Tests des rapports : recalcul depuis les opérations sources, filtres par
 * activité et période, exports tabulaires.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReport, periodLabel, reportToFlatRows, reportToSections } from '../src/services/reports.js';
import { formatDate, formatMoney } from '../src/shared/format.js';
import { addExpense, addProduct, addPurchase, addSale, createWorld } from './helpers.js';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31', preset: 'month' };
const NOVEMBER = { from: '2026-11-01', to: '2026-11-30', preset: 'month' };

function buildReportWorld() {
  const { world, activity } = createWorld({ capital: 40000 });
  const product = addProduct(world, { name: 'Pantalon', cost: 1500, price: 2500, alertThreshold: 5 });
  addPurchase(world, { lines: [{ product, quantity: 21, unitPrice: 1500 }], transportCost: 2000, status: 'received', pay: 33500, date: '2026-10-01' });
  addExpense(world, { category: 'Publicité', amount: 600, date: '2026-10-02' });
  addSale(world, { items: [{ product, quantity: 20, unitPrice: 2500 }], pay: 50000, date: '2026-10-05' });
  addSale(world, { items: [{ product, quantity: 1, unitPrice: 2500 }], pay: 2500, date: '2026-11-03' });
  return { world, activity, product };
}

test('le rapport reprend les indicateurs du scénario de référence', () => {
  const { world, activity } = buildReportWorld();
  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });

  assert.equal(report.kpis.revenue, 50000);
  assert.equal(report.kpis.costOfGoodsSold, 31904.76);
  assert.equal(report.kpis.grossMargin, 18095.24);
  assert.equal(report.kpis.operatingExpenses, 600);
  assert.equal(report.kpis.estimatedResult, 17495.24);
  // La trésorerie est un solde global (elle n'est pas bornée par la période :
  // la vente de novembre est déjà encaissée), contrairement aux flux de la période.
  assert.equal(report.kpis.treasury, 55900 + 2500);
  assert.equal(report.treasury.cashIn, 50000);
  assert.equal(report.salesTable.length, 1);
  assert.equal(report.purchasesTable.length, 1);
  assert.equal(report.activity.name, activity.name);
  assert.ok(report.assumptions.length >= 8);
});

test('les filtres de période isolent bien chaque mois', () => {
  const { world, activity } = buildReportWorld();
  const november = buildReport(world, { activityId: activity.id, period: NOVEMBER });

  assert.equal(november.kpis.revenue, 2500);
  assert.equal(november.salesTable.length, 1);
  // le stock restant au 30 novembre est valorisé au coût d'acquisition
  assert.equal(november.kpis.stockValue, 0);
  assert.equal(november.kpis.receivables, 0);
});

test('les créances et dettes sont présentées séparément du résultat', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Article', cost: 1000, price: 2000, quantity: 5, unitCost: 1000 });
  world.customers.push({ id: 'cli_1', name: 'Client crédit' });
  addSale(world, { items: [{ product, quantity: 3, unitPrice: 2000 }], pay: 2000, customerId: 'cli_1', date: '2026-10-05' });

  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });
  assert.equal(report.kpis.revenue, 6000);
  assert.equal(report.kpis.receivables, 4000);
  assert.equal(report.kpis.treasury, 2000);
  assert.equal(report.receivables.list.length, 1);
});

test('les documents annulés sont exclus des rapports', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Article', cost: 1000, price: 2000, quantity: 5, unitCost: 1000 });
  const sale = addSale(world, { items: [{ product, quantity: 2, unitPrice: 2000 }], pay: 4000, date: '2026-10-05' });
  world.sales[0] = { ...sale, status: 'cancelled' };

  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });
  assert.equal(report.kpis.revenue, 0);
  assert.equal(report.salesTable.length, 0);
});

test('les alertes de stock figurent dans le rapport', () => {
  const { world, activity } = buildReportWorld();
  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });
  assert.equal(report.stock.alerts.length, 1);
  assert.equal(report.stock.alerts[0].name, 'Pantalon');
  // les deux ventes (octobre et novembre) ont épuisé le stock
  assert.equal(report.stock.alerts[0].quantity, 0);
  assert.equal(report.stock.alerts[0].severity, 'rupture');
});

test('les sections d’export contiennent les en-têtes et les lignes attendues', () => {
  const { world, activity } = buildReportWorld();
  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });
  const sections = reportToSections(report, {
    formatDate: (value) => formatDate(value, 'dd/MM/yyyy'),
    formatMoney: (value) => formatMoney(value),
    formatQuantity: (value) => String(value),
  });

  const synthese = sections.find((section) => section.title === 'Synthèse financière');
  assert.ok(synthese);
  assert.equal(synthese.columns.length, 2);
  assert.ok(synthese.rows.some((row) => row[0] === 'Résultat estimé' && row[1] === '17 495,24 FCFA'));

  const ventes = sections.find((section) => section.title === 'Ventes de la période');
  assert.equal(ventes.rows.length, 1);
  assert.equal(ventes.rows[0][1], '05/10/2026');
});

test('les lignes plates d’export respectent la période et l’activité', () => {
  const { world, activity } = buildReportWorld();
  const report = buildReport(world, { activityId: activity.id, period: OCTOBER });
  const rows = reportToFlatRows(report);
  assert.equal(rows.find((row) => row.indicateur === 'Du').valeur, '2026-10-01');
  assert.equal(rows.find((row) => row.indicateur === 'Au').valeur, '2026-10-31');
  assert.equal(rows.find((row) => row.indicateur === 'Nom').valeur, activity.name);
});

test('libellé de période lisible', () => {
  assert.equal(periodLabel(OCTOBER, (value) => formatDate(value, 'dd/MM/yyyy')), 'du 01/10/2026 au 31/10/2026');
  assert.equal(periodLabel({ from: '2026-10-05', to: '2026-10-05' }, (value) => formatDate(value, 'dd/MM/yyyy')), '05/10/2026');
  assert.equal(periodLabel({ preset: 'all' }), 'Tout l’historique');
  assert.equal(periodLabel(null), 'Tout l’historique');
});
