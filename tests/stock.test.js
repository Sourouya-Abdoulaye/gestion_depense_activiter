/* ---------------------------------------------------------------------------
 * Tests du stock : coût moyen pondéré, corrections, pertes, alertes.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BusinessError } from '../src/shared/validators.js';
import {
  assertStockAvailable,
  buildCorrectionMovement,
  buildMovement,
  computeProductStock,
  computeStockState,
  currentUnitCost,
  lowStockAlerts,
  movementSummary,
  stockValue,
} from '../src/services/stock.js';
import { newId, ID_PREFIX } from '../src/shared/id.js';

const movement = (overrides) => ({
  id: newId(ID_PREFIX.STOCK_MOVEMENT),
  activityId: 'act_1',
  productId: 'prd_1',
  date: '2026-10-01',
  type: 'in',
  reason: 'opening',
  quantity: 0,
  unitCost: null,
  sourceType: null,
  sourceId: null,
  note: '',
  createdAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
});

test('coût moyen pondéré : deux entrées à des prix différents', () => {
  const movements = [
    movement({ date: '2026-10-01', quantity: 10, unitCost: 1000 }),
    movement({ date: '2026-10-02', quantity: 10, unitCost: 2000 }),
  ];
  const entry = computeProductStock(movements, 'prd_1', 0);
  assert.equal(entry.quantity, 20);
  assert.equal(entry.value, 30000);
  assert.equal(entry.averageCost, 1500);

  const afterSale = computeProductStock(
    [...movements, movement({ date: '2026-10-03', type: 'out', reason: 'sale', quantity: -5, unitCost: 1500 })],
    'prd_1',
    0,
  );
  assert.equal(afterSale.quantity, 15);
  assert.equal(afterSale.value, 22500);
  assert.equal(afterSale.averageCost, 1500);
});

test('stock épuisé : la valeur résiduelle retombe à zéro', () => {
  const movements = [
    movement({ quantity: 3, unitCost: 1333.333 }),
    movement({ date: '2026-10-02', type: 'out', reason: 'sale', quantity: -3 }),
  ];
  const entry = computeProductStock(movements, 'prd_1', 0);
  assert.equal(entry.quantity, 0);
  assert.equal(entry.value, 0);
});

test('sans mouvement, le coût de référence du produit est utilisé', () => {
  const entry = computeProductStock([], 'prd_1', 2500);
  assert.equal(entry.quantity, 0);
  assert.equal(entry.averageCost, 2500);
});

test('stock négatif autorisé : quantité négative et valeur nulle', () => {
  const movements = [movement({ type: 'out', reason: 'sale', quantity: -4 })];
  const entry = computeProductStock(movements, 'prd_1', 0);
  assert.equal(entry.quantity, -4);
  assert.equal(entry.value, 0);
  assert.equal(entry.negative, true);
});

test('correction documentée : le mouvement porte la différence, la trace est conservée', () => {
  const correction = buildCorrectionMovement({
    id: newId(ID_PREFIX.STOCK_MOVEMENT),
    activityId: 'act_1',
    productId: 'prd_1',
    date: '2026-10-10',
    currentQuantity: 7,
    targetQuantity: 5,
    unitCost: 1200,
    reason: 'correction',
    note: 'Inventaire du 10/10',
  });
  assert.equal(correction.quantity, -2);
  assert.equal(correction.type, 'adjust');
  assert.equal(correction.reason, 'correction');
  assert.equal(correction.note, 'Inventaire du 10/10');

  const noChange = buildCorrectionMovement({ currentQuantity: 5, targetQuantity: 5, unitCost: 0 });
  assert.equal(noChange, null);
});

test('perte et casse diminue le stock et la valeur au coût moyen', () => {
  const state = computeStockState(
    [
      movement({ productId: 'prd_1', quantity: 10, unitCost: 1000 }),
      movement({ productId: 'prd_1', date: '2026-10-05', type: 'out', reason: 'breakage', quantity: -2 }),
    ],
    [{ id: 'prd_1', cost: 1000 }],
  );
  assert.equal(state.prd_1.quantity, 8);
  assert.equal(state.prd_1.value, 8000);
});

test('contrôle de disponibilité : bloque la sortie au-delà du stock', () => {
  const state = { prd_1: { productId: 'prd_1', quantity: 3, value: 3000, averageCost: 1000 } };
  assert.equal(assertStockAvailable({ state, productId: 'prd_1', productName: 'Article', quantity: 3 }), true);
  assert.throws(
    () => assertStockAvailable({ state, productId: 'prd_1', productName: 'Article', quantity: 4 }),
    (error) => error instanceof BusinessError && /Stock insuffisant/.test(error.message),
  );
  assert.equal(
    assertStockAvailable({ state, productId: 'prd_1', productName: 'Article', quantity: 10, allowNegativeStock: true }),
    true,
  );
});

test('coût unitaire courant utilisé pour figer un prix de revient', () => {
  const state = computeStockState([movement({ productId: 'prd_1', quantity: 5, unitCost: 2000 })], [{ id: 'prd_1', cost: 500 }]);
  assert.equal(currentUnitCost(state, 'prd_1', { cost: 500 }), 2000);
  assert.equal(currentUnitCost({}, 'prd_absent', { cost: 700 }), 700);
});

test('valorisation globale du stock', () => {
  const movements = [
    movement({ productId: 'prd_1', quantity: 2, unitCost: 1000 }),
    movement({ productId: 'prd_2', quantity: 3, unitCost: 2500 }),
  ];
  const state = computeStockState(movements, [
    { id: 'prd_1', cost: 1000 },
    { id: 'prd_2', cost: 2500 },
  ]);
  assert.equal(stockValue(state), 9500);
});

test('alertes de stock faible : seuil du produit puis seuil global', () => {
  const state = computeStockState([movement({ productId: 'prd_1', quantity: 1, unitCost: 1000 })], [{ id: 'prd_1', cost: 1000 }]);
  const alerts = lowStockAlerts(
    [
      { id: 'prd_1', name: 'Savon', alertThreshold: 5, status: 'active' },
      { id: 'prd_2', name: 'Huile', alertThreshold: 0, status: 'active' },
      { id: 'prd_3', name: 'Archivé', alertThreshold: 5, status: 'archived' },
    ],
    state,
    2,
  );
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].name, 'Huile');
  assert.equal(alerts[0].severity, 'rupture');
  assert.equal(alerts[1].name, 'Savon');
});

test('résumé des mouvements sur une période', () => {
  const movements = [
    movement({ productId: 'prd_1', date: '2026-10-01', quantity: 10, unitCost: 1000 }),
    movement({ productId: 'prd_1', date: '2026-10-05', type: 'out', reason: 'sale', quantity: -4 }),
    movement({ productId: 'prd_1', date: '2026-11-01', quantity: 2, unitCost: 1000 }),
  ];
  const summary = movementSummary(movements, { from: '2026-10-01', to: '2026-10-31', productId: 'prd_1' });
  assert.equal(summary.prd_1.in, 10);
  assert.equal(summary.prd_1.out, 4);
  assert.equal(summary.prd_1.net, 6);
  assert.equal(summary.prd_1.movements, 2);
});

test('les mouvements sont rejoués dans l’ordre chronologique', () => {
  const movements = [
    movement({ date: '2026-10-05', type: 'out', reason: 'sale', quantity: -5 }),
    movement({ date: '2026-10-01', quantity: 10, unitCost: 1000 }),
    movement({ date: '2026-10-03', quantity: 10, unitCost: 3000 }),
  ];
  const entry = computeProductStock(movements, 'prd_1', 0);
  // 10 à 1 000 puis 10 à 3 000 → 20 pour 40 000 (moyenne 2 000), puis −5 à 2 000
  assert.equal(entry.quantity, 15);
  assert.equal(entry.value, 30000);
  assert.equal(entry.averageCost, 2000);
});

test('un mouvement est normalisé (date, quantité, coût)', () => {
  const result = buildMovement({
    id: 'mvt_1',
    activityId: null,
    productId: 'prd_1',
    date: '2026-10-01T15:30:00.000Z',
    type: 'in',
    reason: 'purchase_receipt',
    quantity: '5',
    unitCost: '1595.2380952380952',
  });
  assert.equal(result.date, '2026-10-01');
  assert.equal(result.quantity, 5);
  assert.equal(result.unitCost, 1595.2380952380952);
  assert.equal(result.activityId, null);
});
