/* ---------------------------------------------------------------------------
 * Mon Commerce — éditeur de paiements
 *
 * Un règlement peut être fractionné (espèces + mobile money, par exemple).
 * Les montants saisis sont contrôlés par les services métier qui refusent tout
 * dépassement du solde restant dû.
 * ------------------------------------------------------------------------- */

import { element, html, qs, raw } from './dom.js';
import { formatMoney, toNumber } from './format.js';
import { icon } from './icons.js';

/**
 * @param {object} options
 * @param {string[]} options.methods moyens de paiement paramétrés
 * @param {Array} options.accounts comptes de trésorerie actifs
 * @param {Array} [options.initial] paiements existants
 * @param {string} [options.hint] aide affichée sous le tableau
 */
export function createPaymentsEditor({ methods = [], accounts = [], initial = [], hint = '' } = {}) {
  const container = element(html`
    <div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Montant (FCFA)</th>
              <th scope="col">Moyen de paiement</th>
              <th scope="col">Compte de trésorerie</th>
              <th scope="col" class="text-right"><span class="sr-only">Retirer</span></th>
            </tr>
          </thead>
          <tbody data-payments-body></tbody>
        </table>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" class="btn-ghost btn-sm" data-add-payment>
          ${raw(icon('plus', { size: 14 }))}<span>Ajouter un paiement</span>
        </button>
        <p class="text-sm font-semibold text-brand-dark">Total saisi : <span data-payments-total>0 FCFA</span></p>
      </div>
      <p class="mt-1 text-xs text-muted" data-payments-hint>${hint}</p>
    </div>
  `);

  const body = qs('[data-payments-body]', container);
  const totalSlot = qs('[data-payments-total]', container);

  function refresh() {
    const total = readPayments().reduce((sum, payment) => sum + payment.amount, 0);
    totalSlot.textContent = formatMoney(total);
  }

  function readPayments() {
    return [...body.querySelectorAll('tr')]
      .map((row) => ({
        amount: toNumber(qs('[data-amount]', row).value, 0),
        method: qs('[data-method]', row).value,
        accountId: qs('[data-account]', row).value,
      }))
      .filter((payment) => payment.amount > 0);
  }

  function rowElement(payment = {}) {
    const row = element(html`
      <tr>
        <td class="w-36">
          <input type="number" class="input text-right" data-amount min="0" step="any" inputmode="decimal"
            value="${payment.amount !== undefined ? payment.amount : ''}" aria-label="Montant du paiement" />
        </td>
        <td>
          <select class="input" data-method aria-label="Moyen de paiement">
            ${methods.map((method) => html`<option value="${method}" ${method === payment.method ? 'selected' : ''}>${method}</option>`)}
          </select>
        </td>
        <td>
          <select class="input" data-account aria-label="Compte de trésorerie">
            ${accounts.length === 0 ? html`<option value="">Aucun compte actif</option>` : ''}
            ${accounts.map(
              (account) => html`<option value="${account.id}" ${account.id === payment.accountId ? 'selected' : ''}>${account.name}</option>`,
            )}
          </select>
        </td>
        <td class="text-right">
          <button type="button" class="btn-ghost btn-sm" data-remove-payment aria-label="Retirer ce paiement">
            ${raw(icon('trash', { size: 14 }))}
          </button>
        </td>
      </tr>
    `);
    for (const field of row.querySelectorAll('input')) field.addEventListener('input', refresh);
    qs('[data-remove-payment]', row).addEventListener('click', () => {
      row.remove();
      refresh();
    });
    return row;
  }

  function addPayment(payment = {}) {
    body.append(rowElement(payment));
    refresh();
  }

  qs('[data-add-payment]', container).addEventListener('click', () => addPayment());

  initial.forEach((payment) => addPayment(payment));

  return {
    element: container,
    addPayment,
    getPayments() {
      return readPayments();
    },
    refresh,
  };
}
