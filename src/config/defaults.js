/* ---------------------------------------------------------------------------
 * Mon Commerce — valeurs par défaut (module pur, sans DOM ni IndexedDB)
 * ------------------------------------------------------------------------- */

import {
  APP_VERSION,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PRODUCT_CATEGORIES,
  PAYMENT_METHODS,
  SCHEMA_VERSION,
} from './constants.js';

/** État vide : garantit que l'interface ne rencontre jamais `undefined`. */
export function emptyState() {
  return {
    activities: [],
    products: [],
    customers: [],
    suppliers: [],
    employees: [],
    purchases: [],
    sales: [],
    returns: [],
    expenses: [],
    payments: [],
    stockMovements: [],
    cashAccounts: [],
    cashMovements: [],
    settings: null,
    meta: null,
  };
}

export function defaultSettings(now = new Date().toISOString()) {
  return {
    id: 'app',
    shopName: '',
    logoDataUrl: '',
    dateFormat: 'dd/MM/yyyy',
    paymentMethods: [...PAYMENT_METHODS],
    productCategories: [...DEFAULT_PRODUCT_CATEGORIES],
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    defaultAlertThreshold: 2,
    allowNegativeStock: false,
    onboardingDone: false,
    currentActivityId: '',
    /* Identité et documents (L13) */
    shopPhone: '',
    shopAddress: '',
    shopTaxId: '',
    receiptTemplate: 'classic',
    receiptFooter: 'Merci de votre visite.',
    receiptShowLogo: true,
    /* Sauvegardes (L1, L2) */
    lastBackupAt: '',
    backupReminderDays: 7,
    autoBackupOnOpen: false,
    backupSnoozedUntil: '',
    backupSnoozedAt: '',
    /* Verrouillage local (L6) */
    lockEnabled: false,
    lockPinHash: '',
    lockPinSalt: '',
    lockIterations: 210000,
    lockTimeoutMinutes: 5,
    lockOnHidden: true,
    lockUpdatedAt: '',
    /* Affichage (L15) : null = automatique, 0 = sans centimes, 2 = avec centimes */
    moneyDecimals: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultMeta(now = new Date().toISOString()) {
  return {
    id: 'app',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    lastOpenedAt: now,
    createdAt: now,
  };
}
