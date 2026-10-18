/* ---------------------------------------------------------------------------
 * Mon Commerce — service Achats (logique pure)
 *
 * Règle impérative : le stock n'augmente qu'à la RÉCEPTION des marchandises,
 * jamais à la simple commande. Un achat non payé n'est pas un décaissement :
 * il crée une dette fournisseur.
 *
 * Les frais d'acquisition (transport, frais annexes) sont répartis sur les
 * lignes au prorata du montant net, puis intégrés au coût unitaire du produit
 * (méthode documentée, cf. finance.allocateAcquisitionCost).
 * ------------------------------------------------------------------------- */

import { DOCUMENT_STATUS, PAYMENT_METHODS } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { BusinessError } from '../shared/validators.js';
import { buildMovement } from './stock.js';
import { allocateAcquisitionCost, cashInFor, cashOutFor, purchaseBalance, purchaseLinesSubtotal, purchaseTotal } from './finance.js';
import { generateReference, paymentsToCashMovements } from './sales.js';

const DEFAULT_METHOD = PAYMENT_METHODS[0];

/**
 * Construit un achat.
 * @param {object} input
 * @param {Array<{productId:string, quantity:number, unitPrice:number, discount?:number}>} input.lines
 * @param {'ordered'|'received'} [input.status]
 * @param {{products: Array}} context
 */
export function buildPurchase(input, { products = [] } = {}) {
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date de l’achat est invalide.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new BusinessError('Un achat doit contenir au moins une ligne de produit.');
  }

  const productIndex = new Map(products.map((product) => [product.id, product]));
  const rawLines = input.lines.map((line) => {
    const product = productIndex.get(line.productId);
    if (!product) throw new BusinessError('Une ligne référence un produit inconnu du catalogue.');
    const quantity = toNumber(line.quantity, 0);
    if (quantity <= 0) throw new BusinessError(`La quantité de « ${product.name} » doit être supérieure à zéro.`);
    const unitPrice = toNumber(line.unitPrice, toNumber(product.cost, 0));
    if (unitPrice < 0) throw new BusinessError(`Le prix d'achat de « ${product.name} » ne peut pas être négatif.`);
    return {
      id: newId(ID_PREFIX.LINE),
      productId: product.id,
      label: product.name,
      unit: product.unit || '',
      quantity,
      unitPrice: roundMoney(unitPrice),
      discount: roundMoney(toNumber(line.discount, 0)),
    };
  });

  const allocated = allocateAcquisitionCost(rawLines, {
    transportCost: toNumber(input.transportCost, 0),
    otherFees: toNumber(input.otherFees, 0),
    discount: toNumber(input.discount, 0),
  });

  const status = input.status === DOCUMENT_STATUS.RECEIVED ? DOCUMENT_STATUS.RECEIVED : DOCUMENT_STATUS.ORDERED;

  const purchase = {
    id: newId(ID_PREFIX.PURCHASE),
    activityId: input.activityId || '',
    supplierId: input.supplierId || '',
    reference: input.reference || generateReference('ACH', date),
    date,
    expectedDate: input.expectedDate ? toISODate(input.expectedDate) : '',
    status,
    lines: allocated,
    discount: roundMoney(toNumber(input.discount, 0)),
    transportCost: roundMoney(toNumber(input.transportCost, 0)),
    otherFees: roundMoney(toNumber(input.otherFees, 0)),
    dueDate: input.dueDate ? toISODate(input.dueDate) : '',
    receiveDate: status === DOCUMENT_STATUS.RECEIVED ? date : '',
    note: input.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  purchase.total = purchaseTotal(purchase);
  if (purchase.discount > purchaseLinesSubtotal(rawLines)) {
    throw new BusinessError('La remise globale ne peut pas dépasser le sous-total de l’achat.');
  }

  const stockMovements =
    status === DOCUMENT_STATUS.RECEIVED ? buildReceiptMovements(purchase, date) : [];

  return { purchase, stockMovements };
}

function buildReceiptMovements(purchase, date) {
  return purchase.lines.map((line) =>
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: purchase.activityId,
      productId: line.productId,
      date,
      type: 'in',
      reason: 'purchase_receipt',
      quantity: line.quantity,
      unitCost: line.allocatedUnitCost,
      sourceType: 'purchase',
      sourceId: purchase.id,
      note: `Réception achat ${purchase.reference}`,
      createdAt: purchase.createdAt,
    }),
  );
}

/** Réceptionne un achat commandé : le stock augmente à ce moment précis. */
export function receivePurchase(input) {
  const purchase = input.purchase;
  if (!purchase) throw new BusinessError('Achat introuvable.');
  if (purchase.status === DOCUMENT_STATUS.RECEIVED) throw new BusinessError('Cet achat est déjà réceptionné.');
  if (purchase.status === DOCUMENT_STATUS.CANCELLED) throw new BusinessError('Un achat annulé ne peut pas être réceptionné.');

  const date = toISODate(input.date || new Date());
  if (!date) throw new BusinessError('La date de réception est invalide.');

  const patched = {
    ...purchase,
    status: DOCUMENT_STATUS.RECEIVED,
    receiveDate: date,
    updatedAt: new Date().toISOString(),
  };
  return { purchase: patched, stockMovements: buildReceiptMovements(patched, date) };
}

/**
 * Construit les paiements d'un achat (paiement total, partiel ou dette).
 * @param {{maxAmount?: number}} options
 */
export function buildPurchasePayments(purchase, payments = [], { maxAmount = null } = {}) {
  const limit = maxAmount === null ? purchaseTotal(purchase) : maxAmount;
  const entries = [];
  for (const payment of payments) {
    const amount = roundMoney(toNumber(payment.amount, 0));
    if (amount <= 0) continue;
    entries.push({
      id: newId(ID_PREFIX.PAYMENT),
      activityId: purchase.activityId || '',
      date: toISODate(payment.date || purchase.date),
      amount,
      direction: 'out',
      method: payment.method || DEFAULT_METHOD,
      accountId: payment.accountId || '',
      partyType: 'purchase',
      partyId: purchase.id,
      kind: 'payment',
      note: payment.note || `Paiement fournisseur achat ${purchase.reference}`,
      createdAt: new Date().toISOString(),
    });
  }
  const total = roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0));
  if (total > limit + 0.01) {
    throw new BusinessError('Le total payé dépasse le montant restant dû sur cet achat.');
  }
  return entries;
}

/** Règlement complémentaire sur une dette fournisseur. */
export function buildSupplierPayment(input) {
  const purchase = input.purchase;
  if (!purchase) throw new BusinessError('Achat introuvable.');
  if (purchase.status !== DOCUMENT_STATUS.RECEIVED) {
    throw new BusinessError('Seul un achat réceptionné peut être réglé.');
  }
  const amount = roundMoney(toNumber(input.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant du règlement doit être supérieur à zéro.');
  const balance = purchaseBalance(purchase, { payments: input.payments || [], returns: input.returns || [] });
  if (amount > balance + 0.01) {
    throw new BusinessError(`Le règlement dépasse le solde restant dû (${roundMoney(balance)}).`);
  }
  if (!input.accountId) throw new BusinessError('Choisissez le compte de trésorerie qui effectue le paiement.');

  const payment = {
    id: newId(ID_PREFIX.PAYMENT),
    activityId: purchase.activityId || '',
    date: toISODate(input.date || new Date()),
    amount,
    direction: 'out',
    method: input.method || DEFAULT_METHOD,
    accountId: input.accountId,
    partyType: 'purchase',
    partyId: purchase.id,
    kind: 'payment',
    note: input.note || `Règlement fournisseur sur ${purchase.reference}`,
    createdAt: new Date().toISOString(),
  };
  return { payment, cashMovements: paymentsToCashMovements([payment]) };
}

/**
 * Retour au fournisseur : le stock diminue, la dette diminue, et un
 * remboursement reçu augmente la trésorerie.
 */
export function buildPurchaseReturn(input, { returns = [] } = {}) {
  const purchase = input.purchase;
  if (!purchase) throw new BusinessError('Achat introuvable.');
  if (purchase.status !== DOCUMENT_STATUS.RECEIVED) {
    throw new BusinessError('Seul un achat réceptionné peut faire l’objet d’un retour.');
  }
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date du retour est invalide.');

  const alreadyReturned = (purchaseLineId) =>
    returns
      .filter((item) => item.kind === 'purchase' && item.sourceId === purchase.id)
      .flatMap((item) => item.lines || [])
      .filter((line) => line.purchaseLineId === purchaseLineId)
      .reduce((total, line) => total + toNumber(line.quantity, 0), 0);

  const lines = [];
  for (const requested of input.lines || []) {
    const purchaseLine = (purchase.lines || []).find((line) => line.id === requested.purchaseLineId);
    if (!purchaseLine) throw new BusinessError('Une ligne de retour ne correspond pas à l’achat d’origine.');
    const remaining = toNumber(purchaseLine.quantity, 0) - alreadyReturned(purchaseLine.id);
    const quantity = toNumber(requested.quantity, 0);
    if (quantity <= 0) continue;
    if (quantity > remaining + 1e-9) {
      throw new BusinessError(`Retour impossible pour « ${purchaseLine.label} » : ${remaining} unité(s) retournable(s).`);
    }
    lines.push({
      id: newId(ID_PREFIX.LINE),
      purchaseLineId: purchaseLine.id,
      productId: purchaseLine.productId,
      label: purchaseLine.label,
      unit: purchaseLine.unit || '',
      quantity,
      unitPrice: toNumber(purchaseLine.unitPrice, 0),
      unitCost: toNumber(purchaseLine.allocatedUnitCost, 0),
      creditedUnitCost: toNumber(purchaseLine.allocatedUnitCost, 0),
    });
  }

  if (lines.length === 0) throw new BusinessError('Sélectionnez au moins un produit à retourner.');

  // Le montant porté au débit du fournisseur inclut sa part des frais alloués.
  const document_ = {
    id: newId(ID_PREFIX.RETURN),
    kind: 'purchase',
    activityId: purchase.activityId || '',
    sourceId: purchase.id,
    sourceReference: purchase.reference,
    reference: input.reference || generateReference('RTF', date),
    date,
    lines,
    reason: input.reason || '',
    refund: null,
    createdAt: new Date().toISOString(),
  };
  document_.total = roundMoney(
    lines.reduce(
      (total, line) => total + toNumber(line.quantity, 0) * toNumber(line.creditedUnitCost, 0),
      0,
    ),
  );

  const stockMovements = lines.map((line) =>
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: document_.activityId,
      productId: line.productId,
      date,
      type: 'out',
      reason: 'return_out',
      quantity: -Math.abs(line.quantity),
      unitCost: line.unitCost,
      sourceType: 'return',
      sourceId: document_.id,
      note: `Retour fournisseur ${document_.reference}`,
      createdAt: document_.createdAt,
    }),
  );

  const refundAmount = roundMoney(toNumber(input.refundAmount, 0));
  if (refundAmount < 0) throw new BusinessError('Le remboursement reçu ne peut pas être négatif.');
  if (refundAmount > document_.total + 0.01) {
    throw new BusinessError('Le remboursement reçu ne peut pas dépasser le montant du retour.');
  }
  if (refundAmount > 0 && !input.accountId) {
    throw new BusinessError('Choisissez le compte de trésorerie qui reçoit le remboursement.');
  }

  let payment = null;
  if (refundAmount > 0) {
    payment = {
      id: newId(ID_PREFIX.PAYMENT),
      activityId: document_.activityId,
      date,
      amount: refundAmount,
      direction: 'in',
      method: input.refundMethod || DEFAULT_METHOD,
      accountId: input.accountId,
      partyType: 'purchase',
      partyId: purchase.id,
      kind: 'refund',
      note: `Remboursement fournisseur retour ${document_.reference}`,
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

/** Annule un achat sans effacer l'historique (sortie de stock, remboursement). */
export function buildPurchaseCancellation(input, { payments = [], returns = [] } = {}) {
  const purchase = input.purchase;
  if (!purchase) throw new BusinessError('Achat introuvable.');
  if (purchase.status === DOCUMENT_STATUS.CANCELLED) throw new BusinessError('Cet achat est déjà annulé.');
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date d’annulation est invalide.');

  const returnedByLine = new Map();
  for (const item of returns.filter((entry) => entry.kind === 'purchase' && entry.sourceId === purchase.id)) {
    for (const line of item.lines || []) {
      returnedByLine.set(line.purchaseLineId, (returnedByLine.get(line.purchaseLineId) || 0) + toNumber(line.quantity, 0));
    }
  }

  const stockMovements = [];
  if (purchase.status === DOCUMENT_STATUS.RECEIVED) {
    for (const line of purchase.lines || []) {
      const alreadyReturned = returnedByLine.get(line.id) || 0;
      const quantity = toNumber(line.quantity, 0) - alreadyReturned;
      if (quantity <= 0) continue;
      stockMovements.push(
        buildMovement({
          id: newId(ID_PREFIX.STOCK_MOVEMENT),
          activityId: purchase.activityId,
          productId: line.productId,
          date,
          type: 'out',
          reason: 'purchase_cancel',
          quantity: -Math.abs(quantity),
          unitCost: toNumber(line.allocatedUnitCost, 0),
          sourceType: 'purchase_cancel',
          sourceId: purchase.id,
          note: `Annulation achat ${purchase.reference}`,
        }),
      );
    }
  }

  // Argent encore versé au fournisseur : paiements − remboursements reçus.
  const paid = cashOutFor(payments, 'purchase', purchase.id) - cashInFor(payments, 'purchase', purchase.id);
  const held = roundMoney(Math.max(paid, 0));

  let payment = null;
  if (held > 0.01) {
    if (!input.accountId) {
      throw new BusinessError(
        'Cet achat a déjà été payé : choisissez le compte de trésorerie qui reçoit le remboursement du fournisseur.',
      );
    }
    payment = {
      id: newId(ID_PREFIX.PAYMENT),
      activityId: purchase.activityId,
      date,
      amount: held,
      direction: 'in',
      method: input.method || DEFAULT_METHOD,
      accountId: input.accountId,
      partyType: 'purchase',
      partyId: purchase.id,
      kind: 'refund',
      note: `Remboursement fournisseur annulation ${purchase.reference}`,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    purchase: {
      ...purchase,
      status: DOCUMENT_STATUS.CANCELLED,
      cancelledAt: new Date().toISOString(),
      cancelReason: input.reason || '',
      updatedAt: new Date().toISOString(),
    },
    stockMovements,
    payments: payment ? [payment] : [],
    cashMovements: payment ? paymentsToCashMovements([payment]) : [],
  };
}
