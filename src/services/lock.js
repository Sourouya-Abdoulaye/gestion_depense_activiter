/* ---------------------------------------------------------------------------
 * Mon Commerce — verrouillage local par code PIN (L6)
 *
 * Objectif : empêcher une personne qui emprunte l'appareil d'ouvrir
 * l'application. Le PIN n'est jamais stocké en clair : seul un condensat
 * PBKDF2-SHA256 (sel aléatoire, 210 000 itérations) est conservé dans les
 * paramètres locaux.
 *
 * Limite assumée et documentée : ce verrou protège l'accès à l'interface, pas
 * les fichiers d'IndexedDB pour quelqu'un qui dispose d'un accès technique à
 * l'appareil (voir L7 pour le chiffrement des sauvegardes).
 * ------------------------------------------------------------------------- */

import { bytesToBase64, base64ToBytes } from './crypto.js';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;
export const LOCK_ITERATIONS = 210000;

function webCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error('Le verrouillage nécessite un navigateur récent (WebCrypto indisponible).');
  }
  return crypto;
}

/** Le verrou est-il actif et correctement configuré ? */
export function lockIsEnabled(settings = {}) {
  return Boolean(settings.lockEnabled && settings.lockPinHash && settings.lockPinSalt);
}

/** Valide la forme du PIN (chiffres uniquement, longueur bornée). */
export function validatePin(pin) {
  const value = String(pin || '').trim();
  if (!/^\d+$/.test(value)) return { valid: false, message: 'Le code PIN ne doit contenir que des chiffres.' };
  if (value.length < PIN_MIN_LENGTH) return { valid: false, message: `Le code PIN doit contenir au moins ${PIN_MIN_LENGTH} chiffres.` };
  if (value.length > PIN_MAX_LENGTH) return { valid: false, message: `Le code PIN ne doit pas dépasser ${PIN_MAX_LENGTH} chiffres.` };
  if (/^(\d)\1+$/.test(value)) return { valid: false, message: 'Évitez un code PIN composé du même chiffre répété.' };
  if (['1234', '0000', '1111', '123456', '12345678'].includes(value)) {
    return { valid: false, message: 'Ce code PIN est trop courant : choisissez-en un autre.' };
  }
  return { valid: true, message: '' };
}

/** Condensat du PIN (PBKDF2-SHA256, sel fourni ou aléatoire). */
export async function hashPin(pin, salt, iterations = LOCK_ITERATIONS) {
  const crypto = webCrypto();
  const saltBytes = salt ? (salt instanceof Uint8Array ? salt : base64ToBytes(salt)) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: Math.max(10000, Number(iterations) || LOCK_ITERATIONS), hash: 'SHA-256' },
    material,
    256,
  );
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(saltBytes) };
}

/** Prépare les paramètres à enregistrer pour un nouveau PIN. */
export async function createLockSettings(pin) {
  const validation = validatePin(pin);
  if (!validation.valid) throw new Error(validation.message);
  const { hash, salt } = await hashPin(pin);
  return {
    lockEnabled: true,
    lockPinHash: hash,
    lockPinSalt: salt,
    lockIterations: LOCK_ITERATIONS,
    lockUpdatedAt: new Date().toISOString(),
  };
}

/** Vérifie un PIN saisi contre les paramètres enregistrés. */
export async function verifyPin(pin, settings = {}) {
  if (!lockIsEnabled(settings)) return false;
  const value = String(pin || '').trim();
  if (!/^\d+$/.test(value)) return false;
  try {
    const { hash } = await hashPin(value, settings.lockPinSalt, settings.lockIterations || LOCK_ITERATIONS);
    return timingSafeEqual(hash, settings.lockPinHash);
  } catch {
    return false;
  }
}

/** Comparaison à durée constante (évite une fuite par mesure de temps). */
export function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

/** Délai d'inactivité avant reverrouillage automatique (0 = jamais). */
export function lockTimeoutMs(settings = {}) {
  const minutes = Number(settings.lockTimeoutMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(minutes, 240) * 60 * 1000;
}

/** Texte d'aide affiché dans les paramètres. */
export function lockSummary(settings = {}) {
  if (!lockIsEnabled(settings)) return 'Verrouillage désactivé : l’application s’ouvre directement.';
  const minutes = Number(settings.lockTimeoutMinutes) || 0;
  return minutes > 0
    ? `Verrouillage activé : code demandé à l’ouverture et après ${minutes} min d’inactivité.`
    : 'Verrouillage activé : code demandé à chaque ouverture de l’application.';
}
