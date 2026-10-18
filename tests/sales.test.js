/* ---------------------------------------------------------------------------
 * Tests des ventes : comptant, crédit, paiements partiels, retours,
 * remboursements, annulations et contrôle du stock.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BusinessError } from '../src/shared/validators.js';
import {
  buildCustomerPayment,
  buildSale,
  buildSaleCancellation,
  buildSalePayments,
  buildSaleReturn,
  paymentsToCashMovements,
} from '../src/services/sales.js';
import {
  costOfGoodsSold,
  estimatedResult,
  revenue,
  saleBalance,
  saleTotal,
  totalReceivables,
  treasuryBalance,
} from '../src/services/finance.js';
import { computeStockState } from '../src/services/stock.js';
import { addProduct, addSale, createWorld, saleOutstanding, worldStock } from './helpers.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

function apply(world, result) {
  if (result.return) world.returns.push(result.return);
  if (result.sale) {
    const index = world.sales.findIndex((sale) => sale.id === result.sale.id);
    if (index >= 0) world.sales[index] = result.sale;
    else world.sales.push(result.sale);
  }
  for (const movement of result.stockMovements || []) world.stockMovements.push(movement);
  for (const payment of result.payments || []) world.payments.push(payment);
  for (const movement of result.cashMovements || []) world.cashMovements.push(movement);
}

test('vente comptant : chiffre d’affaires, stock et trésorerie cohérents', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'T-shirt', cost: 1000, price: 2000, quantity: 10, unitCost: 1000 });
  const sale = addSale(world, { items: [{ product, quantity: 4, unitPrice: 2000 }], pay: 8000, date: '2026-10-05' });

  assert.equal(saleTotal(sale), 8000);
  assert.equal(revenue({ sales: world.sales, returns: world.returns, filters: PERIOD }), 8000);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters: PERIOD }), 4000);
  assert.equal(worldStock(world)[product.id].quantity, 6);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 8000);
  assert.equal(saleOutstanding(world, sale), 0);
});

test('vente à crédit puis paiement partiel : la créance diminue, la trésorerie n’augmente que de l’encaissé', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Sac', cost: 3000, price: 5000, quantity: 10, unitCost: 3000 });
  const customer = { id: 'cli_test', name: 'Awa' };
  world.customers.push(customer);

  const sale = addSale(world, {
    items: [{ product, quantity: 5, unitPrice: 5000 }],
    pay: 0,
    customerId: customer.id,
    date: '2026-10-05',
    dueDate: '2026-10-20',
  });

  assert.equal(saleTotal(sale), 25000);
  assert.equal(saleBalance(sale, { payments: world.payments, returns: world.returns }), 25000);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 0);
  assert.equal(
    totalReceivables({ sales: world.sales, payments: world.payments, returns: world.returns }),
    25000,
  );

  const { payment, cashMovements } = buildCustomerPayment({
    sale,
    amount: 10000,
    accountId: world.cashAccounts[0].id,
    date: '2026-10-12',
    payments: world.payments,
    returns: world.returns,
  });
  world.payments.push(payment);
  world.cashMovements.push(...cashMovements);

  assert.equal(saleBalance(sale, { payments: world.payments, returns: world.returns }), 15000);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 10000);
  assert.equal(totalReceivables({ sales: world.sales, payments: world.payments, returns: world.returns }), 15000);
});

test('un règlement supérieur au solde restant est refusé', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Casquette', cost: 1000, price: 2000, quantity: 3, unitCost: 1000 });
  const sale = addSale(world, { items: [{ product, quantity: 3, unitPrice: 2000 }], pay: 2000, date: '2026-10-05' });

  assert.throws(
    () =>
      buildCustomerPayment({
        sale,
        amount: 5000,
        accountId: world.cashAccounts[0].id,
        payments: world.payments,
        returns: world.returns,
      }),
    BusinessError,
  );
});

test('retour client remboursé : chiffre d’affaires, stock et trésorerie corrigés', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Robe', cost: 3000, price: 4000, quantity: 5, unitCost: 3000 });
  const sale = addSale(world, { items: [{ product, quantity: 3, unitPrice: 4000 }], pay: 12000, date: '2026-10-05' });

  const result = buildSaleReturn(
    {
      sale,
      lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
      date: '2026-10-08',
      reason: 'Taille inadaptée',
      refundAmount: 4000,
      accountId: world.cashAccounts[0].id,
    },
    { returns: world.returns, payments: world.payments },
  );
  apply(world, result);

  assert.equal(result.return.total, 4000);
  assert.equal(revenue({ sales: world.sales, returns: world.returns, filters: PERIOD }), 8000);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters: PERIOD }), 6000);
  assert.equal(worldStock(world)[product.id].quantity, 3); // 5 − 3 + 1
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 8000);
});

test('retour client en avoir (sans remboursement) : la créance diminue sans sortie d’argent', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Montre', cost: 5000, price: 8000, quantity: 4, unitCost: 5000 });
  world.customers.push({ id: 'cli_avoir', name: 'Kossi' });
  const sale = addSale(world, {
    items: [{ product, quantity: 2, unitPrice: 8000 }],
    pay: 0,
    customerId: 'cli_avoir',
    date: '2026-10-05',
  });

  const result = buildSaleReturn(
    { sale, lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], date: '2026-10-07', refundAmount: 0 },
    { returns: world.returns, payments: world.payments },
  );
  apply(world, result);

  assert.equal(saleBalance(sale, { payments: world.payments, returns: world.returns }), 8000);
  assert.equal(totalReceivables({ sales: world.sales, payments: world.payments, returns: world.returns }), 8000);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 0);
  assert.equal(result.return.refund, null);
});

test('un retour ne peut pas dépasser la quantité vendue', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Foulard', cost: 500, price: 1000, quantity: 4, unitCost: 500 });
  const sale = addSale(world, { items: [{ product, quantity: 2, unitPrice: 1000 }], pay: 2000, date: '2026-10-05' });

  assert.throws(
    () =>
      buildSaleReturn(
        { sale, lines: [{ saleLineId: sale.lines[0].id, quantity: 3 }], date: '2026-10-07' },
        { returns: world.returns },
      ),
    BusinessError,
  );
});

test('annulation de vente : statut conservé, stock réintégré, argent remboursé', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Pantalon', cost: 2000, price: 3500, quantity: 6, unitCost: 2000 });
  const sale = addSale(world, { items: [{ product, quantity: 2, unitPrice: 3500 }], pay: 7000, date: '2026-10-05' });

  const result = buildSaleCancellation(
    { sale, date: '2026-10-06', reason: 'Erreur de saisie', accountId: world.cashAccounts[0].id },
    { payments: world.payments, returns: world.returns },
  );
  apply(world, result);

  assert.equal(result.sale.status, 'cancelled');
  assert.equal(result.sale.cancelReason, 'Erreur de saisie');
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].amount, 7000);
  assert.equal(result.payments[0].direction, 'out');

  const filters = { ...PERIOD };
  assert.equal(revenue({ sales: world.sales, returns: world.returns, filters }), 0);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters }), 0);
  assert.equal(worldStock(world)[product.id].quantity, 6);
  assert.equal(treasuryBalance({ cashAccounts: world.cashAccounts, cashMovements: world.cashMovements }), 0);
  assert.equal(saleBalance(result.sale, { payments: world.payments, returns: world.returns }), 0);
});

test('une vente au-delà du stock est bloquée, sauf option explicite', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Chargeur', cost: 2000, price: 4000, quantity: 2, unitCost: 2000 });
  const stockState = computeStockState(world.stockMovements, world.products);

  assert.throws(
    () =>
      buildSale(
        { activityId: world.activities[0].id, date: '2026-10-05', items: [{ productId: product.id, quantity: 3, unitPrice: 4000 }] },
        { products: world.products, stockState, allowNegativeStock: false },
      ),
    (error) => error instanceof BusinessError && /Stock insuffisant/.test(error.message),
  );

  const allowed = buildSale(
    { activityId: world.activities[0].id, date: '2026-10-05', items: [{ productId: product.id, quantity: 3, unitPrice: 4000 }] },
    { products: world.products, stockState, allowNegativeStock: true },
  );
  assert.equal(allowed.sale.lines[0].quantity, 3);
});

test('remise globale, remise de ligne et frais éventuels sont appliqués au total', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Baskets', cost: 6000, price: 10000, quantity: 5, unitCost: 6000 });
  const stockState = computeStockState(world.stockMovements, world.products);
  const { sale } = buildSale(
    {
      activityId: world.activities[0].id,
      date: '2026-10-05',
      items: [{ productId: product.id, quantity: 2, unitPrice: 10000, discount: 1000 }],
      discount: 500,
      otherFees: 200,
    },
    { products: world.products, stockState },
  );
  // 2 × 10 000 − 1 000 (remise ligne) − 500 (remise globale) + 200 (frais) = 18 700
  assert.equal(saleTotal(sale), 18700);
});

test('une remise globale supérieure au sous-total est refusée', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Ceinture', cost: 1000, price: 2000, quantity: 3, unitCost: 1000 });
  const stockState = computeStockState(world.stockMovements, world.products);
  assert.throws(
    () =>
      buildSale(
        {
          activityId: world.activities[0].id,
          date: '2026-10-05',
          items: [{ productId: product.id, quantity: 1, unitPrice: 2000 }],
          discount: 5000,
        },
        { products: world.products, stockState },
      ),
    BusinessError,
  );
});

test('le total encaissé ne peut pas dépasser le total de la vente', () => {
  const { world } = createWorld();
  const product = addProduct(world, { name: 'Écouteurs', cost: 4000, price: 6000, quantity: 2, unitCost: 4000 });
  const sale = addSale(world, { items: [{ product, quantity: 1, unitPrice: 6000 }], pay: 6000, date: '2026-10-05' });
  // Il ne reste rien à encaisser sur cette vente : tout encaissement est refusé.
  assert.throws(
    () => buildSalePayments(sale, [{ amount: 1000, accountId: world.cashAccounts[0].id }], { maxAmount: saleTotal(sale) - 6000 }),
    BusinessError,
  );
  assert.throws(
    () => buildSalePayments(sale, [{ amount: 7000, accountId: world.cashAccounts[0].id }], { maxAmount: saleTotal(sale) }),
    BusinessError,
  );
});

test('paiement combiné : espèces + portefeuille mobile', () => {
  const { world } = createWorld();
  const cash = world.cashAccounts[0];
  const wallet = { id: 'cpt_mobile', name: 'TMoney', type: 'mobile', initialBalance: 0, active: true };
  world.cashAccounts.push(wallet);
  const product = addProduct(world, { name: 'Radio', cost: 8000, price: 15000, quantity: 2, unitCost: 8000 });

  const stockState = computeStockState(world.stockMovements, world.products);
  const { sale } = buildSale(
    { activityId: world.activities[0].id, date: '2026-10-05', items: [{ productId: product.id, quantity: 1, unitPrice: 15000 }] },
    { products: world.products, stockState },
  );
  const payments = buildSalePayments(sale, [
    { amount: 5000, accountId: cash.id, method: 'Espèces' },
    { amount: 10000, accountId: wallet.id, method: 'TMoney' },
  ]);
  world.sales.push(sale);
  world.payments.push(...payments);
  world.cashMovements.push(...paymentsToCashMovements(payments));

  assert.equal(saleBalance(sale, { payments: world.payments, returns: world.returns }), 0);
  const byAccount = Object.fromEntries(
    world.cashAccounts.map((account) => [
      account.name,
      world.cashMovements
        .filter((movement) => movement.accountId === account.id)
        .reduce((total, movement) => total + (movement.direction === 'in' ? movement.amount : -movement.amount), account.initialBalance),
    ]),
  );
  assert.deepEqual(byAccount, { 'Caisse principale': 5000, TMoney: 10000 });
});

test('les ventes annulées et les avoirs n’entrent pas dans le résultat de la période', () => {
  const { world } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Lunettes', cost: 2000, price: 4000, quantity: 10, unitCost: 2000 });
  const sale = addSale(world, { items: [{ product, quantity: 5, unitPrice: 4000 }], pay: 20000, date: '2026-10-05' });

  const retour = buildSaleReturn(
    { sale, lines: [{ saleLineId: sale.lines[0].id, quantity: 5 }], date: '2026-10-09', refundAmount: 20000, accountId: world.cashAccounts[0].id },
    { returns: world.returns, payments: world.payments },
  );
  apply(world, retour);

  const filters = { ...PERIOD };
  assert.equal(revenue({ sales: world.sales, returns: world.returns, filters }), 0);
  assert.equal(costOfGoodsSold({ sales: world.sales, returns: world.returns, filters }), 0);
  assert.equal(estimatedResult({ sales: world.sales, returns: world.returns, expenses: [], filters }), 0);
  assert.equal(worldStock(world)[product.id].quantity, 10);
});
