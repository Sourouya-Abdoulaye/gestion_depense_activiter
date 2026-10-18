/* ---------------------------------------------------------------------------
 * Mon Commerce — accès à IndexedDB
 *
 * Couche technique minimale et sans dépendance : ouverture versionnée de la
 * base, lecture complète, écritures groupées dans UNE seule transaction
 * (atomicité des opérations liées vente / paiement / stock), remplacement
 * complet lors d'une restauration de sauvegarde.
 * ------------------------------------------------------------------------- */

import { DATABASE_NAME, DATA_STORES, META_ID, SETTINGS_ID, STORE_NAMES } from './schema.js';
import { applyMigrations, targetVersion } from './migrations.js';

let databasePromise = null;

/** Erreur de stockage lisible par l'utilisateur. */
export class StorageError extends Error {
  constructor(message, { code = 'storage', cause = null } = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

export function isIndexedDbSupported() {
  return typeof indexedDB !== 'undefined';
}

function wrapError(error) {
  if (!error) return new StorageError('Erreur de stockage inconnue.');
  if (error.name === 'QuotaExceededError') {
    return new StorageError(
      "L'espace de stockage du navigateur est plein. Exportez une sauvegarde JSON puis libérez de la place avant de continuer.",
      { code: 'quota', cause: error },
    );
  }
  return new StorageError(error.message || 'Erreur de stockage.', { code: error.name || 'storage', cause: error });
}

/** Ouverture (et mise à jour de schéma) de la base, une seule fois par session. */
export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!isIndexedDbSupported()) {
      reject(new StorageError("Ce navigateur ne prend pas en charge IndexedDB : l'application ne peut pas enregistrer de données.", { code: 'unsupported' }));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, targetVersion());
    request.onupgradeneeded = (event) => {
      try {
        applyMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
      } catch (error) {
        reject(wrapError(error));
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(wrapError(request.error));
    request.onblocked = () =>
      reject(
        new StorageError(
          "La base de données est utilisée par un autre onglet ouvert avec une version différente. Fermez les autres onglets de Mon Commerce puis rechargez.",
          { code: 'blocked' },
        ),
      );
  });
  return databasePromise;
}

export async function readAll(storeName) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(wrapError(request.error));
  });
}

export async function readOne(storeName, key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(wrapError(request.error));
  });
}

/** Lecture complète : toutes les collections métier + paramètres + métadonnées. */
export async function readAllData() {
  const entries = await Promise.all(
    STORE_NAMES.map(async (storeName) => [storeName, await readAll(storeName)]),
  );
  const raw = Object.fromEntries(entries);

  const data = {};
  for (const storeName of DATA_STORES) data[storeName] = raw[storeName] || [];
  data.settings = (raw.settings || [])[0] || null;
  data.meta = (raw.meta || [])[0] || null;
  return data;
}

/**
 * Écritures groupées, atomiques.
 * @param {Array<{store: string, type: 'put'|'add'|'delete'|'clear', value?: any, key?: any}>} operations
 * @returns {Promise<number>} nombre d'opérations appliquées
 */
export async function writeBatch(operations = []) {
  if (operations.length === 0) return 0;
  const database = await openDatabase();
  const storeNames = [...new Set(operations.map((operation) => operation.store))];

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = database.transaction(storeNames, 'readwrite');
    } catch (error) {
      reject(wrapError(error));
      return;
    }
    transaction.oncomplete = () => resolve(operations.length);
    transaction.onabort = () => reject(wrapError(transaction.error));
    transaction.onerror = () => reject(wrapError(transaction.error));

    try {
      for (const operation of operations) {
        const store = transaction.objectStore(operation.store);
        switch (operation.type) {
          case 'put':
            store.put(operation.value);
            break;
          case 'add':
            store.add(operation.value);
            break;
          case 'delete':
            store.delete(operation.key);
            break;
          case 'clear':
            store.clear();
            break;
          default:
            throw new Error(`Opération de stockage inconnue : ${operation.type}`);
        }
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* la transaction est déjà terminée */
      }
      reject(wrapError(error));
    }
  });
}

/** Remplace intégralement le contenu de la base (restauration de sauvegarde). */
export async function replaceAllData(data = {}) {
  const operations = [];
  for (const storeName of DATA_STORES) {
    operations.push({ store: storeName, type: 'clear' });
    for (const record of data[storeName] || []) operations.push({ store: storeName, type: 'put', value: record });
  }
  operations.push({ store: 'settings', type: 'clear' });
  if (data.settings) operations.push({ store: 'settings', type: 'put', value: { ...data.settings, id: SETTINGS_ID } });
  operations.push({ store: 'meta', type: 'clear' });
  if (data.meta) operations.push({ store: 'meta', type: 'put', value: { ...data.meta, id: META_ID } });
  return writeBatch(operations);
}

export async function clearAllData() {
  return writeBatch(STORE_NAMES.map((store) => ({ store, type: 'clear' })));
}

/** Estimation de l'espace utilisé (affichée dans les paramètres). */
export async function estimateStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/** Demande au navigateur de ne pas évincer les données (best effort). */
export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return false;
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function resetDatabaseConnection() {
  databasePromise = null;
}
