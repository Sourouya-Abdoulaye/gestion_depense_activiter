/* ---------------------------------------------------------------------------
 * Mon Commerce — validateurs
 * Validation générique de formulaires et d'enregistrements importés.
 * Aucune dépendance au DOM : les mêmes règles servent aux tests et à l'UI.
 * ------------------------------------------------------------------------- */

import { isValidISODate } from './dates.js';
import { toNumber } from './format.js';

export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

export function isNonEmptyString(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

export function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

export function isISODate(value) {
  return isValidISODate(value);
}

export function isEmail(value) {
  if (isBlank(value)) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim());
}

export function isPhone(value) {
  if (isBlank(value)) return true;
  return /^[+0-9 ().-]{6,25}$/.test(String(value).trim());
}

/**
 * Schémas de champs réutilisables.
 * type : text | amount | quantity | integer | date | id | select | email | phone
 */
const TYPE_CHECKS = {
  text: (value, field) => {
    if (field.maxLength && String(value).trim().length > field.maxLength) {
      return `Le champ « ${field.label} » ne doit pas dépasser ${field.maxLength} caractères.`;
    }
    return null;
  },
  amount: (value) => {
    if (!isFiniteNumber(value)) return `Le montant saisi n'est pas un nombre valide.`;
    if (value < 0) return `Le montant ne peut pas être négatif.`;
    return null;
  },
  quantity: (value) => {
    if (!isFiniteNumber(value)) return `La quantité n'est pas un nombre valide.`;
    if (value <= 0) return `La quantité doit être supérieure à zéro.`;
    return null;
  },
  integer: (value) => {
    if (!isFiniteNumber(value)) return `La valeur doit être un nombre entier.`;
    if (!Number.isInteger(value)) return `La valeur doit être un nombre entier.`;
    return null;
  },
  date: (value) => (isISODate(value) ? null : `La date est invalide (format attendu : AAAA-MM-JJ).`),
  id: (value) => (isNonEmptyString(value, 120) ? null : `Une référence obligatoire est manquante.`),
  select: (value) => (isNonEmptyString(value, 120) ? null : `Veuillez choisir une valeur.`),
  email: (value) => (isEmail(value) ? null : `L'adresse e-mail est invalide.`),
  phone: (value) => (isPhone(value) ? null : `Le numéro de téléphone est invalide.`),
};

// Les contrôles de type ci-dessus restent volontairement simples et lisibles.

/**
 * Valide un objet de valeurs contre un schéma de champs.
 * @param {Record<string, unknown>} values
 * @param {Record<string, {label?: string, type?: string, required?: boolean, min?: number, max?: number, maxLength?: number}>} schema
 * @returns {{valid: boolean, errors: Record<string, string>}}
 */
export function validate(values, schema) {
  const errors = {};
  for (const [name, field] of Object.entries(schema)) {
    const label = field.label || name;
    const raw = values ? values[name] : undefined;
    const value = field.type === 'amount' || field.type === 'quantity' || field.type === 'integer' ? toNumber(raw, NaN) : raw;

    if (field.required && (isBlank(raw) || (Number.isNaN(value) && field.type !== 'text'))) {
      errors[name] = `Le champ « ${label} » est obligatoire.`;
      continue;
    }
    if (isBlank(raw) && !field.required) continue;

    const type = field.type || 'text';
    const check = TYPE_CHECKS[type];
    if (check) {
      const message = check(value, { ...field, label });
      if (message) {
        errors[name] = message;
        continue;
      }
    }

    if (isFiniteNumber(field.min) && toNumber(raw, 0) < field.min) {
      errors[name] = `« ${label} » doit être supérieur ou égal à ${field.min}.`;
      continue;
    }
    if (isFiniteNumber(field.max) && toNumber(raw, 0) > field.max) {
      errors[name] = `« ${label} » doit être inférieur ou égal à ${field.max}.`;
      continue;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Lève une erreur métier si la validation échoue (utilisé par les services). */
export function assertValid(values, schema, context = 'opération') {
  const { valid, errors } = validate(values, schema);
  if (!valid) {
    const error = new Error(`Données invalides pour ${context} : ${Object.values(errors).join(' ')}`);
    error.name = 'ValidationError';
    error.fields = errors;
    throw error;
  }
}

/** Erreur métier identifiable (règles de gestion, stock insuffisant…). */
export class BusinessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BusinessError';
    this.details = details;
  }
}
