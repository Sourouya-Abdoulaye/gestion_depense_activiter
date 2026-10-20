/* ---------------------------------------------------------------------------
 * Mon Commerce — environnement d'exécution
 *
 * Détections côté navigateur, sans dépendance : mode d'affichage (PWA
 * installée), stockage persistant, risque de stockage éphémère (navigation
 * privée) et fraîcheur de la dernière sauvegarde. Ces fonctions sont pures ou
 * tolérantes à l'absence d'API : elles ne lèvent jamais d'exception.
 * ------------------------------------------------------------------------- */

import { APP_NAME } from '../config/constants.js';
import { daysBetween, nowStamp, todayISO } from '../shared/dates.js';

/** Taille en dessous de laquelle le quota est considéré comme suspect. */
export const EPHEMERAL_QUOTA_BYTES = 120 * 1024 * 1024;

/** L'application tourne-t-elle comme application installée (PWA / écran d'accueil) ? */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* API absente : on poursuit avec les autres indices */
  }
  return Boolean(window.navigator && window.navigator.standalone);
}

/** Appareil iOS / iPadOS (y compris iPad récent qui se présente comme macOS). */
export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;
}

/**
 * Indice de stockage éphémère (navigation privée, stockage très contraint).
 * Heuristique documentée : un quota inférieur à 120 Mo ou un quota inconnu
 * avec IndexedDB indisponible. Ce n'est pas une certitude, d'où le libellé
 * « probable » affiché à l'utilisateur.
 */
export function looksEphemeral({ quota = 0, persisted = false } = {}) {
  if (persisted) return false;
  if (!Number.isFinite(quota) || quota <= 0) return false;
  return quota < EPHEMERAL_QUOTA_BYTES;
}

/**
 * Rassemble l'état du stockage du navigateur.
 * @returns {Promise<{supported: boolean, persisted: boolean, persistedSupported: boolean, quota: number, usage: number, ephemeral: boolean, standalone: boolean, ios: boolean}>}
 */
export async function getEnvironmentStatus() {
  const result = {
    supported: false,
    persisted: false,
    persistedSupported: false,
    quota: 0,
    usage: 0,
    ephemeral: false,
    standalone: isStandalone(),
    ios: isIosDevice(),
  };
  if (typeof navigator === 'undefined' || !navigator.storage) return result;

  const storage = navigator.storage;
  result.persistedSupported = typeof storage.persist === 'function';
  try {
    if (typeof storage.estimate === 'function') {
      const estimate = await storage.estimate();
      result.supported = true;
      result.usage = Number(estimate.usage || 0);
      result.quota = Number(estimate.quota || 0);
    }
  } catch {
    result.supported = false;
  }
  try {
    if (typeof storage.persisted === 'function') result.persisted = Boolean(await storage.persisted());
  } catch {
    result.persisted = false;
  }
  result.ephemeral = looksEphemeral({ quota: result.quota, persisted: result.persisted });
  return result;
}

/** Demande le stockage persistant (best effort, réponse du navigateur). */
export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') return false;
  try {
    if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/* ------------------------------- sauvegardes ----------------------------- */

export const DEFAULT_BACKUP_REMINDER_DAYS = 7;

/**
 * Âge et échéance de la dernière sauvegarde.
 * @param {object} settings paramètres applicatifs
 * @param {Date} reference date de référence (tests)
 * @returns {{never: boolean, daysSince: number, dueIn: number, due: boolean, reminderDays: number, lastBackupAt: string}}
 */
export function backupStatus(settings = {}, reference = new Date()) {
  const reminderDays = Number(settings.backupReminderDays);
  const threshold = Number.isFinite(reminderDays) && reminderDays >= 0 ? reminderDays : DEFAULT_BACKUP_REMINDER_DAYS;
  const lastBackupAt = settings.lastBackupAt || '';
  if (!lastBackupAt) {
    return { never: true, daysSince: null, dueIn: 0, due: threshold > 0, reminderDays: threshold, lastBackupAt };
  }
  const referenceDay = todayISO(reference);
  const lastDay = todayISO(lastBackupAt);
  const daysSince = Math.max(0, daysBetween(lastDay, referenceDay));
  const dueIn = Math.max(0, threshold - daysSince);
  return {
    never: false,
    daysSince,
    dueIn,
    due: threshold > 0 && daysSince >= threshold,
    reminderDays: threshold,
    lastBackupAt,
  };
}

/** Texte court et lisible sur l'état de la sauvegarde. */
export function describeBackupStatus(settings = {}, reference = new Date()) {
  const status = backupStatus(settings, reference);
  if (status.never) return 'Aucune sauvegarde exportée pour le moment.';
  if (status.daysSince === 0) return 'Dernière sauvegarde exportée aujourd’hui.';
  if (status.daysSince === 1) return 'Dernière sauvegarde exportée hier.';
  return `Dernière sauvegarde exportée il y a ${status.daysSince} jours.`;
}

/** Message de rappel prêt à afficher (ou chaîne vide si aucune échéance). */
export function backupReminderMessage(settings = {}, reference = new Date()) {
  const status = backupStatus(settings, reference);
  if (!status.due) return '';
  if (status.never) return `Aucune sauvegarde n’a encore été exportée. Vos données n’existent que dans ce navigateur.`;
  return `Votre dernière sauvegarde date de ${status.daysSince} jours. Exportez-en une nouvelle pour éviter toute perte.`;
}

/** Horodatage de report du rappel (bouton « plus tard »). */
export function snoozeBackupReminder(days = 1, reference = new Date()) {
  const until = new Date(reference.getTime());
  until.setDate(until.getDate() + Math.max(1, Number(days) || 1));
  return { backupSnoozedUntil: until.toISOString(), backupSnoozedAt: nowStamp() };
}

/** Le rappel a-t-il été explicitement reporté ? */
export function isBackupReminderSnoozed(settings = {}, reference = new Date()) {
  if (!settings.backupSnoozedUntil) return false;
  const until = new Date(settings.backupSnoozedUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > reference.getTime();
}

/** Résumé utilisable dans le guide et les paramètres. */
export function environmentSummary(status = {}) {
  const lines = [];
  lines.push(status.standalone ? `${APP_NAME} est ouverte comme application installée.` : `${APP_NAME} est ouverte dans un onglet du navigateur.`);
  if (status.ephemeral) lines.push('Le stockage semble temporaire (navigation privée probable) : les données peuvent disparaître à la fermeture.');
  else if (status.persisted) lines.push('Le navigateur a accordé le stockage persistant : il ne doit pas évincer les données automatiquement.');
  else lines.push('Le stockage persistant n’est pas encore accordé : demandez-le dans « Paramètres & sauvegardes ».');
  if (status.quota > 0) lines.push(`Espace estimé : ${(status.usage / 1024 / 1024).toFixed(2)} Mo utilisés sur ${(status.quota / 1024 / 1024).toFixed(0)} Mo.`);
  return lines;
}
