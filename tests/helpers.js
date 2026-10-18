/* ---------------------------------------------------------------------------
 * Mon Commerce — utilitaires de test
 *
 * Construit un « monde » en mémoire équivalent à ce que produiraient les
 * actions applicatives, sans IndexedDB : les calculs financiers et de stock
 * sont donc testables directement sous Node.
 * ------------------------------------------------------------------------- */

import { defaultMeta, defaultSettings, emptyState } from '../src/config/defaults.js';
import { buildCashAccount, buildCashMovement } from '../src/services/cash.js';
import { buildExpense } from '../src/services/expenses.js';
import { purchaseTotal, purchaseBalance, saleTotal, saleBalance } from '../src/services/finance.js';
import { buildPurchase, buildPurchasePayments } from '../src/services/purchases.js';
import { buildSale, buildSalePayments, paymentsToCashMovements } from '../src/services/sales.js';
import { buildMovement, computeStockState } from '../src/services/stock.js';
import { newId, ID_PREFIX } from '../src/shared/id.js';

const STAMP = '2026-10-01T08:00:00.000Z';

export function createWorld({ capital = 0, date = '2026-10-01', accountName = 'Caisse principale' } = {}) {
  const world = emptyState();
  world.settings = defaultSettings(STAMP);
  world.meta = defaultMeta(STAMP);

  const account = buildCashAccount({ name: accountName, type: 'cash', initialBalance: 0 });
  world.cashAccounts = [account];

  const activity = {
    id: newId(ID_PREFIX.ACTIVITY),
    name: 'Vêtements Yopougon',
    category: 'Vêtements',
    description: '',
    status: 'active',
    startDate: date,
    endDate: '',
    initialCapital: capital,
    targetBudget: 0,
    note: '',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  world.activities = [activity];
  world.settings.currentActivityId = activity.id;

  if (capital > 0) {
    world.cashMovements.push(
      buildCashMovement({
        activityId: activity.id,
        date,
        accountId: account.id,
        direction: 'in',
        amount: capital,
        nature: 'capital_in',
        sourceType: 'activity',
        sourceId: activity.id,
        note: 'Capital initial',
      }),
    );
  }

  return { world, activity, account };
}

export function addProduct(world, { name, cost = 0, price = 0, quantity = 0, unitCost = null, unit = 'pièce', alertThreshold = 0, date = '2026-10-01' } = {}) {
  const activity = world.activities[0];
  const product = {
    id: newId(ID_PREFIX.PRODUCT),
    activityId: activity.id,
    name,
    reference: '',
    category: '',
    unit,
    cost,
    price,
    alertThreshold,
    description: '',
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  world.products.push(product);
  if (quantity > 0) {
    world.stockMovements.push(
      buildMovement({
        id: newId(ID_PREFIX.STOCK_MOVEMENT),
        activityId: activity.id,
        productId: product.id,
        date,
        type: 'in',
        reason: 'opening',
        quantity,
        unitCost: unitCost === null ? cost : unitCost,
        sourceType: 'product',
        sourceId: product.id,
      }),
    );
  }
  return product;
}

export function addPurchase(world, { lines, transportCost = 0, otherFees = 0, discount = 0, status = 'received', pay = 0, date = '2026-10-01', supplierId = '', method = 'Espèces' } = {}) {
  const activity = world.activities[0];
  const account = world.cashAccounts[0];
  const { purchase, stockMovements } = buildPurchase(
    {
      activityId: activity.id,
      supplierId,
      date,
      lines: lines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount || 0,
      })),
      transportCost,
      otherFees,
      discount,
      status,
    },
    { products: world.products },
  );

  world.purchases.push(purchase);
  world.stockMovements.push(...stockMovements);

  if (pay > 0) {
    const [payment] = buildPurchasePayments(purchase, [{ amount: pay, accountId: account.id, method, date }], {
      maxAmount: purchaseTotal(purchase),
    });
    world.payments.push(payment);
    world.cashMovements.push(...paymentsToCashMovements([payment]));
  }

  return purchase;
}

export function addSale(world, { items, discount = 0, otherFees = 0, customerId = '', pay = 0, date = '2026-10-05', dueDate = '', method = 'Espèces', allowNegativeStock = false } = {}) {
  const activity = world.activities[0];
  const account = world.cashAccounts[0];
  const stockState = computeStockState(world.stockMovements, world.products);
  const { sale, stockMovements } = buildSale(
    {
      activityId: activity.id,
      customerId,
      date,
      items: items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
      })),
      discount,
      otherFees,
      dueDate,
    },
    { products: world.products, stockState, allowNegativeStock },
  );

  world.sales.push(sale);
  world.stockMovements.push(...stockMovements);

  if (pay > 0) {
    const [payment] = buildSalePayments(sale, [{ amount: pay, accountId: account.id, method, date }], {
      maxAmount: saleTotal(sale),
    });
    world.payments.push(payment);
    world.cashMovements.push(...paymentsToCashMovements([payment]));
  }

  return sale;
}

export function addExpense(world, { category = 'Publicité', amount, nature = 'operating', pay = true, date = '2026-10-02', beneficiary = '', note = '' } = {}) {
  const activity = world.activities[0];
  const account = world.cashAccounts[0];
  const { expense, cashMovements } = buildExpense({
    activityId: activity.id,
    date,
    category,
    nature,
    amount,
    paid: pay,
    accountId: pay ? account.id : '',
    beneficiary,
    note,
  });
  world.expenses.push(expense);
  world.cashMovements.push(...cashMovements);
  return expense;
}

export function worldStock(world) {
  return computeStockState(world.stockMovements, world.products);
}

export function saleOutstanding(world, sale) {
  return saleBalance(sale, { payments: world.payments, returns: world.returns });
}

export function purchaseOutstanding(world, purchase) {
  return purchaseBalance(purchase, { payments: world.payments, returns: world.returns });
}
