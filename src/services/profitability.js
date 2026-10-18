/* ---------------------------------------------------------------------------
 * Mon Commerce — assistant de rentabilité (logique pure)
 *
 * Conventions documentées :
 *   • coût d'acquisition unitaire = (montant net de la ligne + frais attribués)
 *     ÷ quantité de la ligne ;
 *   • taux de marge  = marge unitaire ÷ coût d'acquisition ;
 *   • taux de marque = marge unitaire ÷ prix de vente ;
 *   • seuil de rentabilité = charges fixes ÷ marge unitaire.
 *
 * Le résultat affiché est une estimation : l'interface explique toujours les
 * hypothèses retenues et ne garantit jamais un bénéfice.
 * ------------------------------------------------------------------------- */

import { roundMoney, toNumber } from '../shared/format.js';
import { allocateAcquisitionCost, purchaseLinesSubtotal, purchaseTotal } from './finance.js';

/** Coût d'acquisition unitaire avec frais attribués. */
export function acquisitionUnitCost({ netAmount = 0, fees = 0, quantity = 0 } = {}) {
  const qty = toNumber(quantity, 0);
  if (qty <= 0) return 0;
  return (toNumber(netAmount, 0) + toNumber(fees, 0)) / qty;
}

/**
 * Coût d'acquisition unitaire constaté sur un achat réel :
 * ligne la plus chère en priorité ? Non : la moyenne pondérée des lignes
 * de ce produit, frais répartis au prorata des montants nets.
 */
export function unitCostFromPurchase(purchase, productId = null) {
  if (!purchase) return 0;
  const lines = productId ? (purchase.lines || []).filter((line) => line.productId === productId) : purchase.lines || [];
  if (lines.length === 0) return 0;
  const allocated = allocateAcquisitionCost(lines, {
    transportCost: toNumber(purchase.transportCost, 0),
    otherFees: toNumber(purchase.otherFees, 0),
    discount: toNumber(purchase.discount, 0),
  });
  const quantity = allocated.reduce((total, line) => total + toNumber(line.quantity, 0), 0);
  const cost = allocated.reduce((total, line) => total + toNumber(line.allocatedCost, 0), 0);
  return quantity > 0 ? cost / quantity : 0;
}

/** Coût unitaire moyen pondéré constaté sur un ensemble d'achats. */
export function weightedUnitCost(purchases = [], productId = null) {
  let quantity = 0;
  let cost = 0;
  for (const purchase of purchases) {
    const lines = productId ? (purchase.lines || []).filter((line) => line.productId === productId) : purchase.lines || [];
    if (lines.length === 0) continue;
    const allocated = allocateAcquisitionCost(lines, {
      transportCost: toNumber(purchase.transportCost, 0),
      otherFees: toNumber(purchase.otherFees, 0),
      discount: toNumber(purchase.discount, 0),
    });
    for (const line of allocated) {
      quantity += toNumber(line.quantity, 0);
      cost += toNumber(line.allocatedCost, 0);
    }
  }
  return quantity > 0 ? cost / quantity : 0;
}

/**
 * Simulation de rentabilité.
 * @param {object} input
 * @param {number} input.unitCost coût d'acquisition unitaire
 * @param {number} input.price prix de vente unitaire
 * @param {number} [input.quantity] quantité envisagée (défaut : 1)
 * @param {number} [input.fixedCosts] charges fixes de la période à couvrir
 * @param {number} [input.lossRate] taux de perte/casse estimé (0 à 1)
 */
export function simulate(input = {}) {
  const unitCost = toNumber(input.unitCost, 0);
  const price = toNumber(input.price, 0);
  const quantity = toNumber(input.quantity, 1) || 1;
  const fixedCosts = toNumber(input.fixedCosts, 0);
  const lossRate = Math.min(Math.max(toNumber(input.lossRate, 0), 0), 0.99);

  const effectiveCost = lossRate > 0 ? unitCost / (1 - lossRate) : unitCost;
  const unitMargin = price - effectiveCost;
  const revenue = roundMoney(price * quantity);
  const totalCost = roundMoney(effectiveCost * quantity);
  const grossMargin = roundMoney(unitMargin * quantity);
  const netResult = roundMoney(grossMargin - fixedCosts);
  const marginRate = effectiveCost > 0 ? unitMargin / effectiveCost : 0;
  const markupRate = price > 0 ? unitMargin / price : 0;
  const breakEvenUnits = unitMargin > 0 ? Math.ceil(fixedCosts / unitMargin) : null;
  const breakEvenRevenue = breakEvenUnits === null ? null : roundMoney(breakEvenUnits * price);
  const unitsForTarget = (target) => (unitMargin > 0 ? Math.ceil((fixedCosts + toNumber(target, 0)) / unitMargin) : null);

  const warnings = [];
  if (unitCost === 0) warnings.push("Le coût d'acquisition est nul : renseignez le prix d'achat réel pour une estimation fiable.");
  if (unitMargin <= 0) warnings.push('La marge unitaire est nulle ou négative : ce prix ne couvre pas le coût d’acquisition.');
  if (price > 0 && markupRate < 0.1 && unitMargin > 0) warnings.push('La marge est faible (moins de 10 % du prix de vente).');
  if (fixedCosts === 0) warnings.push('Aucune charge fixe saisie : le seuil de rentabilité n’est pas calculé.');

  return {
    unitCost: roundMoney(unitCost),
    effectiveUnitCost: roundMoney(effectiveCost),
    price: roundMoney(price),
    quantity,
    lossRate,
    fixedCosts: roundMoney(fixedCosts),
    unitMargin: roundMoney(unitMargin),
    revenue,
    totalCost,
    grossMargin,
    netResult,
    marginRate,
    markupRate,
    breakEvenUnits,
    breakEvenRevenue,
    unitsForTarget,
    warnings,
  };
}

/** Hypothèses affichées avec chaque simulation (transparence obligatoire). */
export function simulationAssumptions(input = {}, result = {}) {
  const assumptions = [
    'Marge unitaire = prix de vente − coût d’acquisition unitaire (frais d’approvisionnement inclus).',
    'Taux de marge = marge unitaire ÷ coût d’acquisition ; taux de marque = marge unitaire ÷ prix de vente.',
    'Seuil de rentabilité = charges fixes de la période ÷ marge unitaire (arrondi à l’unité supérieure).',
    'Estimation indicative : elle suppose que toutes les unités sont vendues et encaissées, sans autre charge imprévue.',
  ];
  if (result.lossRate > 0) {
    assumptions.push(
      `Un taux de perte/casse de ${(result.lossRate * 100).toFixed(1)} % est appliqué : ${result.effectiveUnitCost} FCFA de coût effectif par unité vendable.`,
    );
  }
  if (input.includeFixedCosts === false) {
    assumptions.push('Aucune charge fixe n’est prise en compte dans cette simulation.');
  }
  assumptions.push('Cette simulation ne garantit pas un bénéfice : elle aide seulement à choisir un prix de vente.');
  return assumptions;
}

/** Prix conseillé pour atteindre un taux de marque cible. */
export function priceForMarkupRate(unitCost, targetRate) {
  const cost = toNumber(unitCost, 0);
  const rate = toNumber(targetRate, 0);
  if (rate >= 1) return null;
  return roundMoney(cost / (1 - rate));
}

/** Prix conseillé pour atteindre un taux de marge cible (sur le coût). */
export function priceForMarginRate(unitCost, targetRate) {
  return roundMoney(toNumber(unitCost, 0) * (1 + toNumber(targetRate, 0)));
}

/** Marge dégagée par un achat réel, compte tenu du prix de vente actuel. */
export function purchaseMarginPreview(purchase, product, { quantity = null } = {}) {
  const unitCost = unitCostFromPurchase(purchase, product ? product.id : null);
  const unitPrice = toNumber(product ? product.price : 0, 0);
  const units = quantity === null
    ? (purchase.lines || []).filter((line) => !product || line.productId === product.id).reduce((total, line) => total + toNumber(line.quantity, 0), 0)
    : quantity;
  return simulate({ unitCost, price: unitPrice, quantity: units, fixedCosts: 0 });
}

export { purchaseTotal, purchaseLinesSubtotal };
