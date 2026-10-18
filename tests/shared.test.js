/* ---------------------------------------------------------------------------
 * Tests des utilitaires partagés : formatage, dates, validation.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  formatMoney,
  formatMoneyPlain,
  formatNumber,
  formatPercent,
  formatQuantity,
  roundMoney,
  toNumber,
  truncate,
} from '../src/shared/format.js';
import {
  addDays,
  addMonths,
  daysBetween,
  eachDay,
  endOfMonth,
  formatDate,
  isWithin,
  monthKey,
  parseISODate,
  periodRange,
  startOfWeek,
  toISODate,
  todayISO,
} from '../src/shared/dates.js';
import { isEmail, isISODate, isPhone, validate, BusinessError } from '../src/shared/validators.js';
import { newId } from '../src/shared/id.js';

/* ------------------------------- formatage ------------------------------ */

test('arrondi monétaire à 2 décimales', () => {
  assert.equal(roundMoney(1595.2380952380952), 1595.24);
  assert.equal(roundMoney(31904.761904761905), 31904.76);
  assert.equal(roundMoney(17495.238095238095), 17495.24);
  assert.equal(roundMoney(2.005), 2.01);
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundMoney('abc'), 0);
});

test('affichage des montants en FCFA', () => {
  assert.equal(formatMoney(50000), '50 000 FCFA');
  assert.equal(formatMoney(1595.2380952380952), '1 595,24 FCFA');
  assert.equal(formatMoney(0), '0 FCFA');
  assert.equal(formatMoney(1234.5, { decimals: 2 }), '1 234,50 FCFA');
  assert.equal(formatMoney(5000, { symbol: false }), '5 000');
  assert.equal(formatMoneyPlain(1595.238), '1595.24');
});

test('formats nombre, quantité et pourcentage', () => {
  assert.equal(formatNumber(1500), '1 500');
  assert.equal(formatPercent(0.35), '35,0 %');
  assert.equal(formatPercent(0), '0,0 %');
  assert.equal(formatQuantity(2.5, 'kg'), '2,5 kg');
  assert.equal(toNumber('1 595,24'), 1595.24);
  assert.equal(toNumber('', 7), 7);
  assert.equal(toNumber('abc', 3), 3);
});

test('échappement HTML et troncature', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abc', 5), 'abc');
});

/* --------------------------------- dates -------------------------------- */

test('normalisation des dates', () => {
  assert.equal(toISODate('2026-10-18T22:15:00.000Z'), '2026-10-18');
  assert.equal(toISODate(new Date(2026, 9, 18)), '2026-10-18');
  assert.equal(toISODate('18/10/2026'), '');
  assert.equal(toISODate(''), '');
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(parseISODate('2026-10-18').getDate(), 18);
});

test('arithmétique de dates', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(daysBetween('2026-10-01', '2026-10-18'), 17);
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12'); // dimanche → lundi précédent
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(monthKey('2026-10-18'), '2026-10');
  assert.equal(eachDay('2026-10-01', '2026-10-03').length, 3);
});

test('formatage lisible des dates', () => {
  assert.equal(formatDate('2026-10-18'), '18/10/2026');
  assert.equal(formatDate('2026-10-18', 'yyyy-MM-dd'), '2026-10-18');
  assert.equal(formatDate('2026-10-18', 'dd-MM-yyyy'), '18-10-2026');
  assert.equal(formatDate('invalide'), '—');
});

test('plages de périodes', () => {
  const reference = new Date(2026, 9, 18); // dimanche 18 octobre 2026
  assert.deepEqual(periodRange('today', {}, reference), { from: '2026-10-18', to: '2026-10-18', preset: 'today' });
  assert.deepEqual(periodRange('week', {}, reference), { from: '2026-10-12', to: '2026-10-18', preset: 'week' });
  assert.deepEqual(periodRange('month', {}, reference), { from: '2026-10-01', to: '2026-10-31', preset: 'month' });
  assert.deepEqual(periodRange('quarter', {}, reference), { from: '2026-10-01', to: '2026-12-31', preset: 'quarter' });
  assert.deepEqual(periodRange('year', {}, reference), { from: '2026-01-01', to: '2026-12-31', preset: 'year' });
  assert.equal(periodRange('all', {}, reference).from, '0000-01-01');
  assert.deepEqual(periodRange('custom', { from: '2026-03-01', to: '2026-04-15' }, reference).from, '2026-03-01');
});

test('appartenance à un intervalle', () => {
  assert.equal(isWithin('2026-10-18', '2026-10-01', '2026-10-31'), true);
  assert.equal(isWithin('2026-11-01', '2026-10-01', '2026-10-31'), false);
  assert.equal(isWithin('', '2026-10-01', '2026-10-31'), false);
  assert.equal(isWithin('2026-10-18', null, null), true);
});

/* ------------------------------ validation ------------------------------ */

test('validation de formulaire : champs obligatoires et types', () => {
  const { valid, errors } = validate(
    { name: '', amount: -5, quantity: 0, date: '18/10/2026' },
    {
      name: { label: 'Nom', required: true, type: 'text', maxLength: 10 },
      amount: { label: 'Montant', required: true, type: 'amount' },
      quantity: { label: 'Quantité', required: true, type: 'quantity' },
      date: { label: 'Date', required: true, type: 'date' },
    },
  );
  assert.equal(valid, false);
  assert.match(errors.name, /obligatoire/);
  assert.match(errors.amount, /négatif|nombre/);
  assert.match(errors.quantity, /supérieure à zéro/);
  assert.match(errors.date, /invalide/);
});

test('validation de formulaire : cas valides', () => {
  const { valid, errors } = validate(
    { name: 'Pantalon', amount: 1500, email: '', phone: '+228 90 12 34 56' },
    {
      name: { label: 'Nom', required: true, type: 'text' },
      amount: { label: 'Montant', required: true, type: 'amount', min: 0 },
      email: { label: 'E-mail', type: 'email' },
      phone: { label: 'Téléphone', type: 'phone' },
    },
  );
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
});

test('contrôles élémentaires', () => {
  assert.equal(isISODate('2026-10-18'), true);
  assert.equal(isISODate('2026-13-40'), false);
  assert.equal(isEmail('vendeur@exemple.tg'), true);
  assert.equal(isEmail('pas-un-email'), false);
  assert.equal(isPhone('90123456'), true);
  assert.equal(isPhone('abc'), false);
});

test('les erreurs métier sont identifiables', () => {
  const error = new BusinessError('Stock insuffisant', { productId: 'prd_1' });
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'BusinessError');
  assert.equal(error.details.productId, 'prd_1');
});

test('les identifiants sont uniques et préfixés', () => {
  const first = newId('prd');
  const second = newId('prd');
  assert.ok(first.startsWith('prd_'));
  assert.notEqual(first, second);
});
