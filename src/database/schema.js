/* ---------------------------------------------------------------------------
 * Mon Commerce — schéma IndexedDB
 *
 * IndexedDB est le stockage métier local. Chaque enregistrement possède un
 * identifiant stable, des dates normalisées et des relations explicites.
 * Le schéma est versionné : toute évolution passe par une migration
 * (cf. src/database/migrations.js).
 * ------------------------------------------------------------------------- */

export const DATABASE_NAME = 'mon-commerce';
export const DEMO_DATABASE_NAME = 'mon-commerce-demo';
export const DEMO_STORAGE_KEY = 'mon-commerce.demo';

/**
 * Base utilisée pour la session : les données réelles et la démonstration sont
 * physiquement séparées. Le choix est mémorisé dans localStorage et prend effet
 * au rechargement (une seule ouverture de base par session).
 */
export function databaseName() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_STORAGE_KEY) === '1') return DEMO_DATABASE_NAME;
  } catch {
    /* stockage local indisponible : on reste sur la base réelle */
  }
  return DATABASE_NAME;
}

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
  /**
   * Employés (L10) : fiches locales. Les salaires versés restent des dépenses
   * d'exploitation reliées à l'employé par `employeeId`.
   */
  employees: {
    keyPath: 'id',
    indexes: [
      ['name', 'name'],
      ['status', 'status'],
      ['activityId', 'activityId'],
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
  /**
   * Instantanés techniques (annulation d'import, corbeille). Ils ne font pas
   * partie des données métier : jamais exportés, jamais chargés en mémoire.
   */
  snapshots: {
    keyPath: 'id',
    indexes: [
      ['kind', 'kind'],
      ['createdAt', 'createdAt'],
    ],
  },
  /**
   * Journal des dernières opérations : chaque entrée contient les opérations
   * inverses permettant d'annuler un mouvement (L12).
   */
  journal: {
    keyPath: 'id',
    indexes: [['createdAt', 'createdAt']],
  },
  /**
   * Empreintes des lignes de relevés déjà importées (L21). Magasin technique :
   * il empêche de saisir deux fois la même ligne, sans alourdir l'état mémoire.
   */
  imports: {
    keyPath: 'id',
    indexes: [
      ['createdAt', 'createdAt'],
      ['batchId', 'batchId'],
    ],
  },
};

export const STORE_NAMES = Object.keys(SCHEMA);

/** Magasins techniques exclus des collections métier. */
export const INTERNAL_STORES = ['settings', 'meta', 'snapshots', 'journal', 'imports'];

/** Magasins contenant des listes d'enregistrements métier. */
export const DATA_STORES = STORE_NAMES.filter((name) => !INTERNAL_STORES.includes(name));

export const SETTINGS_ID = 'app';
export const META_ID = 'app';
