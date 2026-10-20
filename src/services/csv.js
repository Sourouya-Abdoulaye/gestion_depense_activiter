/* ---------------------------------------------------------------------------
 * Mon Commerce — export CSV (Papa Parse)
 *
 * Les fichiers produits sont lisibles par les tableurs (Excel, LibreOffice,
 * Google Sheets) : séparateur point-virgule, décimales à la virgule, encodage
 * UTF-8 avec BOM pour préserver les accents.
 * ------------------------------------------------------------------------- */

import Papa from 'papaparse';
import { downloadFile } from '../shared/dom.js';
import { formatMoney, formatMoneyPlain, formatQuantity } from '../shared/format.js';
import { formatDate } from '../shared/dates.js';
import { reportToSections } from './reports.js';
import { ACCOUNTING_COLUMNS, buildAccountingJournal } from './accounting.js';

export const CSV_MIME = 'text/csv';

/** Convertit une liste de listes en chaîne CSV (séparateur point-virgule). */
export function toCsv(rows = [], { fields = null, delimiter = ';' } = {}) {
  return Papa.unparse(fields ? { fields, data: rows } : rows, { delimiter, newline: '\r\n' });
}

/** Montant au format tabulaire français : 1595,24 (sans séparateur de milliers). */
export function moneyValue(value) {
  return formatMoneyPlain(value).replace('.', ',');
}

/** Déclenche le téléchargement d'un fichier CSV (avec BOM UTF-8). */
export function downloadCsv(filename, csv) {
  downloadFile(filename, `\uFEFF${csv}`, CSV_MIME);
}

function stamp(date = new Date()) {
  return formatDate(date, 'yyyy-MM-dd');
}

/**
 * Export d'une liste d'enregistrements.
 * @param {{filename: string, columns: Array<{key:string,label:string,format?:Function}>, rows: Array}} options
 */
export function exportRows({ filename, columns, rows }) {
  const fields = columns.map((column) => column.label);
  const data = rows.map((row) => columns.map((column) => (column.format ? column.format(row) : row[column.key] ?? '')));
  const csv = toCsv(data, { fields });
  downloadCsv(filename, csv);
  return { filename, csv, lines: rows.length };
}

/* --------------------------- exports métier ----------------------------- */

export function exportSalesCsv({ sales, customers, activityName }) {
  const customerIndex = new Map((customers || []).map((customer) => [customer.id, customer.name]));
  return exportRows({
    filename: `mon-commerce-ventes-${activityName ? `${activityName}-` : ''}${stamp()}.csv`,
    columns: [
      { key: 'reference', label: 'Référence' },
      { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
      { key: 'customer', label: 'Client', format: (row) => customerIndex.get(row.customerId) || '' },
      { key: 'status', label: 'Statut' },
      { key: 'total', label: 'Total (FCFA)', format: (row) => moneyValue(row.total) },
    ],
    rows: sales,
  });
}

export function exportProductsCsv({ products, stockState, categories }) {
  return exportRows({
    filename: `mon-commerce-produits-${stamp()}.csv`,
    columns: [
      { key: 'name', label: 'Produit' },
      { key: 'reference', label: 'Référence' },
      { key: 'category', label: 'Catégorie' },
      { key: 'unit', label: 'Unité' },
      { key: 'cost', label: 'Coût (FCFA)', format: (row) => moneyValue(row.cost) },
      { key: 'price', label: 'Prix de vente (FCFA)', format: (row) => moneyValue(row.price) },
      {
        key: 'quantity',
        label: 'Quantité en stock',
        format: (row) => formatQuantity(stockState[row.id] ? stockState[row.id].quantity : 0),
      },
      {
        key: 'value',
        label: 'Valeur du stock (FCFA)',
        format: (row) => moneyValue(stockState[row.id] ? stockState[row.id].value : 0),
      },
      { key: 'alertThreshold', label: 'Seuil d’alerte' },
    ],
    rows: products,
  });
}

export function exportStockMovementsCsv({ movements, products, activityName }) {
  const productIndex = new Map((products || []).map((product) => [product.id, product.name]));
  return exportRows({
    filename: `mon-commerce-stock-${activityName ? `${activityName}-` : ''}${stamp()}.csv`,
    columns: [
      { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
      { key: 'product', label: 'Produit', format: (row) => productIndex.get(row.productId) || row.productId },
      { key: 'type', label: 'Sens' },
      { key: 'reason', label: 'Motif' },
      { key: 'quantity', label: 'Quantité', format: (row) => formatQuantity(row.quantity) },
      { key: 'unitCost', label: 'Coût unitaire (FCFA)', format: (row) => (row.unitCost === null ? '' : moneyValue(row.unitCost)) },
      { key: 'note', label: 'Note' },
    ],
    rows: movements,
  });
}

export function exportCashMovementsCsv({ movements, accounts }) {
  const accountIndex = new Map((accounts || []).map((account) => [account.id, account.name]));
  return exportRows({
    filename: `mon-commerce-tresorerie-${stamp()}.csv`,
    columns: [
      { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
      { key: 'account', label: 'Compte', format: (row) => accountIndex.get(row.accountId) || '' },
      { key: 'direction', label: 'Sens', format: (row) => (row.direction === 'in' ? 'Entrée' : 'Sortie') },
      { key: 'nature', label: 'Nature' },
      { key: 'amount', label: 'Montant (FCFA)', format: (row) => moneyValue(row.amount) },
      { key: 'note', label: 'Note' },
    ],
    rows: movements,
  });
}

export function exportExpensesCsv({ expenses, activityName }) {
  return exportRows({
    filename: `mon-commerce-depenses-${activityName ? `${activityName}-` : ''}${stamp()}.csv`,
    columns: [
      { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
      { key: 'category', label: 'Catégorie' },
      { key: 'nature', label: 'Nature' },
      { key: 'amount', label: 'Montant (FCFA)', format: (row) => moneyValue(row.amount) },
      { key: 'paymentMethod', label: 'Moyen de paiement' },
      { key: 'beneficiary', label: 'Bénéficiaire' },
      { key: 'paid', label: 'Payée', format: (row) => (row.paid ? 'Oui' : 'Non') },
      { key: 'note', label: 'Note' },
    ],
    rows: expenses,
  });
}

/**
 * Export du journal comptable simplifié (L9). Un fichier CSV, une ligne par
 * écriture, avec un contrôle d'équilibre débit = crédit.
 */
export function exportAccountingCsv({ state, activityId = '', activityName = '', period = null }) {
  const journal = buildAccountingJournal(state, { activityId, period });
  if (journal.rows.length === 0) return { ...journal, filename: '', lines: 0 };
  const filename = `mon-commerce-journal-comptable-${activityName ? `${activityName}-` : ''}${stamp()}.csv`;
  const data = journal.rows.map((row) => [
    formatDate(row.date),
    row.journal,
    row.account,
    row.accountLabel,
    row.piece,
    row.label,
    moneyValue(row.debit),
    moneyValue(row.credit),
    row.source,
  ]);
  const csv = toCsv(data, { fields: ACCOUNTING_COLUMNS.map((column) => column.label) });
  downloadCsv(filename, csv);
  return { ...journal, filename, lines: journal.rows.length };
}

/** Export d'un rapport complet : un fichier CSV par section. */export function exportReportCsv(report, { activityName = '' } = {}) {
  const sections = reportToSections(report, {
    formatDate: (value) => formatDate(value, 'dd/MM/yyyy'),
    formatMoney: (value) => formatMoney(value),
    formatQuantity: (value) => formatQuantity(value),
  });
  let index = 0;
  for (const section of sections) {
    if (section.rows.length === 0) continue;
    const slug = section.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setTimeout(() => {
      downloadCsv(
        `mon-commerce-rapport-${slug}-${activityName ? `${activityName}-` : ''}${stamp()}.csv`,
        toCsv(section.rows, { fields: section.columns }),
      );
    }, index * 350);
    index += 1;
  }
  return index;
}

export { Papa };
