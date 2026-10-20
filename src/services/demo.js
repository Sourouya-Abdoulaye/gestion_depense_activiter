/* ---------------------------------------------------------------------------
 * Mon Commerce — mode démonstration (L23)
 *
 * La démonstration utilise une base IndexedDB SÉPARÉE (« mon-commerce-demo »).
 * Elle ne peut donc jamais se mélanger aux vraies données. Le bandeau de
 * l'application rappelle en permanence que les chiffres sont fictifs, et un
 * bouton permet de revenir aux données réelles.
 * ------------------------------------------------------------------------- */

import { DEMO_STORAGE_KEY } from '../database/schema.js';
import { defaultMeta, defaultSettings, emptyState } from '../config/defaults.js';
import { buildCashAccount, buildCashMovement } from './cash.js';
import { buildExpense } from './expenses.js';
import { buildPurchase, buildPurchasePayments } from './purchases.js';
import { buildSale, buildSalePayments, paymentsToCashMovements } from './sales.js';
import { buildMovement, computeStockState } from './stock.js';
import { purchaseTotal, saleTotal } from './finance.js';
import { replaceState, getState } from './state.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { toISODate } from '../shared/dates.js';

const STAMP = new Date().toISOString();

export function isDemoMode() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toISODate(date);
}

/** Jeu de données fictif, volontairement petit mais cohérent. */
export function buildDemoState() {
  const state = emptyState();
  state.settings = {
    ...defaultSettings(STAMP),
    shopName: 'Démo — Boutique Awa',
    shopPhone: '+228 90 00 00 00',
    shopAddress: 'Quartier démo, Lomé',
    shopTaxId: 'DONNÉES FICTIVES — aucun identifiant réel',
    onboardingDone: true,
    tourDone: false,
    lastBackupAt: '',
  };
  state.meta = { ...defaultMeta(STAMP), appVersion: 'demo' };

  const activity = {
    id: newId(ID_PREFIX.ACTIVITY),
    name: 'Démo — Vêtements & accessoires',
    category: 'Vêtements',
    description: 'Jeu de données fictif pour découvrir l’application.',
    status: 'active',
    startDate: daysAgo(40),
    endDate: '',
    initialCapital: 150000,
    targetBudget: 0,
    note: 'Données de démonstration : ne pas utiliser pour une gestion réelle.',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  state.activities = [activity];
  state.settings.currentActivityId = activity.id;

  const account = buildCashAccount({ name: 'Caisse démo', type: 'cash', initialBalance: 0 });
  state.cashAccounts = [account];
  state.cashMovements.push(
    buildCashMovement({
      activityId: activity.id,
      date: daysAgo(40),
      accountId: account.id,
      direction: 'in',
      amount: 150000,
      nature: 'capital_in',
      sourceType: 'activity',
      sourceId: activity.id,
      note: 'Capital de départ (démo)',
    }),
  );

  const supplier = {
    id: newId(ID_PREFIX.SUPPLIER),
    name: 'Fournisseur démo',
    phone: '',
    email: '',
    address: '',
    note: 'Fournisseur fictif',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  state.suppliers = [supplier];

  const customer = {
    id: newId(ID_PREFIX.CUSTOMER),
    name: 'Cliente démo',
    phone: '90 00 00 01',
    email: '',
    address: '',
    note: 'Cliente fictive',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  state.customers = [customer];

  const chemise = {
    id: newId(ID_PREFIX.PRODUCT),
    activityId: activity.id,
    name: 'Chemise démo',
    reference: 'DEMO-001',
    category: 'Vêtements',
    unit: 'pièce',
    cost: 5000,
    price: 9000,
    alertThreshold: 3,
    description: 'Produit fictif',
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  const sac = {
    id: newId(ID_PREFIX.PRODUCT),
    activityId: activity.id,
    name: 'Sac démo',
    reference: 'DEMO-002',
    category: 'Accessoires',
    unit: 'pièce',
    cost: 8000,
    price: 15000,
    alertThreshold: 2,
    description: 'Produit fictif',
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  state.products = [chemise, sac];
  state.stockMovements.push(
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: activity.id,
      productId: chemise.id,
      date: daysAgo(40),
      type: 'in',
      reason: 'opening',
      quantity: 20,
      unitCost: 5000,
      sourceType: 'product',
      sourceId: chemise.id,
      note: 'Stock initial (démo)',
    }),
    buildMovement({
      id: newId(ID_PREFIX.STOCK_MOVEMENT),
      activityId: activity.id,
      productId: sac.id,
      date: daysAgo(40),
      type: 'in',
      reason: 'opening',
      quantity: 12,
      unitCost: 8000,
      sourceType: 'product',
      sourceId: sac.id,
      note: 'Stock initial (démo)',
    }),
  );

  const { purchase, stockMovements: purchaseMovements } = buildPurchase(
    {
      activityId: activity.id,
      supplierId: supplier.id,
      date: daysAgo(20),
      lines: [{ productId: chemise.id, quantity: 10, unitPrice: 6000 }],
      status: 'received',
    },
    { products: state.products },
  );
  state.purchases.push(purchase);
  state.stockMovements.push(...purchaseMovements);
  const [purchasePayment] = buildPurchasePayments(purchase, [{ amount: 40000, accountId: account.id, method: 'Espèces', date: daysAgo(20) }], {
    maxAmount: purchaseTotal(purchase),
  });
  state.payments.push(purchasePayment);
  state.cashMovements.push(...paymentsToCashMovements([purchasePayment]));

  const { sale: firstSale, stockMovements: firstMovements } = buildSale(
    {
      activityId: activity.id,
      date: daysAgo(15),
      items: [{ productId: chemise.id, quantity: 4, unitPrice: 9000 }],
    },
    { products: state.products, stockState: computeStockState(state.stockMovements, state.products) },
  );
  state.sales.push(firstSale);
  state.stockMovements.push(...firstMovements);
  const [firstPayment] = buildSalePayments(firstSale, [{ amount: saleTotal(firstSale), accountId: account.id, method: 'Espèces', date: daysAgo(15) }], {
    maxAmount: saleTotal(firstSale),
  });
  state.payments.push(firstPayment);
  state.cashMovements.push(...paymentsToCashMovements([firstPayment]));

  const { sale: secondSale, stockMovements: secondMovements } = buildSale(
    {
      activityId: activity.id,
      customerId: customer.id,
      date: daysAgo(7),
      items: [{ productId: sac.id, quantity: 2, unitPrice: 15000 }],
      dueDate: daysAgo(-7),
    },
    { products: state.products, stockState: computeStockState(state.stockMovements, state.products) },
  );
  state.sales.push(secondSale);
  state.stockMovements.push(...secondMovements);
  const [secondPayment] = buildSalePayments(secondSale, [{ amount: 10000, accountId: account.id, method: 'TMoney', date: daysAgo(7) }], {
    maxAmount: saleTotal(secondSale),
  });
  state.payments.push(secondPayment);
  state.cashMovements.push(...paymentsToCashMovements([secondPayment]));

  const { expense, cashMovements: expenseMovements } = buildExpense({
    activityId: activity.id,
    date: daysAgo(10),
    category: 'Loyer',
    nature: 'operating',
    amount: 25000,
    accountId: account.id,
    paid: true,
    beneficiary: 'Bailleur démo',
    note: 'Loyer fictif',
  });
  state.expenses.push(expense);
  state.cashMovements.push(...expenseMovements);

  return state;
}

/** Initialise la base de démonstration si elle est vide. */
export async function ensureDemoData() {
  if (!isDemoMode()) return false;
  const state = getState();
  if ((state.activities || []).length > 0) return false;
  await replaceState(buildDemoState());
  return true;
}

/** Bascule vers la démonstration (nécessite un rechargement). */
export function enterDemoMode() {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, '1');
    window.location.reload();
  } catch {
    throw new Error('Le mode démonstration n’est pas disponible dans ce navigateur.');
  }
}

/** Revient aux données réelles (nécessite un rechargement). */
export function exitDemoMode() {
  try {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    window.location.reload();
  } catch {
    throw new Error('Impossible de quitter le mode démonstration.');
  }
}

/** Supprime la base de démonstration puis la recrée au prochain chargement. */
export async function resetDemoMode() {
  if (!isDemoMode()) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('mon-commerce-demo');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Suppression de la démo impossible.'));
    request.onblocked = () => resolve();
  });
  window.location.reload();
}
