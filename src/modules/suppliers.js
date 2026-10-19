/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Fournisseurs »
 *
 * Fiche fournisseur et suivi des dettes : un achat réceptionné et non soldé
 * apparaît ici tant qu'il reste dû. La suppression est refusée dès qu'un
 * historique d'achats existe, afin de ne jamais rompre la traçabilité.
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
import { payableList } from '../services/finance.js';
import { deleteSupplier, saveSupplier } from '../services/actions.js';
import { openPurchaseSettlement } from '../shared/settle-form.js';
import { exportRows } from '../services/csv.js';

export const meta = { path: 'fournisseurs', title: 'Fournisseurs' };

/* ------------------------------- formulaire ----------------------------- */

function openSupplierForm({ supplier = null }) {
  modalForm({
    title: supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur',
    fields: [
      { node: field({ name: 'name', label: 'Nom du fournisseur', value: supplier?.name || '', required: true, placeholder: 'Ex. Grossiste Adjamé' }) },
      { node: field({ name: 'phone', label: 'Téléphone', value: supplier?.phone || '' }) },
      { node: field({ name: 'email', label: 'Courriel (facultatif)', type: 'email', value: supplier?.email || '' }) },
      { node: field({ name: 'address', label: 'Adresse / quartier', value: supplier?.address || '' }) },
      { node: field({ name: 'note', label: 'Note (facultatif)', type: 'textarea', rows: 2, value: supplier?.note || '' }), span: 2 },
    ],
    submitLabel: supplier ? 'Enregistrer' : 'Créer le fournisseur',
    onSubmit: async (values) => {
      if (!values.name || !String(values.name).trim()) {
        toast('Le nom du fournisseur est obligatoire.', 'warning');
        return false;
      }
      const result = await runAction(
        () => saveSupplier({ id: supplier ? supplier.id : undefined, ...values }),
        { successMessage: supplier ? 'Fournisseur modifié.' : 'Fournisseur créé.' },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function supplierDebts(supplierId, payables) {
  return payables.filter((entry) => entry.purchase.supplierId === supplierId);
}

function openDebtsModal(supplier, payables) {
  const state = getState();
  const entries = supplierDebts(supplier.id, payables);
  const total = entries.reduce((sum, entry) => sum + entry.balance, 0);

  const body = element(html`
    <div class="space-y-3">
      ${entries.length === 0
        ? html`<p class="text-sm text-muted">Aucune dette en cours pour ce fournisseur.</p>`
        : html`
            <div class="table-wrap">
              <table class="table table-stack">
                <thead>
                  <tr><th>Achat</th><th>Date</th><th>Échéance</th><th class="text-right">Solde dû</th><th class="text-right">Action</th></tr>
                </thead>
                <tbody>
                  ${entries.map(
                    (entry) => html`
                      <tr>
                        <td data-label="Achat" class="font-medium">${entry.purchase.reference}</td>
                        <td data-label="Date">${formatDate(entry.purchase.date)}</td>
                        <td data-label="Échéance" class="${entry.overdueDays > 0 ? 'text-danger font-semibold' : ''}">
                          ${entry.dueDate ? formatDate(entry.dueDate) : '—'}${entry.overdueDays > 0 ? ` (${entry.overdueDays} j)` : ''}
                        </td>
                        <td data-label="Solde dû" class="text-right font-semibold">${formatMoney(entry.balance)}</td>
                        <td data-label="Action" class="text-right">
                          <button type="button" class="btn-primary btn-sm" data-settle="${entry.purchase.id}">Payer</button>
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
    title: `Dettes envers ${supplier.name}`,
    description: `Total restant à payer : ${formatMoney(total)}.`,
    size: 'lg',
    content: body,
  });

  delegate(body, 'click', '[data-settle]', (event, target) => {
    const purchase = state.purchases.find((entry) => entry.id === target.dataset.settle);
    if (!purchase) return;
    modal.close();
    openPurchaseSettlement(purchase);
  });
}

function paint(ctx) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');
  const filters = getFilters();
  const payables = payableList({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: filters.activityId },
  });

  wrapper.append(
    pageHeader({
      title: 'Fournisseurs',
      subtitle: 'Fiches fournisseurs et dettes en cours.',
      actions: [
        button({ label: 'Nouveau fournisseur', iconName: 'plus', variant: 'primary', onClick: () => openSupplierForm({}) }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (state.suppliers.length === 0) {
              toast('Aucun fournisseur à exporter.', 'warning');
              return;
            }
            const { lines } = exportRows({
              filename: 'mon-commerce-fournisseurs.csv',
              columns: [
                { key: 'name', label: 'Nom' },
                { key: 'phone', label: 'Téléphone' },
                { key: 'address', label: 'Adresse' },
                {
                  key: 'du',
                  label: 'Dette (FCFA)',
                  format: (row) => supplierDebts(row.id, payables).reduce((sum, entry) => sum + entry.balance, 0),
                },
              ],
              rows: state.suppliers,
            });
            toast(`${lines} fournisseur(s) exporté(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  const totalDue = payables.reduce((sum, entry) => sum + entry.balance, 0);
  const indebtedSuppliers = state.suppliers.filter((supplier) => supplierDebts(supplier.id, payables).length > 0).length;

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Fournisseurs', value: String(state.suppliers.length), hint: 'Fiches enregistrées', iconName: 'truck' }).outerHTML)}
        ${raw(kpiCard({ label: 'Dettes totales', value: formatMoney(totalDue), hint: 'Toutes dettes réceptionnées confondues', tone: totalDue > 0 ? 'warning' : 'neutral', iconName: 'wallet' }).outerHTML)}
        ${raw(kpiCard({ label: 'Fournisseurs à payer', value: String(indebtedSuppliers), hint: 'Avec au moins une dette ouverte', iconName: 'chart' }).outerHTML)}
        ${raw(kpiCard({ label: 'Achats non soldés', value: String(payables.length), hint: 'Documents encore dus', iconName: 'cart' }).outerHTML)}
      </div>
    `),
  );

  if (state.suppliers.length === 0) {
    wrapper.append(
      emptyState({
        title: 'Aucun fournisseur',
        message: 'Ajoutez un fournisseur pour suivre les achats à crédit et les paiements.',
        actionLabel: 'Nouveau fournisseur',
        iconName: 'truck',
        onAction: () => openSupplierForm({}),
      }),
    );
    return wrapper;
  }

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher un fournisseur (nom, téléphone)…',
    caption: 'Liste des fournisseurs',
    columns: [
      {
        key: 'name',
        label: 'Fournisseur',
        render: (row) => html`<div class="min-w-0">
          <p class="font-semibold text-ink">${row.name}</p>
          <p class="text-xs text-muted">${row.phone || 'sans téléphone'}</p>
        </div>`,
      },
      { key: 'address', label: 'Adresse', render: (row) => row.address || '—' },
      {
        key: 'purchases',
        label: 'Achats',
        align: 'center',
        render: (row) => String(state.purchases.filter((purchase) => purchase.supplierId === row.id).length),
      },
      {
        key: 'due',
        label: 'Dette',
        align: 'right',
        render: (row) => {
          const due = supplierDebts(row.id, payables).reduce((sum, entry) => sum + entry.balance, 0);
          return html`<span class="${due > 0 ? 'text-warning font-semibold' : 'text-brand-dark'}">${formatMoney(due)}</span>`;
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => html`
          <div class="flex justify-end gap-1">
            <button type="button" class="btn-ghost btn-sm" data-action="debts" data-id="${row.id}" title="Voir les dettes">${raw(icon('wallet', { size: 14 }))}</button>
            <button type="button" class="btn-ghost btn-sm" data-action="edit" data-id="${row.id}" title="Modifier">${raw(icon('edit', { size: 14 }))}</button>
            <button type="button" class="btn-danger btn-sm" data-action="delete" data-id="${row.id}" title="Supprimer">${raw(icon('trash', { size: 14 }))}</button>
          </div>
        `,
      },
    ],
    rows: state.suppliers,
    empty: { title: 'Aucun fournisseur', message: 'Ajoutez votre premier fournisseur.', iconName: 'truck' },
  });

  delegate(table.element, 'click', '[data-action]', async (event, target) => {
    const supplier = state.suppliers.find((entry) => entry.id === target.dataset.id);
    if (!supplier) return;
    const action = target.dataset.action;
    if (action === 'edit') openSupplierForm({ supplier });
    if (action === 'debts') openDebtsModal(supplier, payables);
    if (action === 'delete') {
      const confirmed = await confirmDialog({
        title: 'Supprimer ce fournisseur ?',
        message: `${supplier.name} sera définitivement supprimé.`,
        details: 'La suppression est refusée si le fournisseur possède un historique d’achats : conservez sa fiche pour préserver la traçabilité.',
        confirmLabel: 'Supprimer',
      });
      if (confirmed) await runAction(() => deleteSupplier(supplier.id), { successMessage: 'Fournisseur supprimé.' });
    }
  });

  wrapper.append(table.element);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Suivi des dettes fournisseurs',
      items: [
        'Un achat réceptionné et non payé crée une dette fournisseur.',
        'Une dette n’est pas une dépense : elle ne réduit ni le résultat ni la trésorerie tant qu’elle n’est pas payée.',
        'Les retours au fournisseur viennent en déduction de la dette.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: () => paint(ctx) }).root; } };
