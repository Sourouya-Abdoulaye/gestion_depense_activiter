/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Dépenses »
 *
 * La NATURE d'une dépense détermine son traitement : seule une dépense
 * d'exploitation réduit le résultat. Les frais d'approvisionnement sont déjà
 * dans le coût des produits vendus ; investissements et retraits ne sont pas
 * des charges. L'écran rend cette règle visible.
 * ------------------------------------------------------------------------- */

import { EXPENSE_NATURES } from '../config/constants.js';
import { html, element, raw, delegate } from '../shared/dom.js';
import { formatMoney, toNumber } from '../shared/format.js';
import { formatDate, todayISO } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  dataTable,
  field,
  kpiCard,
  modalForm,
  noticePanel,
  optionsFrom,
  pageHeader,
  runAction,
  sectionCard,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { chartBox, CHART_COLORS, Chart } from '../shared/charts.js';
import { getSettings, getState } from '../services/state.js';
import { expensesByCategory, expensesByNature, expensesTotal, periodOperatingExpenses } from '../services/finance.js';
import { createExpense, deleteExpense, updateExpense } from '../services/actions.js';
import { exportExpensesCsv } from '../services/csv.js';

export const meta = { path: 'depenses', title: 'Dépenses' };

const NATURE_LABELS = Object.fromEntries(EXPENSE_NATURES.map((nature) => [nature.value, nature.label]));

/* ------------------------------- formulaire ----------------------------- */

function expenseFormFields({ expense = null, accounts = [] }) {
  const settings = getSettings();
  const fields = [
    { node: field({ name: 'date', label: 'Date de la dépense', type: 'date', value: expense?.date || todayISO(), required: true }) },
    {
      node: field({
        name: 'category',
        label: 'Catégorie',
        type: 'select',
        value: expense?.category || (settings.expenseCategories || ['Autres'])[0],
        options: optionsFrom(settings.expenseCategories || ['Autres']),
      }),
    },
    { node: field({ name: 'amount', label: 'Montant (FCFA)', type: 'number', min: '0', value: expense?.amount ?? '', required: true }) },
    {
      node: field({
        name: 'nature',
        label: 'Nature (traitement financier)',
        type: 'select',
        value: expense?.nature || 'operating',
        options: EXPENSE_NATURES.map((nature) => ({ value: nature.value, label: nature.label })),
        hint: 'La nature décide si la dépense réduit le résultat de la période.',
      }),
    },
    {
      node: field({
        name: 'paid',
        label: 'Dépense payée',
        type: 'checkbox',
        value: expense ? expense.paid !== false : true,
        hint: 'Décochez si la dépense reste à payer : elle n’impactera pas la trésorerie.',
      }),
    },
    {
      node: field({
        name: 'accountId',
        label: 'Compte de trésorerie',
        type: 'select',
        value: expense?.accountId || (accounts[0] ? accounts[0].id : ''),
        options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
        hint: 'Nécessaire uniquement si la dépense est payée.',
      }),
    },
    {
      node: field({
        name: 'paymentMethod',
        label: 'Moyen de paiement',
        type: 'select',
        value: expense?.paymentMethod || (settings.paymentMethods || ['Espèces'])[0],
        options: optionsFrom(settings.paymentMethods || ['Espèces']),
      }),
    },
    { node: field({ name: 'beneficiary', label: 'Bénéficiaire (facultatif)', value: expense?.beneficiary || '', placeholder: 'Ex. transporteur, boutique…' }) },
    { node: field({ name: 'note', label: 'Note (facultatif)', value: expense?.note || '' }), span: 2 },
  ];
  return fields;
}

function openExpenseForm({ expense = null }) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  modalForm({
    title: expense ? 'Modifier la dépense' : 'Nouvelle dépense',
    description: 'Chaque dépense conserve sa nature : elle explique comment elle est comptée.',
    size: 'lg',
    fields: expenseFormFields({ expense, accounts }),
    submitLabel: expense ? 'Enregistrer' : 'Ajouter la dépense',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      if (values.paid && !values.accountId) {
        toast('Choisissez le compte de trésorerie utilisé pour cette dépense payée.', 'warning');
        return false;
      }
      const payload = {
        date: values.date,
        category: values.category,
        amount,
        nature: values.nature,
        paid: Boolean(values.paid),
        accountId: values.accountId,
        paymentMethod: values.paymentMethod,
        beneficiary: values.beneficiary,
        note: values.note,
      };
      const result = await runAction(
        () => (expense ? updateExpense(expense.id, payload) : createExpense(payload)),
        { successMessage: expense ? 'Dépense modifiée.' : 'Dépense enregistrée.' },
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
    wrapper.append(pageHeader({ title: 'Dépenses' }));
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

  const expenses = state.expenses.filter(inPeriod).sort((a, b) => (a.date < b.date ? 1 : -1));
  const operating = periodOperatingExpenses({ expenses: state.expenses, filters });
  const topical = expensesTotal({ expenses: state.expenses, filters });
  const byNature = expensesByNature({ expenses: state.expenses, filters });
  const byCategory = expensesByCategory({ expenses: state.expenses, filters });

  wrapper.append(
    pageHeader({
      title: 'Dépenses',
      subtitle: 'Transport, publicité, loyer, salaires, investissements et retraits.',
      actions: [
        button({ label: 'Nouvelle dépense', iconName: 'plus', variant: 'primary', onClick: () => openExpenseForm({}) }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (expenses.length === 0) {
              toast('Aucune dépense à exporter.', 'warning');
              return;
            }
            const activity = state.activities.find((entry) => entry.id === filters.activityId);
            const { lines } = exportExpensesCsv({ expenses, activityName: activity ? activity.name : '' });
            toast(`${lines} dépense(s) exportée(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Dépenses d’exploitation', value: formatMoney(operating), hint: 'Déduites du résultat de la période', tone: 'negative', iconName: 'wallet' }).outerHTML)}
        ${raw(kpiCard({ label: 'Total des dépenses', value: formatMoney(topical), hint: 'Toutes natures confondues', iconName: 'chart' }).outerHTML)}
        ${raw(kpiCard({ label: 'Dépenses affichées', value: String(expenses.length), hint: `${state.expenses.length} au total`, iconName: 'clock' }).outerHTML)}
        ${raw(kpiCard({ label: 'Approvisionnement', value: formatMoney(byNature.supply || 0), hint: 'Déjà compris dans le coût des produits vendus', iconName: 'cart' }).outerHTML)}
      </div>
    `),
  );

  if (byCategory.length > 0) {
    const { wrapper: box, canvas } = chartBox({ height: 280, label: 'Dépenses par catégorie' });
    const card = sectionCard({ title: 'Dépenses par catégorie', description: 'Répartition des dépenses de la période sélectionnée.', content: box });
    wrapper.append(card);
    // Graphique construit après insertion dans le DOM (via l'ossature d'écran,
    // qui détruit ensuite proprement l'instance au rafraîchissement).
    api.defer(() => {
      if (!canvas.isConnected) return;
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: byCategory.map((entry) => entry.category),
          datasets: [{ label: 'Montant', data: byCategory.map((entry) => entry.amount), backgroundColor: CHART_COLORS.brand, borderRadius: 6 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (context) => formatMoney(context.parsed.y) } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: CHART_COLORS.muted, autoSkip: false, maxRotation: 45 } },
            y: { beginAtZero: true, ticks: { color: CHART_COLORS.muted, callback: (value) => formatMoney(value, { symbol: false }) } },
          },
        },
      });
      api.charts.push(chart);
    });
  }

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher une catégorie, un bénéficiaire…',
    caption: 'Liste des dépenses',
    columns: [
      { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
      { key: 'category', label: 'Catégorie', render: (row) => html`<span class="font-medium">${row.category}</span>` },
      {
        key: 'nature',
        label: 'Nature',
        render: (row) => {
          const tone = row.nature === 'operating' ? 'danger' : row.nature === 'supply' ? 'warning' : 'neutral';
          return html`<span class="badge badge-${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'neutral'}">${NATURE_LABELS[row.nature] || 'Exploitation'}</span>`;
        },
      },
      { key: 'amount', label: 'Montant', align: 'right', render: (row) => formatMoney(row.amount) },
      { key: 'beneficiary', label: 'Bénéficiaire', render: (row) => row.beneficiary || '—' },
      { key: 'paid', label: 'Payée', align: 'center', render: (row) => (row.paid ? html`<span class="badge badge-brand">Oui</span>` : html`<span class="badge badge-warning">Non</span>`) },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => html`
          <div class="flex justify-end gap-1">
            <button type="button" class="btn-ghost btn-sm" data-action="edit" data-id="${row.id}" title="Modifier">${raw(icon('edit', { size: 14 }))}</button>
            <button type="button" class="btn-danger btn-sm" data-action="delete" data-id="${row.id}" title="Supprimer">${raw(icon('trash', { size: 14 }))}</button>
          </div>
        `,
      },
    ],
    rows: expenses,
    empty: { title: 'Aucune dépense', message: 'Enregistrez vos dépenses pour mesurer le résultat de l’activité.', iconName: 'wallet' },
  });

  delegate(table.element, 'click', '[data-action]', async (event, target) => {
    const expense = state.expenses.find((entry) => entry.id === target.dataset.id);
    if (!expense) return;
    if (target.dataset.action === 'edit') openExpenseForm({ expense });
    if (target.dataset.action === 'delete') {
      const confirmed = await confirmDialog({
        title: 'Supprimer cette dépense ?',
        message: `${expense.category} — ${formatMoney(expense.amount)} du ${formatDate(expense.date)}.`,
        details: 'La dépense est retirée de l’historique et, si elle était payée, un mouvement inverse est enregistré en trésorerie.',
        confirmLabel: 'Supprimer',
      });
      if (confirmed) await runAction(() => deleteExpense(expense.id), { successMessage: 'Dépense supprimée.' });
    }
  });

  wrapper.append(table.element);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Comment chaque nature est comptée',
      items: EXPENSE_NATURES.map((nature) => `${nature.label} : ${nature.hint}`),
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
