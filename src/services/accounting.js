/* ---------------------------------------------------------------------------
 * Mon Commerce — export comptable simplifié (L9)
 *
 * Produit un journal en partie double lisible par un comptable ou un tableur :
 *   date · journal · compte · libellé · pièce · débit · crédit · source
 *
 * Ce n'est PAS une comptabilité légale : pas de TVA, pas d'amortissements, pas
 * de bilan. Le but est de transmettre des écritures cohérentes et équilibrées
 * (total débit = total crédit) pour gagner du temps lors de la reprise.
 * ------------------------------------------------------------------------- */

import { EXPENSE_NATURES } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { filterRecords, isCancelled, isReceivedPurchase, purchaseTotal, saleTotal } from './finance.js';

export const ACCOUNT_LABELS = {
  101: 'Capital',
  108: 'Compte de l’exploitant',
  215: 'Immobilisations',
  401: 'Fournisseurs',
  411: 'Clients',
  571: 'Caisse / banque / mobile money',
  601: 'Achats et frais d’approvisionnement',
  606: 'Charges d’exploitation',
  658: 'Charges diverses',
  701: 'Ventes de marchandises',
  758: 'Produits divers',
};

const EXPENSE_ACCOUNTS = {
  operating: '606',
  supply: '601',
  investment: '215',
  personal: '108',
};

function expenseAccount(expense) {
  return EXPENSE_ACCOUNTS[expense.nature] || (EXPENSE_NATURES.some((entry) => entry.value === expense.nature) ? '606' : '606');
}

function line({ date, journal, account, piece, label, debit = 0, credit = 0, source = '', sourceId = '' }) {
  return {
    date: toISODate(date),
    journal,
    account,
    accountLabel: ACCOUNT_LABELS[account] || '',
    piece,
    label,
    debit: roundMoney(Math.max(0, toNumber(debit, 0))),
    credit: roundMoney(Math.max(0, toNumber(credit, 0))),
    source,
    sourceId,
  };
}

/**
 * Construit les écritures simplifiées d'une période.
 * @param {object} state état complet
 * @param {{activityId?: string, period?: {from:string,to:string}}} options
 */
export function buildAccountingJournal(state = {}, { activityId = '', period = null } = {}) {
  const filters = { activityId, from: period?.from || '', to: period?.to || '' };
  const rows = [];
  const inPeriod = (date) => {
    const iso = toISODate(date);
    if (!iso) return false;
    if (period?.from && iso < period.from) return false;
    if (period?.to && iso > period.to) return false;
    return true;
  };

  /* Ventes et retours clients */
  const sales = filterRecords(state.sales || [], filters).filter((sale) => sale.status === 'validated' && !isCancelled(sale));
  const saleIds = new Set(sales.map((sale) => sale.id));
  for (const sale of sales) {
    const total = saleTotal(sale);
    rows.push(line({ date: sale.date, journal: 'VE', account: '411', piece: sale.reference, label: `Vente ${sale.reference}`, debit: total, source: 'sale', sourceId: sale.id }));
    rows.push(line({ date: sale.date, journal: 'VE', account: '701', piece: sale.reference, label: `Vente ${sale.reference}`, credit: total, source: 'sale', sourceId: sale.id }));
  }
  for (const entry of state.returns || []) {
    if (entry.kind !== 'sale' || !inPeriod(entry.date)) continue;
    if (!saleIds.has(entry.sourceId)) continue;
    const total = roundMoney(toNumber(entry.total, 0));
    rows.push(line({ date: entry.date, journal: 'VE', account: '701', piece: entry.reference || entry.sourceId, label: 'Retour client', debit: total, source: 'return', sourceId: entry.id }));
    rows.push(line({ date: entry.date, journal: 'VE', account: '411', piece: entry.reference || entry.sourceId, label: 'Retour client', credit: total, source: 'return', sourceId: entry.id }));
  }

  /* Achats et retours fournisseurs */
  const purchases = filterRecords(state.purchases || [], filters).filter(isReceivedPurchase);
  const purchaseIds = new Set(purchases.map((purchase) => purchase.id));
  for (const purchase of purchases) {
    const total = purchaseTotal(purchase);
    rows.push(line({ date: purchase.date, journal: 'AC', account: '601', piece: purchase.reference, label: `Achat ${purchase.reference}`, debit: total, source: 'purchase', sourceId: purchase.id }));
    rows.push(line({ date: purchase.date, journal: 'AC', account: '401', piece: purchase.reference, label: `Achat ${purchase.reference}`, credit: total, source: 'purchase', sourceId: purchase.id }));
  }
  for (const entry of state.returns || []) {
    if (entry.kind !== 'purchase' || !inPeriod(entry.date)) continue;
    if (!purchaseIds.has(entry.sourceId)) continue;
    const total = roundMoney(toNumber(entry.total, 0));
    rows.push(line({ date: entry.date, journal: 'AC', account: '401', piece: entry.reference || entry.sourceId, label: 'Retour fournisseur', debit: total, source: 'return', sourceId: entry.id }));
    rows.push(line({ date: entry.date, journal: 'AC', account: '601', piece: entry.reference || entry.sourceId, label: 'Retour fournisseur', credit: total, source: 'return', sourceId: entry.id }));
  }

  /* Dépenses */
  const expenses = filterRecords(state.expenses || [], filters);
  for (const expense of expenses) {
    const total = roundMoney(toNumber(expense.amount, 0));
    if (expense.reversedAt) continue;
    const account = expenseAccount(expense);
    rows.push(line({ date: expense.date, journal: 'OD', account, piece: expense.reference || expense.id, label: `${expense.category || 'Dépense'}${expense.beneficiary ? ` — ${expense.beneficiary}` : ''}`, debit: total, source: 'expense', sourceId: expense.id }));
    rows.push(line({ date: expense.date, journal: 'OD', account: expense.paid ? '571' : '401', piece: expense.reference || expense.id, label: `${expense.category || 'Dépense'}`, credit: total, source: 'expense', sourceId: expense.id }));
  }

  /* Paiements clients / fournisseurs */
  for (const payment of state.payments || []) {
    if (!inPeriod(payment.date)) continue;
    const amount = roundMoney(toNumber(payment.amount, 0));
    if (amount <= 0) continue;
    if (payment.partyType === 'sale' && saleIds.has(payment.partyId)) {
      rows.push(line({ date: payment.date, journal: 'BQ', account: '571', piece: payment.reference || payment.id, label: 'Encaissement client', debit: amount, source: 'payment', sourceId: payment.id }));
      rows.push(line({ date: payment.date, journal: 'BQ', account: '411', piece: payment.reference || payment.id, label: 'Encaissement client', credit: amount, source: 'payment', sourceId: payment.id }));
    } else if (payment.partyType === 'purchase' && purchaseIds.has(payment.partyId)) {
      rows.push(line({ date: payment.date, journal: 'BQ', account: '401', piece: payment.reference || payment.id, label: 'Paiement fournisseur', debit: amount, source: 'payment', sourceId: payment.id }));
      rows.push(line({ date: payment.date, journal: 'BQ', account: '571', piece: payment.reference || payment.id, label: 'Paiement fournisseur', credit: amount, source: 'payment', sourceId: payment.id }));
    }
  }

  /* Mouvements de trésorerie non déjà représentés */
  const alreadyBooked = new Set([
    'sale_payment',
    'purchase_payment',
    'expense',
    'transfer_in',
    'transfer_out',
  ]);
  for (const movement of state.cashMovements || []) {
    if (!inPeriod(movement.date) || alreadyBooked.has(movement.nature)) continue;
    if (activityId && movement.activityId && movement.activityId !== activityId) continue;
    const amount = roundMoney(toNumber(movement.amount, 0));
    if (amount <= 0) continue;
    const piece = movement.reference || movement.id;
    const label = movement.note || movement.nature;
    if (movement.nature === 'capital_in') {
      rows.push(line({ date: movement.date, journal: 'OD', account: '571', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'OD', account: '101', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else if (movement.nature === 'withdrawal') {
      rows.push(line({ date: movement.date, journal: 'OD', account: '108', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'OD', account: '571', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else if (movement.nature === 'customer_payment') {
      rows.push(line({ date: movement.date, journal: 'BQ', account: '571', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'BQ', account: '411', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else if (movement.nature === 'customer_refund') {
      rows.push(line({ date: movement.date, journal: 'BQ', account: '411', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'BQ', account: '571', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else if (movement.nature === 'supplier_refund') {
      rows.push(line({ date: movement.date, journal: 'BQ', account: '571', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'BQ', account: '401', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else if (movement.direction === 'in') {
      rows.push(line({ date: movement.date, journal: 'OD', account: '571', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'OD', account: '758', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    } else {
      rows.push(line({ date: movement.date, journal: 'OD', account: '658', piece, label, debit: amount, source: 'cash', sourceId: movement.id }));
      rows.push(line({ date: movement.date, journal: 'OD', account: '571', piece, label, credit: amount, source: 'cash', sourceId: movement.id }));
    }
  }

  rows.sort((a, b) => (a.date === b.date ? String(a.journal).localeCompare(String(b.journal)) : a.date.localeCompare(b.date)));
  const totals = rows.reduce(
    (accumulator, row) => ({ debit: roundMoney(accumulator.debit + row.debit), credit: roundMoney(accumulator.credit + row.credit) }),
    { debit: 0, credit: 0 },
  );
  return { rows, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.01 };
}

export const ACCOUNTING_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'journal', label: 'Journal' },
  { key: 'account', label: 'Compte' },
  { key: 'accountLabel', label: 'Libellé du compte' },
  { key: 'piece', label: 'Pièce' },
  { key: 'label', label: 'Libellé' },
  { key: 'debit', label: 'Débit (FCFA)' },
  { key: 'credit', label: 'Crédit (FCFA)' },
  { key: 'source', label: 'Source' },
];
