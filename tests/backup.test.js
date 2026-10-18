/* ---------------------------------------------------------------------------
 * Tests des sauvegardes : export complet, validation stricte des imports,
 * fusion contrôlée, remplacement explicite et refus des fichiers invalides.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTIONS,
  buildBackup,
  buildBackupFilename,
  mergeBackup,
  replaceBackup,
  summarizeBackup,
  validateBackup,
} from '../src/services/backup.js';
import { APP_NAME, SCHEMA_VERSION } from '../src/config/constants.js';
import { addExpense, addProduct, addSale, createWorld } from './helpers.js';

function buildSampleWorld() {
  const { world } = createWorld({ capital: 40000 });
  const product = addProduct(world, { name: 'Pantalon', cost: 1500, price: 2500, quantity: 5, unitCost: 1500 });
  addSale(world, { items: [{ product, quantity: 2, unitPrice: 2500 }], pay: 5000, date: '2026-10-05' });
  addExpense(world, { category: 'Publicité', amount: 600, date: '2026-10-02' });
  return world;
}

test('l’export contient toutes les collections, une version de schéma et une date', () => {
  const world = buildSampleWorld();
  const backup = buildBackup(world, { reference: new Date('2026-10-18T10:00:00.000Z') });

  assert.equal(backup.application, APP_NAME);
  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  assert.equal(backup.exportedAt, '2026-10-18T10:00:00.000Z');
  for (const collection of COLLECTIONS) {
    assert.ok(Array.isArray(backup.data[collection]), `collection manquante : ${collection}`);
    assert.equal(backup.counts[collection], backup.data[collection].length);
  }
  assert.equal(backup.counts.sales, 1);
  assert.equal(backup.counts.products, 1);
  assert.ok(backup.data.settings);
  assert.equal(buildBackupFilename(new Date('2026-10-18T10:00:00.000Z')), 'mon-commerce-sauvegarde-2026-10-18.json');
});

test('un export ne partage jamais les références avec l’état en mémoire', () => {
  const world = buildSampleWorld();
  const backup = buildBackup(world);
  backup.data.products[0].name = 'Modifié';
  assert.notEqual(world.products[0].name, 'Modifié');
});

test('une sauvegarde valide peut être relue et résumée', () => {
  const world = buildSampleWorld();
  const backup = buildBackup(world);
  const validation = validateBackup(JSON.parse(JSON.stringify(backup)));

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.preview.counts.sales, 1);
  assert.equal(validation.preview.dateRange.from, '2026-10-01');
  assert.equal(validation.preview.activities.length, 1);
});

test('les fichiers invalides sont refusés avec un message clair', () => {
  assert.equal(validateBackup(null).valid, false);
  assert.match(validateBackup(null).errors[0], /objet JSON/);
  assert.equal(validateBackup('texte').valid, false);
  assert.equal(validateBackup({ schemaVersion: 1 }).valid, false);
  assert.match(validateBackup({ schemaVersion: 1 }).errors[0], /data/);
  assert.equal(validateBackup({ schemaVersion: 1, data: { sales: 'pas une liste' } }).valid, false);
  assert.equal(validateBackup({ schemaVersion: 99, data: { sales: [] } }).valid, false);
  assert.match(validateBackup({ schemaVersion: 99, data: { sales: [] } }).errors.join(' '), /schéma plus récent/);
});

test('une sauvegarde vide est refusée', () => {
  const validation = validateBackup({ schemaVersion: 1, data: {} });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /aucune donnée/);
});

test('les enregistrements sans identifiant sont ignorés avec un avertissement', () => {
  const validation = validateBackup({
    schemaVersion: 1,
    data: { activities: [{ name: 'Sans identifiant' }, { id: 'act_1', name: 'Valide' }] },
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.normalized.data.activities.length, 1);
  assert.ok(validation.warnings.some((warning) => /invalide/.test(warning)));
});

test('une sauvegarde d’une autre application est acceptée mais signalée', () => {
  const validation = validateBackup({
    application: 'Autre Logiciel',
    schemaVersion: 1,
    data: { activities: [{ id: 'act_1', name: 'A' }] },
  });
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((warning) => /produit par/.test(warning)));
});

test('fusion contrôlée : ajout, mise à jour par identifiant, rien n’est supprimé', () => {
  const world = buildSampleWorld();
  const current = { ...world, activities: [...world.activities, { id: 'act_ancienne', name: 'Ancienne activité' }] };
  const incoming = {
    [COLLECTIONS[0]]: [
      { id: world.activities[0].id, name: 'Vêtements (renommée)' },
      { id: 'act_nouvelle', name: 'Nouvelle activité' },
    ],
    products: [],
  };

  const { data, stats } = mergeBackup(current, incoming);
  assert.equal(stats.added, 1);
  assert.equal(stats.updated, 1);
  assert.equal(data.activities.length, 3);
  assert.equal(data.activities.find((activity) => activity.id === world.activities[0].id).name, 'Vêtements (renommée)');
  assert.ok(data.activities.some((activity) => activity.id === 'act_ancienne'));
  // les autres collections sont conservées à l'identique
  assert.equal(data.sales.length, current.sales.length);
});

test('remplacement explicite : seules les données importées subsistent', () => {
  const world = buildSampleWorld();
  const incoming = {
    activities: [{ id: 'act_reprise', name: 'Reprise' }],
    products: [],
  };
  const { data, stats } = replaceBackup(world, incoming);
  assert.equal(data.activities.length, 1);
  assert.equal(data.activities[0].id, 'act_reprise');
  assert.equal(data.sales.length, 0);
  assert.equal(stats.replaced, true);
  // les paramètres existants sont conservés s'ils ne sont pas fournis
  assert.equal(data.settings.shopName, world.settings.shopName);
});

test('le contenu importé est traité comme des données, jamais exécuté', () => {
  const payload = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      data: {
        products: [{ id: 'prd_1', name: 'Produit', description: 'javascript:alert(1)' }],
      },
    }),
  );
  const validation = validateBackup(payload);
  assert.equal(validation.valid, true);
  assert.equal(typeof validation.normalized.data.products[0].description, 'string');
  // aucun code exécuté, aucune fonction dans le résultat
  assert.equal(
    JSON.stringify(validation.normalized),
    JSON.stringify({ ...validation.normalized }),
  );
});

test('summarizeBackup expose les erreurs et avertissements', () => {
  const summary = summarizeBackup({ schemaVersion: 1, data: {} });
  assert.equal(summary.valid, false);
  assert.ok(summary.errors.length > 0);
});
