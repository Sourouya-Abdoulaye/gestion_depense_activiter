/* ---------------------------------------------------------------------------
 * Mon Commerce — chiffrement des sauvegardes (L7)
 *
 * Une sauvegarde chiffrée reste un simple fichier JSON, mais son contenu est
 * illisible sans le mot de passe :
 *   { application, encrypted: true, format: 'mon-commerce-chiffre', ...,
 *     kdf: 'PBKDF2-SHA256', iterations, salt, iv, ciphertext }
 *
 * AES-GCM 256 bits + PBKDF2-SHA256. Aucune clé n'est stockée : un mot de passe
 * perdu rend le fichier définitivement illisible (c'est le principe).
 * Module sans DOM : testable sous Node 20 (globalThis.crypto.subtle).
 * ------------------------------------------------------------------------- */

import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from '../config/constants.js';

export const ENCRYPTED_FORMAT = 'mon-commerce-chiffre';
export const KDF_NAME = 'PBKDF2-SHA256';
export const KDF_ITERATIONS = 210000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

function requireWebCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error(
      'Le chiffrement n’est pas disponible dans ce navigateur. Utilisez un navigateur récent, en HTTPS, ou exportez une sauvegarde non chiffrée.',
    );
  }
  return crypto;
}

/** Base64 portable (navigateur et Node). */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(view).toString('base64');
  throw new Error('Encodage base64 indisponible.');
}

export function base64ToBytes(text) {
  const value = String(text || '');
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  throw new Error('Décodage base64 indisponible.');
}

/** Dérive une clé AES-GCM 256 bits depuis un mot de passe et un sel. */
export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const crypto = requireWebCrypto();
  if (typeof password !== 'string' || password.length === 0) throw new Error('Mot de passe requis.');
  const saltBytes = salt instanceof Uint8Array ? salt : base64ToBytes(salt);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: Math.max(10000, Number(iterations) || KDF_ITERATIONS), hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Le contenu ressemble-t-il à une sauvegarde chiffrée ? */
export function isEncryptedBackup(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload.encrypted === true || payload.format === ENCRYPTED_FORMAT) &&
      typeof payload.ciphertext === 'string' &&
      payload.ciphertext.length > 0,
  );
}

/**
 * Chiffre un objet de sauvegarde.
 * @param {object} payload sauvegarde complète (buildBackup)
 * @param {string} password mot de passe choisi par l'utilisateur
 * @returns {Promise<object>} enveloppe chiffrée prête à être écrite en JSON
 */
export async function encryptBackup(payload, password) {
  const crypto = requireWebCrypto();
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    application: APP_NAME,
    format: ENCRYPTED_FORMAT,
    encrypted: true,
    version: 1,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: payload && payload.exportedAt ? payload.exportedAt : new Date().toISOString(),
    kdf: KDF_NAME,
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    hint: 'Mot de passe requis pour restaurer cette sauvegarde. Il n’est pas enregistré dans le fichier.',
  };
}

/**
 * Déchiffre une enveloppe et renvoie la sauvegarde d'origine.
 * Un mot de passe erroné échoue sans révéler d'information sur le contenu.
 */
export async function decryptBackup(envelope, password) {
  if (!isEncryptedBackup(envelope)) throw new Error('Ce fichier n’est pas une sauvegarde chiffrée Mon Commerce.');
  const crypto = requireWebCrypto();
  if (typeof password !== 'string' || password.length === 0) throw new Error('Saisissez le mot de passe de cette sauvegarde.');
  let key;
  try {
    key = await deriveKey(password, envelope.salt, envelope.iterations);
  } catch {
    throw new Error('Le fichier chiffré est endommagé : le sel ou les paramètres sont invalides.');
  }
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.ciphertext),
    );
  } catch {
    throw new Error('Mot de passe incorrect ou fichier altéré : impossible de déchiffrer la sauvegarde.');
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Le contenu déchiffré n’est pas un JSON valide.');
  }
  return parsed;
}

/** Force minimale d'un mot de passe de sauvegarde (message d'aide). */
export function passwordStrength(password) {
  const value = String(password || '');
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort', 'Très fort'];
  return { score, label: labels[Math.min(score, labels.length - 1)] };
}
