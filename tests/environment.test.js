/* ---------------------------------------------------------------------------
 * Tests de l'environnement et des rappels de sauvegarde (L2, L5, L19).
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backupReminderMessage,
  backupStatus,
  describeBackupStatus,
  isBackupReminderSnoozed,
  looksEphemeral,
  snoozeBackupReminder,
} from '../src/services/environment.js';
import { diffBackup, mergeBackup } from '../src/services/backup.js';

const REFERENCE = new Date('2026-10-20T12:00:00.000Z');

/* ------------------------------- sauvegardes ----------------------------- */

test('une sauvegarde jamais exportée est toujours due', () => {
  const status = backupStatus({ lastBackupAt: '' }, REFERENCE);
  assert.equal(status.never, true);
  assert.equal(status.due, true);
  assert.match(backupReminderMessage({ lastBackupAt: '' }, REFERENCE), /Aucune sauvegarde/);
});

test('le rappel respecte la fréquence choisie', () => {
  const settings = { lastBackupAt: '2026-10-15T08:00:00.000Z', backupReminderDays: 7 };
  const status = backupStatus(settings, REFERENCE);
  assert.equal(status.daysSince, 5);
  assert.equal(status.dueIn, 2);
  assert.equal(status.due, false);
  assert.match(describeBackupStatus(settings, REFERENCE), /il y a 5 jours/);
});

test('un rappel échu produit un message et peut être reporté', () => {
  const settings = { lastBackupAt: '2026-10-01T08:00:00.000Z', backupReminderDays: 7 };
  assert.equal(backupStatus(settings, REFERENCE).due, true);
  assert.match(backupReminderMessage(settings, REFERENCE), /19 jours/);

  const snoozed = { ...settings, ...snoozeBackupReminder(1, REFERENCE) };
  assert.equal(isBackupReminderSnoozed(snoozed, REFERENCE), true);
  assert.equal(isBackupReminderSnoozed(snoozed, new Date('2026-10-22T12:00:00.000Z')), false);
});

test('une fréquence à zéro désactive le rappel', () => {
  const status = backupStatus({ lastBackupAt: '', backupReminderDays: 0 }, REFERENCE);
  assert.equal(status.due, false);
  assert.equal(backupReminderMessage({ lastBackupAt: '', backupReminderDays: 0 }, REFERENCE), '');
});

/* ------------------------------- environnement --------------------------- */

test('le stockage est jugé éphémère sous 120 Mo sans persistance', () => {
  assert.equal(looksEphemeral({ quota: 50 * 1024 * 1024 }), true);
  assert.equal(looksEphemeral({ quota: 2 * 1024 * 1024 * 1024 }), false);
  assert.equal(looksEphemeral({ quota: 0 }), false);
  assert.equal(looksEphemeral({ quota: 50 * 1024 * 1024, persisted: true }), false);
});

/* --------------------------------- fusion -------------------------------- */

function record(id, name, updatedAt) {
  return { id, name, updatedAt };
}

test('la fusion ignore une version plus ancienne que celle déjà présente', () => {
  const current = { products: [record('prd_1', 'Récent', '2026-10-20T10:00:00.000Z')] };
  const incoming = { products: [record('prd_1', 'Ancien', '2026-10-01T10:00:00.000Z')] };
  const { data, stats } = mergeBackup(current, incoming);
  assert.equal(data.products[0].name, 'Récent');
  assert.equal(stats.ignored, 1);
  assert.equal(stats.updated, 0);
});

test('la fusion applique une version plus récente et compte les identiques', () => {
  const current = {
    products: [record('prd_1', 'Ancien', '2026-10-01T10:00:00.000Z'), record('prd_2', 'Stable', '2026-10-01T10:00:00.000Z')],
  };
  const incoming = {
    products: [record('prd_1', 'Récent', '2026-10-20T10:00:00.000Z'), record('prd_2', 'Stable', '2026-10-01T10:00:00.000Z')],
  };
  const { data, stats } = mergeBackup(current, incoming);
  assert.equal(data.products.find((entry) => entry.id === 'prd_1').name, 'Récent');
  assert.equal(stats.updated, 1);
  assert.equal(stats.identical, 1);
  assert.equal(stats.ignored, 0);
});

test('l’aperçu d’import détaille ajouts, mises à jour, identiques et plus anciens', () => {
  const current = {
    products: [
      record('prd_1', 'À mettre à jour', '2026-10-01T10:00:00.000Z'),
      record('prd_2', 'Identique', '2026-10-01T10:00:00.000Z'),
      record('prd_3', 'Plus récent ici', '2026-10-20T10:00:00.000Z'),
    ],
    sales: [{ id: 'vte_old' }],
  };
  const incoming = {
    products: [
      record('prd_1', 'Nouveau nom', '2026-10-10T10:00:00.000Z'),
      record('prd_2', 'Identique', '2026-10-01T10:00:00.000Z'),
      record('prd_3', 'Ancien', '2026-10-01T10:00:00.000Z'),
      record('prd_4', 'Ajout', '2026-10-10T10:00:00.000Z'),
    ],
    sales: [],
  };
  const diff = diffBackup(current, incoming);
  assert.equal(diff.totals.added, 1);
  assert.equal(diff.totals.updated, 1);
  assert.equal(diff.totals.identical, 1);
  assert.equal(diff.totals.older, 1);
  assert.equal(diff.collections.products.total, 4);
  assert.equal(diff.deletesOnReplace, 1);
});
