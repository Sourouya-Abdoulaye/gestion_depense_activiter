/* ---------------------------------------------------------------------------
 * Mon Commerce — identifiants stables
 * Chaque enregistrement possède un identifiant unique et stable, préfixé par
 * le type d'entité pour faciliter le débogage et les sauvegardes lisibles.
 * ------------------------------------------------------------------------- */

let counter = 0;

/** Identifiant stable : UUID v4 quand disponible, sinon repli horodaté. */
export function newId(prefix = 'id') {
  const uuid =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackUuid();
  return `${prefix}_${uuid}`;
}

function fallbackUuid() {
  counter += 1;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${time}-${counter.toString(36)}-${rand}`;
}

export const ID_PREFIX = {
  ACTIVITY: 'act',
  PRODUCT: 'prd',
  CUSTOMER: 'cli',
  SUPPLIER: 'frs',
  PURCHASE: 'ach',
  SALE: 'vte',
  RETURN: 'ret',
  EXPENSE: 'dep',
  STOCK_MOVEMENT: 'mvt',
  PAYMENT: 'pay',
  CASH_ACCOUNT: 'cpt',
  CASH_MOVEMENT: 'trz',
  LINE: 'lig',
  SNAPSHOT: 'snp',
  JOURNAL: 'jrn',
  EMPLOYEE: 'emp',
  IMPORT: 'imp',
};
