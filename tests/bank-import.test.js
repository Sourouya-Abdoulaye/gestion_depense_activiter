/* ---------------------------------------------------------------------------
 * Tests de l'import de relevés CSV (L21).
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImportLines,
  detectColumns,
  lineFingerprint,
  parseAmount,
  parseStatementCsv,
  parseStatementDate,
  summarizeImportLines,
} from '../src/services/bank-import.js';

test('les montants français et internationaux sont lus correctement', () => {
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('-2 500'), -2500);
  assert.equal(parseAmount('(1 200,00)'), -1200);
  assert.equal(parseAmount('12 000 FCFA'), 12000);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('les dates de relevé sont normalisées en ISO', () => {
  assert.equal(parseStatementDate('18/10/2026'), '2026-10-18');
  assert.equal(parseStatementDate('18-10-2026'), '2026-10-18');
  assert.equal(parseStatementDate('2026-10-18'), '2026-10-18');
  assert.equal(parseStatementDate('18/10/26'), '2026-10-18');
  assert.equal(parseStatementDate('18.10.2026'), '2026-10-18');
  assert.equal(parseStatementDate('n/a'), '');
});

test('les colonnes usuelles sont détectées', () => {
  const columns = detectColumns(['Date opération', 'Libellé', 'Débit', 'Crédit', 'Montant']);
  assert.equal(columns.date, 'Date opération');
  assert.equal(columns.label, 'Libellé');
  assert.equal(columns.debit, 'Débit');
  assert.equal(columns.credit, 'Crédit');
  assert.equal(columns.amount, 'Montant');
});

test('un CSV point-virgule est lu et converti en lignes signées', () => {
  const csv = [
    'Date;Libellé;Débit;Crédit',
    '01/10/2026;Loyer boutique;50000;',
    '02/10/2026;Vente Flooz;;120000',
    ';Ligne sans date;;1000',
  ].join('\n');
  const parsed = parseStatementCsv(csv);
  const mapping = detectColumns(parsed.headers);
  const { lines, skipped } = buildImportLines(parsed.records, mapping);

  assert.equal(lines.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(
    lines.map((line) => [line.date, line.direction, line.amount]),
    [
      ['2026-10-01', 'out', 50000],
      ['2026-10-02', 'in', 120000],
    ],
  );
  const summary = summarizeImportLines(lines);
  assert.equal(summary.inflow, 120000);
  assert.equal(summary.outflow, 50000);
});

test('un montant signé et une colonne sens sont interprétés', () => {
  const csv = [
    'date;description;montant;sens',
    '05/10/2026;Achat fournitures;-15000;',
    '06/10/2026;Dépôt client;20000;',
  ].join('\n');
  const parsed = parseStatementCsv(csv);
  const { lines } = buildImportLines(parsed.records, detectColumns(parsed.headers));
  assert.equal(lines[0].direction, 'out');
  assert.equal(lines[1].direction, 'in');
});

test('les empreintes distinguent les lignes et repèrent les doublons', () => {
  const line = { date: '2026-10-01', direction: 'out', amount: 50000, label: 'Loyer boutique' };
  assert.equal(lineFingerprint(line), lineFingerprint({ ...line }));
  assert.notEqual(lineFingerprint(line), lineFingerprint({ ...line, amount: 50001 }));
  assert.match(lineFingerprint(line), /^imp_[0-9a-f]{8}_\d+$/);
});

test('un fichier vide est refusé avec un message clair', () => {
  assert.throws(() => parseStatementCsv(''), /vide/);
  assert.throws(() => parseStatementCsv('Date;Libellé\n'), /Aucune ligne exploitable/);
});
