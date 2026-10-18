/* ---------------------------------------------------------------------------
 * Mon Commerce — service Dépenses (logique pure)
 *
 * Une dépense est toujours enregistrée avec sa NATURE, qui détermine son
 * traitement financier (cf. config/constants.js → EXPENSE_NATURES) :
 *   operating  → charge déduite du résultat de la période ;
 *   supply     → frais d'approvisionnement déjà compris dans le coût des
 *                marchandises : jamais déduits une seconde fois ;
 *   investment → sortie de trésorerie, hors résultat de la période ;
 *   personal   → retrait de l'exploitant, ce n'est pas une charge.
 * ------------------------------------------------------------------------- */

import { PAYMENT_METHODS, EXPENSE_NATURE_VALUES } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { BusinessError } from '../shared/validators.js';
import { buildCashMovement } from './cash.js';

const DEFAULT_METHOD = PAYMENT_METHODS[0];

/**
 * Construit une dépense et, si elle est payée, le mouvement de trésorerie
 * correspondant. Une dépense non payée n'impacte pas la trésorerie.
 */
export function buildExpense(input) {
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date de la dépense est invalide.');

  const amount = roundMoney(toNumber(input.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant de la dépense doit être supérieur à zéro.');

  const nature = EXPENSE_NATURE_VALUES.includes(input.nature) ? input.nature : 'operating';
  const paid = input.paid !== false;

  if (paid && !input.accountId) {
    throw new BusinessError('Choisissez le compte de trésorerie utilisé pour cette dépense payée.');
  }

  const expense = {
    id: newId(ID_PREFIX.EXPENSE),
    activityId: input.activityId || '',
    date,
    category: input.category || 'Autres',
    nature,
    amount,
    paymentMethod: input.paymentMethod || DEFAULT_METHOD,
    accountId: input.accountId || '',
    beneficiary: input.beneficiary || '',
    paid,
    note: input.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const cashMovements = paid
    ? [
        buildCashMovement({
          activityId: expense.activityId,
          date,
          accountId: expense.accountId,
          direction: 'out',
          amount,
          nature: nature === 'personal' ? 'withdrawal' : 'expense',
          sourceType: 'expense',
          sourceId: expense.id,
          note: expense.note || `Dépense ${expense.category}`,
        }),
      ]
    : [];

  return { expense, cashMovements };
}

/** Modifie une dépense en régularisant la trésorerie si nécessaire. */
export function rebuildExpenseUpdate(original, changes) {
  const merged = { ...original, ...changes };
  const date = toISODate(merged.date);
  if (!date) throw new BusinessError('La date de la dépense est invalide.');
  const amount = roundMoney(toNumber(merged.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant de la dépense doit être supérieur à zéro.');
  const paid = merged.paid !== false;

  const expense = {
    ...merged,
    date,
    amount,
    nature: EXPENSE_NATURE_VALUES.includes(merged.nature) ? merged.nature : 'operating',
    updatedAt: new Date().toISOString(),
  };

  const removal = original.paid
    ? [
        buildCashMovement({
          activityId: original.activityId,
          date: original.date,
          accountId: original.accountId,
          direction: 'in',
          amount: toNumber(original.amount, 0),
          nature: 'other_in',
          sourceType: 'expense_reversal',
          sourceId: original.id,
          note: `Régularisation de la dépense ${original.category}`,
        }),
      ]
    : [];
  const addition = paid
    ? [
        buildCashMovement({
          activityId: expense.activityId,
          date: expense.date,
          accountId: expense.accountId,
          direction: 'out',
          amount: expense.amount,
          nature: expense.nature === 'personal' ? 'withdrawal' : 'expense',
          sourceType: 'expense',
          sourceId: expense.id,
          note: expense.note || `Dépense ${expense.category}`,
        }),
      ]
    : [];

  return { expense, cashMovements: [...removal, ...addition] };
}

/** Contre-passation d'une dépense supprimée (aucune suppression silencieuse). */
export function buildExpenseReversal(expense) {
  if (!expense) throw new BusinessError('Dépense introuvable.');
  if (!expense.paid) return { cashMovements: [] };
  return {
    cashMovements: [
      buildCashMovement({
        activityId: expense.activityId,
        date: toISODate(new Date()),
        accountId: expense.accountId,
        direction: 'in',
        amount: toNumber(expense.amount, 0),
        nature: 'other_in',
        sourceType: 'expense_reversal',
        sourceId: expense.id,
        note: `Contre-passation de la dépense ${expense.category}`,
      }),
    ],
  };
}
