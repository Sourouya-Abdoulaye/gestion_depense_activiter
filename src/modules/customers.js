/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Clients »
 *
 * Fiche client et suivi des créances : une vente à crédit apparaît ici tant
 * qu'elle n'est pas intégralement encaissée. La suppression est refusée dès
 * qu'un historique de ventes existe, afin de ne jamais rompre la traçabilité.
 * ------------------------------------------------------------------------- */

import { html, element, raw, delegate } from '../shared/dom.js';
import { formatMoney } from '../shared/format.js';
import { formatDate } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  dataTable,
  emptyState,
  field,
  kpiCard,
  modalForm,
  noticePanel,
  openModal,
  pageHeader,
  runAction,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { getState } from '../services/state.js';
import { receivableList } from '../services/finance.js';
import { deleteCustomer, saveCustomer } from '../services/actions.js';
import { openSaleSettlement } from '../shared/settle-form.js';
import { exportRows } from '../services/csv.js';

export const meta = { path: 'clients', title: 'Clients' };

/* ------------------------------- formulaire ----------------------------- */

function openCustomerForm({ customer = null }) {
  modalForm({
    title: customer ? 'Modifier le client' : 'Nouveau client',
    fields: [
      { node: field({ name: 'name', label: 'Nom du client', value: customer?.name || '', required: true, placeholder: 'Ex. Awa Traoré' }) },
      { node: field({ name: 'phone', label: 'Téléphone', value: customer?.phone || '', placeholder: 'Ex. 07 00 00 00' }) },
      { node: field({ name: 'email', label: 'Courriel (facultatif)', type: 'email', value: customer?.email || '' }) },
      { node: field({ name: 'address', label: 'Adresse / quartier', value: customer?.address || '' }) },
      { node: field({ name: 'note', label: 'Note (facultatif)', type: 'textarea', rows: 2, value: customer?.note || '' }), span: 2 },
    ],
    submitLabel: customer ? 'Enregistrer' : 'Créer le client',
    onSubmit: async (values) => {
      if (!values.name || !String(values.name).trim()) {
        toast('Le nom du client est obligatoire.', 'warning');
        return false;
      }
      const result = await runAction(
        () => saveCustomer({ id: customer ? customer.id : undefined, ...values }),
        { successMessage: customer ? 'Client modifié.' : 'Client créé.' },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function customerDebts(customerId, receivables) {
  return receivables.filter((entry) => entry.sale.customerId === customerId);
}

function openDebtsModal(customer, receivables) {
  const state = getState();
  const entries = customerDebts(customer.id, receivables);
  const total = entries.reduce((sum, entry) => sum + entry.balance, 0);

  const body = element(html`
    <div class="space-y-3">
      ${entries.length === 0
        ? html`<p class="text-sm text-muted">Aucune créance en cours pour ce client.</p>`
        : html`
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr><th>Vente</th><th>Date</th><th>Échéance</th><th class="text-right">Solde dû</th><th class="text-right">Action</th></tr>
                </thead>
                <tbody>
                  ${entries.map(
                    (entry) => html`
                      <tr>
                        <td class="font-medium">${entry.sale.reference}</td>
                        <td>${formatDate(entry.sale.date)}</td>
                        <td class="${entry.overdueDays > 0 ? 'text-danger font-semibold' : ''}">
                          ${entry.dueDate ? formatDate(entry.dueDate) : '—'}${entry.overdueDays > 0 ? ` (${entry.overdueDays} j)` : ''}
                        </td>
                        <td class="text-right font-semibold">${formatMoney(entry.balance)}</td>
                        <td class="text-right">
                          <button type="button" class="btn-primary btn-sm" data-settle="${entry.sale.id}">Encaisser</button>
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `}
    </div>
  `);

  const modal = openModal({
    title: `Créances de ${customer.name}`,
    description: `Total restant à recevoir : ${formatMoney(total)}.`,
    size: 'lg',
    content: body,
  });

  delegate(body, 'click', '[data-settle]', (event, target) => {
    const sale = state.sales.find((entry) => entry.id === target.dataset.settle);
    if (!sale) return;
    modal.close();
    openSaleSettlement(sale);
  });
}

function paint(ctx) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');
  const filters = getFilters();
  const receivables = receivableList({
    sales: state.sales,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: filters.activityId },
  });

  wrapper.append(
    pageHeader({
      title: 'Clients',
      subtitle: 'Fiches clients et créances en cours.',
      actions: [
        button({ label: 'Nouveau client', iconName: 'plus', variant: 'primary', onClick: () => openCustomerForm({}) }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (state.customers.length === 0) {
              toast('Aucun client à exporter.', 'warning');
              return;
            }
            const { lines } = exportRows({
              filename: 'mon-commerce-clients.csv',
              columns: [
                { key: 'name', label: 'Nom' },
                { key: 'phone', label: 'Téléphone' },
                { key: 'address', label: 'Adresse' },
                {
                  key: 'du',
                  label: 'Créance (FCFA)',
                  format: (row) => customerDebts(row.id, receivables).reduce((sum, entry) => sum + entry.balance, 0),
                },
              ],
              rows: state.customers,
            });
            toast(`${lines} client(s) exporté(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  const totalDue = receivables.reduce((sum, entry) => sum + entry.balance, 0);
  const indebtedCustomers = state.customers.filter((customer) => customerDebts(customer.id, receivables).length > 0).length;

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Clients', value: String(state.customers.length), hint: 'Fiches enregistrées', iconName: 'users' }).outerHTML)}
        ${raw(kpiCard({ label: 'Créances totales', value: formatMoney(totalDue), hint: 'Toutes ventes à crédit confondues', tone: totalDue > 0 ? 'warning' : 'neutral', iconName: 'wallet' }).outerHTML)}
        ${raw(kpiCard({ label: 'Clients débiteurs', value: String(indebtedCustomers), hint: 'Avec au moins une créance ouverte', iconName: 'chart' }).outerHTML)}
        ${raw(kpiCard({ label: 'Ventes à crédit', value: String(receivables.length), hint: 'Documents encore non soldés', iconName: 'receipt' }).outerHTML)}
      </div>
    `),
  );

  if (state.customers.length === 0) {
    wrapper.append(
      emptyState({
        title: 'Aucun client',
        message: 'Ajoutez un client pour suivre les ventes à crédit et les encaissements.',
        actionLabel: 'Nouveau client',
        iconName: 'users',
        onAction: () => openCustomerForm({}),
      }),
    );
    return wrapper;
  }

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher un client (nom, téléphone)…',
    caption: 'Liste des clients',
    columns: [
      {
        key: 'name',
        label: 'Client',
        render: (row) => html`<div class="min-w-0">
          <p class="font-semibold text-ink">${row.name}</p>
          <p class="text-xs text-muted">${row.phone || 'sans téléphone'}</p>
        </div>`,
      },
      { key: 'address', label: 'Adresse', render: (row) => row.address || '—' },
      {
        key: 'sales',
        label: 'Ventes',
        align: 'center',
        render: (row) => String(state.sales.filter((sale) => sale.customerId === row.id).length),
      },
      {
        key: 'due',
        label: 'Créance',
        align: 'right',
        render: (row) => {
          const due = customerDebts(row.id, receivables).reduce((sum, entry) => sum + entry.balance, 0);
          return html`<span class="${due > 0 ? 'text-warning font-semibold' : 'text-brand-dark'}">${formatMoney(due)}</span>`;
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => html`
          <div class="flex justify-end gap-1">
            <button type="button" class="btn-ghost btn-sm" data-action="debts" data-id="${row.id}" title="Voir les créances">${raw(icon('wallet', { size: 14 }))}</button>
            <button type="button" class="btn-ghost btn-sm" data-action="edit" data-id="${row.id}" title="Modifier">${raw(icon('edit', { size: 14 }))}</button>
            <button type="button" class="btn-danger btn-sm" data-action="delete" data-id="${row.id}" title="Supprimer">${raw(icon('trash', { size: 14 }))}</button>
          </div>
        `,
      },
    ],
    rows: state.customers,
    empty: { title: 'Aucun client', message: 'Ajoutez votre premier client.', iconName: 'users' },
  });

  delegate(table.element, 'click', '[data-action]', async (event, target) => {
    const customer = state.customers.find((entry) => entry.id === target.dataset.id);
    if (!customer) return;
    const action = target.dataset.action;
    if (action === 'edit') openCustomerForm({ customer });
    if (action === 'debts') openDebtsModal(customer, receivables);
    if (action === 'delete') {
      const confirmed = await confirmDialog({
        title: 'Supprimer ce client ?',
        message: `${customer.name} sera définitivement supprimé.`,
        details: 'La suppression est refusée si le client possède un historique de ventes : conservez sa fiche pour préserver la traçabilité.',
        confirmLabel: 'Supprimer',
      });
      if (confirmed) await runAction(() => deleteCustomer(customer.id), { successMessage: 'Client supprimé.' });
    }
  });

  wrapper.append(table.element);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Suivi des créances',
      items: [
        'Une vente devient une créance dès qu’elle n’est pas intégralement encaissée.',
        'Une créance n’est pas une recette : elle ne compte ni dans le chiffre d’affaires encaissé ni dans la trésorerie.',
        'Les retours clients viennent en déduction de la créance.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: () => paint(ctx) }).root; } };
