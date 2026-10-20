/* ---------------------------------------------------------------------------
 * Tests du chiffrement des sauvegardes et du verrouillage local.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  passwordStrength,
} from '../src/services/crypto.js';
import {
  createLockSettings,
  hashPin,
  lockIsEnabled,
  lockSummary,
  lockTimeoutMs,
  validatePin,
  verifyPin,
} from '../src/services/lock.js';
import { buildBackup } from '../src/services/backup.js';
import { createWorld } from './helpers.js';

const FAST = { iterations: 10000 };

test('un aller-retour chiffré restitue exactement la sauvegarde', async () => {
  const { world } = createWorld({ capital: 40000 });
  const payload = buildBackup(world);
  const envelope = await encryptBackup(payload, 'mot-de-passe-solide');

  assert.equal(envelope.encrypted, true);
  assert.equal(envelope.format, 'mon-commerce-chiffre');
  assert.ok(isEncryptedBackup(envelope));
  assert.equal(JSON.stringify(envelope).includes('capital_in'), false);

  const decrypted = await decryptBackup(envelope, 'mot-de-passe-solide');
  assert.equal(decrypted.application, payload.application);
  assert.deepEqual(decrypted.data.activities, payload.data.activities);
});

test('un mauvais mot de passe échoue avec un message clair', async () => {
  const { world } = createWorld({ capital: 1000 });
  const envelope = await encryptBackup(buildBackup(world), 'bon-mot-de-passe');
  await assert.rejects(() => decryptBackup(envelope, 'mauvais-mot-de-passe'), /Mot de passe incorrect/);
  await assert.rejects(() => decryptBackup(envelope, ''), /Saisissez le mot de passe/);
});

test('un mot de passe trop court est refusé à l’export', async () => {
  const { world } = createWorld();
  await assert.rejects(() => encryptBackup(buildBackup(world), 'court'), /au moins 8 caractères/);
});

test('le condensat du PIN n’est jamais le PIN et change avec le sel', async () => {
  const first = await hashPin('246813', undefined, FAST.iterations);
  const second = await hashPin('246813', undefined, FAST.iterations);
  assert.notEqual(first.hash, '246813');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test('le verrouillage vérifie le bon code et refuse les autres', async () => {
  const settings = await createLockSettings('246813');
  assert.equal(lockIsEnabled(settings), true);
  assert.equal(await verifyPin('246813', settings), true);
  assert.equal(await verifyPin('246814', settings), false);
  assert.equal(await verifyPin('', settings), false);
  assert.equal(await verifyPin('246813', {}), false);
});

test('la politique de PIN refuse les codes faibles', () => {
  assert.equal(validatePin('1234').valid, false);
  assert.equal(validatePin('1111').valid, false);
  assert.equal(validatePin('abc123').valid, false);
  assert.equal(validatePin('123').valid, false);
  assert.equal(validatePin('246813').valid, true);
});

test('les paramètres de verrouillage produisent un résumé lisible', () => {
  assert.match(lockSummary({}), /désactivé/);
  assert.match(lockSummary({ lockEnabled: true, lockPinHash: 'x', lockPinSalt: 'y', lockTimeoutMinutes: 5 }), /5 min/);
  assert.equal(lockTimeoutMs({ lockTimeoutMinutes: 5 }), 5 * 60 * 1000);
  assert.equal(lockTimeoutMs({ lockTimeoutMinutes: 0 }), 0);
  assert.equal(lockTimeoutMs({ lockTimeoutMinutes: 999 }), 240 * 60 * 1000);
});

test('la force du mot de passe est classée', () => {
  assert.equal(passwordStrength('abc').label, 'Très faible');
  assert.ok(['Bon', 'Fort', 'Très fort'].includes(passwordStrength('MotDePasse2026!').label));
});
