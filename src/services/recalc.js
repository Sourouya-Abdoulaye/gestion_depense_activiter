/* ---------------------------------------------------------------------------
 * Mon Commerce — diagnostic de recalcul du coût de revient (L14)
 *
 * Le coût d'une vente est volontairement figé au moment de la vente : une
 * correction d'achat ultérieure ne réécrit pas les marges passées. Cet outil
 * SIMULE un recalcul sur une période et affiche les écarts, sans jamais
 * modifier les données. Toute correction reste donc une décision explicite.
 * ------------------------------------------------------------------------- */

import { roundMoney, toNumber } from '../shared/format.js';
import { toISODate } from '../shared/dates.js';
import { computeProductStock, sortMovements } from './stock.js';

function inPeriod(date, from, to) {
  const value = toISODate(date) || '';
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

/**
 * Rejoue le stock jusqu'à la date de chaque vente et compare le coût moyen
 * obtenu au coût figé sur la ligne.
 * @returns {{
 *   from: string, to: string, salesCount: number, linesCount: number,
 *   rows: Array, totalFrozen: number, totalRecalculated: number, difference: number
 * }}
 */
export function simulateCostRecalculation(state = {}, { from = '', to = '' } = {}) {
  const sales = (state.sales || []).filter((sale) => sale.status !== 'cancelled' && inPeriod(sale.date, from, to));
  const movements = sortMovements(state.stockMovements || []);
  const products = new Map((state.products || []).map((product) => [product.id, product]));
  const rows = [];
  let linesCount = 0;
  let totalFrozen = 0;
  let totalRecalculated = 0;

  for (const sale of sales) {
    for (const line of sale.lines || []) {
      linesCount += 1;
      const product = products.get(line.productId);
      const upto = movements.filter(
        (movement) => movement.productId === line.productId && String(movement.date || '') <= String(sale.date || ''),
      );
      const stock = computeProductStock(upto, line.productId, product ? product.cost : 0);
      const quantity = toNumber(line.quantity, 0);
      const frozen = roundMoney(toNumber(line.unitCost, 0) * quantity);
      const recalculated = roundMoney(stock.averageCost * quantity);
      totalFrozen += frozen;
      totalRecalculated += recalculated;
      const difference = roundMoney(recalculated - frozen);
      if (Math.abs(difference) < 0.005) continue;
      rows.push({
        saleId: sale.id,
        reference: sale.reference,
        date: sale.date,
        product: line.label || (product ? product.name : line.productId),
        quantity,
        frozenUnitCost: roundMoney(toNumber(line.unitCost, 0)),
        recalculatedUnitCost: roundMoney(stock.averageCost),
        frozen,
        recalculated,
        difference,
      });
    }
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.reference).localeCompare(String(b.reference)));

  return {
    from,
    to,
    salesCount: sales.length,
    linesCount,
    rows,
    totalFrozen: roundMoney(totalFrozen),
    totalRecalculated: roundMoney(totalRecalculated),
    difference: roundMoney(totalRecalculated - totalFrozen),
  };
}
