/* ---------------------------------------------------------------------------
 * Tests de l'assistant local : intentions, réponses chiffrées et suggestions.
 * ------------------------------------------------------------------------- */

import assert from 'node:assert/strict';
import test from 'node:test';

import { answerQuestion, QUICK_QUESTIONS } from '../src/services/assistant.js';
import { addExpense, addProduct, addPurchase, addSale, createWorld } from './helpers.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-31', preset: 'month' };
const PERIOD_LABEL = 'du 01/10/2026 au 31/10/2026';

function contextFor(world, activity, overrides = {}) {
  return {
    state: world,
    period: PERIOD,
    periodLabel: PERIOD_LABEL,
    activityId: activity ? activity.id : '',
    activity: activity || null,
    now: new Date('2026-10-31T12:00:00.000Z'),
    ...overrides,
  };
}

test('toutes les questions suggérées obtiennent une réponse du guide', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const context = contextFor(world, activity);
  for (const question of QUICK_QUESTIONS) {
    const answer = answerQuestion(question, context);
    assert.notEqual(answer.topic, 'fallback', `question sans réponse : ${question}`);
    assert.ok(answer.text.length > 20, `réponse trop courte : ${question}`);
  }
});

test('salutations, remerciements et incompréhension', () => {
  assert.equal(answerQuestion('Bonjour', {}).topic, 'greeting');
  assert.equal(answerQuestion('merci beaucoup', {}).topic, 'thanks');
  assert.equal(answerQuestion('au revoir', {}).topic, 'farewell');

  const unknown = answerQuestion('xyzabc introuvable', {});
  assert.equal(unknown.topic, 'fallback');
  assert.equal(unknown.isFallback, true);
  assert.ok(unknown.followUps.length > 0);
});

test('la prise en main renvoie vers les écrans utiles', () => {
  const answer = answerQuestion('Comment démarrer ?', {});
  assert.equal(answer.topic, 'start');
  assert.ok(answer.links.some((link) => link.path === 'activites'));
  assert.ok(answer.links.some((link) => link.path === 'produits'));
  assert.ok(answer.bullets.length >= 3);
});

test('les chiffres réels de la période sont utilisés', () => {
  const { world, activity } = createWorld({ capital: 40000, date: '2026-10-01' });
  const product = addProduct(world, { name: 'Pantalon', cost: 1500, price: 2500, quantity: 21 });
  addSale(world, {
    items: [{ product, quantity: 20, unitPrice: 2500 }],
    pay: 50000,
    date: '2026-10-05',
  });
  addExpense(world, { amount: 600, date: '2026-10-02' });

  const context = contextFor(world, activity);

  assert.match(answerQuestion('mon chiffre d’affaires', context).headline, /50 000 FCFA/);
  assert.match(answerQuestion('ma marge brute', context).headline, /20 000 FCFA/);
  assert.match(answerQuestion('mon résultat', context).headline, /19 400 FCFA/);
  assert.match(answerQuestion('ma trésorerie', context).headline, /89 400 FCFA/);
  assert.match(answerQuestion('mon stock', context).headline, /1 500 FCFA/);
  assert.match(answerQuestion('mon budget', context).headline, /39 400 FCFA/);
  assert.ok(answerQuestion('mes ventes', context).headline.includes('1 vente'));
});

test('une vente à crédit apparaît dans les créances clients', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Sac', cost: 400, price: 1000, quantity: 10 });
  addSale(world, {
    items: [{ product, quantity: 2, unitPrice: 1000 }],
    pay: 500,
    dueDate: '2026-10-20',
    date: '2026-10-10',
  });

  const answer = answerQuestion('où voir mes créances ?', contextFor(world, activity));
  assert.equal(answer.topic, 'receivables');
  assert.match(answer.headline, /1 500 FCFA/);
  assert.match(answer.text, /1 créance/);
  assert.ok(answer.links.some((link) => link.path === 'clients'));
});

test('un achat partiellement payé apparaît dans les dettes fournisseurs', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const product = addProduct(world, { name: 'Carton', cost: 0, price: 1200, quantity: 0 });
  addPurchase(world, {
    lines: [{ product, quantity: 10, unitPrice: 1000 }],
    pay: 3000,
    date: '2026-10-03',
  });

  const answer = answerQuestion('mes dettes fournisseurs', contextFor(world, activity));
  assert.equal(answer.topic, 'payables');
  assert.match(answer.headline, /7 000 FCFA/);
  assert.ok(answer.links.some((link) => link.path === 'fournisseurs'));
});

test('une question « comment » explique l’action sans se limiter au montant', () => {
  const { world, activity } = createWorld({ capital: 0 });
  const context = contextFor(world, activity);

  assert.equal(answerQuestion('faire une vente', context).headline, 'Comment enregistrer une vente');
  assert.equal(answerQuestion('ajouter une dépense', context).headline, 'Ajouter une dépense');
  assert.equal(answerQuestion('comment fonctionne le stock', context).headline, 'Stock et coût moyen pondéré');
});

test('le budget explique l’absence d’activité', () => {
  const answer = answerQuestion('mon budget', { state: {}, activity: null });
  assert.equal(answer.topic, 'budget');
  assert.match(answer.text, /Aucune activité/);
  assert.ok(answer.links.some((link) => link.path === 'activites'));
});
