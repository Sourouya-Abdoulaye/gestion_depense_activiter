/* ---------------------------------------------------------------------------
 * Mon Commerce — instantanés de sécurité (annulation d'import, corbeille)
 *
 * Les instantanés sont stockés dans IndexedDB, hors des collections métier :
 * ils ne sont ni exportés, ni chargés en mémoire au démarrage. On conserve les
 * plus récents et on purge les anciens pour ne pas saturer le quota.
 * ------------------------------------------------------------------------- */

import { readAll, writeBatch } from '../database/db.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { nowStamp } from '../shared/dates.js';

export const SNAPSHOT_STORE = 'snapshots';
export const MAX_SNAPSHOTS = 6;

/** Enregistre un instantané complet de l'état (collections + réglages). */
export async function saveSnapshot({ kind = 'manual', label = '', data = {}, meta = {} } = {}) {
  const record = {
    id: newId(ID_PREFIX.SNAPSHOT),
    kind,
    label,
    createdAt: nowStamp(),
    meta,
    counts: Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length]),
    ),
    data: JSON.parse(JSON.stringify(data)),
  };
  await writeBatch([{ store: SNAPSHOT_STORE, type: 'put', value: record }]);
  await pruneSnapshots();
  return record;
}

/** Liste les instantanés, du plus récent au plus ancien. */
export async function listSnapshots() {
  const records = await readAll(SNAPSHOT_STORE);
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getSnapshot(id) {
  const records = await readAll(SNAPSHOT_STORE);
  return records.find((record) => record.id === id) || null;
}

export async function deleteSnapshot(id) {
  return writeBatch([{ store: SNAPSHOT_STORE, type: 'delete', key: id }]);
}

/** Ne garde que les N instantanés les plus récents. */
export async function pruneSnapshots(keep = MAX_SNAPSHOTS) {
  const records = await listSnapshots();
  const stale = records.slice(Math.max(0, keep));
  if (stale.length === 0) return 0;
  await writeBatch(stale.map((record) => ({ store: SNAPSHOT_STORE, type: 'delete', key: record.id })));
  return stale.length;
}

/** Supprime tous les instantanés (réinitialisation complète). */
export async function clearSnapshots() {
  return writeBatch([{ store: SNAPSHOT_STORE, type: 'clear' }]);
}

/** Dernier instantané d'un type donné (ex. « avant-import »). */
export async function latestSnapshot(kind) {
  const records = await listSnapshots();
  return records.find((record) => !kind || record.kind === kind) || null;
}
