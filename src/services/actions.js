/* ---------------------------------------------------------------------------
 * Mon Commerce — actions métier
 *
 * Chaque action construit les documents concernés avec les services purs, puis
 * les écrit dans UN SEUL lot atomique : une vente, ses mouvements de stock et
 * ses paiements réussissent ensemble ou échouent ensemble. Aucune opération
 * financière n'est supprimée silencieusement : les annulations créent des
 * écritures compensatoires traçables.
 * ------------------------------------------------------------------------- */

import { ACTIVITY_STATUS, DOCUMENT_STATUS, EXPENSE_NATURE_VALUES } from '../config/constants.js';
import { readAll } from '../database/db.js';
import { toISODate, todayISO } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { BusinessError, isNonEmptyString } from '../shared/validators.js';
import { buildCorrectionMovement, computeProductStock, computeStockState, sortMovements } from './stock.js';
import {
  buildCustomerPayment,
  buildSale,
  buildSaleCancellation,
  buildSalePayments,
  buildSaleReturn,
  paymentsToCashMovements,
} from './sales.js';
import {
  buildPurchase,
  buildPurchaseCancellation,
  buildPurchasePayments,
  buildPurchaseReturn,
  buildSupplierPayment,
  receivePurchase,
} from './purchases.js';
import { buildExpense, buildExpenseReversal, rebuildExpenseUpdate } from './expenses.js';
import { buildCashAccount, buildCashMovement, buildContribution, buildTransfer, buildWithdrawal } from './cash.js';
import { lineFingerprint } from './bank-import.js';
import { purchaseBalance, purchaseTotal, saleBalance, saleTotal } from './finance.js';
import { applyOperations, currentActivity, getSettings, getState, op, putAll } from './state.js';

/* ------------------------------ utilitaires ----------------------------- */

function requireActivity(activityId) {
  const state = getState();
  const id = activityId || currentActivity()?.id || '';
  if (!id) {
    throw new BusinessError('Créez d’abord une activité commerciale pour enregistrer des opérations.');
  }
  const activity = state.activities.find((entry) => entry.id === id);
  if (!activity) throw new BusinessError('Activité introuvable.');
  return activity;
}

function requireEntity(collection, id, label) {
  const found = getState()[collection].find((entry) => entry.id === id);
  if (!found) throw new BusinessError(`${label} introuvable.`);
  return found;
}

function assertText(value, label, { required = true, max = 160 } = {}) {
  if (!required && !value) return '';
  if (!isNonEmptyString(value, max)) throw new BusinessError(`${label} est obligatoire (160 caractères maximum).`);
  return String(value).trim();
}

function stamp(record) {
  return { ...record, updatedAt: new Date().toISOString() };
}

/* ------------------------------ activités ------------------------------- */

export async function createActivity(input) {
  const name = assertText(input.name, 'Le nom de l’activité');
  const activity = {
    id: newId(ID_PREFIX.ACTIVITY),
    name,
    category: input.category || '',
    description: input.description || '',
    status: input.status === ACTIVITY_STATUS.ARCHIVED ? ACTIVITY_STATUS.ARCHIVED : ACTIVITY_STATUS.ACTIVE,
    startDate: toISODate(input.startDate || todayISO()),
    endDate: input.endDate ? toISODate(input.endDate) : '',
    initialCapital: roundMoney(toNumber(input.initialCapital, 0)),
    targetBudget: roundMoney(toNumber(input.targetBudget, 0)),
    note: input.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const operations = [op.put('activities', activity)];

  // Le capital initial alimente la trésorerie du compte choisi.
  if (activity.initialCapital > 0) {
    if (!input.accountId) {
      throw new BusinessError('Choisissez le compte de trésorerie qui reçoit le capital initial.');
    }
    operations.push(
      op.put(
        'cashMovements',
        buildCashMovement({
          activityId: activity.id,
          date: activity.startDate,
          accountId: input.accountId,
          direction: 'in',
          amount: activity.initialCapital,
          nature: 'capital_in',
          sourceType: 'activity',
          sourceId: activity.id,
          note: `Capital initial — ${activity.name}`,
        }),
      ),
    );
  }

  const settings = getSettings();
  if (!settings.currentActivityId) operations.push(op.put('settings', { ...settings, currentActivityId: activity.id }));

  await applyOperations(operations, { type: 'activity-created', id: activity.id });
  return activity;
}

export async function updateActivity(activityId, changes) {
  const activity = requireEntity('activities', activityId, 'Activité');
  const updated = stamp({
    ...activity,
    ...changes,
    name: changes.name !== undefined ? assertText(changes.name, 'Le nom de l’activité') : activity.name,
    startDate: changes.startDate ? toISODate(changes.startDate) : activity.startDate,
    endDate: changes.endDate !== undefined ? (changes.endDate ? toISODate(changes.endDate) : '') : activity.endDate,
    initialCapital: changes.initialCapital !== undefined ? roundMoney(toNumber(changes.initialCapital, 0)) : activity.initialCapital,
    targetBudget: changes.targetBudget !== undefined ? roundMoney(toNumber(changes.targetBudget, 0)) : activity.targetBudget,
  });
  await applyOperations([op.put('activities', updated)], { type: 'activity-updated', id: activityId });
  return updated;
}

export async function setActivityStatus(activityId, status) {
  return updateActivity(activityId, { status });
}

export async function deleteActivity(activityId) {
  const state = getState();
  const linked =
    state.products.some((item) => item.activityId === activityId) ||
    state.sales.some((item) => item.activityId === activityId) ||
    state.purchases.some((item) => item.activityId === activityId) ||
    state.expenses.some((item) => item.activityId === activityId);
  if (linked) {
    throw new BusinessError(
      'Cette activité contient des opérations : archivez-la au lieu de la supprimer, afin de préserver l’historique.',
    );
  }
  const operations = [op.remove('activities', activityId)];
  const settings = getSettings();
  if (settings.currentActivityId === activityId) operations.push(op.put('settings', { ...settings, currentActivityId: '' }));
  await applyOperations(operations, { type: 'activity-deleted', id: activityId });
}

/* ----------------------------- trésorerie ------------------------------- */

export async function addContribution(input) {
  const activity = requireActivity(input.activityId);
  const { cashMovement } = buildContribution({ ...input, activityId: activity.id });
  await applyOperations([op.put('cashMovements', cashMovement)], { type: 'contribution' });
  return cashMovement;
}

export async function addWithdrawal(input) {
  const activity = requireActivity(input.activityId);
  const { cashMovement } = buildWithdrawal({ ...input, activityId: activity.id });
  await applyOperations([op.put('cashMovements', cashMovement)], { type: 'withdrawal' });
  return cashMovement;
}

export async function addCashMovement(input) {
  const cashMovement = buildCashMovement(input);
  await applyOperations([op.put('cashMovements', cashMovement)], { type: 'cash-movement' });
  return cashMovement;
}

export async function transferBetweenAccounts(input) {
  const { cashMovements } = buildTransfer(input);
  await applyOperations(putAll('cashMovements', cashMovements), { type: 'transfer' });
  return cashMovements;
}

export async function saveCashAccount(input) {
  const existing = input.id ? getState().cashAccounts.find((entry) => entry.id === input.id) : null;
  const account = existing
    ? stamp({ ...existing, ...input, name: assertText(input.name, 'Le nom du compte') })
    : buildCashAccount(input);
  await applyOperations([op.put('cashAccounts', account)], { type: 'cash-account' });
  return account;
}

export async function toggleCashAccount(accountId, active) {
  const account = requireEntity('cashAccounts', accountId, 'Compte de trésorerie');
  const updated = stamp({ ...account, active });
  await applyOperations([op.put('cashAccounts', updated)], { type: 'cash-account' });
  return updated;
}

/* ------------------------------- produits ------------------------------- */

export async function createProduct(input) {
  const activity = requireActivity(input.activityId);
  const name = assertText(input.name, 'Le nom du produit');
  const product = {
    id: newId(ID_PREFIX.PRODUCT),
    activityId: activity.id,
    name,
    reference: input.reference || '',
    category: input.category || '',
    unit: input.unit || 'pièce',
    cost: roundMoney(toNumber(input.cost, 0)),
    price: roundMoney(toNumber(input.price, 0)),
    alertThreshold: toNumber(input.alertThreshold, 0),
    description: input.description || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const operations = [op.put('products', product)];

  // Stock initial facultatif : tracé comme un mouvement d'entrée documenté.
  const openingQuantity = toNumber(input.openingQuantity, 0);
  if (openingQuantity > 0) {
    const openingMovement = buildCorrectionMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: product.activityId,
      productId: product.id,
      date: toISODate(input.openingDate || todayISO()),
      currentQuantity: 0,
      targetQuantity: openingQuantity,
      unitCost: roundMoney(toNumber(input.openingUnitCost, product.cost)),
      reason: 'opening',
      sourceType: 'product',
      sourceId: product.id,
      note: `Stock initial — ${product.name}`,
    });
    if (openingMovement) operations.push(op.put('stockMovements', openingMovement));
  }

  await applyOperations(operations, { type: 'product-created', id: product.id });
  return product;
}

export async function updateProduct(productId, changes) {
  const product = requireEntity('products', productId, 'Produit');
  const updated = stamp({
    ...product,
    ...changes,
    name: changes.name !== undefined ? assertText(changes.name, 'Le nom du produit') : product.name,
    cost: changes.cost !== undefined ? roundMoney(toNumber(changes.cost, 0)) : product.cost,
    price: changes.price !== undefined ? roundMoney(toNumber(changes.price, 0)) : product.price,
    alertThreshold: changes.alertThreshold !== undefined ? toNumber(changes.alertThreshold, 0) : product.alertThreshold,
  });
  await applyOperations([op.put('products', updated)], { type: 'product-updated', id: productId });
  return updated;
}

export async function setProductStatus(productId, status) {
  return updateProduct(productId, { status });
}

export async function deleteProduct(productId) {
  const state = getState();
  const hasMovements = state.stockMovements.some((movement) => movement.productId === productId);
  if (hasMovements) {
    throw new BusinessError(
      'Ce produit possède un historique de stock : archivez-le au lieu de le supprimer, afin de préserver l’historique.',
    );
  }
  await applyOperations([op.remove('products', productId)], { type: 'product-deleted', id: productId });
}

/** Correction documentée du stock (perte, casse, inventaire, retour…). */
export async function adjustStock(input) {
  const product = requireEntity('products', input.productId, 'Produit');
  const state = getState();
  const movements = state.stockMovements.filter((movement) => movement.productId === product.id);
  const current = computeProductStock(movements, product.id, product.cost);

  let movement;
  if (input.mode === 'set') {
    movement = buildCorrectionMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: product.activityId,
      productId: product.id,
      date: toISODate(input.date),
      currentQuantity: current.quantity,
      targetQuantity: toNumber(input.targetQuantity, 0),
      unitCost: toNumber(input.unitCost, current.averageCost),
      reason: input.reason || 'correction',
      sourceType: 'manual',
      note: input.note || '',
    });
  } else {
    const quantity = toNumber(input.quantity, 0);
    if (quantity <= 0) throw new BusinessError('La quantité doit être supérieure à zéro.');
    const direction = input.direction === 'in' ? 'in' : 'out';
    movement = {
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: product.activityId,
      productId: product.id,
      date: toISODate(input.date),
      type: direction,
      reason: input.reason || (direction === 'in' ? 'opening' : 'loss'),
      quantity: direction === 'in' ? quantity : -quantity,
      unitCost: toNumber(input.unitCost, current.averageCost),
      sourceType: 'manual',
      sourceId: '',
      note: input.note || '',
      createdAt: new Date().toISOString(),
    };
  }

  if (!movement) throw new BusinessError('La correction demandée ne change pas la quantité en stock.');
  await applyOperations([op.put('stockMovements', movement)], { type: 'stock-adjusted', id: product.id });
  return movement;
}

/* -------------------------------- achats -------------------------------- */

/**
 * Enregistre un achat avec son paiement éventuel.
 * @param {object} input lignes, fournisseur, frais, statut (ordered|received), paiements
 */
export async function createPurchase(input) {
  const activity = requireActivity(input.activityId);
  const state = getState();
  const { purchase, stockMovements } = buildPurchase(
    { ...input, activityId: activity.id },
    { products: state.products },
  );

  const payments = buildPurchasePayments(purchase, input.payments || [], { maxAmount: purchaseTotal(purchase) });
  const operations = [op.put('purchases', purchase), ...putAll('stockMovements', stockMovements), ...putAll('payments', payments)];
  for (const payment of payments) {
    operations.push(...putAll('cashMovements', paymentsToCashMovements([payment])));
  }

  await applyOperations(operations, { type: 'purchase-created', id: purchase.id });
  return purchase;
}

/** Réception d'un achat commandé : c'est ici que le stock augmente. */
export async function receivePurchaseAction(purchaseId, date) {
  const purchase = requireEntity('purchases', purchaseId, 'Achat');
  const state = getState();
  const { purchase: received, stockMovements } = receivePurchase({ purchase, date });
  const activity = state.activities.find((entry) => entry.id === received.activityId);
  await applyOperations(
    [op.put('purchases', received), ...putAll('stockMovements', stockMovements)],
    { type: 'purchase-received', id: received.id },
  );
  return { purchase: received, activity };
}

export async function payPurchase(input) {
  const purchase = requireEntity('purchases', input.purchaseId, 'Achat');
  const state = getState();
  const { payment, cashMovements } = buildSupplierPayment({
    purchase,
    amount: input.amount,
    date: input.date,
    method: input.method,
    accountId: input.accountId,
    note: input.note,
    payments: state.payments,
    returns: state.returns,
  });
  await applyOperations([op.put('payments', payment), ...putAll('cashMovements', cashMovements)], {
    type: 'purchase-paid',
    id: purchase.id,
  });
  return payment;
}

export async function returnPurchase(input) {
  const purchase = requireEntity('purchases', input.purchaseId, 'Achat');
  const state = getState();
  const result = buildPurchaseReturn(
    { purchase, lines: input.lines, date: input.date, reason: input.reason, refundAmount: input.refundAmount, refundMethod: input.refundMethod, accountId: input.accountId },
    { returns: state.returns },
  );
  await applyOperations(
    [
      op.put('returns', result.return),
      ...putAll('stockMovements', result.stockMovements),
      ...putAll('payments', result.payments),
      ...putAll('cashMovements', result.cashMovements),
    ],
    { type: 'purchase-returned', id: purchase.id },
  );
  return result.return;
}

export async function cancelPurchase(input) {
  const purchase = requireEntity('purchases', input.purchaseId, 'Achat');
  const state = getState();
  const result = buildPurchaseCancellation(
    { purchase, date: input.date, reason: input.reason, method: input.method, accountId: input.accountId },
    { payments: state.payments, returns: state.returns },
  );
  await applyOperations(
    [
      op.put('purchases', result.purchase),
      ...putAll('stockMovements', result.stockMovements),
      ...putAll('payments', result.payments),
      ...putAll('cashMovements', result.cashMovements),
    ],
    { type: 'purchase-cancelled', id: purchase.id },
  );
  return result.purchase;
}


/* -------------------------------- ventes -------------------------------- */

/** Enregistre une vente : lignes, stock, paiements et trésorerie en une fois. */
export async function createSale(input) {
  const activity = requireActivity(input.activityId);
  const state = getState();
  const stockState = computeStockState(state.stockMovements, state.products);
  const settings = getSettings();

  const { sale, stockMovements } = buildSale(
    { ...input, activityId: activity.id },
    { products: state.products, stockState, allowNegativeStock: settings.allowNegativeStock },
  );

  const requestedPayments = (input.payments || []).filter((payment) => toNumber(payment.amount, 0) > 0);
  const payments = buildSalePayments(sale, requestedPayments, { maxAmount: saleTotal(sale) });
  if (saleTotal(sale) > 0 && payments.length === 0) {
    // vente à crédit : aucun encaissement, la créance est suivie côté client
    if (!sale.customerId) {
      throw new BusinessError(
        'Une vente sans encaissement doit être rattachée à un client, afin de suivre la créance.',
      );
    }
  }

  const operations = [op.put('sales', sale), ...putAll('stockMovements', stockMovements), ...putAll('payments', payments)];
  for (const payment of payments) operations.push(...putAll('cashMovements', paymentsToCashMovements([payment])));

  await applyOperations(operations, { type: 'sale-created', id: sale.id });
  return sale;
}

export async function paySale(input) {
  const sale = requireEntity('sales', input.saleId, 'Vente');
  const state = getState();
  const { payment, cashMovements } = buildCustomerPayment({
    sale,
    amount: input.amount,
    date: input.date,
    method: input.method,
    accountId: input.accountId,
    note: input.note,
    payments: state.payments,
    returns: state.returns,
  });
  await applyOperations([op.put('payments', payment), ...putAll('cashMovements', cashMovements)], {
    type: 'sale-paid',
    id: sale.id,
  });
  return payment;
}

export async function returnSale(input) {
  const sale = requireEntity('sales', input.saleId, 'Vente');
  const state = getState();
  const result = buildSaleReturn(
    {
      sale,
      lines: input.lines,
      date: input.date,
      reason: input.reason,
      refundAmount: input.refundAmount,
      refundMethod: input.refundMethod,
      accountId: input.accountId,
    },
    { returns: state.returns, payments: state.payments },
  );
  await applyOperations(
    [
      op.put('returns', result.return),
      ...putAll('stockMovements', result.stockMovements),
      ...putAll('payments', result.payments),
      ...putAll('cashMovements', result.cashMovements),
    ],
    { type: 'sale-returned', id: sale.id },
  );
  return result.return;
}

export async function cancelSale(input) {
  const sale = requireEntity('sales', input.saleId, 'Vente');
  const state = getState();
  const result = buildSaleCancellation(
    { sale, date: input.date, reason: input.reason, method: input.method, accountId: input.accountId },
    { payments: state.payments, returns: state.returns },
  );
  await applyOperations(
    [
      op.put('sales', result.sale),
      ...putAll('stockMovements', result.stockMovements),
      ...putAll('payments', result.payments),
      ...putAll('cashMovements', result.cashMovements),
    ],
    { type: 'sale-cancelled', id: sale.id },
  );
  return result.sale;
}

/* ------------------------------- dépenses ------------------------------- */

export async function createExpense(input) {
  const activity = requireActivity(input.activityId);
  const { expense, cashMovements } = buildExpense({ ...input, activityId: activity.id });
  await applyOperations([op.put('expenses', expense), ...putAll('cashMovements', cashMovements)], {
    type: 'expense-created',
    id: expense.id,
  });
  return expense;
}

export async function updateExpense(expenseId, changes) {
  const expense = requireEntity('expenses', expenseId, 'Dépense');
  const { expense: updated, cashMovements } = rebuildExpenseUpdate(expense, changes);
  await applyOperations([op.put('expenses', updated), ...putAll('cashMovements', cashMovements)], {
    type: 'expense-updated',
    id: expenseId,
  });
  return updated;
}

export async function deleteExpense(expenseId) {
  const expense = requireEntity('expenses', expenseId, 'Dépense');
  const { cashMovements } = buildExpenseReversal(expense);
  await applyOperations([op.remove('expenses', expenseId), ...putAll('cashMovements', cashMovements)], {
    type: 'expense-deleted',
    id: expenseId,
  });
}

/* -------------------------- clients / fournisseurs ---------------------- */

export async function saveCustomer(input) {
  const existing = input.id ? getState().customers.find((entry) => entry.id === input.id) : null;
  const customer = existing
    ? stamp({ ...existing, ...input, name: assertText(input.name, 'Le nom du client') })
    : {
        id: newId(ID_PREFIX.CUSTOMER),
        name: assertText(input.name, 'Le nom du client'),
        phone: input.phone || '',
        email: input.email || '',
        address: input.address || '',
        note: input.note || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
  await applyOperations([op.put('customers', customer)], { type: 'customer-saved', id: customer.id });
  return customer;
}

export async function deleteCustomer(customerId) {
  const state = getState();
  if (state.sales.some((sale) => sale.customerId === customerId)) {
    throw new BusinessError('Ce client possède un historique de ventes : conservez sa fiche pour préserver l’historique.');
  }
  await applyOperations([op.remove('customers', customerId)], { type: 'customer-deleted', id: customerId });
}

export async function saveSupplier(input) {
  const existing = input.id ? getState().suppliers.find((entry) => entry.id === input.id) : null;
  const supplier = existing
    ? stamp({ ...existing, ...input, name: assertText(input.name, 'Le nom du fournisseur') })
    : {
        id: newId(ID_PREFIX.SUPPLIER),
        name: assertText(input.name, 'Le nom du fournisseur'),
        phone: input.phone || '',
        email: input.email || '',
        address: input.address || '',
        note: input.note || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
  await applyOperations([op.put('suppliers', supplier)], { type: 'supplier-saved', id: supplier.id });
  return supplier;
}

export async function deleteSupplier(supplierId) {
  const state = getState();
  if (state.purchases.some((purchase) => purchase.supplierId === supplierId)) {
    throw new BusinessError('Ce fournisseur possède un historique d’achats : conservez sa fiche pour préserver l’historique.');
  }
  await applyOperations([op.remove('suppliers', supplierId)], { type: 'supplier-deleted', id: supplierId });
}

/* ------------------------------- employés (L10) ------------------------- */

export async function saveEmployee(input) {
  const existing = input.id ? getState().employees.find((entry) => entry.id === input.id) : null;
  const now = new Date().toISOString();
  const base = {
    name: assertText(input.name, 'Le nom de l’employé'),
    phone: String(input.phone || '').trim(),
    role: String(input.role || '').trim(),
    hiredAt: toISODate(input.hiredAt) || todayISO(),
    salary: roundMoney(toNumber(input.salary, 0)),
    activityId: input.activityId || '',
    status: input.status === 'inactive' ? 'inactive' : 'active',
    note: String(input.note || '').trim(),
    updatedAt: now,
  };
  if (base.salary < 0) throw new BusinessError('Le salaire de référence ne peut pas être négatif.');
  const employee = existing
    ? { ...existing, ...base }
    : { id: newId(ID_PREFIX.EMPLOYEE), ...base, createdAt: now };
  await applyOperations([op.put('employees', employee)], { type: 'employee-saved', id: employee.id });
  return employee;
}

export async function setEmployeeStatus(employeeId, status) {
  const employee = requireEntity('employees', employeeId, 'Employé');
  const updated = stamp({ ...employee, status: status === 'inactive' ? 'inactive' : 'active' });
  await applyOperations([op.put('employees', updated)], { type: 'employee-saved', id: employeeId });
  return updated;
}

export async function deleteEmployee(employeeId) {
  const state = getState();
  if (state.expenses.some((expense) => expense.employeeId === employeeId)) {
    throw new BusinessError(
      'Cet employé possède un historique de salaires : désactivez sa fiche au lieu de la supprimer, afin de préserver la traçabilité.',
    );
  }
  await applyOperations([op.remove('employees', employeeId)], { type: 'employee-deleted', id: employeeId });
}

/** Verse un salaire : crée une dépense d'exploitation reliée à l'employé. */
export async function payEmployeeSalary(input) {
  const employee = requireEntity('employees', input.employeeId, 'Employé');
  const activity = requireActivity(input.activityId || employee.activityId);
  const period = String(input.period || '').trim();
  return createExpense({
    activityId: activity.id,
    date: input.date,
    category: 'Salaire',
    nature: 'operating',
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    accountId: input.accountId,
    beneficiary: employee.name,
    employeeId: employee.id,
    paid: input.paid !== false,
    note: [period ? `Salaire ${period}` : 'Salaire', input.note].filter(Boolean).join(' — '),
  });
}

/* --------------------------- import de relevés (L21) -------------------- */

/**
 * Importe des lignes de relevé déjà validées par l'utilisateur.
 * - mode « cash » : chaque ligne devient un mouvement de trésorerie ;
 * - mode « expense » : les sorties deviennent des dépenses d'exploitation, les
 *   entrées restent des mouvements de trésorerie.
 * Les lignes déjà importées (même date, sens, montant, libellé) sont ignorées.
 */
export async function importStatementLines({ lines = [], accountId, activityId, mode = 'cash' } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) throw new BusinessError('Aucune ligne à importer.');
  const activity = requireActivity(activityId);
  if (!accountId) throw new BusinessError('Choisissez le compte de trésorerie à rapprocher.');

  const existing = new Set((await readAll('imports')).map((record) => record.id));
  const batchId = newId(ID_PREFIX.IMPORT);
  const createdAt = new Date().toISOString();
  const operations = [];
  const fingerprints = [];
  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    const fingerprint = lineFingerprint(line);
    if (existing.has(fingerprint)) {
      skipped += 1;
      continue;
    }
    existing.add(fingerprint);
    fingerprints.push({
      id: fingerprint,
      hash: fingerprint,
      batchId,
      date: line.date,
      amount: line.amount,
      direction: line.direction,
      label: line.label,
      createdAt,
    });

    if (mode === 'expense' && line.direction === 'out') {
      const { expense, cashMovements } = buildExpense({
        activityId: activity.id,
        date: line.date,
        category: 'Autres',
        nature: 'operating',
        amount: line.amount,
        accountId,
        paid: true,
        beneficiary: line.label,
        note: `Import de relevé — ${line.label}`,
      });
      operations.push(op.put('expenses', expense), ...putAll('cashMovements', cashMovements));
    } else {
      const movement = buildCashMovement({
        activityId: activity.id,
        date: line.date,
        accountId,
        direction: line.direction,
        amount: line.amount,
        nature: line.direction === 'in' ? 'other_in' : 'other_out',
        sourceType: 'bank_import',
        sourceId: batchId,
        note: `Import de relevé — ${line.label}`,
      });
      operations.push(op.put('cashMovements', movement));
    }
    imported += 1;
  }

  if (imported === 0) {
    throw new BusinessError('Toutes les lignes de ce fichier ont déjà été importées.');
  }

  const settings = getSettings();
  operations.push(
    op.put('settings', {
      ...settings,
      lastBankImportAt: createdAt,
      lastBankImportCount: imported,
      updatedAt: createdAt,
    }),
  );
  operations.push(...putAll('imports', fingerprints));

  await applyOperations(operations, { type: 'bank-import', summary: `${imported} ligne(s)` });
  return { imported, skipped, batchId };
}

/* ------------------------------ paramètres ------------------------------ */

export async function saveProductCategory(name) {
  const settings = getSettings();
  const label = assertText(name, 'Le nom de la catégorie', { max: 60 });
  if (settings.productCategories.includes(label)) throw new BusinessError('Cette catégorie existe déjà.');
  return applyOperations(
    [op.put('settings', { ...settings, productCategories: [...settings.productCategories, label] })],
    { type: 'settings' },
  );
}

export async function saveExpenseCategory(name) {
  const settings = getSettings();
  const label = assertText(name, 'Le nom de la catégorie', { max: 60 });
  if (settings.expenseCategories.includes(label)) throw new BusinessError('Cette catégorie existe déjà.');
  return applyOperations(
    [op.put('settings', { ...settings, expenseCategories: [...settings.expenseCategories, label] })],
    { type: 'settings' },
  );
}

export async function savePaymentMethod(name) {
  const settings = getSettings();
  const label = assertText(name, 'Le nom du moyen de paiement', { max: 40 });
  if (settings.paymentMethods.includes(label)) throw new BusinessError('Ce moyen de paiement existe déjà.');
  return applyOperations([op.put('settings', { ...settings, paymentMethods: [...settings.paymentMethods, label] })], {
    type: 'settings',
  });
}

export async function removeSettingsEntry(key, value) {
  const settings = getSettings();
  const list = Array.isArray(settings[key]) ? settings[key] : [];
  if (list.length <= 1) throw new BusinessError('Il doit rester au moins une valeur dans cette liste.');
  return applyOperations([op.put('settings', { ...settings, [key]: list.filter((entry) => entry !== value) })], {
    type: 'settings',
  });
}

/* ------------------------------- helpers -------------------------------- */

export function stockStateSnapshot() {
  const state = getState();
  return computeStockState(state.stockMovements, state.products);
}

export function productMovements(productId) {
  const state = getState();
  return sortMovements(state.stockMovements.filter((movement) => movement.productId === productId));
}

export function saleOutstanding(sale) {
  const state = getState();
  return saleBalance(sale, { payments: state.payments, returns: state.returns });
}

export function purchaseOutstanding(purchase) {
  const state = getState();
  return purchaseBalance(purchase, { payments: state.payments, returns: state.returns });
}

export { DOCUMENT_STATUS, EXPENSE_NATURE_VALUES };
