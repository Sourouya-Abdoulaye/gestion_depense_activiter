/* ---------------------------------------------------------------------------
 * Tests des achats : commande vs réception, frais d'acquisition répartis,
 * dettes fournisseurs, retours et annulations.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BusinessError } from '../src/shared/validators.js';
import {
  allocateAcquisitionCost,
  purchaseBalance,
  purchaseTotal,
  totalPayables,
  treasuryBalance,
} from '../src/services/finance.js';
import {
  buildPurchase,
  buildPurchaseCancellation,
  buildPurchasePayments,
  buildPurchaseReturn,
  buildSupplierPayment,
  receivePurchase,
} from '../src/services/purchases.js';
import { paymentsToCashMovements } from '../src/services/sales.js';
import { computeStockState } from '../src/services/stock.js';
import { addProduct, addPurchase, createWorld, worldStock } from './helpers.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

test('une commande ne change pas le stock ; la réception, oui', () => {
  const { world, activity } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Carton de savon', cost: 5000, price: 7000 });

  const { purchase, stockMovements } = buildPurchase(
    {
      activityId: activity.id,
      date: '2026-10-02',
      lines: [{ productId: product.id, quantity: 10, unitPrice: 5000 }],
      status: 'ordered',
    },
    { products: world.products },
  );
  world.purchases.push(purchase);
  world.stockMovements.push(...stockMovements);

  assert.equal(purchase.status, 'ordered');
  assert.equal(stockMovements.length, 0);
  assert.equal(worldStock(world)[product.id].quantity, 0);

  const reception = receivePurchase({ purchase, date: '2026-10-04' });
  world.purchases[0] = reception.purchase;
  world.stockMovements.push(...reception.stockMovements);

  assert.equal(reception.purchase.status, 'received');
  assert.equal(reception.purchase.receiveDate, '2026-10-04');
  assert.equal(worldStock(world)[product.id].quantity, 10);
  assert.equal(worldStock(world)[product.id].averageCost, 5000);
});

test('les frais d’acquisition sont répartis au prorata des montants nets', () => {
  const lines = [
    { id: 'l1', productId: 'p1', quantity: 10, unitPrice: 1000, discount: 0 },
    { id: 'l2', productId: 'p2', quantity: 10, unitPrice: 3000, discount: 0 },
  ];
  const allocated = allocateAcquisitionCost(lines, { transportCost: 4000, otherFees: 0, discount: 0 });
  // sous-total 40 000 : part de la ligne 1 = 25 % (1 000), ligne 2 = 75 % (3 000)
  assert.equal(allocated[0].allocatedFees, 1000);
  assert.equal(allocated[1].allocatedFees, 3000);
  assert.equal(allocated[0].allocatedUnitCost, 1100);
  assert.equal(allocated[1].allocatedUnitCost, 3300);

  const withDiscount = allocateAcquisitionCost(lines, { transportCost: 4000, otherFees: 0, discount: 2000 });
  assert.equal(withDiscount[0].allocatedUnitCost, 1050);
  assert.equal(withDiscount[1].allocatedUnitCost, 3150);
});

test('total d’un achat : marchandises + transport + frais − remise', () => {
  const purchase = {
    lines: [{ id: 'l1', quantity: 4, unitPrice: 2500, discount: 0 }],
    discount: 500,
    transportCost: 1000,
    otherFees: 200,
  };
  assert.equal(purchaseTotal(purchase), 10700);
});

test('achat à crédit : la dette fournisseur suit les paiements partiels', () => {
  const { world } = createWorld({ capital: 200000 });
  const product = addProduct(world, { name: 'Frigo', cost: 80000, price: 95000 });
  const purchase = addPurchase(world, {
    lines: [{ product, quantity: 1, unitPrice: 80000 }],
    status: 'received',
    pay: 30000,
    date: '2026-10-02',
  });

  assert.equal(purchaseTotal(purchase), 80000);
  assert.equal(purchaseBalance(purchase, { payments: world.payments, returns: world.returns }), 50000);
  assert.equal(totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns }), 50000);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 200000 - 30000);

  const { payment, cashMovements } = buildSupplierPayment({
    purchase,
    amount: 50000,
    accountId: world.cashAccounts[0].id,
    date: '2026-10-20',
    payments: world.payments,
    returns: world.returns,
  });
  world.payments.push(payment);
  world.cashMovements.push(...cashMovements);

  assert.equal(purchaseBalance(purchase, { payments: world.payments, returns: world.returns }), 0);
  assert.equal(totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns }), 0);
});

test('un paiement supérieur au solde dû est refusé', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Vélo', cost: 40000, price: 50000 });
  const purchase = addPurchase(world, { lines: [{ product, quantity: 1, unitPrice: 40000 }], status: 'received', pay: 10000 });

  assert.throws(
    () =>
      buildSupplierPayment({
        purchase,
        amount: 40000,
        accountId: world.cashAccounts[0].id,
        payments: world.payments,
        returns: world.returns,
      }),
    BusinessError,
  );
});

test('retour au fournisseur : stock, dette et trésorerie corrigés', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Machine', cost: 20000, price: 30000 });
  const purchase = addPurchase(world, {
    lines: [{ product, quantity: 5, unitPrice: 20000 }],
    status: 'received',
    pay: 50000,
    date: '2026-10-02',
  });

  const result = buildPurchaseReturn(
    {
      purchase,
      lines: [{ purchaseLineId: purchase.lines[0].id, quantity: 1 }],
      date: '2026-10-06',
      reason: 'Article défectueux',
      refundAmount: 20000,
      accountId: world.cashAccounts[0].id,
    },
    { returns: world.returns },
  );
  world.returns.push(result.return);
  world.stockMovements.push(...result.stockMovements);
  world.payments.push(...result.payments);
  world.cashMovements.push(...result.cashMovements);

  assert.equal(result.return.total, 20000);
  assert.equal(worldStock(world)[product.id].quantity, 4);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 100000 - 50000 + 20000);
  // Total dû : 5 × 20 000 = 100 000. Retour : −20 000. Net payé : 50 000 − 20 000 reçus = 30 000.
  assert.equal(purchaseBalance(purchase, { payments: world.payments, returns: world.returns }), 100000 - 20000 - 50000 + 20000);
  assert.equal(totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns }), 50000);
});

test('annulation d’achat : stock retiré et remboursement reçu', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Groupe', cost: 30000, price: 40000 });
  const purchase = addPurchase(world, {
    lines: [{ product, quantity: 2, unitPrice: 30000 }],
    status: 'received',
    pay: 60000,
    date: '2026-10-02',
  });

  const result = buildPurchaseCancellation(
    { purchase, date: '2026-10-05', reason: 'Erreur de commande', accountId: world.cashAccounts[0].id },
    { payments: world.payments, returns: world.returns },
  );
  world.purchases[0] = result.purchase;
  world.stockMovements.push(...result.stockMovements);
  world.payments.push(...result.payments);
  world.cashMovements.push(...result.cashMovements);

  assert.equal(result.purchase.status, 'cancelled');
  assert.equal(result.payments[0].direction, 'in');
  assert.equal(result.payments[0].amount, 60000);
  assert.equal(worldStock(world)[product.id].quantity, 0);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 100000);
  assert.equal(totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns }), 0);
});

test('réception d’un achat déjà réceptionné ou annulé refusée', () => {
  const { world } = createWorld({ capital: 50000 });
  const product = addProduct(world, { name: 'Chaise', cost: 10000, price: 15000 });
  const purchase = addPurchase(world, { lines: [{ product, quantity: 2, unitPrice: 10000 }], status: 'received' });
  assert.throws(() => receivePurchase({ purchase, date: '2026-10-05' }), BusinessError);
});

test('le total payé ne peut pas dépasser le total de l’achat', () => {
  const { world } = createWorld({ capital: 50000 });
  const product = addProduct(world, { name: 'Table', cost: 15000, price: 20000 });
  const purchase = addPurchase(world, { lines: [{ product, quantity: 1, unitPrice: 15000 }], status: 'received' });
  assert.throws(
    () => buildPurchasePayments(purchase, [{ amount: 20000, accountId: world.cashAccounts[0].id }], { maxAmount: purchaseTotal(purchase) - 15000 }),
    BusinessError,
  );
});

test('un achat commandé non réceptionné n’apparaît pas dans les dettes fournisseurs', () => {
  const { world, activity } = createWorld({ capital: 50000 });
  const product = addProduct(world, { name: 'Nappe', cost: 3000, price: 5000 });
  const { purchase } = buildPurchase(
    { activityId: activity.id, date: '2026-10-02', lines: [{ productId: product.id, quantity: 10, unitPrice: 3000 }], status: 'ordered' },
    { products: world.products },
  );
  world.purchases.push(purchase);
  assert.equal(totalPayables({ purchases: world.purchases, payments: [], returns: [] }), 0);
  assert.equal(purchaseBalance(purchase, { payments: [], returns: [] }), 30000);
});

test('retour fournisseur sans remboursement immédiat : seule la dette diminue', () => {
  const { world } = createWorld({ capital: 50000 });
  const product = addProduct(world, { name: 'Lot de tissus', cost: 4000, price: 6000 });
  const purchase = addPurchase(world, { lines: [{ product, quantity: 10, unitPrice: 4000 }], status: 'received', pay: 0 });

  const result = buildPurchaseReturn(
    { purchase, lines: [{ purchaseLineId: purchase.lines[0].id, quantity: 2 }], date: '2026-10-08' },
    { returns: world.returns },
  );
  world.returns.push(result.return);
  world.stockMovements.push(...result.stockMovements);

  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 50000);
  assert.equal(purchaseBalance(purchase, { payments: world.payments, returns: world.returns }), 32000);
});

test('réception : la valeur du stock reflète les frais de transport répartis', () => {
  const { world } = createWorld({ capital: 100000 });
  const a = addProduct(world, { name: 'A', cost: 1000, price: 2000 });
  const b = addProduct(world, { name: 'B', cost: 3000, price: 5000 });
  addPurchase(world, {
    lines: [
      { product: a, quantity: 10, unitPrice: 1000 },
      { product: b, quantity: 10, unitPrice: 3000 },
    ],
    transportCost: 4000,
    status: 'received',
    pay: 44000,
  });
  const state = computeStockState(world.stockMovements, world.products);
  assert.equal(state[a.id].averageCost, 1100);
  assert.equal(state[b.id].averageCost, 3300);
});

test('les paiements d’achat alimentent la trésorerie avec la nature attendue', () => {
  const { world } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Produit', cost: 1000, price: 2000 });
  addPurchase(world, { lines: [{ product, quantity: 5, unitPrice: 1000 }], status: 'received', pay: 5000 });
  const movement = world.cashMovements.find((entry) => entry.sourceType === 'payment');
  assert.equal(movement.direction, 'out');
  assert.equal(movement.nature, 'purchase_payment');
  assert.equal(paymentsToCashMovements([]).length, 0);
});

test('fiches fournisseur : le total des dettes est filtré par activité', () => {
  const { world, activity } = createWorld({ capital: 100000 });
  const product = addProduct(world, { name: 'Produit', cost: 1000, price: 2000 });
  addPurchase(world, { lines: [{ product, quantity: 10, unitPrice: 1000 }], status: 'received', pay: 2000 });
  assert.equal(
    totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns, filters: { activityId: activity.id } }),
    8000,
  );
  assert.equal(
    totalPayables({ purchases: world.purchases, payments: world.payments, returns: world.returns, filters: { activityId: 'act_autre' } }),
    0,
  );
  assert.equal(PERIOD.from, '2026-10-01');
});
