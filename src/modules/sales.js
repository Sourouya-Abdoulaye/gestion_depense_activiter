/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Ventes & caisse »
 *
 * Une vente validée fige le coût des produits vendus (coût moyen pondéré) et
 * sort le stock. Un encaissement partiel crée une créance client suivie ici.
 * Rien n'est jamais supprimé : retours et annulations créent des documents
 * compensatoires.
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
import {
  cashInFor,
  cashOutFor,
  receivableList,
  returnsFor,
  saleBalance,
  saleLineNet,
  saleTotal,
  totalReceivables,
} from '../services/finance.js';
import { cancelSale, createSale, paySale, returnSale } from '../services/actions.js';
import { exportRows, moneyValue } from '../services/csv.js';

export const meta = { path: 'ventes', title: 'Ventes & caisse' };

let statusFilter = '';

/* ------------------------------- utilitaires ---------------------------- */

function netReceived(state, sale) {
  return cashInFor(state.payments, 'sale', sale.id) - cashOutFor(state.payments, 'sale', sale.id);
}

function saleReturns(state, sale) {
  return returnsFor(state.returns, { kind: 'sale', sourceId: sale.id });
}

function returnableLines(state, sale) {
  return (sale.lines || []).map((line) => {
    const returned = saleReturns(state, sale)
      .flatMap((item) => item.lines || [])
      .filter((entry) => entry.saleLineId === line.id)
      .reduce((total, entry) => total + toNumber(entry.quantity, 0), 0);
    return { line, returned, remaining: toNumber(line.quantity, 0) - returned };
  });
}

function receiptContext(state, sale) {
  const filters = getFilters();
  return {
    settings: getSettings(),
    activity: state.activities.find((entry) => entry.id === sale.activityId || entry.id === filters.activityId) || null,
    customer: state.customers.find((entry) => entry.id === sale.customerId) || null,
    payments: state.payments.filter((payment) => payment.partyType === 'sale' && payment.partyId === sale.id),
    returns: saleReturns(state, sale),
    netTotal: saleTotal(sale) - saleReturns(state, sale).reduce((total, item) => total + item.total, 0),
    balance: saleBalance(sale, { payments: state.payments, returns: state.returns }),
  };
}

/* ----------------------------- formulaire vente ------------------------- */

function openSaleForm() {
  const state = getState();
  const settings = getSettings();
  const products = state.products.filter((product) => product.status !== 'archived');
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (products.length === 0) {
    toast('Ajoutez d’abord au moins un produit dans « Produits & stock ».', 'warning', { duration: 6000 });
    return;
  }

  const lines = createLinesEditor({ products, priceField: 'price' });
  const payments = createPaymentsEditor({
    methods: settings.paymentMethods || ['Espèces'],
    accounts,
    initial: accounts.length > 0 ? [{ amount: '', method: (settings.paymentMethods || ['Espèces'])[0], accountId: accounts[0].id }] : [],
    hint: 'Pour une vente à crédit, laissez le montant vide et choisissez un client.',
  });

  const fields = [
    {
      node: field({
        name: 'customerId',
        label: 'Client (facultatif)',
        type: 'select',
        value: '',
        options: optionsFrom(state.customers.map((customer) => ({ value: customer.id, label: customer.name })), { placeholder: '— Client de passage —' }),
        hint: 'Obligatoire pour une vente à crédit (sans encaissement).',
      }),
    },
    { node: field({ name: 'date', label: 'Date de la vente', type: 'date', value: todayISO(), required: true }) },
    { node: field({ name: 'discount', label: 'Remise globale (FCFA)', type: 'number', min: '0', value: 0 }) },
    { node: field({ name: 'otherFees', label: 'Frais supplémentaires (FCFA)', type: 'number', min: '0', value: 0 }) },
    { node: field({ name: 'dueDate', label: 'Date d’échéance (vente à crédit)', type: 'date', value: '' }) },
    { node: field({ name: 'reference', label: 'Référence (facultatif)', value: '', placeholder: 'Générée automatiquement si vide' }) },
    { node: element(html`<div><p class="label">Produits vendus</p></div>`), span: 2 },
    { node: lines.element, span: 2 },
    { node: element(html`<div><p class="label">Encaissement immédiat</p></div>`), span: 2 },
    { node: payments.element, span: 2 },
    { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }), span: 2 },
  ];

  modalForm({
    title: 'Nouvelle vente',
    description: 'Le stock est vérifié avant validation ; le coût de revient est figé au moment de la vente.',
    size: 'xl',
    fields,
    submitLabel: 'Enregistrer la vente',
    onSubmit: async (values) => {
      const items = lines.getLines();
      if (items.length === 0) {
        toast('Ajoutez au moins une ligne de produit avec sa quantité.', 'warning');
        return false;
      }
      const requested = payments.getPayments();
      if (requested.length === 0 && !values.customerId) {
        toast('Une vente sans encaissement doit être rattachée à un client pour suivre la créance.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          createSale({
            customerId: values.customerId,
            date: values.date,
            discount: toNumber(values.discount, 0),
            otherFees: toNumber(values.otherFees, 0),
            dueDate: values.dueDate,
            reference: values.reference,
            note: values.note,
            items,
            payments: requested,
            activityId: getFilters().activityId || undefined,
          }),
        { successMessage: 'Vente enregistrée.' },
      );
      if (result) toast('Vous pouvez imprimer le reçu depuis la ligne de la vente.', 'info', { duration: 5000 });
      return Boolean(result);
    },
  });
}

/* --------------------------- actions sur une vente ---------------------- */

function openSaleDetail(sale) {
  const state = getState();
  const customer = state.customers.find((entry) => entry.id === sale.customerId);
  const payments = state.payments.filter((payment) => payment.partyType === 'sale' && payment.partyId === sale.id);
  const returns = saleReturns(state, sale);
  const balance = saleBalance(sale, { payments: state.payments, returns: state.returns });

  openModal({
    title: `Vente ${sale.reference}`,
    description: `${customer ? customer.name : 'Client de passage'} — ${formatDate(sale.date)}`,
    size: 'lg',
    content: element(html`
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          ${documentStatusBadge(sale.status)}
          <span class="badge badge-neutral">Total ${formatMoney(saleTotal(sale))}</span>
          <span class="badge ${balance > 0 ? 'badge-warning' : 'badge-brand'}">
            ${balance > 0 ? `Reste dû ${formatMoney(balance)}` : 'Encaissée'}
          </span>
          ${sale.cancelledAt ? html`<span class="badge badge-danger">Annulée le ${formatDate(sale.cancelledAt)}</span>` : ''}
        </div>
        ${sale.cancelReason ? html`<p class="text-sm text-muted">Motif d’annulation : ${sale.cancelReason}</p>` : ''}

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Produit</th>
                <th class="text-right">Qté</th>
                <th class="text-right">Prix unitaire</th>
                <th class="text-right">Remise</th>
                <th class="text-right">Total net</th>
                <th class="text-right">Marge</th>
              </tr>
            </thead>
            <tbody>
              ${(sale.lines || []).map(
                (line) => html`
                  <tr>
                    <td class="font-medium">${line.label}</td>
                    <td class="text-right">${formatQuantity(line.quantity, line.unit)}</td>
                    <td class="text-right">${formatMoney(line.unitPrice)}</td>
                    <td class="text-right">${formatMoney(line.discount || 0)}</td>
                    <td class="text-right font-semibold">${formatMoney(saleLineNet(line))}</td>
                    <td class="text-right ${saleLineNet(line) - line.quantity * line.unitCost < 0 ? 'text-danger' : 'text-brand-dark'}">
                      ${formatMoney(saleLineNet(line) - line.quantity * line.unitCost)}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>

        <div class="grid gap-2 text-sm sm:grid-cols-2">
          <p>Remise globale : <strong>− ${formatMoney(sale.discount || 0)}</strong></p>
          <p>Frais : <strong>${formatMoney(sale.otherFees || 0)}</strong></p>
          <p>Coût des produits vendus : <strong>${formatMoney((sale.lines || []).reduce((total, line) => total + line.quantity * line.unitCost, 0))}</strong></p>
          <p>Déjà encaissé : <strong>${formatMoney(netReceived(state, sale))}</strong></p>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-brand-dark">Encaissements</h3>
          ${payments.length === 0
            ? html`<p class="text-sm text-muted">Aucun encaissement : vente à crédit.</p>`
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
                <h3 class="text-sm font-semibold text-brand-dark">Retours clients</h3>
                <ul class="mt-1 space-y-1 text-sm">
                  ${returns.map(
                    (item) => html`<li class="flex items-center justify-between gap-3 border-b border-line/70 py-1 last:border-0">
                      <span>${item.reference} — ${formatDate(item.date)}${item.reason ? ` (${item.reason})` : ''}</span>
                      <span>${formatMoney(item.total)}</span>
                    </li>`,
                  )}
                </ul>
              </div>
            `
          : ''}
      </div>
    `),
  });
}

function openPaymentForm(sale) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    toast('Créez d’abord un compte de trésorerie.', 'warning');
    return;
  }
  const balance = saleBalance(sale, { payments: state.payments, returns: state.returns });
  const settings = getSettings();

  modalForm({
    title: `Encaisser la vente ${sale.reference}`,
    description: `Solde restant dû : ${formatMoney(balance)}.`,
    fields: [
      { node: field({ name: 'amount', label: 'Montant reçu (FCFA)', type: 'number', min: '0', value: balance, required: true }), span: 2 },
      {
        node: field({
          name: 'method',
          label: 'Moyen de paiement',
          type: 'select',
          value: (settings.paymentMethods || ['Espèces'])[0],
          options: optionsFrom(settings.paymentMethods || ['Espèces']),
        }),
      },
      { node: field({ name: 'date', label: 'Date de l’encaissement', type: 'date', value: todayISO(), required: true }) },
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
      return Boolean(result);
    },
  });
}

function openReturnForm(sale) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  const settings = getSettings();
  const lines = returnableLines(state, sale).filter((entry) => entry.remaining > 0);
  if (lines.length === 0) {
    toast('Toutes les lignes de cette vente ont déjà été retournées.', 'warning');
    return;
  }

  const rows = lines
    .map(
      (entry) => html`
        <tr data-line="${entry.line.id}">
          <td class="font-medium">${entry.line.label}</td>
          <td class="text-right">${formatQuantity(entry.line.quantity, entry.line.unit)}</td>
          <td class="text-right">${formatQuantity(entry.remaining)}</td>
          <td class="text-right">${formatMoney(entry.line.unitPrice)}</td>
          <td class="w-28">
            <input type="number" class="input text-right" data-return-quantity min="0" max="${entry.remaining}" step="any" value="0" aria-label="Quantité retournée" />
          </td>
        </tr>
      `,
    )
    .join('');

  const extra = element(html`
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Produit</th><th class="text-right">Vendu</th><th class="text-right">Retournable</th><th class="text-right">Prix</th><th class="text-right">À retourner</th></tr>
        </thead>
        <tbody>${raw(rows)}</tbody>
      </table>
    </div>
  `);

  modalForm({
    title: `Retour client — ${sale.reference}`,
    description: 'Le stock réintègre le catalogue au coût figé de la vente ; un remboursement éventuel sort de la trésorerie.',
    size: 'lg',
    fields: [
      { node: field({ name: 'date', label: 'Date du retour', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'reason', label: 'Motif', value: '', placeholder: 'Taille inadaptée…' }) },
      { node: field({ name: 'refundAmount', label: 'Remboursement rendu au client (FCFA)', type: 'number', min: '0', value: 0, hint: 'Uniquement si le client est effectivement remboursé.' }) },
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
          label: 'Compte utilisé pour le remboursement',
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
          saleLineId: row.dataset.line,
          quantity: toNumber(qs('[data-return-quantity]', row).value, 0),
        }))
        .filter((entry) => entry.quantity > 0);
      if (selected.length === 0) {
        toast('Saisissez au moins une quantité à retourner.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          returnSale({
            saleId: sale.id,
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

function openCancelForm(sale) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  const held = Math.max(netReceived(state, sale) - saleReturns(state, sale).reduce((total, item) => total + item.total, 0), 0);
  const settings = getSettings();

  modalForm({
    title: `Annuler la vente ${sale.reference}`,
    description: 'La vente reste dans l’historique avec le statut « annulée ». Le stock est réintégré et l’argent encore détenu est remboursé.',
    fields: [
      { node: field({ name: 'date', label: 'Date d’annulation', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'reason', label: 'Motif de l’annulation', value: '', required: true }) },
      ...(held > 0.01
        ? [
            {
              node: field({
                name: 'method',
                label: 'Moyen du remboursement',
                type: 'select',
                value: (settings.paymentMethods || ['Espèces'])[0],
                options: optionsFrom(settings.paymentMethods || ['Espèces']),
              }),
            },
            {
              node: field({
                name: 'accountId',
                label: 'Compte qui rend l’argent',
                type: 'select',
                value: accounts.length > 0 ? accounts[0].id : '',
                options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
                hint: `Un remboursement de ${formatMoney(held)} sera enregistré.`,
                required: true,
              }),
            },
          ]
        : []),
    ],
    submitLabel: 'Annuler la vente',
    onSubmit: async (values) => {
      if (!values.reason || !String(values.reason).trim()) {
        toast('Indiquez le motif de l’annulation.', 'warning');
        return false;
      }
      const result = await runAction(
        () => cancelSale({ saleId: sale.id, date: values.date, reason: values.reason, method: values.method, accountId: values.accountId }),
        { successMessage: 'Vente annulée.' },
      );
      return Boolean(result);
    },
  });
}

async function downloadReceipt(sale) {
  const state = getState();
  try {
    const { downloadSaleReceiptPdf } = await import('../services/documents.js');
    const filename = downloadSaleReceiptPdf(sale, receiptContext(state, sale));
    toast(`Reçu enregistré : ${filename}`, 'success');
  } catch (error) {
    toast(error && error.message ? error.message : 'Génération du reçu impossible.', 'error', { duration: 6000 });
  }
}

async function printReceipt(sale) {
  const state = getState();
  try {
    const { printSaleReceipt } = await import('../services/documents.js');
    const opened = printSaleReceipt(sale, receiptContext(state, sale));
    if (!opened) toast('Autorisez l’ouverture de fenêtres pour imprimer le reçu.', 'warning', { duration: 6000 });
  } catch (error) {
    toast(error && error.message ? error.message : 'Impression impossible.', 'error', { duration: 6000 });
  }
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx, api) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Ventes & caisse' }));
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

  const sales = [...state.sales]
    .filter(inPeriod)
    .filter((sale) => !statusFilter || sale.status === statusFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const validated = state.sales.filter(inPeriod).filter((sale) => sale.status === DOCUMENT_STATUS.VALIDATED && !sale.cancelledAt);
  const revenue = validated.reduce((total, sale) => total + saleTotal(sale), 0);
  const collected = state.payments
    .filter(inPeriod)
    .filter((payment) => payment.partyType === 'sale')
    .reduce((total, payment) => total + (payment.direction === 'in' ? payment.amount : -payment.amount), 0);
  const receivables = totalReceivables({ sales: state.sales, payments: state.payments, returns: state.returns, filters: { activityId: filters.activityId } });
  const averageBasket = validated.length > 0 ? revenue / validated.length : 0;

  wrapper.append(
    pageHeader({
      title: 'Ventes & caisse',
      subtitle: 'Ventes encaissées, ventes à crédit et créances clients.',
      actions: [
        button({ label: 'Nouvelle vente', iconName: 'plus', variant: 'primary', onClick: () => openSaleForm(), className: 'open-sale-form' }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (sales.length === 0) {
              toast('Aucune vente à exporter.', 'warning');
              return;
            }
            const { lines } = exportRows({
              filename: `mon-commerce-ventes-${todayISO()}.csv`,
              columns: [
                { key: 'reference', label: 'Référence' },
                { key: 'date', label: 'Date', format: (row) => formatDate(row.date) },
                { key: 'customer', label: 'Client', format: (row) => state.customers.find((entry) => entry.id === row.customerId)?.name || 'Client de passage' },
                { key: 'status', label: 'Statut' },
                { key: 'total', label: 'Total (FCFA)', format: (row) => moneyValue(saleTotal(row)) },
                { key: 'received', label: 'Encaissé (FCFA)', format: (row) => moneyValue(Math.max(netReceived(state, row), 0)) },
                { key: 'balance', label: 'Solde dû (FCFA)', format: (row) => moneyValue(saleBalance(row, { payments: state.payments, returns: state.returns })) },
              ],
              rows: sales,
            });
            toast(`${lines} vente(s) exportée(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Chiffre d’affaires', value: formatMoney(revenue), hint: `${validated.length} vente(s) validée(s)`, iconName: 'receipt' }).outerHTML)}
        ${raw(kpiCard({ label: 'Encaissements', value: formatMoney(collected), hint: 'Paiements réellement reçus sur la période', tone: 'positive', iconName: 'wallet' }).outerHTML)}
        ${raw(kpiCard({ label: 'Créances clients', value: formatMoney(receivables), hint: 'Montants restant à recevoir', tone: receivables > 0 ? 'warning' : 'neutral', iconName: 'users' }).outerHTML)}
        ${raw(kpiCard({ label: 'Panier moyen', value: formatMoney(averageBasket), hint: 'Chiffre d’affaires ÷ nombre de ventes', iconName: 'chart' }).outerHTML)}
      </div>
    `),
  );

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher une référence ou un client…',
    caption: 'Liste des ventes',
    columns: [
      { key: 'reference', label: 'Référence', render: (row) => html`<span class="font-semibold">${row.reference}</span>` },
      { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
      { key: 'customer', label: 'Client', render: (row) => state.customers.find((entry) => entry.id === row.customerId)?.name || 'Client de passage' },
      { key: 'status', label: 'Statut', render: (row) => documentStatusBadge(row.status) },
      { key: 'total', label: 'Total', align: 'right', render: (row) => formatMoney(saleTotal(row)) },
      { key: 'received', label: 'Encaissé', align: 'right', render: (row) => formatMoney(Math.max(netReceived(state, row), 0)) },
      {
        key: 'balance',
        label: 'Solde dû',
        align: 'right',
        render: (row) => {
          const balance = saleBalance(row, { payments: state.payments, returns: state.returns });
          return html`<span class="${balance > 0 ? 'text-warning font-semibold' : 'text-brand-dark'}">${formatMoney(balance)}</span>`;
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => {
          const buttons = [
            html`<button type="button" class="btn-ghost btn-sm" data-action="detail" data-id="${row.id}" title="Voir le détail">${raw(icon('search', { size: 14 }))}</button>`,
            html`<button type="button" class="btn-ghost btn-sm" data-action="pdf" data-id="${row.id}" title="Reçu PDF">${raw(icon('download', { size: 14 }))}</button>`,
            html`<button type="button" class="btn-ghost btn-sm" data-action="print" data-id="${row.id}" title="Imprimer le reçu">${raw(icon('printer', { size: 14 }))}</button>`,
          ];
          if (row.status === DOCUMENT_STATUS.VALIDATED) {
            const balance = saleBalance(row, { payments: state.payments, returns: state.returns });
            if (balance > 0.005) {
              buttons.push(html`<button type="button" class="btn-primary btn-sm" data-action="pay" data-id="${row.id}" title="Encaisser">${raw(icon('wallet', { size: 14 }))}</button>`);
            }
            if (returnableLines(state, row).some((entry) => entry.remaining > 0)) {
              buttons.push(html`<button type="button" class="btn-ghost btn-sm" data-action="return" data-id="${row.id}" title="Retour client">${raw(icon('arrowLeft', { size: 14 }))}</button>`);
            }
            buttons.push(html`<button type="button" class="btn-danger btn-sm" data-action="cancel" data-id="${row.id}" title="Annuler la vente">${raw(icon('close', { size: 14 }))}</button>`);
          }
          return html`<div class="flex flex-wrap justify-end gap-1">${buttons}</div>`;
        },
      },
    ],
    rows: sales,
    empty: { title: 'Aucune vente', message: 'Enregistrez votre première vente : le stock, la caisse et les marges se mettent à jour.', iconName: 'receipt' },
  });

  delegate(table.element, 'click', '[data-action]', async (event, target) => {
    const sale = state.sales.find((entry) => entry.id === target.dataset.id);
    if (!sale) return;
    const action = target.dataset.action;
    if (action === 'detail') openSaleDetail(sale);
    if (action === 'pay') openPaymentForm(sale);
    if (action === 'return') openReturnForm(sale);
    if (action === 'cancel') openCancelForm(sale);
    if (action === 'pdf') await downloadReceipt(sale);
    if (action === 'print') await printReceipt(sale);
  });

  const statusToolbar = element(html`
    <div class="card card-pad no-print mb-3 flex flex-wrap items-end gap-3">
      <div class="min-w-[200px]">
        <label class="label" for="sale-status-filter">Statut de la vente</label>
        <select id="sale-status-filter" class="input">
          <option value="">Tous les statuts</option>
          <option value="validated" ${statusFilter === 'validated' ? 'selected' : ''}>Validée</option>
          <option value="cancelled" ${statusFilter === 'cancelled' ? 'selected' : ''}>Annulée</option>
        </select>
      </div>
      <p class="text-xs text-muted">${sales.length} vente(s) affichée(s).</p>
    </div>
  `);
  qs('#sale-status-filter', statusToolbar).addEventListener('change', (event) => {
    statusFilter = event.target.value;
    api.repaint();
  });

  wrapper.append(statusToolbar);
  wrapper.append(table.element);

  const overdue = receivableList({ sales: state.sales, payments: state.payments, returns: state.returns, filters: { activityId: filters.activityId } }).filter((entry) => entry.overdueDays > 0);
  if (overdue.length > 0) {
    wrapper.append(
      noticePanel({
        tone: 'warning',
        title: `${overdue.length} créance(s) en retard`,
        items: overdue.slice(0, 6).map(
          (entry) => `${state.customers.find((customer) => customer.id === entry.sale.customerId)?.name || 'Client'} — ${entry.sale.reference} : ${formatMoney(entry.balance)} (${entry.overdueDays} jour(s) de retard)`,
        ),
      }),
    );
  }

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Règles appliquées aux ventes',
      items: [
        'Le chiffre d’affaires compte les ventes validées, nettes des remises et des retours.',
        'Les encaissements ne comptent que l’argent réellement reçu : une créance n’est pas une recette.',
        'Le coût des produits vendus est figé au moment de la vente (coût moyen pondéré).',
        'Une vente est refusée si le stock est insuffisant, sauf autorisation explicite dans les paramètres.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
