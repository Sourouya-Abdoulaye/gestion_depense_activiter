/* ---------------------------------------------------------------------------
 * Tests de l'assistant de rentabilité.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquisitionUnitCost,
  priceForMarginRate,
  priceForMarkupRate,
  simulate,
  simulationAssumptions,
  unitCostFromPurchase,
  weightedUnitCost,
} from '../src/services/profitability.js';
import { addProduct, createWorld, addPurchase } from './helpers.js';

test('coût d’acquisition unitaire = (montant net + frais) ÷ quantité', () => {
  assert.equal(acquisitionUnitCost({ netAmount: 31500, fees: 2000, quantity: 21 }), 33500 / 21);
  assert.equal(acquisitionUnitCost({ netAmount: 0, fees: 0, quantity: 0 }), 0);
});

test('coût unitaire constaté sur un achat réel', () => {
  const { world } = createWorld({ capital: 50000 });
  const product = addProduct(world, { name: 'Pantalon', cost: 1500, price: 2500 });
  const purchase = addPurchase(world, {
    lines: [{ product, quantity: 21, unitPrice: 1500 }],
    transportCost: 2000,
    status: 'received',
  });
  assert.equal(Number(unitCostFromPurchase(purchase).toFixed(2)), 1595.24);
  assert.equal(Number(unitCostFromPurchase(purchase, product.id).toFixed(2)), 1595.24);
});

test('coût unitaire moyen pondéré sur plusieurs achats', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Sac', cost: 3000, price: 5000 });
  addPurchase(world, { lines: [{ product, quantity: 10, unitPrice: 3000 }], status: 'received' });
  addPurchase(world, { lines: [{ product, quantity: 10, unitPrice: 5000 }], transportCost: 2000, status: 'received' });
  // 30 000 + 52 000 = 82 000 pour 20 unités
  assert.equal(weightedUnitCost(world.purchases, product.id), 4100);
});

test('simulation : marges, taux et seuil de rentabilité', () => {
  const result = simulate({ unitCost: 1595.24, price: 2500, quantity: 20, fixedCosts: 10000 });
  assert.equal(result.unitMargin, 904.76);
  assert.equal(result.revenue, 50000);
  assert.equal(result.grossMargin, 18095.2);
  assert.equal(result.netResult, 8095.2);
  // taux de marge = marge ÷ coût ; taux de marque = marge ÷ prix
  assert.ok(Math.abs(result.marginRate - 904.76 / 1595.24) < 1e-9);
  assert.ok(Math.abs(result.markupRate - 904.76 / 2500) < 1e-9);
  assert.equal(result.breakEvenUnits, Math.ceil(10000 / 904.76));
  assert.equal(result.breakEvenRevenue, result.breakEvenUnits * 2500);
});

test('simulation : une marge négative est signalée, sans garantir de bénéfice', () => {
  const result = simulate({ unitCost: 3000, price: 2500, quantity: 10, fixedCosts: 0 });
  assert.ok(result.unitMargin < 0);
  assert.equal(result.breakEvenUnits, null);
  assert.ok(result.warnings.some((warning) => /marge unitaire est nulle ou négative/.test(warning)));
  assert.ok(result.warnings.some((warning) => /charge fixe/i.test(warning)));
});

test('simulation : taux de perte appliqué au coût effectif', () => {
  const result = simulate({ unitCost: 1000, price: 2000, quantity: 10, lossRate: 0.2 });
  assert.equal(result.effectiveUnitCost, 1250);
  assert.equal(result.unitMargin, 750);
});

test('prix conseillé pour un taux de marque ou un taux de marge', () => {
  assert.equal(priceForMarkupRate(1600, 0.4), 2666.67);
  assert.equal(priceForMarkupRate(1600, 1), null);
  assert.equal(priceForMarginRate(1600, 0.5), 2400);
});

test('les hypothèses sont toujours expliquées en langage simple', () => {
  const assumptions = simulationAssumptions({}, simulate({ unitCost: 1000, price: 2000, fixedCosts: 5000 }));
  assert.ok(assumptions.length >= 4);
  assert.ok(assumptions.some((line) => /ne garantit pas un bénéfice/.test(line)));
});
