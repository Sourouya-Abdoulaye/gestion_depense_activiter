/* ---------------------------------------------------------------------------
 * Mon Commerce — service Trésorerie (logique pure)
 *
 * La trésorerie est la seule source de vérité des mouvements d'argent réels :
 * « Trésorerie = solde initial + entrées réelles − sorties réelles ».
 *
 * Un transfert interne crée deux mouvements (sortie d'un compte, entrée dans
 * l'autre) et n'est jamais compté comme recette ou dépense consolidée.
 * ------------------------------------------------------------------------- */

import { CASH_ACCOUNT_TYPES } from '../config/constants.js';
import { toISODate } from '../shared/dates.js';
import { roundMoney, toNumber } from '../shared/format.js';
import { newId, ID_PREFIX } from '../shared/id.js';
import { BusinessError } from '../shared/validators.js';

const DEFAULT_ACCOUNT_TYPE = CASH_ACCOUNT_TYPES[0].value;

export function buildCashAccount(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new BusinessError('Le nom du compte de trésorerie est obligatoire.');
  return {
    id: newId(ID_PREFIX.CASH_ACCOUNT),
    name,
    type: CASH_ACCOUNT_TYPES.some((entry) => entry.value === input.type) ? input.type : DEFAULT_ACCOUNT_TYPE,
    initialBalance: roundMoney(toNumber(input.initialBalance, 0)),
    active: input.active !== false,
    note: input.note || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function buildCashMovement(input) {
  const date = toISODate(input.date);
  if (!date) throw new BusinessError('La date du mouvement de trésorerie est invalide.');
  const amount = roundMoney(toNumber(input.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant du mouvement de trésorerie doit être supérieur à zéro.');
  if (input.direction !== 'in' && input.direction !== 'out') {
    throw new BusinessError('Le sens du mouvement de trésorerie doit être « entrée » ou « sortie ».');
  }
  if (!input.accountId) throw new BusinessError('Choisissez un compte de trésorerie.');

  return {
    id: newId(ID_PREFIX.CASH_MOVEMENT),
    activityId: input.activityId || '',
    date,
    accountId: input.accountId,
    direction: input.direction,
    amount,
    nature: input.nature || (input.direction === 'in' ? 'other_in' : 'other_out'),
    sourceType: input.sourceType || 'manual',
    sourceId: input.sourceId || '',
    note: input.note || '',
    createdAt: new Date().toISOString(),
  };
}

/** Apport de l'exploitant : augmente le budget disponible et la trésorerie. */
export function buildContribution(input) {
  return {
    cashMovement: buildCashMovement({
      activityId: input.activityId,
      date: input.date,
      accountId: input.accountId,
      direction: 'in',
      amount: input.amount,
      nature: 'capital_in',
      sourceType: 'contribution',
      note: input.note || 'Apport de l’exploitant',
    }),
  };
}

/** Retrait de l'exploitant : sortie d'argent, ce n'est pas une charge. */
export function buildWithdrawal(input) {
  return {
    cashMovement: buildCashMovement({
      activityId: input.activityId,
      date: input.date,
      accountId: input.accountId,
      direction: 'out',
      amount: input.amount,
      nature: 'withdrawal',
      sourceType: 'withdrawal',
      note: input.note || 'Retrait de l’exploitant',
    }),
  };
}

/** Transfert entre deux comptes : deux mouvements liés, aucun impact consolidé. */
export function buildTransfer(input) {
  if (input.fromAccountId === input.toAccountId) {
    throw new BusinessError('Les comptes de départ et d’arrivée doivent être différents.');
  }
  const amount = roundMoney(toNumber(input.amount, 0));
  if (amount <= 0) throw new BusinessError('Le montant du transfert doit être supérieur à zéro.');
  if (!input.fromAccountId || !input.toAccountId) throw new BusinessError('Choisissez les deux comptes du transfert.');

  const groupId = newId('trf');
  const out = buildCashMovement({
    activityId: input.activityId,
    date: input.date,
    accountId: input.fromAccountId,
    direction: 'out',
    amount,
    nature: 'transfer_out',
    sourceType: 'transfer',
    sourceId: groupId,
    note: input.note || 'Transfert interne sortant',
  });
  const incoming = buildCashMovement({
    activityId: input.activityId,
    date: input.date,
    accountId: input.toAccountId,
    direction: 'in',
    amount,
    nature: 'transfer_in',
    sourceType: 'transfer',
    sourceId: groupId,
    note: input.note || 'Transfert interne entrant',
  });
  return { cashMovements: [out, incoming], groupId };
}

/** Entrée ou sortie exceptionnelle (correction de caisse, autre recette). */
export function buildManualCashMovement(input) {
  return { cashMovement: buildCashMovement({ ...input, sourceType: 'manual' }) };
}

/** Compte par défaut à la première initialisation. */
export function defaultCashAccount(initialBalance = 0) {
  return buildCashAccount({ name: 'Caisse principale', type: 'cash', initialBalance });
}
