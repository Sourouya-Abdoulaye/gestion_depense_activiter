/* ---------------------------------------------------------------------------
 * Mon Commerce — sauvegarde et restauration (logique pure)
 *
 * Une sauvegarde est un fichier JSON lisible, versionné et vérifiable :
 *   { application, appVersion, schemaVersion, exportedAt, counts, data }
 *
 * Sécurité : un import est un document de DONNÉES, jamais du code. Il est
 * analysé, validé, normalisé, puis présenté à l'utilisateur avant toute
 * écriture. Aucun contenu importé n'est évalué ni exécuté.
 * ------------------------------------------------------------------------- */

import { APP_NAME, APP_VERSION, SCHEMA_VERSION, CURRENCY_CODE } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { toNumber } from '../shared/format.js';

/** Collections métier de l'application (identique aux magasins IndexedDB). */
export const COLLECTIONS = [
  'activities',
  'products',
  'customers',
  'suppliers',
  'purchases',
  'sales',
  'returns',
  'expenses',
  'payments',
  'stockMovements',
  'cashAccounts',
  'cashMovements',
];

export const EXPORT_FILE_PREFIX = 'mon-commerce-sauvegarde';

/** Nom de fichier daté et trié naturellement : mon-commerce-sauvegarde-2026-10-18.json */
export function buildBackupFilename(reference = new Date()) {
  return `${EXPORT_FILE_PREFIX}-${toISODate(reference)}.json`;
}

/**
 * Construit l'objet de sauvegarde complet.
 * @param {object} data état de l'application (collections + settings)
 * @param {{reference?: Date, appVersion?: string}} options
 */
export function buildBackup(data = {}, { reference = new Date(), appVersion = APP_VERSION } = {}) {
  const payload = {
    application: APP_NAME,
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: reference.toISOString(),
    currency: CURRENCY_CODE,
    counts: {},
    data: {},
  };

  for (const collection of COLLECTIONS) {
    const records = Array.isArray(data[collection]) ? data[collection] : [];
    payload.data[collection] = records.map((record) => ({ ...record }));
    payload.counts[collection] = records.length;
  }
  payload.data.settings = { ...(data.settings || {}) };
  payload.counts.settings = payload.data.settings && payload.data.settings.id ? 1 : 0;

  return payload;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valide un contenu importé.
 * @returns {{valid: boolean, errors: string[], warnings: string[], preview: object, normalized: object|null}}
 */
export function validateBackup(payload) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(payload)) {
    return {
      valid: false,
      errors: ['Le fichier ne contient pas un objet JSON de sauvegarde Mon Commerce.'],
      warnings,
      preview: null,
      normalized: null,
    };
  }
  if (!isPlainObject(payload.data)) {
    errors.push('Le fichier ne contient aucune section « data » exploitable.');
  }
  if (payload.application && payload.application !== APP_NAME) {
    warnings.push(`Ce fichier a été produit par « ${payload.application} » et non par ${APP_NAME}. Vérifiez son contenu avant de continuer.`);
  }

  const schemaVersion = toNumber(payload.schemaVersion, 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    errors.push('La version de schéma est absente ou invalide.');
  } else if (schemaVersion > SCHEMA_VERSION) {
    errors.push(
      `Cette sauvegarde utilise un schéma plus récent (v${schemaVersion}) que cette version de l'application (v${SCHEMA_VERSION}). Mettez l'application à jour.`,
    );
  } else if (schemaVersion < SCHEMA_VERSION) {
    warnings.push(`La sauvegarde provient d'un schéma plus ancien (v${schemaVersion}) : elle sera migrée à l'import.`);
  }

  const normalized = {
    application: payload.application || APP_NAME,
    appVersion: payload.appVersion || 'inconnue',
    schemaVersion,
    exportedAt: payload.exportedAt || '',
    data: {},
    counts: {},
  };

  const preview = {
    appVersion: normalized.appVersion,
    schemaVersion,
    exportedAt: payload.exportedAt || '',
    counts: {},
    activities: [],
    dateRange: { from: '', to: '' },
    duplicates: {},
  };

  const source = isPlainObject(payload.data) ? payload.data : {};
  for (const collection of COLLECTIONS) {
    const raw = source[collection];
    if (raw === undefined) {
      normalized.data[collection] = [];
      preview.counts[collection] = 0;
      warnings.push(`La section « ${collection} » est absente du fichier : elle sera importée vide.`);
      continue;
    }
    if (!Array.isArray(raw)) {
      errors.push(`La section « ${collection} » doit être une liste d'enregistrements.`);
      normalized.data[collection] = [];
      preview.counts[collection] = 0;
      continue;
    }
    const kept = [];
    let rejected = 0;
    for (const record of raw) {
      if (!isPlainObject(record) || !record.id) {
        rejected += 1;
        continue;
      }
      kept.push(record);
      const date = toISODate(record.date);
      if (date) {
        if (!preview.dateRange.from || date < preview.dateRange.from) preview.dateRange.from = date;
        if (!preview.dateRange.to || date > preview.dateRange.to) preview.dateRange.to = date;
      }
    }
    if (rejected > 0) {
      warnings.push(`${rejected} enregistrement(s) invalide(s) ignoré(s) dans « ${collection} ».`);
    }
    normalized.data[collection] = kept;
    preview.counts[collection] = kept.length;
  }

  const settings = isPlainObject(source.settings) ? source.settings : null;
  normalized.data.settings = settings ? { ...settings, id: settings.id || 'app' } : null;
  preview.counts.settings = normalized.data.settings ? 1 : 0;

  if (normalized.data.activities.length > 0) {
    preview.activities = normalized.data.activities.map((activity) => ({
      id: activity.id,
      name: activity.name || '(sans nom)',
      status: activity.status || 'active',
    }));
  }

  if (errors.length === 0 && COLLECTIONS.every((collection) => normalized.data[collection].length === 0) && !normalized.data.settings) {
    errors.push('La sauvegarde ne contient aucune donnée à restaurer.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    preview,
    normalized: errors.length === 0 ? normalized : null,
  };
}

/**
 * Fusion contrôlée : les enregistrements de la sauvegarde complètent et
 * remplacent, par identifiant, les enregistrements existants. Rien n'est
 * supprimé et les réponses aux identifiants inconnus sont conservées.
 */
export function mergeBackup(current = {}, incoming = {}) {
  const result = {};
  const stats = { added: 0, updated: 0, kept: 0 };
  for (const collection of COLLECTIONS) {
    const existing = new Map((current[collection] || []).map((record) => [record.id, record]));
    const merged = [...(current[collection] || [])];
    let added = 0;
    let updated = 0;
    for (const record of incoming[collection] || []) {
      if (existing.has(record.id)) {
        const index = merged.findIndex((entry) => entry.id === record.id);
        merged[index] = { ...merged[index], ...record };
        updated += 1;
      } else {
        merged.push({ ...record });
        existing.set(record.id, record);
        added += 1;
      }
    }
    result[collection] = merged;
    stats.added += added;
    stats.updated += updated;
    stats.kept += (current[collection] || []).length;
  }
  result.settings = incoming.settings ? { ...(current.settings || {}), ...incoming.settings } : current.settings || null;
  return { data: result, stats };
}

/** Remplacement explicite : les données importées remplacent tout le reste. */
export function replaceBackup(current = {}, incoming = {}) {
  const result = {};
  let total = 0;
  for (const collection of COLLECTIONS) {
    result[collection] = [...(incoming[collection] || [])];
    total += result[collection].length;
  }
  result.settings = incoming.settings || current.settings || null;
  return { data: result, stats: { added: total, updated: 0, kept: 0, replaced: true } };
}

/** Résumé lisible d'une sauvegarde (utilisé par l'écran de paramètres). */
export function summarizeBackup(payload) {
  const validation = validateBackup(payload);
  return {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    preview: validation.preview,
  };
}
