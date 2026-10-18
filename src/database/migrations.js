/* ---------------------------------------------------------------------------
 * Mon Commerce — migrations IndexedDB versionnées
 *
 * Chaque migration décrit la transformation des magasins d'objets pour une
 * version donnée. Les migrations sont appliquées dans l'ordre, une seule fois,
 * au moment de l'ouverture de la base.
 *
 * Règle : ne jamais modifier une migration déjà publiée. On ajoute une nouvelle
 * entrée, on incrémente SCHEMA_VERSION (src/config/constants.js) et on adapte
 * la constante SCHEMA pour décrire l'état cible :
 *
 *   {
 *     version: 2,
 *     description: 'Ajout de l'index « dueDate » sur les ventes.',
 *     up(db, transaction) {
 *       const store = transaction.objectStore('sales');
 *       if (!store.indexNames.contains('dueDate')) store.createIndex('dueDate', 'dueDate');
 *     },
 *   }
 * ------------------------------------------------------------------------- */

import { SCHEMA } from './schema.js';

/**
 * @typedef {object} Migration
 * @property {number} version
 * @property {string} description
 * @property {(db: IDBDatabase, transaction: IDBTransaction) => void} up
 */

/** @type {Migration[]} */
export const MIGRATIONS = [
  {
    version: 1,
    description:
      "Schéma initial : activités, produits, clients, fournisseurs, achats, ventes, retours, dépenses, paiements, mouvements de stock et de trésorerie, paramètres, métadonnées.",
    up(db) {
      for (const [storeName, definition] of Object.entries(SCHEMA)) {
        if (db.objectStoreNames.contains(storeName)) continue;
        // Les magasins sont créés dans la transaction « versionchange » en cours :
        // les index doivent être déclarés sur l'objet magasin retourné.
        const store = db.createObjectStore(storeName, { keyPath: definition.keyPath });
        for (const [indexName, keyPath, options] of definition.indexes || []) {
          store.createIndex(indexName, keyPath, options || { unique: false });
        }
      }
    },
  },
];

/** Version cible de la base = dernière migration disponible. */
export function targetVersion() {
  return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 1;
}

/**
 * Applique les migrations nécessaires lors d'un « upgradeneeded ».
 * @param {IDBDatabase} db
 * @param {IDBTransaction} transaction
 * @param {number} oldVersion version précédente de la base
 * @param {number} newVersion version demandée
 */
export function applyMigrations(db, transaction, oldVersion, newVersion) {
  for (const migration of MIGRATIONS) {
    if (migration.version <= oldVersion || migration.version > newVersion) continue;
    migration.up(db, transaction);
  }
}
