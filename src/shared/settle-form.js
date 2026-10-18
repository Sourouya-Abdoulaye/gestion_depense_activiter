/* ---------------------------------------------------------------------------
 * Mon Commerce — formulaires de règlement (client / fournisseur)
 *
 * Mutualisés entre les écrans Ventes, Achats, Clients et Fournisseurs : la
 * règle est identique partout — un encaissement augmente la trésorerie, un
 * paiement la diminue, et aucun montant ne peut dépasser le solde restant dû
 * (contrôle définitif réalisé par les services métier).
 * ------------------------------------------------------------------------- */

import { field, modalForm, optionsFrom, runAction, toast } from './ui.js';
import { formatMoney, toNumber } from './format.js';
import { todayISO } from './dates.js';
import { getSettings, getState } from '../services/state.js';
import { purchaseBalance, saleBalance } from '../services/finance.js';
import { payPurchase, paySale } from '../services/actions.js';

function settlementFields({ accounts, methods, defaultMethod, amount }) {
  return [
    { node: field({ name: 'amount', label: 'Montant (FCFA)', type: 'number', min: '0', value: amount, required: true }), span: 2 },
    { node: field({ name: 'method', label: 'Moyen de paiement', type: 'select', value: defaultMethod, options: optionsFrom(methods) }) },
    { node: field({ name: 'date', label: 'Date', type: 'date', value: todayISO(), required: true }) },
    {
      node: field({
        name: 'accountId',
        label: 'Compte de trésorerie',
        type: 'select',
        value: accounts.length > 0 ? accounts[0].id : '',
        options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
        required: true,
      }),
      span: 2,
    },
    { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }), span: 2 },
  ];
}

function activeAccounts() {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    toast('Créez d’abord un compte de trésorerie.', 'warning', { duration: 6000 });
    return null;
  }
  return accounts;
}

/** Encaissement d'une vente (partiel ou total). */
export function openSaleSettlement(sale, { onDone = null } = {}) {
  const accounts = activeAccounts();
  if (!accounts) return;
  const state = getState();
  const settings = getSettings();
  const balance = saleBalance(sale, { payments: state.payments, returns: state.returns });
  const methods = settings.paymentMethods || ['Espèces'];

  modalForm({
    title: `Encaisser la vente ${sale.reference}`,
    description: `Solde restant dû : ${formatMoney(balance)}.`,
    fields: settlementFields({ accounts, methods, defaultMethod: methods[0], amount: balance }),
    submitLabel: 'Enregistrer l’encaissement',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          paySale({
            saleId: sale.id,
            amount,
            method: values.method,
            accountId: values.accountId,
            date: values.date,
            note: values.note,
          }),
        { successMessage: 'Encaissement enregistré.' },
      );
      if (result && onDone) onDone(result);
      return Boolean(result);
    },
  });
}

/** Paiement d'un achat (partiel ou total). */
export function openPurchaseSettlement(purchase, { onDone = null } = {}) {
  const accounts = activeAccounts();
  if (!accounts) return;
  const state = getState();
  const settings = getSettings();
  const balance = purchaseBalance(purchase, { payments: state.payments, returns: state.returns });
  const methods = settings.paymentMethods || ['Espèces'];

  modalForm({
    title: `Régler l’achat ${purchase.reference}`,
    description: `Solde restant dû : ${formatMoney(balance)}.`,
    fields: settlementFields({ accounts, methods, defaultMethod: methods[0], amount: balance }),
    submitLabel: 'Enregistrer le paiement',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          payPurchase({
            purchaseId: purchase.id,
            amount,
            method: values.method,
            accountId: values.accountId,
            date: values.date,
            note: values.note,
          }),
        { successMessage: 'Paiement fournisseur enregistré.' },
      );
      if (result && onDone) onDone(result);
      return Boolean(result);
    },
  });
}
