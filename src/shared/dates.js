/* ---------------------------------------------------------------------------
 * Mon Commerce — dates
 * Convention : les dates métier sont stockées sous forme normalisée « ISO
 * courte » (YYYY-MM-DD, heure locale, sans fuseau) ; les horodatages techniques
 * (createdAt, exportedAt) sont stockés en ISO 8601 complet.
 * ------------------------------------------------------------------------- */

import { DATE_FORMATS } from '../config/constants.js';

const pad = (value) => String(value).padStart(2, '0');

/** Date du jour au format YYYY-MM-DD (heure locale). */
export function todayISO(reference = new Date()) {
  return toISODate(reference);
}

/** Vérifie qu'une chaîne est une date ISO courte correspondant à un jour réel. */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Convertit une Date ou une chaîne en YYYY-MM-DD (heure locale). */
export function toISODate(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const short = value.slice(0, 10);
    if (isValidISODate(short)) return short;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : formatISOFromDate(parsed);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : formatISOFromDate(value);
  }
  return '';
}

function formatISOFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date locale à minuit pour une date ISO courte. */
export function parseISODate(iso) {
  if (!iso) return null;
  const short = toISODate(iso);
  if (!short) return null;
  const [year, month, day] = short.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Horodatage technique complet (ISO 8601, UTC). */
export function nowStamp() {
  return new Date().toISOString();
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  if (!date) return '';
  date.setDate(date.getDate() + days);
  return formatISOFromDate(date);
}

export function addMonths(iso, months) {
  const date = parseISODate(iso);
  if (!date) return '';
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return formatISOFromDate(date);
}

/** Lundi de la semaine contenant la date (semaine française). */
export function startOfWeek(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  const day = date.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatISOFromDate(date);
}

export function startOfMonth(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

export function endOfMonth(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return formatISOFromDate(last);
}

export function startOfQuarter(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  const month = Math.floor(date.getMonth() / 3) * 3;
  return `${date.getFullYear()}-${pad(month + 1)}-01`;
}

export function endOfQuarter(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  const month = Math.floor(date.getMonth() / 3) * 3 + 3;
  const last = new Date(date.getFullYear(), month, 0);
  return formatISOFromDate(last);
}

export function startOfYear(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  return `${date.getFullYear()}-01-01`;
}

export function endOfYear(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  return `${date.getFullYear()}-12-31`;
}

export const MIN_DATE = '0000-01-01';
export const MAX_DATE = '9999-12-31';

/**
 * Plage de dates d'un filtre de période.
 * @param {string} preset identifiant de période (today, week, month, quarter, year, all, custom)
 * @param {{from?: string, to?: string}} custom
 * @param {Date|string} reference date de référence (utile pour les tests)
 * @returns {{from: string, to: string, preset: string}}
 */
export function periodRange(preset = 'month', custom = {}, reference = new Date()) {
  const ref = toISODate(reference) || todayISO();
  switch (preset) {
    case 'today':
      return { from: ref, to: ref, preset };
    case 'week':
      return { from: startOfWeek(ref), to: addDays(startOfWeek(ref), 6), preset };
    case 'month':
      return { from: startOfMonth(ref), to: endOfMonth(ref), preset };
    case 'quarter':
      return { from: startOfQuarter(ref), to: endOfQuarter(ref), preset };
    case 'year':
      return { from: startOfYear(ref), to: endOfYear(ref), preset };
    case 'all':
      return { from: MIN_DATE, to: MAX_DATE, preset };
    case 'custom':
      return {
        from: custom.from ? toISODate(custom.from) : MIN_DATE,
        to: custom.to ? toISODate(custom.to) : MAX_DATE,
        preset,
      };
    default:
      return { from: startOfMonth(ref), to: endOfMonth(ref), preset: 'month' };
  }
}

/** Une date ISO courte est-elle dans l'intervalle inclusif [from, to] ? */
export function isWithin(iso, from, to) {
  const value = toISODate(iso);
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export function isBefore(a, b) {
  return toISODate(a) < toISODate(b);
}

export function isAfter(a, b) {
  return toISODate(a) > toISODate(b);
}

export function maxDate(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a >= b ? a : b;
}

/** Période précédente de même durée (comparaison N vs N−1, L11). */
export function previousPeriod(period) {
  if (!period || !period.from || !period.to || period.preset === 'all') return null;
  const days = Math.max(1, daysBetween(period.from, period.to) + 1);
  const to = addDays(period.from, -1);
  const from = addDays(to, -(days - 1));
  if (!from || !to) return null;
  return { from, to, preset: 'custom', label: 'Période précédente' };
}

export function minDate(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a <= b ? a : b;
}

/** Nombre de jours entiers entre deux dates ISO courtes (b − a). */
export function daysBetween(from, to) {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/** Formatage lisible : 31/12/2026 par défaut. */
export function formatDate(iso, pattern = 'dd/MM/yyyy') {
  const date = parseISODate(iso);
  if (!date) return '—';
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = String(date.getFullYear());
  const safePattern = DATE_FORMATS.some((f) => f.value === pattern) ? pattern : 'dd/MM/yyyy';
  return safePattern.replace('dd', dd).replace('MM', mm).replace('yyyy', yyyy);
}

/** Mois au format « octobre 2026 ». */
export function formatMonthLabel(iso) {
  const date = parseISODate(iso);
  if (!date) return '—';
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
}

/** Clé de regroupement mensuel : YYYY-MM. */
export function monthKey(iso) {
  const short = toISODate(iso);
  return short ? short.slice(0, 7) : '';
}

/** Liste ordonnée des jours d'un intervalle (bornée pour la performance). */
export function eachDay(from, to, limit = 370) {
  const days = [];
  let cursor = toISODate(from);
  const end = toISODate(to);
  while (cursor && cursor <= end && days.length < limit) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Horodatage lisible : 31/12/2026 à 14:05. */
export function formatStamp(stamp) {
  if (!stamp) return '—';
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return '—';
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${formatDate(toISODate(date))} à ${time}`;
}
