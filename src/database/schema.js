/* ---------------------------------------------------------------------------
 * Mon Commerce — schéma IndexedDB
 *
 * IndexedDB est le stockage métier local. Chaque enregistrement possède un
 * identifiant stable, des dates normalisées et des relations explicites.
 * Le schéma est versionné : toute évolution passe par une migration
 * (cf. src/database/migrations.js).
 * ------------------------------------------------------------------------- */

export const DATABASE_NAME = 'mon-commerce';

/**
 * Description déclarative des magasins d'objets.
 * keyPath : clé primaire ; indexes : [nom, chemin, options?]
 */
export const SCHEMA = {
  activities: {
    keyPath: 'id',
    indexes: [
      ['status', 'status'],
      ['name', 'name'],
      ['date', 'startDate'],
    ],
  },
  products: {
    keyPath: 'id',
    indexes: [
      ['activityId', 'activityId'],
      ['category', 'category'],
      ['status', 'status'],
      ['name', 'name'],
    ],
  },
  customers: {
    keyPath: 'id',
    indexes: [
      ['name', 'name'],
      ['phone', 'phone'],
    ],
  },
  suppliers: {
    keyPath: 'id',
    indexes: [
      ['name', 'name'],
      ['phone', 'phone'],
    ],
  },
  purchases: {
    keyPath: 'id',
    indexes: [
      ['activityId', 'activityId'],
      ['supplierId', 'supplierId'],
      ['date', 'date'],
      ['status', 'status'],
      ['reference', 'reference'],
    ],
  },
  sales: {
    keyPath: 'id',
    indexes: [
      ['activityId', 'activityId'],
      ['customerId', 'customerId'],
      ['date', 'date'],
      ['status', 'status'],
      ['reference', 'reference'],
    ],
  },
  returns: {
    keyPath: 'id',
    indexes: [
      ['kind', 'kind'],
      ['sourceId', 'sourceId'],
      ['date', 'date'],
      ['activityId', 'activityId'],
    ],
  },
  expenses: {
    keyPath: 'id',
    indexes: [
      ['activityId', 'activityId'],
      ['date', 'date'],
      ['category', 'category'],
      ['nature', 'nature'],
    ],
  },
  payments: {
    keyPath: 'id',
    indexes: [
      ['partyType', 'partyType'],
      ['partyId', 'partyId'],
      ['date', 'date'],
      ['accountId', 'accountId'],
    ],
  },
  stockMovements: {
    keyPath: 'id',
    indexes: [
      ['productId', 'productId'],
      ['date', 'date'],
      ['sourceId', 'sourceId'],
      ['reason', 'reason'],
    ],
  },
  cashAccounts: {
    keyPath: 'id',
    indexes: [['type', 'type'], ['active', 'active']],
  },
  cashMovements: {
    keyPath: 'id',
    indexes: [
      ['accountId', 'accountId'],
      ['date', 'date'],
      ['activityId', 'activityId'],
      ['nature', 'nature'],
      ['sourceId', 'sourceId'],
    ],
  },
  settings: {
    keyPath: 'id',
    indexes: [],
  },
  meta: {
    keyPath: 'id',
    indexes: [],
  },
};

export const STORE_NAMES = Object.keys(SCHEMA);

/** Magasins contenant des listes d'enregistrements métier. */
export const DATA_STORES = STORE_NAMES.filter((name) => name !== 'settings' && name !== 'meta');

export const SETTINGS_ID = 'app';
export const META_ID = 'app';
