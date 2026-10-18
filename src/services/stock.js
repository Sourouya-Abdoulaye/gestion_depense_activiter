/* ---------------------------------------------------------------------------
 * Mon Commerce — service Stock (logique pure)
 * Le stock n'est jamais stocké comme un compteur : il est toujours recalculé
 * par rejeu chronologique des mouvements. Les statistiques restent donc
 * recalculables depuis les opérations sources.
 *
 * Convention de valorisation documentée :
 *   coût moyen pondéré (CMP). À chaque entrée, la valeur du stock augmente du
 *   coût réel de l'entrée ; à chaque sortie, la valeur diminue au coût moyen
 *   disponible à cet instant.
 * ------------------------------------------------------------------------- */

import { roundMoney, roundQuantity, toNumber } from '../shared/format.js';
import { toISODate } from '../shared/dates.js';
import { BusinessError } from '../shared/validators.js';

/** Tri chronologique stable : date métier puis date de création. */
export function sortMovements(movements = []) {
  return [...movements].sort((a, b) => {
    const dateA = toISODate(a.date) || '';
    const dateB = toISODate(b.date) || '';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    const createdA = a.createdAt || '';
    const createdB = b.createdAt || '';
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Rejoue les mouvements d'un produit et retourne sa quantité, sa valeur et son
 * coût moyen pondéré.
 * @param {Array} movements mouvements (tous produits confondus acceptés)
 * @param {string} productId
 * @param {number} fallbackCost coût de référence si aucun mouvement exploitable
 */
export function computeProductStock(movements, productId, fallbackCost = 0) {
  let quantity = 0;
  let value = 0;
  let averageCost = toNumber(fallbackCost, 0);
  let inboundQuantity = 0;
  let outboundQuantity = 0;

  for (const movement of sortMovements(movements.filter((m) => m.productId === productId))) {
    const delta = toNumber(movement.quantity, 0);
    if (delta === 0) continue;

    if (delta > 0) {
      const cost = movement.unitCost === null || movement.unitCost === undefined ? averageCost : toNumber(movement.unitCost, averageCost);
      quantity += delta;
      value += delta * cost;
      inboundQuantity += delta;
    } else {
      const out = Math.abs(delta);
      const currentAverage = quantity > 0 ? value / quantity : averageCost;
      const removed = Math.min(out, Math.max(quantity, 0));
      value -= removed * currentAverage;
      quantity -= out;
      outboundQuantity += out;
      if (quantity <= 0) value = 0; // stock épuisé : plus de valeur résiduelle
    }

    if (quantity > 0) {
      averageCost = value / quantity;
    }
  }

  return {
    productId,
    quantity: roundQuantity(quantity),
    value: roundMoney(Math.max(value, 0)),
    averageCost: quantity > 0 ? value / quantity : averageCost,
    inboundQuantity: roundQuantity(inboundQuantity),
    outboundQuantity: roundQuantity(outboundQuantity),
    negative: quantity < 0,
  };
}

/**
 * État de stock complet : un enregistrement par produit connu.
 * @returns {Record<string, {productId:string, quantity:number, value:number, averageCost:number}>}
 */
export function computeStockState(movements = [], products = []) {
  const state = {};
  for (const product of products) {
    state[product.id] = computeProductStock(movements, product.id, product.cost);
  }
  // Mouvements orphelins (produit supprimé) : conservés pour la valorisation.
  for (const movement of movements) {
    if (!movement.productId || state[movement.productId]) continue;
    state[movement.productId] = computeProductStock(movements, movement.productId, movement.unitCost);
  }
  return state;
}

/** Quantité disponible d'un produit selon l'état de stock déjà calculé. */
export function availableQuantity(state, productId) {
  const entry = state ? state[productId] : null;
  return entry ? entry.quantity : 0;
}

/** Coût unitaire à figer sur une ligne : CMP courant, repli sur le coût produit. */
export function currentUnitCost(state, productId, product = null) {
  const entry = state ? state[productId] : null;
  if (entry && entry.quantity > 0) return entry.averageCost;
  if (entry && entry.averageCost > 0) return entry.averageCost;
  return product ? toNumber(product.cost, 0) : 0;
}

/** Valeur totale du stock. */
export function stockValue(state) {
  return roundMoney(
    Object.values(state || {}).reduce((total, entry) => total + (entry.quantity > 0 ? entry.value : 0), 0),
  );
}

/**
 * Contrôle de disponibilité avant une sortie de stock.
 * La vente au-delà du stock est bloquée, sauf option explicite
 * « autoriser le stock négatif » dans les paramètres.
 */
export function assertStockAvailable({ state, productId, productName, quantity, allowNegativeStock = false }) {
  if (allowNegativeStock) return true;
  const available = availableQuantity(state, productId);
  if (quantity > available + 1e-9) {
    throw new BusinessError(
      `Stock insuffisant pour « ${productName || productId} » : ${available} disponible(s) pour ${quantity} demandé(s).`,
      { productId, available, requested: quantity },
    );
  }
  return true;
}

/**
 * Construit un mouvement de stock prêt à être enregistré.
 * quantity est signée : positive pour une entrée, négative pour une sortie.
 */
export function buildMovement({
  id,
  activityId,
  productId,
  date,
  type = 'adjust',
  reason = 'correction',
  quantity,
  unitCost = null,
  sourceType = null,
  sourceId = null,
  note = '',
  createdAt,
}) {
  return {
    id,
    activityId: activityId ?? null,
    productId,
    date: toISODate(date),
    type,
    reason,
    quantity: roundQuantity(toNumber(quantity, 0)),
    unitCost: unitCost === null || unitCost === undefined ? null : toNumber(unitCost, 0),
    sourceType,
    sourceId,
    note: note || '',
    createdAt: createdAt || new Date().toISOString(),
  };
}

/**
 * Mouvement de correction documentée : la quantité visée remplace la quantité
 * courante. Le mouvement enregistré porte donc la différence (trace conservée).
 */
export function buildCorrectionMovement({ currentQuantity, targetQuantity, unitCost, ...rest }) {
  const delta = roundQuantity(toNumber(targetQuantity, 0) - toNumber(currentQuantity, 0));
  if (delta === 0) return null;
  return buildMovement({
    ...rest,
    type: 'adjust',
    reason: rest.reason || 'correction',
    quantity: delta,
    unitCost,
  });
}

/**
 * Alertes de stock faible : quantité disponible ≤ seuil d'alerte du produit
 * (ou seuil global par défaut si le produit n'en définit pas).
 */
export function lowStockAlerts(products = [], state = {}, defaultThreshold = 0) {
  const alerts = [];
  for (const product of products) {
    if (product.status === 'archived') continue;
    const threshold = toNumber(product.alertThreshold, 0) || toNumber(defaultThreshold, 0);
    const entry = state[product.id];
    const quantity = entry ? entry.quantity : 0;
    if (quantity <= threshold) {
      alerts.push({
        productId: product.id,
        name: product.name,
        quantity,
        threshold,
        severity: quantity <= 0 ? 'rupture' : quantity <= threshold / 2 ? 'critique' : 'faible',
      });
    }
  }
  return alerts.sort((a, b) => a.quantity - b.quantity);
}

/** Résumé des entrées/sorties sur une période, par produit. */
export function movementSummary(movements = [], filters = {}) {
  const inRange = movements.filter((movement) => {
    if (filters.productId && movement.productId !== filters.productId) return false;
    if (filters.from && toISODate(movement.date) < filters.from) return false;
    if (filters.to && toISODate(movement.date) > filters.to) return false;
    return true;
  });
  const summary = {};
  for (const movement of inRange) {
    const entry = (summary[movement.productId] ||= { productId: movement.productId, in: 0, out: 0, net: 0, movements: 0 });
    const quantity = toNumber(movement.quantity, 0);
    if (quantity >= 0) entry.in = roundQuantity(entry.in + quantity);
    else entry.out = roundQuantity(entry.out + Math.abs(quantity));
    entry.net = roundQuantity(entry.net + quantity);
    entry.movements += 1;
  }
  return summary;
}
