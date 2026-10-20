/* ---------------------------------------------------------------------------
 * Mon Commerce — état applicatif en mémoire
 *
 * Stratégie retenue : toutes les données métier sont chargées en mémoire au
 * démarrage, puis chaque modification est écrite dans IndexedDB (un lot
 * atomique) et répercutée immédiatement en mémoire. Les calculs financiers
 * restent ainsi purs et recalculables, sans requêtes coûteuses.
 * ------------------------------------------------------------------------- */

import { APP_VERSION, SCHEMA_VERSION } from '../config/constants.js';
import { defaultSettings, emptyState } from '../config/defaults.js';
import { INTERNAL_STORES, META_ID, SETTINGS_ID } from '../database/schema.js';
import { readAllData, replaceAllData, requestPersistentStorage, writeBatch } from '../database/db.js';
import { nowStamp, todayISO } from '../shared/dates.js';
import { setMoneyDecimals } from '../shared/format.js';
import { buildCashAccount } from './cash.js';
import { journalLabel, recordJournal } from './journal.js';

export { emptyState, defaultSettings };

const store = {
  data: emptyState(),
  ready: false,
  error: null,
  listeners: new Set(),
};

/* ------------------------------ accès état ------------------------------ */

export function getState() {
  return store.data;
}

export function getSettings() {
  return store.data.settings || defaultSettings();
}

export function isReady() {
  return store.ready;
}

export function getError() {
  return store.error;
}

export function currentActivity() {
  const settings = getSettings();
  const activities = store.data.activities || [];
  return (
    activities.find((activity) => activity.id === settings.currentActivityId) ||
    activities.find((activity) => activity.status === 'active') ||
    activities[0] ||
    null
  );
}

export function subscribe(listener) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

function notify(event = { type: 'change' }) {
  for (const listener of store.listeners) {
    try {
      listener(store.data, event);
    } catch (error) {
      console.error('[Mon Commerce] Un abonné a échoué :', error);
    }
  }
}

/* ---------------------------- initialisation ---------------------------- */

export async function initializeStore() {
  try {
    const data = await readAllData();
    store.data = { ...emptyState(), ...data };
    const operations = [];

    if (!store.data.settings) {
      store.data.settings = defaultSettings();
      operations.push({ store: 'settings', type: 'put', value: store.data.settings });
    } else {
      // Complète les paramètres manquants lors d'une montée de version.
      const merged = { ...defaultSettings(), ...store.data.settings, id: SETTINGS_ID };
      if (JSON.stringify(merged) !== JSON.stringify(store.data.settings)) {
        store.data.settings = merged;
        operations.push({ store: 'settings', type: 'put', value: merged });
      }
    }

    if ((store.data.cashAccounts || []).length === 0) {
      const account = buildCashAccount({ name: 'Caisse principale', type: 'cash', initialBalance: 0 });
      store.data.cashAccounts = [account];
      operations.push({ store: 'cashAccounts', type: 'put', value: account });
    }

    store.data.meta = {
      id: META_ID,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      lastOpenedAt: nowStamp(),
      createdAt: store.data.meta?.createdAt || nowStamp(),
    };
    operations.push({ store: 'meta', type: 'put', value: store.data.meta });

    if (operations.length > 0) await writeBatch(operations);
    setMoneyDecimals(store.data.settings.moneyDecimals);
    await requestPersistentStorage();
    store.ready = true;
    store.error = null;
    notify({ type: 'init' });
    return store.data;
  } catch (error) {
    store.error = error;
    store.ready = false;
    notify({ type: 'error', error });
    throw error;
  }
}

/** Relit intégralement les données (après restauration de sauvegarde). */
export async function reloadStore() {
  const data = await readAllData();
  store.data = { ...emptyState(), ...data };
  setMoneyDecimals(store.data.settings?.moneyDecimals);
  store.ready = true;
  notify({ type: 'reload' });
  return store.data;
}

/* ------------------------------- écritures ------------------------------ */

/**
 * Calcule les opérations inverses d'un lot, à partir de l'état AVANT écriture.
 * Le résultat est renvoyé dans l'ordre inverse d'application.
 */
function invertOperations(operations) {
  const shadows = new Map();
  const shadowFor = (storeName) => {
    if (!shadows.has(storeName)) {
      shadows.set(storeName, new Map((store.data[storeName] || []).map((record) => [record.id, record])));
    }
    return shadows.get(storeName);
  };
  const inverses = [];

  for (const operation of operations) {
    const { store: storeName, type, value, key } = operation;
    if (storeName === 'meta') continue;
    if (storeName !== 'settings' && INTERNAL_STORES.includes(storeName)) continue;
    if (storeName === 'settings') {
      inverses.push(
        store.data.settings
          ? { store: 'settings', type: 'put', value: { ...store.data.settings } }
          : { store: 'settings', type: 'clear' },
      );
      continue;
    }
    const shadow = shadowFor(storeName);
    if (type === 'put' || type === 'add') {
      const id = value && value.id;
      if (!id) continue;
      const previous = shadow.get(id);
      inverses.push(previous ? { store: storeName, type: 'put', value: previous } : { store: storeName, type: 'delete', key: id });
      shadow.set(id, value);
    } else if (type === 'delete') {
      const previous = shadow.get(key);
      if (previous) inverses.push({ store: storeName, type: 'put', value: previous });
      shadow.delete(key);
    } else if (type === 'clear') {
      for (const record of shadow.values()) inverses.push({ store: storeName, type: 'put', value: record });
      shadow.clear();
    }
  }
  return inverses.reverse();
}

/**
 * Applique un lot d'opérations : écriture atomique en base puis mise à jour
 * de l'état mémoire. Les opérations liées (vente + paiement + stock) doivent
 * être fournies dans le même lot : elles réussissent ou échouent ensemble.
 *
 * Sauf demande contraire, les opérations inverses sont journalisées pour
 * permettre « Annuler la dernière opération » (L12).
 */
export async function applyOperations(operations = [], event = { type: 'change' }, { journal = true } = {}) {
  if (operations.length === 0) return 0;
  const inverses = journal ? invertOperations(operations) : [];
  await writeBatch(operations);

  if (journal && inverses.length > 0 && event.type !== 'settings' && event.type !== 'undo') {
    try {
      await recordJournal({
        label: journalLabel(event.type),
        type: event.type || '',
        ops: inverses,
        summary: event.summary || '',
      });
    } catch (error) {
      console.warn('[Mon Commerce] Journal d’annulation indisponible :', error);
    }
  }

  for (const operation of operations) {
    const { store: storeName, type, value, key } = operation;
    if (storeName === 'settings') {
      if (type === 'put') {
        store.data.settings = { ...value, id: SETTINGS_ID };
        setMoneyDecimals(store.data.settings.moneyDecimals);
      } else if (type === 'clear') store.data.settings = null;
      continue;
    }
    if (storeName === 'meta') {
      if (type === 'put') store.data.meta = value;
      continue;
    }
    if (INTERNAL_STORES.includes(storeName)) continue;
    if (!Array.isArray(store.data[storeName])) store.data[storeName] = [];
    if (type === 'clear') {
      store.data[storeName] = [];
      continue;
    }
    const list = store.data[storeName];
    const keyPath = 'id';
    const recordKey = value ? value[keyPath] : key;
    const index = list.findIndex((record) => record.id === recordKey);
    if (type === 'delete') {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = value;
    } else {
      list.push(value);
    }
  }

  notify(event);
  return operations.length;
}

/** Raccourcis de construction d'opérations. */
export const op = {
  put: (storeName, value) => ({ store: storeName, type: 'put', value }),
  add: (storeName, value) => ({ store: storeName, type: 'add', value }),
  remove: (storeName, key) => ({ store: storeName, type: 'delete', key }),
  clear: (storeName) => ({ store: storeName, type: 'clear' }),
};

/** Enregistre un lot d'enregistrements dans un magasin. */
export function putAll(storeName, records = []) {
  return records.map((record) => ({ store: storeName, type: 'put', value: record }));
}

/* ------------------------------ paramètres ------------------------------ */

export async function saveSettings(patch = {}) {
  const settings = { ...getSettings(), ...patch, id: SETTINGS_ID, updatedAt: nowStamp() };
  await applyOperations([op.put('settings', settings)], { type: 'settings' });
  return settings;
}

export async function setCurrentActivity(activityId) {
  return saveSettings({ currentActivityId: activityId || '' });
}

/* --------------------------- restauration ------------------------------- */

export async function replaceState(data) {
  const normalized = { ...emptyState(), ...data };
  await replaceAllData({
    ...normalized,
    settings: normalized.settings ? { ...normalized.settings, id: SETTINGS_ID } : defaultSettings(),
  });
  return reloadStore();
}

export function markFirstLaunchSeen() {
  return saveSettings({ onboardingDone: true, firstLaunchAt: todayISO() });
}

export function markBackupExported() {
  return saveSettings({ lastBackupAt: nowStamp() });
}

export { store as internalStore };
