/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Achats »
 *
 * Règle métier rappelée à l'écran : le stock n'augmente qu'à la RÉCEPTION.
 * Un achat non payé n'est pas un décaissement : il crée une dette fournisseur.
 * Les frais (transport, frais annexes) sont répartis sur les lignes et
 * intégrés au coût d'acquisition des produits.
 * ------------------------------------------------------------------------- */

import { DOCUMENT_STATUS } from '../config/constants.js';
import { html, element, qs, raw, delegate } from '../shared/dom.js';
import { formatMoney, formatQuantity, toNumber } from '../shared/format.js';
import { formatDate, todayISO } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import {
  button,
  dataTable,
  documentStatusBadge,
  field,
  inputDialog,
  kpiCard,
  modalForm,
  noticePanel,
  openModal,
  optionsFrom,
  pageHeader,
  runAction,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { createLinesEditor } from '../shared/lines.js';
import { createPaymentsEditor } from '../shared/payments.js';
import { getSettings, getState } from '../services/state.js';
import { cashInFor, cashOutFor, purchaseBalance, purchaseTotal, returnsFor, totalPayables } from '../services/finance.js';
import { cancelPurchase, createPurchase, payPurchase, receivePurchaseAction, returnPurchase } from '../services/actions.js';
import { exportRows, moneyValue } from '../services/csv.js';

export const meta = { path: 'achats', title: 'Achats' };

/* filtre de statut conservé pendant la session */
let statusFilter = '';

/* ------------------------------- utilitaires ---------------------------- */

function netPaid(state, purchase) {
  return cashOutFor(state.payments, 'purchase', purchase.id) - cashInFor(state.payments, 'purchase', purchase.id);
}

function purchaseReturns(state, purchase) {
  return returnsFor(state.returns, { kind: 'purchase', sourceId: purchase.id });
}

function returnableLines(state, purchase) {
  return (purchase.lines || []).map((line) => {
    const returned = purchaseReturns(state, purchase)
      .flatMap((item) => item.lines || [])
      .filter((entry) => entry.purchaseLineId === line.id)
      .reduce((total, entry) => total + toNumber(entry.quantity, 0), 0);
    return { line, returned, remaining: toNumber(line.quantity, 0) - returned };
  });
}

/* ----------------------------- formulaire achat ------------------------- */

function openPurchaseForm() {
  const state = getState();
  const settings = getSettings();
  const products = state.products.filter((product) => product.status !== 'archived');
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (products.length === 0) {
    toast('Ajoutez d’abord au moins un produit dans « Produits & stock ».', 'warning', { duration: 6000 });
    return;
  }

  const lines = createLinesEditor({ products, priceField: 'cost' });
  const payments = createPaymentsEditor({
    methods: settings.paymentMethods || ['Espèces'],
    accounts,
    hint: 'Laissez vide pour un achat à crédit : une dette fournisseur sera suivie.',
  });

  const fields = [
    {
      node: field({
        name: 'supplierId',
        label: 'Fournisseur (facultatif)',
        type: 'select',
        value: '',
        options: optionsFrom(state.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })), { placeholder: '— Aucun —' }),
      }),
    },
    { node: field({ name: 'date', label: "Date de l'achat", type: 'date', value: todayISO(), required: true }) },
    {
      node: field({
        name: 'status',
        label: 'Statut',
        type: 'select',
        value: DOCUMENT_STATUS.RECEIVED,
        options: [
          { value: DOCUMENT_STATUS.RECEIVED, label: 'Réceptionné (le stock augmente)' },
          { value: DOCUMENT_STATUS.ORDERED, label: 'Commandé (stock inchangé)' },
        ],
      }),
    },
    { node: field({ name: 'expectedDate', label: 'Date de livraison prévue', type: 'date', value: '' }) },
    { node: field({ name: 'transportCost', label: 'Transport (FCFA)', type: 'number', min: '0', value: 0 }) },
    { node: field({ name: 'otherFees', label: 'Autres frais (FCFA)', type: 'number', min: '0', value: 0 }) },
    { node: field({ name: 'discount', label: 'Remise globale (FCFA)', type: 'number', min: '0', value: 0 }) },
    { node: field({ name: 'dueDate', label: 'Date d’échéance (facultatif)', type: 'date', value: '' }) },
    { node: field({ name: 'reference', label: 'Référence (facultatif)', value: '', placeholder: 'Générée automatiquement si vide' }) },
    { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }) },
    { node: element(html`<div><p class="label">Produits achetés</p></div>`), span: 2 },
    { node: lines.element, span: 2 },
    { node: element(html`<div><p class="label">Paiement immédiat</p></div>`), span: 2 },
    { node: payments.element, span: 2 },
  ];

  modalForm({
    title: 'Nouvel achat',
    description: 'Le transport et les frais annexes sont répartis au prorata des lignes et ajoutés au coût des produits.',
    size: 'xl',
    fields,
    submitLabel: 'Enregistrer l’achat',
    onSubmit: async (values) => {
      const items = lines.getLines();
      if (items.length === 0) {
        toast('Ajoutez au moins une ligne de produit avec sa quantité.', 'warning');
        return false;
      }
      const payload = {
        supplierId: values.supplierId,
        date: values.date,
        status: values.status,
        expectedDate: values.expectedDate,
        transportCost: toNumber(values.transportCost, 0),
        otherFees: toNumber(values.otherFees, 0),
        discount: toNumber(values.discount, 0),
        dueDate: values.dueDate,
        reference: values.reference,
        note: values.note,
        lines: items,
        payments: payments.getPayments(),
        activityId: getFilters().activityId || undefined,
      };
      const result = await runAction(() => createPurchase(payload), { successMessage: 'Achat enregistré.' });
      return Boolean(result);
    },
  });
}

/* --------------------------- actions sur un achat ----------------------- */

function openPurchaseDetail(purchase) {
  const state = getState();
  const supplier = state.suppliers.find((entry) => entry.id === purchase.supplierId);
  const payments = state.payments.filter((payment) => payment.partyType === 'purchase' && payment.partyId === purchase.id);
  const returns = purchaseReturns(state, purchase);
  const balance = purchaseBalance(purchase, { payments: state.payments, returns: state.returns });

  openModal({
    title: `Achat ${purchase.reference}`,
    description: `${supplier ? supplier.name : 'Fournisseur non renseigné'} — ${formatDate(purchase.date)}`,
    size: 'lg',
    content: element(html`
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          ${documentStatusBadge(purchase.status)}
          <span class="badge badge-neutral">Total ${formatMoney(purchaseTotal(purchase))}</span>
          <span class="badge ${balance > 0 ? 'badge-warning' : 'badge-brand'}">
            ${balance > 0 ? `Reste dû ${formatMoney(balance)}` : 'Soldé'}
          </span>
        </div>

        <div class="table-wrap">
          <table class="table table-stack">
            <thead>
              <tr>
                <th>Produit</th>
                <th class="text-right">Qté</th>
                <th class="text-right">Prix unitaire</th>
                <th class="text-right">Frais alloués</th>
                <th class="text-right">Coût d’acquisition unitaire</th>
                <th class="text-right">Total net</th>
              </tr>
            </thead>
            <tbody>
              ${(purchase.lines || []).map(
                (line) => html`
                  <tr>
                    <td data-label="Produit" class="font-medium">${line.label}</td>
                    <td data-label="Qté" class="text-right">${formatQuantity(line.quantity, line.unit)}</td>
                    <td data-label="Prix unitaire" class="text-right">${formatMoney(line.unitPrice)}</td>
                    <td data-label="Frais alloués" class="text-right">${formatMoney(line.allocatedFees || 0)}</td>
                    <td data-label="Coût d’acquisition" class="text-right font-semibold">${formatMoney(line.allocatedUnitCost ?? line.unitPrice)}</td>
                    <td data-label="Total net" class="text-right">${formatMoney(line.netTotal ?? 0)}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>

        <div class="grid gap-2 text-sm sm:grid-cols-2">
          <p>Marchandises : <strong>${formatMoney(purchaseTotal(purchase) - toNumber(purchase.transportCost, 0) - toNumber(purchase.otherFees, 0) + toNumber(purchase.discount, 0))}</strong></p>
          <p>Transport : <strong>${formatMoney(purchase.transportCost || 0)}</strong></p>
          <p>Autres frais : <strong>${formatMoney(purchase.otherFees || 0)}</strong></p>
          <p>Remise : <strong>− ${formatMoney(purchase.discount || 0)}</strong></p>
          <p>Déjà payé : <strong>${formatMoney(netPaid(state, purchase))}</strong></p>
          <p>Retours : <strong>− ${formatMoney(returns.reduce((total, item) => total + item.total, 0))}</strong></p>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-brand-dark">Paiements</h3>
          ${payments.length === 0
            ? html`<p class="text-sm text-muted">Aucun paiement enregistré.</p>`
            : html`
                <ul class="mt-1 space-y-1 text-sm">
                  ${payments.map(
                    (payment) => html`<li class="flex items-center justify-between gap-3 border-b border-line/70 py-1 last:border-0">
                      <span>${formatDate(payment.date)} — ${payment.method}</span>
                      <span class="${payment.direction === 'in' ? 'text-brand-dark' : 'text-danger'}">
                        ${payment.direction === 'in' ? '+' : '−'} ${formatMoney(payment.amount)}
                      </span>
                    </li>`,
                  )}
                </ul>
              `}
        </div>

        ${returns.length > 0
          ? html`
              <div>
                <h3 class="text-sm font-semibold text-brand-dark">Retours au fournisseur</h3>
                <ul class="mt-1 space-y-1 text-sm">
                  ${returns.map(
                    (item) => html`<li class="flex items-center justify-between gap-3 border-b border-line/70 py-1 last:border-0">
                      <span>${item.reference} — ${formatDate(item.date)}</span>
                      <span>${formatMoney(item.total)}</span>
                    </li>`,
                  )}
                </ul>
              </div>
            `
          : ''}
        ${purchase.note ? html`<p class="text-sm text-muted">Note : ${purchase.note}</p>` : ''}
      </div>
    `),
  });
}

function openReceiveDialog(purchase) {
  inputDialog({
    title: 'Réceptionner l’achat',
    description: 'C’est à la réception que le stock augmente, au coût d’acquisition calculé.',
    label: 'Date de réception',
    type: 'date',
    value: todayISO(),
    confirmLabel: 'Réceptionner',
  }).then(async (date) => {
    if (!date) return;
    const result = await runAction(() => receivePurchaseAction(purchase.id, date), {
      successMessage: 'Achat réceptionné : le stock a été mis à jour.',
    });
    return result;
  });
}

function openPaymentForm(purchase) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    toast('Créez d’abord un compte de trésorerie.', 'warning');
    return;
  }
  const balance = purchaseBalance(purchase, { payments: state.payments, returns: state.returns });
  const settings = getSettings();

  modalForm({
    title: `Régler l’achat ${purchase.reference}`,
    description: `Solde restant dû : ${formatMoney(balance)}.`,
    fields: [
      { node: field({ name: 'amount', label: 'Montant versé (FCFA)', type: 'number', min: '0', value: balance, required: true }), span: 2 },
      {
        node: field({
          name: 'method',
          label: 'Moyen de paiement',
          type: 'select',
          value: (settings.paymentMethods || ['Espèces'])[0],
          options: optionsFrom(settings.paymentMethods || ['Espèces']),
        }),
      },
      { node: field({ name: 'date', label: 'Date du paiement', type: 'date', value: todayISO(), required: true }) },
      {
        node: field({
          name: 'accountId',
          label: 'Compte de trésorerie',
          type: 'select',
          value: accounts[0].id,
          options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
          required: true,
        }),
        span: 2,
      },
      { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }), span: 2 },
    ],
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
      return Boolean(result);
    },
  });
}

function openReturnForm(purchase) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  const settings = getSettings();
  const lines = returnableLines(state, purchase).filter((entry) => entry.remaining > 0);
  if (lines.length === 0) {
    toast('Toutes les lignes de cet achat ont déjà été retournées.', 'warning');
    return;
  }

  const rows = lines
    .map(
      (entry) => html`
        <tr data-line="${entry.line.id}">
          <td class="font-medium">${entry.line.label}</td>
          <td class="text-right">${formatQuantity(entry.line.quantity, entry.line.unit)}</td>
          <td class="text-right">${formatQuantity(entry.remaining)}</td>
          <td class="w-28">
            <input type="number" class="input text-right" data-return-quantity min="0" max="${entry.remaining}" step="any" value="0" aria-label="Quantité retournée" />
          </td>
        </tr>
      `,
    )
    .join('');

  const extra = element(html`
    <div class="space-y-4">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Produit</th><th class="text-right">Acheté</th><th class="text-right">Retournable</th><th class="text-right">À retourner</th></tr>
          </thead>
          <tbody>${raw(rows)}</tbody>
        </table>
      </div>
    </div>
  `);

  modalForm({
    title: `Retour au fournisseur — ${purchase.reference}`,
    description: 'Le stock diminue, la dette fournisseur diminue et un remboursement éventuel augmente la trésorerie.',
    size: 'lg',
    fields: [
      { node: field({ name: 'date', label: 'Date du retour', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'reason', label: 'Motif', value: '', placeholder: 'Produit défectueux…' }) },
      { node: field({ name: 'refundAmount', label: 'Remboursement reçu (FCFA)', type: 'number', min: '0', value: 0, hint: 'Montant effectivement remboursé par le fournisseur.' }) },
      {
        node: field({
          name: 'refundMethod',
          label: 'Moyen du remboursement',
          type: 'select',
          value: (settings.paymentMethods || ['Espèces'])[0],
          options: optionsFrom(settings.paymentMethods || ['Espèces']),
        }),
      },
      {
        node: field({
          name: 'accountId',
          label: 'Compte qui reçoit le remboursement',
          type: 'select',
          value: accounts.length > 0 ? accounts[0].id : '',
          options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
        }),
        span: 2,
      },
    ],
    extra,
    submitLabel: 'Enregistrer le retour',
    onSubmit: async (values) => {
      const selected = [...extra.querySelectorAll('tr[data-line]')]
        .map((row) => ({
          purchaseLineId: row.dataset.line,
          quantity: toNumber(qs('[data-return-quantity]', row).value, 0),
        }))
        .filter((entry) => entry.quantity > 0);
      if (selected.length === 0) {
        toast('Saisissez au moins une quantité à retourner.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          returnPurchase({
            purchaseId: purchase.id,
            lines: selected,
            date: values.date,
            reason: values.reason,
            refundAmount: toNumber(values.refundAmount, 0),
            refundMethod: values.refundMethod,
            accountId: values.accountId,
          }),
        { successMessage: 'Retour enregistré.' },
      );
      return Boolean(result);
    },
  });
}

function openCancelForm(purchase) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  const paid = netPaid(state, purchase);
  const settings = getSettings();

  modalForm({
    title: `Annuler l’achat ${purchase.reference}`,
    description: 'L’achat est conservé dans l’historique avec le statut « annulée ». Le stock reçu est retiré et un remboursement est enregistré si un paiement avait été versé.',
    fields: [
      { node: field({ name: 'date', label: 'Date d’annulation', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'reason', label: 'Motif de l’annulation', value: '', required: true }) },
      ...(paid > 0
        ? [
            {
              node: field({
                name: 'method',
                label: 'Moyen du remboursement reçu',
                type: 'select',
                value: (settings.paymentMethods || ['Espèces'])[0],
                options: optionsFrom(settings.paymentMethods || ['Espèces']),
              }),
            },
            {
              node: field({
                name: 'accountId',
                label: 'Compte qui reçoit le remboursement',
                type: 'select',
                value: accounts.length > 0 ? accounts[0].id : '',
                options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
                hint: `Un remboursement de ${formatMoney(paid)} sera enregistré.`,
                required: true,
              }),
            },
          ]
        : []),
    ],
    submitLabel: 'Annuler l’achat',
    onSubmit: async (values) => {
      if (!values.reason || !String(values.reason).trim()) {
        toast('Indiquez le motif de l’annulation.', 'warning');
        return false;
      }
      const result = await runAction(
        () => cancelPurchase({ purchaseId: purchase.id, date: values.date, reason: values.reason, method: values.method, accountId: values.accountId }),
        { successMessage: 'Achat annulé.' },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx, api) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Achats' }));
    wrapper.append(needsActivityNotice({ ctx }));
    return wrapper;
  }

  const filters = getFilters();
  const inPeriod = (record) => {
    const date = record.date || '';
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.activityId && record.activityId !== filters.activityId) return false;
    return true;
  };

  const purchases = [...state.purchases]
    .filter(inPeriod)
    .filter((purchase) => !statusFilter || purchase.status === statusFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const receivedTotal = state.purchases
    .filter(inPeriod)
    .filter((purchase) => purchase.status === DOCUMENT_STATUS.RECEIVED)
    .reduce((total, purchase) => total + purchaseTotal(purchase), 0);
  const orderedCount = state.purchases.filter((purchase) => purchase.status === DOCUMENT_STATUS.ORDERED).length;
  const payables = totalPayables({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: filters.activityId },
  });
  const paidTotal = state.purchases
    .filter(inPeriod)
    .reduce((total, purchase) => total + Math.max(netPaid(state, purchase), 0), 0);

  wrapper.append(
    pageHeader({
      title: 'Achats',
      subtitle: 'Commandes, réceptions et dettes fournisseurs.',
      actions: [
        button({ label: 'Nouvel achat', iconName: 'plus', variant: 'primary', onClick: () => openPurchaseForm() }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (purchases.length === 0) {
              toast('Aucun achat à exporter.', 'warning');
              return;
            }
            const { lines } = exportRows({
              filename: `mon-commerce-achats-${todayISO()}.csv`,
              columns: [
                { key: 'reference', label: 'Référence' },
                { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
                { key: 'supplier', label: 'Fournisseur', format: (row) => state.suppliers.find((entry) => entry.id === row.supplierId)?.name || '' },
                { key: 'status', label: 'Statut' },
                { key: 'total', label: 'Total (FCFA)', format: (row) => moneyValue(purchaseTotal(row)) },
                { key: 'paid', label: 'Payé (FCFA)', format: (row) => moneyValue(Math.max(netPaid(state, row), 0)) },
                { key: 'balance', label: 'Solde dû (FCFA)', format: (row) => moneyValue(purchaseBalance(row, { payments: state.payments, returns: state.returns })) },
              ],
              rows: purchases,
            });
            toast(`${lines} achat(s) exporté(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Achats réceptionnés', value: formatMoney(receivedTotal), hint: 'Période et activité filtrées', iconName: 'cart' }).outerHTML)}
        ${raw(kpiCard({ label: 'Dettes fournisseurs', value: formatMoney(payables), hint: 'Hors période : dettes encore ouvertes', tone: payables > 0 ? 'warning' : 'neutral', iconName: 'truck' }).outerHTML)}
        ${raw(kpiCard({ label: 'Commandes en attente', value: String(orderedCount), hint: 'Stock non encore augmenté', iconName: 'clock' }).outerHTML)}
        ${raw(kpiCard({ label: 'Paiements versés', value: formatMoney(paidTotal), hint: 'Sur les achats de la période', iconName: 'wallet' }).outerHTML)}
      </div>
    `),
  );

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher une référence ou un fournisseur…',
    caption: 'Liste des achats',
    columns: [
      { key: 'reference', label: 'Référence', render: (row) => html`<span class="font-semibold">${row.reference}</span>` },
      { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
      {
        key: 'supplier',
        label: 'Fournisseur',
        render: (row) => state.suppliers.find((entry) => entry.id === row.supplierId)?.name || '—',
      },
      { key: 'status', label: 'Statut', render: (row) => documentStatusBadge(row.status) },
      { key: 'total', label: 'Total', align: 'right', render: (row) => formatMoney(purchaseTotal(row)) },
      { key: 'paid', label: 'Payé', align: 'right', render: (row) => formatMoney(Math.max(netPaid(state, row), 0)) },
      {
        key: 'balance',
        label: 'Solde dû',
        align: 'right',
        render: (row) => {
          const balance = purchaseBalance(row, { payments: state.payments, returns: state.returns });
          return html`<span class="${balance > 0 ? 'text-warning font-semibold' : 'text-brand-dark'}">${formatMoney(balance)}</span>`;
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => {
          const buttons = [html`<button type="button" class="btn-ghost btn-sm" data-action="detail" data-id="${row.id}" title="Voir le détail">${raw(icon('search', { size: 14 }))}</button>`];
          if (row.status === DOCUMENT_STATUS.ORDERED) {
            buttons.push(html`<button type="button" class="btn-primary btn-sm" data-action="receive" data-id="${row.id}" title="Réceptionner">${raw(icon('check', { size: 14 }))}</button>`);
          }
          if (row.status === DOCUMENT_STATUS.RECEIVED) {
            const balance = purchaseBalance(row, { payments: state.payments, returns: state.returns });
            if (balance > 0.005) {
              buttons.push(html`<button type="button" class="btn-primary btn-sm" data-action="pay" data-id="${row.id}" title="Régler">${raw(icon('wallet', { size: 14 }))}</button>`);
            }
            if (returnableLines(state, row).some((entry) => entry.remaining > 0)) {
              buttons.push(html`<button type="button" class="btn-ghost btn-sm" data-action="return" data-id="${row.id}" title="Retour au fournisseur">${raw(icon('arrowLeft', { size: 14 }))}</button>`);
            }
          }
          if (row.status !== DOCUMENT_STATUS.CANCELLED) {
            buttons.push(html`<button type="button" class="btn-danger btn-sm" data-action="cancel" data-id="${row.id}" title="Annuler l’achat">${raw(icon('close', { size: 14 }))}</button>`);
          }
          return html`<div class="flex flex-wrap justify-end gap-1">${buttons}</div>`;
        },
      },
    ],
    rows: purchases,
    empty: { title: 'Aucun achat', message: 'Enregistrez votre premier achat pour alimenter le stock.', iconName: 'cart' },
  });

  delegate(table.element, 'click', '[data-action]', (event, target) => {
    const purchase = state.purchases.find((entry) => entry.id === target.dataset.id);
    if (!purchase) return;
    const action = target.dataset.action;
    if (action === 'detail') openPurchaseDetail(purchase);
    if (action === 'receive') openReceiveDialog(purchase);
    if (action === 'pay') openPaymentForm(purchase);
    if (action === 'return') openReturnForm(purchase);
    if (action === 'cancel') openCancelForm(purchase);
  });

  const statusToolbar = element(html`
    <div class="card card-pad no-print mb-3 flex flex-wrap items-end gap-3">
      <div class="min-w-[200px]">
        <label class="label" for="purchase-status-filter">Statut de l’achat</label>
        <select id="purchase-status-filter" class="input">
          <option value="">Tous les statuts</option>
          <option value="ordered" ${statusFilter === 'ordered' ? 'selected' : ''}>Commandé</option>
          <option value="received" ${statusFilter === 'received' ? 'selected' : ''}>Réceptionné</option>
          <option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>Annulé</option>
        </select>
      </div>
      <p class="text-xs text-muted">${purchases.length} achat(s) affiché(s).</p>
    </div>
  `);
  qs('#purchase-status-filter', statusToolbar).addEventListener('change', (event) => {
    statusFilter = event.target.value;
    api.repaint();
  });

  wrapper.append(statusToolbar);
  wrapper.append(table.element);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Règles appliquées aux achats',
      items: [
        'Le stock augmente uniquement à la réception, jamais à la commande.',
        'Un achat non payé crée une dette fournisseur (aucun décaissement tant que rien n’est versé).',
        'Transport et frais annexes sont répartis au prorata des lignes et intégrés au coût d’acquisition.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
