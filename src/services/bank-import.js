/* ---------------------------------------------------------------------------
 * Mon Commerce — import de relevés CSV (L21, sans agrégateur externe)
 *
 * Aucune connexion bancaire : l'utilisateur exporte un relevé CSV depuis sa
 * banque ou son opérateur mobile money, puis le dépose ici. Le fichier est lu
 * localement, jamais envoyé. Les colonnes sont détectées automatiquement mais
 * restent modifiables, et chaque ligne est prévisualisée avant écriture.
 * ------------------------------------------------------------------------- */

import Papa from 'papaparse';
import { toISODate } from '../shared/dates.js';
import { roundMoney } from '../shared/format.js';
import { BusinessError } from '../shared/validators.js';

/** Normalise un intitulé de colonne (sans accents, minuscules). */
export function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Lit un CSV de relevé. Le séparateur est détecté automatiquement (`;`, `,`,
 * tabulation) et les guillemets sont respectés.
 * @returns {{headers: string[], records: object[], errors: string[]}}
 */
export function parseStatementCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (!source.trim()) throw new BusinessError('Le fichier est vide.');
  const result = Papa.parse(source, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => String(header || '').trim(),
  });
  const headers = (result.meta && result.meta.fields ? result.meta.fields : []).filter(Boolean);
  const records = (result.data || []).filter((row) => row && Object.values(row).some((value) => String(value ?? '').trim() !== ''));
  if (headers.length === 0 || records.length === 0) {
    throw new BusinessError('Aucune ligne exploitable : vérifiez que la première ligne contient les noms de colonnes.');
  }
  return {
    headers,
    records,
    errors: (result.errors || []).slice(0, 5).map((error) => error.message),
  };
}

/** Détecte les colonnes usuelles d'un relevé bancaire ou mobile money. */
export function detectColumns(headers = []) {
  const normalized = headers.map((header) => ({ header, key: normalizeHeader(header) }));
  const find = (patterns, exclude = []) =>
    normalized.find(
      (entry) => patterns.some((pattern) => pattern.test(entry.key)) && !exclude.some((pattern) => pattern.test(entry.key)),
    )?.header || '';

  return {
    date: find([/\bdate\b/, /date operation/, /date valeur/, /jour/]),
    label: find([/libell/, /description/, /motif/, /intitule/, /detail/, /operation/], [/date/]),
    debit: find([/debit/, /sortie/, /retrait/, /depense/]),
    credit: find([/credit/, /entree/, /depot/, /versement/, /recette/]),
    amount: find([/montant/, /amount/, /valeur/], [/date/]),
    direction: find([/sens/, /direction/, /type/]),
  };
}

/** Convertit un montant français ou international en nombre signé. */
export function parseAmount(value) {
  if (value === null || value === undefined) return 0;
  let text = String(value)
    .replace(/\u00a0|\s/g, '')
    .replace(/(FCFA|XOF|EUR|USD|€|\$)/gi, '')
    .trim();
  if (!text) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) return 0;
  return negative ? -amount : amount;
}

/** Convertit une date de relevé (jj/mm/aaaa, aaaa-mm-jj, jj.mm.aa…). */
export function parseStatementDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return toISODate(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  const french = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(text);
  if (french) {
    let [, day, month, year] = french;
    if (year.length === 2) year = `20${year}`;
    return toISODate(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  return '';
}

function directionFromText(value) {
  const key = normalizeHeader(value);
  if (!key) return '';
  if (/(debit|sortie|retrait|depense|paiement|prelevement|out)/.test(key)) return 'out';
  if (/(credit|entree|depot|versement|recette|encaissement|in)/.test(key)) return 'in';
  return '';
}

/**
 * Transforme les lignes brutes en écritures normalisées selon le mapping.
 * @returns {{lines: Array, skipped: number}}
 */
export function buildImportLines(records = [], mapping = {}) {
  const lines = [];
  let skipped = 0;

  records.forEach((record, index) => {
    const date = parseStatementDate(record[mapping.date]);
    const label = String(record[mapping.label] || '').trim() || 'Ligne de relevé';
    let amount = 0;
    let direction = '';

    const debit = mapping.debit ? parseAmount(record[mapping.debit]) : 0;
    const credit = mapping.credit ? parseAmount(record[mapping.credit]) : 0;
    if (debit !== 0 || credit !== 0) {
      if (credit > 0) {
        amount = Math.abs(credit);
        direction = 'in';
      } else {
        amount = Math.abs(debit);
        direction = 'out';
      }
    } else {
      amount = Math.abs(parseAmount(record[mapping.amount]));
      if (mapping.direction) {
        direction = directionFromText(record[mapping.direction]);
      }
      if (!direction) {
        const raw = parseAmount(record[mapping.amount]);
        direction = raw < 0 ? 'out' : 'in';
      }
    }

    amount = roundMoney(amount);
    if (!date || amount <= 0) {
      skipped += 1;
      return;
    }
    lines.push({
      index,
      date,
      label,
      amount,
      direction: direction === 'out' ? 'out' : 'in',
    });
  });

  return { lines, skipped };
}

/** Empreinte stable d'une ligne, pour empêcher un double import. */
export function lineFingerprint(line) {
  const source = [line.date, line.direction, Number(line.amount).toFixed(2), normalizeHeader(line.label)].join('|');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `imp_${(hash >>> 0).toString(16).padStart(8, '0')}_${source.length}`;
}

/** Totaux de l'aperçu. */
export function summarizeImportLines(lines = []) {
  return lines.reduce(
    (summary, line) => {
      summary.count += 1;
      if (line.direction === 'in') summary.inflow += line.amount;
      else summary.outflow += line.amount;
      return summary;
    },
    { count: 0, inflow: 0, outflow: 0 },
  );
}
