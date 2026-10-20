/* ---------------------------------------------------------------------------
 * Mon Commerce — annulation de la dernière opération (L12)
 *
 * Rejoue les opérations inverses journalisées, dans un seul lot atomique.
 * Aucun document n'est supprimé silencieusement : l'annulation est elle-même
 * une écriture traçable, et l'entrée du journal est consommée.
 * ------------------------------------------------------------------------- */

import { applyOperations } from './state.js';
import { deleteJournal, latestJournal, listJournal } from './journal.js';

export class NothingToUndoError extends Error {
  constructor(message = 'Aucune opération récente à annuler.') {
    super(message);
    this.name = 'NothingToUndoError';
  }
}

/** Annule la dernière opération journalisée. */
export async function undoLastOperation() {
  const entry = await latestJournal();
  if (!entry || !Array.isArray(entry.ops) || entry.ops.length === 0) throw new NothingToUndoError();
  await applyOperations(entry.ops, { type: 'undo', id: entry.id, summary: entry.label }, { journal: false });
  await deleteJournal(entry.id);
  return entry;
}

/** Historique récent des opérations annulables. */
export async function undoableOperations(limit = 10) {
  const entries = await listJournal();
  return entries.slice(0, Math.max(1, limit));
}
