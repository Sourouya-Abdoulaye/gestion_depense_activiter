/* ---------------------------------------------------------------------------
 * Mon Commerce — service Finance (logique pure)
 *
 * Règles de gestion impératives (cahier des charges §5) et conventions :
 *   1. Chiffre d'affaires = ventes validées, nettes des remises et des retours.
 *   2. Encaissements = paiements réellement reçus (créances exclues).
 *   3. Coût des produits vendus = coût des unités vendues, figé en CMP à la
 *      vente (champ `unitCost` de chaque ligne de vente).
 *   4. Marge brute = chiffre d'affaires net − coût des produits vendus.
 *   5. Résultat estimé = marge brute − dépenses d'exploitation de la période.
 *      Les frais d'approvisionnement et les investissements ne sont jamais
 *      déduits ici (déjà dans le coût d'acquisition, ou hors résultat).
 *   6. Créance client = montant dû − paiements reçus − avoirs (retours).
 *      Dette fournisseur : même règle côté achats.
 *   7. Trésorerie = solde initial + entrées réelles − sorties réelles.
 *      Les transferts internes entre comptes ne sont ni recette ni dépense.
 *   8. Budget restant, bénéfice, chiffre d'affaires et trésorerie sont quatre
 *      indicateurs distincts et ne sont jamais confondus dans l'interface.
 *
 * Aucune dépendance au DOM ni à IndexedDB : ce module est testable sous Node.
 * ------------------------------------------------------------------------- */

import { DOCUMENT_STATUS, EXPENSE_NATURE_VALUES } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, roundQuantity, toNumber } from '../shared/format.js';
import { computeStockState, stockValue as computeStockValue } from './stock.js';

/* ------------------------------- filtres -------------------------------- */

/** Filtre générique par activité et par période (bornes incluses). */
export function matchesFilters(record, filters = {}) {
  if (!record) return false;
  if (filters.activityId && record.activityId !== filters.activityId) return false;
  if (filters.from || filters.to) {
    const date = toISODate(record.date);
    if (!date) return false;
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
  }
  return true;
}

export function filterRecords(records = [], filters = {}) {
  return records.filter((record) => matchesFilters(record, filters));
}

/* ---------------------------- documents vente --------------------------- */

export const isValidatedSale = (sale) => sale && sale.status === DOCUMENT_STATUS.VALIDATED;
export const isReceivedPurchase = (purchase) => purchase && purchase.status === DOCUMENT_STATUS.RECEIVED;
export const isCancelled = (document_) => document_ && document_.status === DOCUMENT_STATUS.CANCELLED;

export function saleLineGross(line) {
  return roundMoney(toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0));
}

export function saleLineNet(line) {
  return roundMoney(saleLineGross(line) - toNumber(line.discount, 0));
}

export function saleLinesSubtotal(lines = []) {
  return roundMoney(lines.reduce((total, line) => total + saleLineNet(line), 0));
}

/** Total d'une vente : sous-total net des remises de ligne, remise globale,
 *  plus frais éventuels. */
export function saleTotal(sale) {
  if (!sale) return 0;
  return roundMoney(saleLinesSubtotal(sale.lines) - toNumber(sale.discount, 0) + toNumber(sale.otherFees, 0));
}

/* --------------------------- documents achat ---------------------------- */

export function purchaseLineNet(line) {
  return roundMoney(toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0) - toNumber(line.discount, 0));
}

export function purchaseLinesSubtotal(lines = []) {
  return roundMoney(lines.reduce((total, line) => total + purchaseLineNet(line), 0));
}

/** Total d'un achat : marchandises + transport + frais annexes − remise. */
export function purchaseTotal(purchase) {
  if (!purchase) return 0;
  return roundMoney(
    purchaseLinesSubtotal(purchase.lines) -
      toNumber(purchase.discount, 0) +
      toNumber(purchase.transportCost, 0) +
      toNumber(purchase.otherFees, 0),
  );
}

/**
 * Répartition documentée des frais d'acquisition :
 * les frais (transport, autres frais, remise globale) sont répartis au prorata
 * du montant net de chaque ligne, puis ajoutés au coût de la ligne. Le coût
 * unitaire d'acquisition est conservé en pleine précision.
 * @returns {Array} lignes enrichies de `netTotal` et `allocatedUnitCost`
 */
export function allocateAcquisitionCost(lines = [], { transportCost = 0, otherFees = 0, discount = 0 } = {}) {
  const subtotal = purchaseLinesSubtotal(lines);
  const fees = toNumber(transportCost, 0) + toNumber(otherFees, 0) - toNumber(discount, 0);
  return lines.map((line) => {
    const net = purchaseLineNet(line);
    const share = subtotal > 0 ? net / subtotal : lines.length > 0 ? 1 / lines.length : 0;
    const allocatedCost = net + fees * share;
    const quantity = toNumber(line.quantity, 0);
    return {
      ...line,
      netTotal: net,
      allocatedFees: roundMoney(fees * share),
      allocatedCost: roundMoney(allocatedCost),
      allocatedUnitCost: quantity > 0 ? allocatedCost / quantity : 0,
    };
  });
}

/* -------------------------------- retours ------------------------------- */

export function returnTotal(returnDocument) {
  if (!returnDocument) return 0;
  return roundMoney(
    (returnDocument.lines || []).reduce(
      (total, line) => total + toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0),
      0,
    ),
  );
}

export function returnsFor(returns = [], { kind, sourceId }) {
  return returns.filter((item) => (!kind || item.kind === kind) && (!sourceId || item.sourceId === sourceId));
}

export function creditAmountFor(returns = [], { kind, sourceId }) {
  return roundMoney(returnsFor(returns, { kind, sourceId }).reduce((total, item) => total + returnTotal(item), 0));
}

/* ------------------------------- paiements ------------------------------ */

export function paymentsFor(payments = [], { partyType, partyId }) {
  return payments.filter((payment) => payment.partyType === partyType && payment.partyId === partyId);
}

/**
 * Somme des mouvements d'argent reçus (direction « in ») liés à un document.
 * Pour une vente, il s'agit des encaissements client ; pour un achat, des
 * remboursements reçus du fournisseur.
 */
export function cashInFor(payments = [], partyType, partyId) {
  return roundMoney(
    paymentsFor(payments, { partyType, partyId })
      .filter((payment) => payment.direction === 'in')
      .reduce((total, payment) => total + toNumber(payment.amount, 0), 0),
  );
}

/**
 * Somme des mouvements d'argent versés (direction « out ») liés à un document.
 * Pour un achat, il s'agit des paiements fournisseur ; pour une vente, des
 * remboursements rendus au client.
 */
export function cashOutFor(payments = [], partyType, partyId) {
  return roundMoney(
    paymentsFor(payments, { partyType, partyId })
      .filter((payment) => payment.direction === 'out')
      .reduce((total, payment) => total + toNumber(payment.amount, 0), 0),
  );
}

/**
 * Solde d'une vente : ce que le client doit encore.
 * total − avoirs (retours) − encaissements + remboursements.
 * Une vente annulée n'ouvre plus aucun solde.
 */
export function saleBalance(sale, { payments = [], returns = [] } = {}) {
  if (!sale || isCancelled(sale)) return 0;
  const credits = creditAmountFor(returns, { kind: 'sale', sourceId: sale.id });
  return roundMoney(
    saleTotal(sale) - credits - cashInFor(payments, 'sale', sale.id) + cashOutFor(payments, 'sale', sale.id),
  );
}

/** Solde d'un achat : ce que le commerce doit encore au fournisseur. */
export function purchaseBalance(purchase, { payments = [], returns = [] } = {}) {
  if (!purchase || isCancelled(purchase)) return 0;
  const credits = creditAmountFor(returns, { kind: 'purchase', sourceId: purchase.id });
  return roundMoney(
    purchaseTotal(purchase) -
      credits -
      cashOutFor(payments, 'purchase', purchase.id) +
      cashInFor(payments, 'purchase', purchase.id),
  );
}

/**
 * Liste des créances clients ouvertes (solde strictement positif).
 * @returns {Array<{sale: object, balance: number, overdueDays: number}>}
 */
export function receivableList({ sales = [], payments = [], returns = [], filters = {}, reference = new Date() } = {}) {
  const today = toISODate(reference);
  return filterRecords(sales, filters)
    .filter(isValidatedSale)
    .map((sale) => {
      const balance = saleBalance(sale, { payments, returns });
      const dueDate = sale.dueDate || '';
      const overdueDays = dueDate && balance > 0 && dueDate < today ? daysBetweenDates(dueDate, today) : 0;
      return { sale, balance, dueDate, overdueDays };
    })
    .filter((entry) => entry.balance > 0.005)
    .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
}

export function totalReceivables(options = {}) {
  return roundMoney(receivableList(options).reduce((total, entry) => total + entry.balance, 0));
}

export function payableList({ purchases = [], payments = [], returns = [], filters = {}, reference = new Date() } = {}) {
  const today = toISODate(reference);
  return filterRecords(purchases, filters)
    .filter(isReceivedPurchase)
    .map((purchase) => {
      const balance = purchaseBalance(purchase, { payments, returns });
      const dueDate = purchase.dueDate || '';
      const overdueDays = dueDate && balance > 0 && dueDate < today ? daysBetweenDates(dueDate, today) : 0;
      return { purchase, balance, dueDate, overdueDays };
    })
    .filter((entry) => entry.balance > 0.005)
    .sort((a, b) => ((a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1));
}

export function totalPayables(options = {}) {
  return roundMoney(payableList(options).reduce((total, entry) => total + entry.balance, 0));
}

function daysBetweenDates(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/* ------------------------------ résultat -------------------------------- */

/** Chiffre d'affaires brut des ventes validées (avant retours). */
export function grossSalesRevenue({ sales = [], filters = {} } = {}) {
  return roundMoney(
    filterRecords(sales, filters)
      .filter(isValidatedSale)
      .reduce((total, sale) => total + saleTotal(sale), 0),
  );
}

/** Retours clients de la période (réduisent le chiffre d'affaires). */
export function salesReturnsRevenue({ returns = [], filters = {} } = {}) {
  return roundMoney(
    filterRecords(returns, filters)
      .filter((item) => item.kind === 'sale')
      .reduce((total, item) => total + returnTotal(item), 0),
  );
}

/** Chiffre d'affaires net = ventes validées − retours clients. */
export function revenue(options = {}) {
  return roundMoney(grossSalesRevenue(options) - salesReturnsRevenue(options));
}

/** Coût des produits vendus (CMP figé à la vente), net des retours clients. */
export function costOfGoodsSold({ sales = [], returns = [], filters = {} } = {}) {
  const sold = filterRecords(sales, filters)
    .filter(isValidatedSale)
    .reduce(
      (total, sale) =>
        total + (sale.lines || []).reduce((sum, line) => sum + toNumber(line.quantity, 0) * toNumber(line.unitCost, 0), 0),
      0,
    );
  const returned = filterRecords(returns, filters)
    .filter((item) => item.kind === 'sale')
    .reduce(
      (total, item) =>
        total + (item.lines || []).reduce((sum, line) => sum + toNumber(line.quantity, 0) * toNumber(line.unitCost, 0), 0),
      0,
    );
  return roundMoney(sold - returned);
}

/** Marge brute = chiffre d'affaires net − coût des produits vendus. */
export function grossMargin(options = {}) {
  return roundMoney(revenue(options) - costOfGoodsSold(options));
}

/** Taux de marge = marge brute ÷ chiffre d'affaires net. */
export function marginRate(options = {}) {
  const net = revenue(options);
  if (net === 0) return 0;
  return grossMargin(options) / net;
}

/* ------------------------------- dépenses ------------------------------- */

export function expensesByNature({ expenses = [], filters = {} } = {}) {
  const result = Object.fromEntries(EXPENSE_NATURE_VALUES.map((nature) => [nature, 0]));
  for (const expense of filterRecords(expenses, filters)) {
    const nature = EXPENSE_NATURE_VALUES.includes(expense.nature) ? expense.nature : 'operating';
    result[nature] = roundMoney(result[nature] + toNumber(expense.amount, 0));
  }
  return result;
}

/**
 * Dépenses d'exploitation de la période : seules celles de nature
 * « operating » sont déduites du résultat. Les frais d'approvisionnement sont
 * déjà intégrés au coût des produits vendus (pas de double déduction) ; les
 * investissements et retraits personnels ne sont pas des charges.
 */
export function periodOperatingExpenses({ expenses = [], filters = {} } = {}) {
  return roundMoney(
    filterRecords(expenses, filters)
      .filter((expense) => (expense.nature || 'operating') === 'operating')
      .reduce((total, expense) => total + toNumber(expense.amount, 0), 0),
  );
}

export function expensesTotal({ expenses = [], filters = {} } = {}) {
  return roundMoney(filterRecords(expenses, filters).reduce((total, expense) => total + toNumber(expense.amount, 0), 0));
}

export function expensesByCategory({ expenses = [], filters = {} } = {}) {
  const groups = {};
  for (const expense of filterRecords(expenses, filters)) {
    const category = expense.category || 'Autres';
    groups[category] = roundMoney((groups[category] || 0) + toNumber(expense.amount, 0));
  }
  return Object.entries(groups)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Résultat estimé = marge brute − dépenses d'exploitation de la période. */
export function estimatedResult(options = {}) {
  return roundMoney(grossMargin(options) - periodOperatingExpenses(options));
}

/* ------------------------------ trésorerie ------------------------------ */

/** Les transferts internes ne sont ni recette ni dépense consolidée. */
export const INTERNAL_TRANSFER_NATURES = ['transfer_in', 'transfer_out'];

export function accountBalance(account, cashMovements = []) {
  const initial = toNumber(account.initialBalance, 0);
  return roundMoney(
    cashMovements
      .filter((movement) => movement.accountId === account.id)
      .reduce(
        (total, movement) =>
          total + (movement.direction === 'in' ? toNumber(movement.amount, 0) : -toNumber(movement.amount, 0)),
        initial,
      ),
  );
}

export function treasuryByAccount({ cashAccounts = [], cashMovements = [] } = {}) {
  return cashAccounts
    .filter((account) => account.active !== false)
    .map((account) => ({ account, balance: accountBalance(account, cashMovements) }));
}

export function treasuryBalance({ cashAccounts = [], cashMovements = [] } = {}) {
  return roundMoney(treasuryByAccount({ cashAccounts, cashMovements }).reduce((total, entry) => total + entry.balance, 0));
}

/**
 * Entrées de trésorerie réelles.
 * Par convention, les transferts internes et les apports de l'exploitant ne
 * sont pas des « encaissements » d'exploitation : ils sont exclus du montant
 * affiché comme encaissements et présentés séparément.
 */
export function cashInTotal({ cashMovements = [], filters = {}, includeTransfers = false, includeContributions = false } = {}) {
  return roundMoney(
    filterRecords(cashMovements, filters)
      .filter((movement) => movement.direction === 'in')
      .filter((movement) => includeTransfers || !INTERNAL_TRANSFER_NATURES.includes(movement.nature))
      .filter((movement) => includeContributions || movement.nature !== 'capital_in')
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );
}

/** Sorties de trésorerie réelles (hors transferts internes). */
export function cashOutTotal({ cashMovements = [], filters = {}, includeTransfers = false } = {}) {
  return roundMoney(
    filterRecords(cashMovements, filters)
      .filter((movement) => movement.direction === 'out')
      .filter((movement) => includeTransfers || !INTERNAL_TRANSFER_NATURES.includes(movement.nature))
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );
}

/** Apports de l'exploitant sur la période (indicateur distinct). */
export function contributionsTotal({ cashMovements = [], filters = {} } = {}) {
  return roundMoney(
    filterRecords(cashMovements, filters)
      .filter((movement) => movement.direction === 'in' && movement.nature === 'capital_in')
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );
}

/** Retraits de l'exploitant sur la période (indicateur distinct). */
export function withdrawalsTotal({ cashMovements = [], filters = {} } = {}) {
  return roundMoney(
    filterRecords(cashMovements, filters)
      .filter((movement) => movement.direction === 'out' && movement.nature === 'withdrawal')
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );
}

export function cashNet(options = {}) {
  return roundMoney(cashInTotal(options) - cashOutTotal(options));
}

/** Encaissements commerciaux : paiements reçus des clients (hors apports). */
export function collectedFromSales({ payments = [], filters = {} } = {}) {
  const inPayments = filterRecords(payments, filters)
    .filter((payment) => payment.direction === 'in')
    .reduce((total, payment) => total + toNumber(payment.amount, 0), 0);
  const refunds = filterRecords(payments, filters)
    .filter((payment) => payment.direction === 'out')
    .reduce((total, payment) => total + toNumber(payment.amount, 0), 0);
  return roundMoney(inPayments - refunds);
}

/* -------------------------------- budget -------------------------------- */

/**
 * Budget d'une activité.
 *
 * Convention documentée :
 *   • disponible = capital initial + apports de l'exploitant ;
 *   • consommé   = somme des décaissements réels rattachés à l'activité
 *                  (achats payés, dépenses payées, retraits, remboursements) ;
 *   • restant    = disponible − consommé.
 *
 * « Budget restant » est un indicateur de budget : il ne dépend pas des
 * encaissements. La trésorerie réelle est un indicateur distinct (elle, oui,
 * tient compte des ventes encaissées).
 */
export function activityBudget(activity, { cashMovements = [] } = {}) {
  const movements = cashMovements.filter((movement) => movement.activityId === activity.id);
  const initialCapital = toNumber(activity.initialCapital, 0);
  // Le capital initial est déjà compté dans activity.initialCapital : on exclut
  // le mouvement de trésorerie correspondant pour éviter tout double comptage.
  const contributions = roundMoney(
    movements
      .filter((movement) => movement.nature === 'capital_in' && movement.sourceType !== 'activity')
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );

  const outflows = movements.filter((movement) => movement.direction === 'out');
  const sumOut = (natures) =>
    roundMoney(
      outflows
        .filter((movement) => natures.includes(movement.nature))
        .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
    );

  const purchasesPaid = sumOut(['purchase_payment']);
  const expensesPaid = sumOut(['expense']);
  const withdrawals = sumOut(['withdrawal']);
  const refunds = sumOut(['customer_refund']);
  const other = roundMoney(
    outflows
      .filter((movement) => !['purchase_payment', 'expense', 'withdrawal', 'customer_refund', 'transfer_out'].includes(movement.nature))
      .reduce((total, movement) => total + toNumber(movement.amount, 0), 0),
  );
  const consumed = roundMoney(purchasesPaid + expensesPaid + withdrawals + refunds + other);

  const available = roundMoney(initialCapital + contributions);
  const target = toNumber(activity.targetBudget, 0);

  return {
    initialCapital,
    contributions,
    available,
    consumed,
    remaining: roundMoney(available - consumed),
    breakdown: { purchasesPaid, expensesPaid, withdrawals, refunds, other },
    target,
    targetProgress: target > 0 ? consumed / target : 0,
  };
}

/* ------------------------------- séries --------------------------------- */

/** Série mensuelle (YYYY-MM) du chiffre d'affaires, des dépenses et de la marge. */
export function monthlySeries({ sales = [], returns = [], expenses = [], filters = {} } = {}) {
  const months = new Map();
  const ensure = (key) => {
    if (!months.has(key)) months.set(key, { key, revenue: 0, expenses: 0, margin: 0, result: 0, count: 0 });
    return months.get(key);
  };

  for (const sale of filterRecords(sales, filters).filter(isValidatedSale)) {
    const key = toISODate(sale.date).slice(0, 7);
    const entry = ensure(key);
    entry.revenue = roundMoney(entry.revenue + saleTotal(sale));
    entry.margin = roundMoney(
      entry.margin + (sale.lines || []).reduce((sum, line) => sum + (saleLineNet(line) - toNumber(line.quantity, 0) * toNumber(line.unitCost, 0)), 0),
    );
    entry.count += 1;
  }
  for (const item of filterRecords(returns, filters).filter((r) => r.kind === 'sale')) {
    const key = toISODate(item.date).slice(0, 7);
    const entry = ensure(key);
    entry.revenue = roundMoney(entry.revenue - returnTotal(item));
    entry.margin = roundMoney(
      entry.margin - (item.lines || []).reduce((sum, line) => sum + (toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0) - toNumber(line.quantity, 0) * toNumber(line.unitCost, 0)), 0),
    );
  }
  for (const expense of filterRecords(expenses, filters).filter((e) => (e.nature || 'operating') === 'operating')) {
    const key = toISODate(expense.date).slice(0, 7);
    const entry = ensure(key);
    entry.expenses = roundMoney(entry.expenses + toNumber(expense.amount, 0));
  }

  return [...months.values()]
    .map((entry) => ({ ...entry, result: roundMoney(entry.margin - entry.expenses) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Série journalière bornée pour les graphiques de courte période. */
export function dailySeries({ sales = [], returns = [], expenses = [], filters = {}, days = [] } = {}) {
  const map = new Map(days.map((day) => [day, { key: day, revenue: 0, expenses: 0 }]));
  for (const sale of filterRecords(sales, filters).filter(isValidatedSale)) {
    const key = toISODate(sale.date);
    if (!map.has(key)) continue;
    map.get(key).revenue = roundMoney(map.get(key).revenue + saleTotal(sale));
  }
  for (const item of filterRecords(returns, filters).filter((r) => r.kind === 'sale')) {
    const key = toISODate(item.date);
    if (!map.has(key)) continue;
    map.get(key).revenue = roundMoney(map.get(key).revenue - returnTotal(item));
  }
  for (const expense of filterRecords(expenses, filters).filter((e) => (e.nature || 'operating') === 'operating')) {
    const key = toISODate(expense.date);
    if (!map.has(key)) continue;
    map.get(key).expenses = roundMoney(map.get(key).expenses + toNumber(expense.amount, 0));
  }
  return [...map.values()];
}

/* ------------------------------- analyses ------------------------------- */

/** Produits les plus vendus (en quantité et en valeur nette). */
export function topProducts({ sales = [], returns = [], products = [], filters = {}, limit = 10 } = {}) {
  const groups = new Map();
  const ensure = (productId, label) => {
    if (!groups.has(productId)) groups.set(productId, { productId, label, quantity: 0, revenue: 0, cost: 0, margin: 0 });
    return groups.get(productId);
  };

  for (const sale of filterRecords(sales, filters).filter(isValidatedSale)) {
    for (const line of sale.lines || []) {
      const entry = ensure(line.productId, line.label || line.productId);
      entry.quantity = roundQuantity(entry.quantity + toNumber(line.quantity, 0));
      entry.revenue = roundMoney(entry.revenue + saleLineNet(line));
      entry.cost = roundMoney(entry.cost + toNumber(line.quantity, 0) * toNumber(line.unitCost, 0));
    }
  }
  for (const item of filterRecords(returns, filters).filter((r) => r.kind === 'sale')) {
    for (const line of item.lines || []) {
      const entry = ensure(line.productId, line.label || line.productId);
      entry.quantity = roundQuantity(entry.quantity - toNumber(line.quantity, 0));
      entry.revenue = roundMoney(entry.revenue - toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0));
      entry.cost = roundMoney(entry.cost - toNumber(line.quantity, 0) * toNumber(line.unitCost, 0));
    }
  }

  const productIndex = new Map(products.map((product) => [product.id, product]));
  return [...groups.values()]
    .map((entry) => {
      const product = productIndex.get(entry.productId);
      const margin = roundMoney(entry.revenue - entry.cost);
      return {
        ...entry,
        unit: product ? product.unit : '',
        margin,
        marginRate: entry.revenue !== 0 ? margin / entry.revenue : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** Marges par produit, triées par marge décroissante. */
export function productMargins(options = {}) {
  return topProducts({ ...options, limit: Number.MAX_SAFE_INTEGER }).sort((a, b) => b.margin - a.margin);
}

/** Résumé d'exploitation pour les rapports. */
export function activitySummary({ sales = [], returns = [], purchases = [], expenses = [], filters = {} } = {}) {
  const receivedPurchases = filterRecords(purchases, filters).filter(isReceivedPurchase);
  return {
    salesCount: filterRecords(sales, filters).filter(isValidatedSale).length,
    purchasesCount: receivedPurchases.length,
    purchasesTotal: roundMoney(receivedPurchases.reduce((total, purchase) => total + purchaseTotal(purchase), 0)),
    revenue: revenue({ sales, returns, filters }),
    returnsTotal: salesReturnsRevenue({ returns, filters }),
    costOfGoodsSold: costOfGoodsSold({ sales, returns, filters }),
    grossMargin: grossMargin({ sales, returns, filters }),
    operatingExpenses: periodOperatingExpenses({ expenses, filters }),
    expensesByNature: expensesByNature({ expenses, filters }),
    estimatedResult: estimatedResult({ sales, returns, expenses, filters }),
  };
}

/* --------------------------------- KPI ---------------------------------- */

/**
 * Indicateurs consolidés du tableau de bord.
 * @param {object} state données complètes de l'application
 * @param {{activityId?: string, period?: {from: string, to: string}}} options
 */
export function computeKpis(state, { activityId = '', period = null } = {}) {
  const filters = { activityId, from: period?.from, to: period?.to };
  const stockState = computeStockState(state.stockMovements || [], state.products || []);
  const grossRevenue = grossSalesRevenue({ sales: state.sales, filters });
  const returnsValue = salesReturnsRevenue({ returns: state.returns, filters });
  const cogs = costOfGoodsSold({ sales: state.sales, returns: state.returns, filters });
  const operating = periodOperatingExpenses({ expenses: state.expenses, filters });
  const receivables = totalReceivables({
    sales: state.sales,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId },
  });
  const payables = totalPayables({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId },
  });

  // Trésorerie globale : elle n'a de sens qu'au niveau du commerce, pas d'une
  // seule activité, sauf si les mouvements sont rattachés à une activité.
  const treasury = activityId
    ? roundMoney(
        treasuryBalance({
          cashAccounts: state.cashAccounts,
          cashMovements: (state.cashMovements || []).filter((movement) => movement.activityId === activityId),
        }),
      )
    : treasuryBalance({ cashAccounts: state.cashAccounts, cashMovements: state.cashMovements });

  return {
    filters,
    period,
    revenue: roundMoney(grossRevenue - returnsValue),
    grossRevenue,
    returnsValue,
    costOfGoodsSold: cogs,
    grossMargin: roundMoney(grossRevenue - returnsValue - cogs),
    operatingExpenses: operating,
    estimatedResult: roundMoney(grossRevenue - returnsValue - cogs - operating),
    cashIn: cashInTotal({ cashMovements: state.cashMovements, filters }),
    cashOut: cashOutTotal({ cashMovements: state.cashMovements, filters }),
    contributions: contributionsTotal({ cashMovements: state.cashMovements, filters }),
    withdrawals: withdrawalsTotal({ cashMovements: state.cashMovements, filters }),
    treasury,
    receivables,
    payables,
    stockValue: computeStockValue(stockState),
    stockState,
    salesCount: filterRecords(state.sales || [], filters).filter(isValidatedSale).length,
    averageBasket:
      filterRecords(state.sales || [], filters).filter(isValidatedSale).length > 0
        ? roundMoney(
            grossRevenue / filterRecords(state.sales || [], filters).filter(isValidatedSale).length,
          )
        : 0,
  };
}

export { computeStockValue };
