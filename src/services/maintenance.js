/* ---------------------------------------------------------------------------
 * Mon Commerce — archivage et purge guidée (L4)
 *
 * La purge ne supprime jamais un document encore ouvert (créance ou dette) :
 * ces pièces restent dans le quotidien. Les mouvements de stock et de
 * trésorerie antérieurs sont remplacés par UN mouvement d'ouverture qui
 * conserve exactement les soldes actuels. Un instantané est créé avant toute
 * suppression, et l'opération reste annulable depuis les paramètres.
 * ------------------------------------------------------------------------- */

import { buildCashMovement } from './cash.js';
import { applyOperations, op, putAll } from './state.js';
import { saveSnapshot } from './snapshots.js';
import { purchaseBalance, saleBalance } from './finance.js';
import { buildBackup } from './backup.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { BusinessError } from '../shared/validators.js';

const DATED_COLLECTIONS = ['sales', 'purchases', 'returns', 'expenses', 'payments', 'stockMovements', 'cashMovements'];

function beforeDate(value) {
  const date = toISODate(value);
  if (!date) throw new BusinessError('Choisissez une date de clôture valide.');
  return date;
}

function oldRecord(record, cutoff) {
  const date = toISODate(record.date);
  return Boolean(date) && date < cutoff;
}

/** Volumétrie lisible par collection, pour guider l'utilisateur. */
export function dataVolume(state = {}) {
  const counts = {};
  for (const collection of DATED_COLLECTIONS) counts[collection] = (state[collection] || []).length;
  const dates = DATED_COLLECTIONS.flatMap((collection) =>
    (state[collection] || []).map((record) => toISODate(record.date)).filter(Boolean),
  ).sort();
  return {
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    oldest: dates[0] || '',
    newest: dates[dates.length - 1] || '',
    master: {
      activities: (state.activities || []).length,
      products: (state.products || []).length,
      customers: (state.customers || []).length,
      suppliers: (state.suppliers || []).length,
      employees: (state.employees || []).length,
    },
  };
}

/**
 * Construit le plan de purge sans rien modifier.
 * @param {object} state état applicatif
 * @param {string} cutoff date ISO : tout ce qui est strictement antérieur est candidat
 */
export function planPurge(state = {}, cutoffValue) {
  const cutoff = beforeDate(cutoffValue);
  const payments = state.payments || [];
  const returns = state.returns || [];

  const keptSales = new Set(
    (state.sales || [])
      .filter((sale) => !oldRecord(sale, cutoff) || saleBalance(sale, { payments, returns }) > 0.005)
      .map((sale) => sale.id),
  );
  const keptPurchases = new Set(
    (state.purchases || [])
      .filter((purchase) => !oldRecord(purchase, cutoff) || purchaseBalance(purchase, { payments, returns }) > 0.005)
      .map((purchase) => purchase.id),
  );
  const keptReturns = new Set(
    returns
      .filter((entry) => {
        if (!oldRecord(entry, cutoff)) return true;
        if (entry.kind === 'sale') return keptSales.has(entry.sourceId);
        if (entry.kind === 'purchase') return keptPurchases.has(entry.sourceId);
        return true;
      })
      .map((entry) => entry.id),
  );
  const keptPayments = new Set(
    payments
      .filter((payment) => {
        if (!oldRecord(payment, cutoff)) return true;
        if (payment.partyType === 'sale') return keptSales.has(payment.partyId);
        if (payment.partyType === 'purchase') return keptPurchases.has(payment.partyId);
        // Acomptes clients/fournisseurs : conservés, ils peuvent solder une
        // facture future et ne sont pas rattachés à un document précis.
        return payment.partyType === 'customer' || payment.partyType === 'supplier';
      })
      .map((payment) => payment.id),
  );
  const keptExpenses = new Set(
    (state.expenses || []).filter((expense) => !oldRecord(expense, cutoff)).map((expense) => expense.id),
  );

  const keptSourceIds = new Set([...keptSales, ...keptPurchases, ...keptReturns, ...keptPayments, ...keptExpenses]);
  /**
   * L'historique des mouvements de stock est intégralement conservé : c'est lui
   * qui garantit la valorisation exacte (coût moyen pondéré) du stock actuel.
   * Il ne contient pas de données nominatives et reste compact.
   */
  const keptStockMovements = state.stockMovements || [];
  const keptCashMovements = (state.cashMovements || []).filter(
    (movement) => !oldRecord(movement, cutoff) || keptSourceIds.has(movement.sourceId),
  );

  /* ---- soldes d'ouverture de trésorerie ---- */
  const keptCashIds = new Set(keptCashMovements.map((movement) => movement.id));
  const openingCashMovements = [];
  for (const account of state.cashAccounts || []) {
    const movements = (state.cashMovements || []).filter((movement) => movement.accountId === account.id);
    const current = movements.reduce(
      (balance, movement) => balance + (movement.direction === 'in' ? toNumber(movement.amount, 0) : -toNumber(movement.amount, 0)),
      toNumber(account.initialBalance, 0),
    );
    const kept = movements
      .filter((movement) => keptCashIds.has(movement.id))
      .reduce(
        (balance, movement) => balance + (movement.direction === 'in' ? toNumber(movement.amount, 0) : -toNumber(movement.amount, 0)),
        toNumber(account.initialBalance, 0),
      );
    const difference = roundMoney(current - kept);
    if (Math.abs(difference) < 0.005) continue;
    openingCashMovements.push(
      buildCashMovement({
        activityId: '',
        date: cutoff,
        accountId: account.id,
        direction: difference > 0 ? 'in' : 'out',
        amount: Math.abs(difference),
        nature: difference > 0 ? 'other_in' : 'other_out',
        sourceType: 'purge_opening',
        sourceId: '',
        note: 'Solde d’ouverture après archivage des exercices précédents',
      }),
    );
  }

  const deletions = {};
  for (const collection of DATED_COLLECTIONS) {
    const keep =
      collection === 'sales' ? keptSales
        : collection === 'purchases' ? keptPurchases
          : collection === 'returns' ? keptReturns
            : collection === 'payments' ? keptPayments
              : collection === 'expenses' ? keptExpenses
                : collection === 'stockMovements' ? new Set(keptStockMovements.map((movement) => movement.id))
                  : new Set(keptCashMovements.map((movement) => movement.id));
    deletions[collection] = (state[collection] || [])
      .filter((record) => !keep.has(record.id))
      .map((record) => record.id);
  }

  const deletedTotal = Object.values(deletions).reduce((sum, ids) => sum + ids.length, 0);

  return {
    cutoff,
    deletions,
    deletedTotal,
    kept: {
      sales: keptSales.size,
      purchases: keptPurchases.size,
      expenses: keptExpenses.size,
      stockMovements: keptStockMovements.length,
      cashMovements: keptCashMovements.length,
    },
    openingStockMovements: [],
    openingCashMovements,
  };
}

/**
 * Construit une archive JSON autonome des opérations antérieures à la date
 * choisie, avec les fiches de référence. À conserver hors de l'appareil avant
 * toute purge.
 */
export function buildArchive(state = {}, cutoffValue) {
  const cutoff = beforeDate(cutoffValue);
  const data = { ...state };
  for (const collection of DATED_COLLECTIONS) {
    data[collection] = (state[collection] || []).filter((record) => oldRecord(record, cutoff));
  }
  const payload = buildBackup(data, { reference: new Date() });
  payload.archive = { cutoff, kind: 'exercice', generatedAt: new Date().toISOString() };
  return { payload, filename: `mon-commerce-archive-${cutoff}.json` };
}

/**
 * Applique un plan de purge. Un instantané complet est créé par défaut.
 * @param {object} state état actuel
 * @param {object} plan résultat de planPurge
 * @param {{snapshot?: boolean, label?: string}} options
 */
export async function applyPurge(state, plan, { snapshot = true, label = '' } = {}) {
  if (!plan || plan.deletedTotal === 0) throw new BusinessError('Aucun document à archiver avant cette date.');
  if (snapshot) {
    await saveSnapshot({
      kind: 'before-purge',
      label: label || `Avant archivage au ${plan.cutoff}`,
      data: state,
      meta: { cutoff: plan.cutoff, deleted: plan.deletedTotal },
    });
  }

  const operations = [];
  for (const [collection, ids] of Object.entries(plan.deletions)) {
    for (const id of ids) operations.push(op.remove(collection, id));
  }
  operations.push(...putAll('stockMovements', plan.openingStockMovements));
  operations.push(...putAll('cashMovements', plan.openingCashMovements));

  await applyOperations(operations, { type: 'purge', summary: `${plan.deletedTotal} document(s) archivé(s)` }, { journal: false });
  return {
    deleted: plan.deletedTotal,
    openingStockMovements: plan.openingStockMovements.length,
    openingCashMovements: plan.openingCashMovements.length,
  };
}
