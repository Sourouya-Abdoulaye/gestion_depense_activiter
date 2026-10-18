/* ---------------------------------------------------------------------------
 * Mon Commerce — service Ventes (construction de documents, logique pure)
 *
 * Une vente validée génère, dans une seule opération atomique côté stockage :
 *   • le document de vente et ses lignes (avec CMP figé),
 *   • les mouvements de stock de sortie,
 *   • éventuellement un ou plusieurs paiements et mouvements de trésorerie.
 *
 * Les retours et annulations ne suppriment jamais l'historique : ils créent
 * des documents et mouvements compensatoires traçables.
 * ------------------------------------------------------------------------- */

import { DOCUMENT_STATUS, PAYMENT_METHODS } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { BusinessError } from '../shared/validators.js';
import { availableQuantity, buildMovement, currentUnitCost } from './stock.js';
import { cashInFor, cashOutFor, creditAmountFor, saleBalance, saleLinesSubtotal, saleTotal } from './finance.js';

/** Moyen de paiement par défaut (premier de la liste paramétrable côté UI). */
const DEFAULT_METHOD = PAYMENT_METHODS[0];

/**
 * Construit une vente complète.
 * @param {object} input
 * @param {Array<{productId:string, quantity:number, unitPrice:number, discount?:number}>} input.items
 * @param {object} context
 * @param {Array} context.products catalogue
 * @param {object} context.stockState état de stock calculé
 * @param {boolean} [context.allowNegativeStock]
 */
export function buildSale(input, { products = [], stockState = {}, allowNegativeStock = false } = {}) {
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date de la vente est invalide.');
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new BusinessError('Une vente doit contenir au moins un produit.');
  }

  const productIndex = new Map(products.map((product) => [product.id, product]));
  const lines = input.items.map((item) => {
    const product = productIndex.get(item.productId);
    if (!product) throw new BusinessError('Un produit sélectionné n’existe plus dans le catalogue.');
    const quantity = toNumber(item.quantity, 0);
    if (quantity <= 0) throw new BusinessError(`La quantité de « ${product.name} » doit être supérieure à zéro.`);

    if (!allowNegativeStock) {
      const available = availableQuantity(stockState, product.id);
      if (quantity > available + 1e-9) {
        throw new BusinessError(
          `Stock insuffisant pour « ${product.name} » : ${available} disponible(s) pour ${quantity} demandé(s).`,
          { productId: product.id, available, requested: quantity },
        );
      }
    }

    const unitPrice = item.unitPrice === undefined || item.unitPrice === null ? toNumber(product.price, 0) : toNumber(item.unitPrice, 0);
    if (unitPrice < 0) throw new BusinessError(`Le prix de « ${product.name} » ne peut pas être négatif.`);
    const unitCost = item.unitCost !== undefined && item.unitCost !== null
      ? toNumber(item.unitCost, 0)
      : currentUnitCost(stockState, product.id, product);

    return {
      id: newId(ID_PREFIX.LINE),
      productId: product.id,
      label: product.name,
      unit: product.unit || '',
      quantity,
      unitPrice: roundMoney(unitPrice),
      discount: roundMoney(toNumber(item.discount, 0)),
      unitCost,
    };
  });

  const sale = {
    id: newId(ID_PREFIX.SALE),
    activityId: input.activityId || '',
    customerId: input.customerId || '',
    reference: input.reference || generateReference('VTE', date),
    date,
    status: DOCUMENT_STATUS.VALIDATED,
    lines,
    discount: roundMoney(toNumber(input.discount, 0)),
    otherFees: roundMoney(toNumber(input.otherFees, 0)),
    dueDate: input.dueDate ? toISODate(input.dueDate) : '',
    note: input.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sale.total = saleTotal(sale);

  if (toNumber(input.discount, 0) > saleLinesSubtotal(lines)) {
    throw new BusinessError('La remise globale ne peut pas dépasser le sous-total de la vente.');
  }

  const stockMovements = lines.map((line) =>
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: sale.activityId,
      productId: line.productId,
      date,
      type: 'out',
      reason: 'sale',
      quantity: -Math.abs(line.quantity),
      unitCost: line.unitCost,
      sourceType: 'sale',
      sourceId: sale.id,
      note: `Vente ${sale.reference}`,
      createdAt: sale.createdAt,
    }),
  );

  return { sale, stockMovements };
}

/**
 * Construit un ou plusieurs paiements pour une vente.
 * @param {object} sale
 * @param {Array<{amount:number, method:string, accountId:string, date?:string}>} payments
 * @param {{maxAmount?: number}} options
 */
export function buildSalePayments(sale, payments = [], { maxAmount = null } = {}) {
  const entries = [];
  const limit = maxAmount === null ? saleTotal(sale) : maxAmount;
  for (const payment of payments) {
    const amount = roundMoney(toNumber(payment.amount, 0));
    if (amount <= 0) continue;
    entries.push({
      id: newId(ID_PREFIX.PAYMENT),
      activityId: sale.activityId || '',
      date: toISODate(payment.date || sale.date),
      amount,
      direction: 'in',
      method: payment.method || DEFAULT_METHOD,
      accountId: payment.accountId || '',
      partyType: 'sale',
      partyId: sale.id,
      kind: 'payment',
      note: payment.note || `Encaissement vente ${sale.reference}`,
      createdAt: new Date().toISOString(),
    });
  }
  const total = roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0));
  if (total > limit + 0.01) {
    throw new BusinessError('Le total encaissé dépasse le montant restant à payer de la vente.');
  }
  return entries;
}

/** Convertit des paiements en mouvements de trésorerie signés. */
export function paymentsToCashMovements(payments = []) {
  return payments.map((payment) => ({
    id: newId(ID_PREFIX.CASH_MOVEMENT),
    activityId: payment.activityId || '',
    date: toISODate(payment.date),
    accountId: payment.accountId || '',
    direction: payment.direction,
    amount: roundMoney(toNumber(payment.amount, 0)),
    nature: payment.partyType === 'purchase'
      ? payment.direction === 'in'
        ? 'supplier_refund'
        : 'purchase_payment'
      : payment.direction === 'in'
        ? payment.kind === 'customer_payment'
          ? 'customer_payment'
          : 'sale_payment'
        : 'customer_refund',
    sourceType: 'payment',
    sourceId: payment.id,
    note: payment.note || '',
    createdAt: payment.createdAt || new Date().toISOString(),
  }));
}

/** Quantité déjà retournée pour une ligne de vente. */
export function returnedQuantityForLine(returns = [], saleId, saleLineId) {
  return returns
    .filter((item) => item.kind === 'sale' && item.sourceId === saleId)
    .flatMap((item) => item.lines || [])
    .filter((line) => line.saleLineId === saleLineId)
    .reduce((total, line) => total + toNumber(line.quantity, 0), 0);
}

/**
 * Construit un retour client.
 * @param {object} input
 * @param {object} input.sale vente d'origine
 * @param {Array<{saleLineId:string, quantity:number}>} input.lines
 * @param {number} [input.refundAmount] remboursement immédiat (≤ total du retour)
 */
export function buildSaleReturn(input, { returns = [], payments = [] } = {}) {
  const sale = input.sale;
  if (!sale) throw new BusinessError('Vente d’origine introuvable.');
  if (sale.status !== DOCUMENT_STATUS.VALIDATED) {
    throw new BusinessError('Un retour ne peut être enregistré que sur une vente validée.');
  }
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date du retour est invalide.');

  const lines = [];
  for (const requested of input.lines || []) {
    const saleLine = (sale.lines || []).find((line) => line.id === requested.saleLineId);
    if (!saleLine) throw new BusinessError('Une ligne de retour ne correspond pas à la vente d’origine.');
    const alreadyReturned = returnedQuantityForLine(returns, sale.id, saleLine.id);
    const remaining = toNumber(saleLine.quantity, 0) - alreadyReturned;
    const quantity = toNumber(requested.quantity, 0);
    if (quantity <= 0) continue;
    if (quantity > remaining + 1e-9) {
      throw new BusinessError(
        `Retour impossible pour « ${saleLine.label} » : ${remaining} unité(s) encore retournable(s).`,
      );
    }
    lines.push({
      id: newId(ID_PREFIX.LINE),
      saleLineId: saleLine.id,
      productId: saleLine.productId,
      label: saleLine.label,
      unit: saleLine.unit || '',
      quantity,
      unitPrice: toNumber(saleLine.unitPrice, 0),
      unitCost: toNumber(saleLine.unitCost, 0),
    });
  }

  if (lines.length === 0) throw new BusinessError('Sélectionnez au moins un produit à retourner.');

  const document_ = {
    id: newId(ID_PREFIX.RETURN),
    kind: 'sale',
    activityId: sale.activityId || '',
    sourceId: sale.id,
    sourceReference: sale.reference,
    reference: input.reference || generateReference('RET', date),
    date,
    lines,
    reason: input.reason || '',
    refund: null,
    createdAt: new Date().toISOString(),
  };
  document_.total = roundMoney(
    lines.reduce((total, line) => total + toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0), 0),
  );

  const refundAmount = roundMoney(toNumber(input.refundAmount, 0));
  if (refundAmount < 0) throw new BusinessError('Le remboursement ne peut pas être négatif.');
  if (refundAmount > document_.total + 0.01) {
    throw new BusinessError('Le remboursement ne peut pas dépasser le montant du retour.');
  }
  if (refundAmount > 0 && !input.accountId) {
    throw new BusinessError('Choisissez le compte de trésorerie utilisé pour le remboursement.');
  }

  const stockMovements = lines.map((line) =>
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: document_.activityId,
      productId: line.productId,
      date,
      type: 'in',
      reason: 'return_in',
      quantity: line.quantity,
      unitCost: line.unitCost,
      sourceType: 'return',
      sourceId: document_.id,
      note: `Retour client ${document_.reference}`,
      createdAt: document_.createdAt,
    }),
  );

  let payment = null;
  if (refundAmount > 0) {
    payment = {
      id: newId(ID_PREFIX.PAYMENT),
      activityId: document_.activityId,
      date,
      amount: refundAmount,
      direction: 'out',
      method: input.refundMethod || DEFAULT_METHOD,
      accountId: input.accountId,
      partyType: 'sale',
      partyId: sale.id,
      kind: 'refund',
      note: `Remboursement retour ${document_.reference}`,
      createdAt: new Date().toISOString(),
    };
    document_.refund = { amount: refundAmount, method: payment.method, accountId: input.accountId };
  }

  return {
    return: document_,
    stockMovements,
    payments: payment ? [payment] : [],
    cashMovements: payment ? paymentsToCashMovements([payment]) : [],
  };
}

/**
 * Annule une vente sans effacer l'historique.
 * - statut « cancelled » (exclue des indicateurs),
 * - réintégration du stock au coût figé de la vente,
 * - remboursement éventuel de l'argent encore détenu.
 */
export function buildSaleCancellation(input, { payments = [], returns = [] } = {}) {
  const sale = input.sale;
  if (!sale) throw new BusinessError('Vente introuvable.');
  if (sale.status === DOCUMENT_STATUS.CANCELLED) throw new BusinessError('Cette vente est déjà annulée.');

  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date d’annulation est invalide.');

  const returnedByLine = new Map();
  for (const item of returns.filter((entry) => entry.kind === 'sale' && entry.sourceId === sale.id)) {
    for (const line of item.lines || []) {
      returnedByLine.set(line.saleLineId, (returnedByLine.get(line.saleLineId) || 0) + toNumber(line.quantity, 0));
    }
  }

  const stockMovements = [];
  for (const line of sale.lines || []) {
    const alreadyReturned = returnedByLine.get(line.id) || 0;
    const quantity = toNumber(line.quantity, 0) - alreadyReturned;
    if (quantity <= 0) continue;
    stockMovements.push(
      buildMovement({
        id: newId(ID_PREFIX.STOCK_MOVEMENT),
        activityId: sale.activityId,
        productId: line.productId,
        date,
        type: 'in',
        reason: 'sale_cancel',
        quantity,
        unitCost: toNumber(line.unitCost, 0),
        sourceType: 'sale_cancel',
        sourceId: sale.id,
        note: `Annulation vente ${sale.reference} : ${input.reason || 'sans motif précisé'}`,
      }),
    );
  }

  // Argent encore détenu : encaissements reçus − remboursements déjà rendus.
  const received = cashInFor(payments, 'sale', sale.id) - cashOutFor(payments, 'sale', sale.id);
  const credits = creditAmountFor(returns, { kind: 'sale', sourceId: sale.id });
  const held = roundMoney(Math.min(Math.max(received - credits, 0), saleTotal(sale)));

  let payment = null;
  if (held > 0.01) {
    if (!input.accountId) {
      throw new BusinessError(
        'Cette vente a reçu de l’argent : choisissez le compte de trésorerie pour le remboursement de l’annulation.',
      );
    }
    payment = {
      id: newId(ID_PREFIX.PAYMENT),
      activityId: sale.activityId,
      date,
      amount: held,
      direction: 'out',
      method: input.method || DEFAULT_METHOD,
      accountId: input.accountId,
      partyType: 'sale',
      partyId: sale.id,
      kind: 'refund',
      note: `Remboursement annulation ${sale.reference}`,
      createdAt: new Date().toISOString(),
    };
  }

  const patchedSale = {
    ...sale,
    status: DOCUMENT_STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    cancelReason: input.reason || '',
    cancellation: payment ? { refundedAmount: payment.amount, method: payment.method, accountId: payment.accountId } : null,
    updatedAt: new Date().toISOString(),
  };

  return {
    sale: patchedSale,
    stockMovements,
    payments: payment ? [payment] : [],
    cashMovements: payment ? paymentsToCashMovements([payment]) : [],
  };
}

/** Enregistre un règlement (partiel ou total) sur une vente à crédit. */
export function buildCustomerPayment(input) {
  const sale = input.sale;
  if (!sale) throw new BusinessError('Vente introuvable.');
  if (sale.status !== DOCUMENT_STATUS.VALIDATED) throw new BusinessError('Cette vente n’accepte plus de paiement.');
  const amount = roundMoney(toNumber(input.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant du règlement doit être supérieur à zéro.');

  const balance = saleBalance(sale, { payments: input.payments || [], returns: input.returns || [] });
  if (amount > balance + 0.01) {
    throw new BusinessError(`Le règlement dépasse le solde restant (${roundMoney(balance)}).`);
  }
  if (!input.accountId) throw new BusinessError('Choisissez le compte de trésorerie qui reçoit le règlement.');

  const payment = {
    id: newId(ID_PREFIX.PAYMENT),
    activityId: sale.activityId || '',
    date: toISODate(input.date || new Date()),
    amount,
    direction: 'in',
    method: input.method || DEFAULT_METHOD,
    accountId: input.accountId,
    partyType: 'sale',
    partyId: sale.id,
    kind: 'payment',
    note: input.note || `Règlement client sur ${sale.reference}`,
    createdAt: new Date().toISOString(),
  };

  return { payment, cashMovements: paymentsToCashMovements([payment]) };
}

/** Génère une référence lisible : VTE-20261018-4F2A. */
export function generateReference(prefix, date) {
  const stamp = toISODate(date).replace(/-/g, '') || '00000000';
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

