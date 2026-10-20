/* ---------------------------------------------------------------------------
 * Mon Commerce — formatage
 * Centralise l'affichage des montants, quantités, pourcentages et dates.
 * Aucune dépendance au DOM : utilisable dans les services et les tests.
 * ------------------------------------------------------------------------- */

import { CURRENCY_SYMBOL, LOCALE, MONEY_DECIMALS } from '../config/constants.js';
import { formatDate as formatDateValue, formatStamp } from './dates.js';

const groupFormatter = (decimals) =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });

/**
 * Décimales d'affichage configurées dans les paramètres (L15).
 * `null` conserve l'affichage automatique historique (entier sans centimes,
 * décimales sinon). Les calculs ne sont jamais arrondis par ce réglage.
 */
let displayDecimals = null;

export function setMoneyDecimals(value) {
  const number = Number(value);
  displayDecimals = Number.isFinite(number) && number >= 0 && number <= 3 ? Math.trunc(number) : null;
}

export function getMoneyDecimals() {
  return displayDecimals;
}

/**
 * Intl utilise une espace fine insécable comme séparateur de milliers.
 * On la remplace par une espace ordinaire pour obtenir un affichage, un export
 * CSV et un rendu PDF strictement identiques et faciles à comparer.
 */
function normalizeSpaces(text) {
  return text.replace(/[\u202f\u00a0\u2009]/g, ' ');
}

/**
 * Arrondi monétaire documenté : arrondi « au plus proche » à 2 décimales
 * (les demis sont arrondis à l'unité supérieure en valeur absolue).
 * Les coûts unitaires sont conservés en pleine précision en interne et
 * arrondis uniquement au moment de l'affichage ou de l'agrégation finale.
 */
export function roundMoney(value, decimals = MONEY_DECIMALS) {
  const factor = 10 ** decimals;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const scaled = number * factor;
  // La multiplication par (1 + epsilon) corrige les imprécisions binaires
  // (ex. 1.005 stocké comme 1.00499999999999989) sans fausser les autres cas.
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) * (1 + Number.EPSILON));
  return rounded / factor;
}

/** Arrondi de quantité (3 décimales, utile pour kg, litres, mètres). */
export function roundQuantity(value, decimals = 3) {
  return roundMoney(value, decimals);
}

export function toNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}

export function formatNumber(value, decimals = 'auto') {
  const number = Number(value) || 0;
  const places = decimals === 'auto' ? (Number.isInteger(number) ? 0 : MONEY_DECIMALS) : decimals;
  return normalizeSpaces(groupFormatter(places).format(roundMoney(number, places)));
}

/** « 50 000 FCFA », « 1 595,24 FCFA ». */
export function formatMoney(value, options = {}) {
  const { symbol = true, showSign = false } = options;
  const decimals = options.decimals !== undefined ? options.decimals : displayDecimals === null ? 'auto' : displayDecimals;
  const number = Number(value) || 0;
  const sign = showSign && number > 0 ? '+' : '';
  const text = formatNumber(number, decimals);
  return `${sign}${text}${symbol ? ` ${CURRENCY_SYMBOL}` : ''}`;
}

/** Montant sans séparateurs ni symbole, pour les exports CSV. */
export function formatMoneyPlain(value, decimals = MONEY_DECIMALS) {
  const number = Number(value) || 0;
  return roundMoney(number, decimals).toFixed(decimals);
}

export function formatQuantity(value, unit = '') {
  const number = Number(value) || 0;
  const text = normalizeSpaces(new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 }).format(number));
  return unit ? `${text} ${unit}` : text;
}

export function formatPercent(value, decimals = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const text = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(number * 100);
  return `${normalizeSpaces(text)} %`;
}

export function formatUnitCost(value) {
  return formatMoney(roundMoney(value, MONEY_DECIMALS));
}

/** « 12 unités », « 1 unité », « 2,5 kg ». */
export function formatQuantityWithUnit(quantity, unit) {
  return formatQuantity(quantity, unit || '');
}

export function formatDate(iso, pattern) {
  return formatDateValue(iso, pattern);
}

export function formatDateTime(stamp) {
  return formatStamp(stamp);
}

/** Échappement HTML pour toute donnée utilisateur insérée dans un gabarit. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tronque proprement un libellé long pour les tableaux compacts. */
export function truncate(value, max = 40) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Libellé libellé/pluriel simple. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return Number(count) > 1 ? pluralForm : singular;
}
