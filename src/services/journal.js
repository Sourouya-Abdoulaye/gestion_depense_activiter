/* ---------------------------------------------------------------------------
 * Mon Commerce — journal d'annulation (L12)
 *
 * Chaque écriture métier enregistre les opérations inverses correspondantes.
 * « Annuler la dernière opération » rejoue ces inverses dans un seul lot
 * atomique : les enregistrements créés sont retirés, les enregistrements
 * modifiés retrouvent leur version précédente.
 *
 * Le journal est technique : il n'est ni exporté, ni chargé au démarrage, et
 * il est purgé au-delà de 25 entrées.
 * ------------------------------------------------------------------------- */

import { readAll, writeBatch } from '../database/db.js';
import { nowStamp } from '../shared/dates.js';
import { newId, ID_PREFIX } from '../shared/id.js';

export const JOURNAL_STORE = 'journal';
export const JOURNAL_KEEP = 25;

/** Enregistre une entrée d'annulation. */
export async function recordJournal({ label = 'Opération', type = '', ops = [], summary = '' } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) return null;
  const record = {
    id: newId(ID_PREFIX.JOURNAL),
    label,
    type,
    summary,
    createdAt: nowStamp(),
    ops,
  };
  await writeBatch([{ store: JOURNAL_STORE, type: 'put', value: record }]);
  await pruneJournal();
  return record;
}

/** Entrées du plus récent au plus ancien. */
export async function listJournal() {
  const records = await readAll(JOURNAL_STORE);
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function latestJournal() {
  const records = await listJournal();
  return records[0] || null;
}

export async function deleteJournal(id) {
  return writeBatch([{ store: JOURNAL_STORE, type: 'delete', key: id }]);
}

export async function clearJournal() {
  return writeBatch([{ store: JOURNAL_STORE, type: 'clear' }]);
}

export async function pruneJournal(keep = JOURNAL_KEEP) {
  const records = await listJournal();
  const stale = records.slice(Math.max(0, keep));
  if (stale.length === 0) return 0;
  await writeBatch(stale.map((record) => ({ store: JOURNAL_STORE, type: 'delete', key: record.id })));
  return stale.length;
}

/** Libellés lisibles des événements métier journalisés. */
export const JOURNAL_LABELS = {
  'activity-created': 'Création d’une activité',
  'activity-updated': 'Modification d’une activité',
  'activity-deleted': 'Suppression d’une activité',
  'product-created': 'Création d’un produit',
  'product-updated': 'Modification d’un produit',
  'product-deleted': 'Suppression d’un produit',
  'customer-saved': 'Enregistrement d’un client',
  'customer-deleted': 'Suppression d’un client',
  'supplier-saved': 'Enregistrement d’un fournisseur',
  'supplier-deleted': 'Suppression d’un fournisseur',
  'employee-saved': 'Enregistrement d’un employé',
  'employee-deleted': 'Suppression d’un employé',
  'bank-import': 'Import de relevé',
  'sale-created': 'Nouvelle vente',
  'sale-paid': 'Encaissement sur vente',
  'sale-cancelled': 'Annulation d’une vente',
  'sale-returned': 'Retour client',
  'purchase-created': 'Nouvel achat',
  'purchase-received': 'Réception d’un achat',
  'purchase-paid': 'Paiement fournisseur',
  'purchase-cancelled': 'Annulation d’un achat',
  'purchase-returned': 'Retour fournisseur',
  'expense-created': 'Nouvelle dépense',
  'expense-updated': 'Modification d’une dépense',
  'expense-deleted': 'Suppression d’une dépense',
  'stock-adjusted': 'Mouvement de stock',
  'cash-movement': 'Mouvement de trésorerie',
  'cash-account': 'Compte de trésorerie',
  contribution: 'Apport de capital',
  withdrawal: 'Retrait',
  transfer: 'Virement interne',
  settings: 'Modification des paramètres',
};

export function journalLabel(type) {
  return JOURNAL_LABELS[type] || 'Opération';
}
