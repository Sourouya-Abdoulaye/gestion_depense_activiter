/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Trésorerie »
 *
 * Source de vérité des mouvements d'argent réels :
 *   trésorerie = solde initial + entrées réelles − sorties réelles.
 * Les transferts internes entre comptes ne sont ni recette ni dépense. Apports
 * et retraits de l'exploitant sont suivis séparément du résultat.
 * ------------------------------------------------------------------------- */

import { CASH_ACCOUNT_TYPES, CASH_MOVEMENT_NATURES } from '../config/constants.js';
import { html, element, qs, raw, delegate } from '../shared/dom.js';
import { formatMoney, toNumber } from '../shared/format.js';
import { formatDate, formatMonthLabel, monthKey, todayISO } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import {
  button,
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
import { getState } from '../services/state.js';
import {
  accountBalance,
  cashInTotal,
  cashOutTotal,
  contributionsTotal,
  treasuryBalance,
  withdrawalsTotal,
} from '../services/finance.js';
import {
  addCashMovement,
  addContribution,
  addWithdrawal,
  saveCashAccount,
  toggleCashAccount,
  transferBetweenAccounts,
} from '../services/actions.js';
import { exportCashMovementsCsv } from '../services/csv.js';

export const meta = { path: 'tresorerie', title: 'Trésorerie' };

const NATURE_LABELS = Object.fromEntries(CASH_MOVEMENT_NATURES.map((nature) => [nature.value, nature.label]));
let selectedAccountId = '';

/* --------------------------------- séries ------------------------------- */

function cashMonthlySeries(movements, filters) {
  const months = new Map();
  const ensure = (key) => {
    if (!months.has(key)) months.set(key, { key, in: 0, out: 0 });
    return months.get(key);
  };
  for (const movement of movements) {
    if (filters.activityId && movement.activityId && movement.activityId !== filters.activityId) continue;
    const date = movement.date || '';
    if (filters.from && date < filters.from) continue;
    if (filters.to && date > filters.to) continue;
    if (movement.nature === 'transfer_in' || movement.nature === 'transfer_out') continue;
    const entry = ensure(monthKey(date));
    if (movement.direction === 'in') entry.in += toNumber(movement.amount, 0);
    else entry.out += toNumber(movement.amount, 0);
  }
  return [...months.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/* ------------------------------- modales -------------------------------- */

function openAccountForm({ account = null }) {
  modalForm({
    title: account ? 'Modifier le compte' : 'Nouveau compte de trésorerie',
    description: 'Caisse (espèces), portefeuille mobile ou compte bancaire.',
    fields: [
      { node: field({ name: 'name', label: 'Nom du compte', value: account?.name || '', required: true, placeholder: 'Ex. Flooz, Compte bancaire…' }) },
      {
        node: field({
          name: 'type',
          label: 'Type de compte',
          type: 'select',
          value: account?.type || 'cash',
          options: CASH_ACCOUNT_TYPES.map((type) => ({ value: type.value, label: type.label })),
        }),
      },
      { node: field({ name: 'initialBalance', label: 'Solde initial (FCFA)', type: 'number', value: account?.initialBalance ?? 0, hint: 'Solde déjà présent avant l’utilisation de l’application.' }) },
      { node: field({ name: 'active', label: 'Compte actif', type: 'checkbox', value: account ? account.active !== false : true, hint: 'Les comptes inactifs sont exclus de la trésorerie totale.' }) },
      { node: field({ name: 'note', label: 'Note (facultatif)', value: account?.note || '' }), span: 2 },
    ],
    submitLabel: account ? 'Enregistrer' : 'Créer le compte',
    onSubmit: async (values) => {
      if (!values.name || !String(values.name).trim()) {
        toast('Le nom du compte est obligatoire.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          saveCashAccount({
            id: account ? account.id : undefined,
            name: values.name,
            type: values.type,
            initialBalance: toNumber(values.initialBalance, 0),
            active: Boolean(values.active),
            note: values.note,
          }),
        { successMessage: account ? 'Compte modifié.' : 'Compte créé.' },
      );
      return Boolean(result);
    },
  });
}

function movementFields(accounts, { withNature = false, natureOptions = [] } = {}) {
  return [
    { node: field({ name: 'date', label: 'Date', type: 'date', value: todayISO(), required: true }) },
    { node: field({ name: 'amount', label: 'Montant (FCFA)', type: 'number', min: '0', required: true }), },
    {
      node: field({
        name: 'accountId',
        label: 'Compte de trésorerie',
        type: 'select',
        value: accounts[0] ? accounts[0].id : '',
        options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
        required: true,
      }),
    },
    ...(withNature
      ? [
          {
            node: field({
              name: 'nature',
              label: 'Nature du mouvement',
              type: 'select',
              value: natureOptions[0]?.value || 'other_in',
              options: natureOptions,
            }),
          },
        ]
      : []),
    { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }), span: 2 },
  ];
}

function openContributionForm(accounts) {
  modalForm({
    title: 'Apport de l’exploitant',
    description: 'Un apport augmente la trésorerie ET le budget disponible de l’activité. Ce n’est pas un chiffre d’affaires.',
    fields: movementFields(accounts),
    submitLabel: 'Enregistrer l’apport',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      const result = await runAction(
        () => addContribution({ date: values.date, amount, accountId: values.accountId, note: values.note, activityId: getFilters().activityId || undefined }),
        { successMessage: 'Apport enregistré.' },
      );
      return Boolean(result);
    },
  });
}

function openWithdrawalForm(accounts) {
  modalForm({
    title: 'Retrait de l’exploitant',
    description: 'Un retrait sort de la trésorerie mais n’est pas une charge : il ne réduit pas le résultat.',
    fields: movementFields(accounts),
    submitLabel: 'Enregistrer le retrait',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      const result = await runAction(
        () => addWithdrawal({ date: values.date, amount, accountId: values.accountId, note: values.note, activityId: getFilters().activityId || undefined }),
        { successMessage: 'Retrait enregistré.' },
      );
      return Boolean(result);
    },
  });
}

function openManualMovementForm(accounts) {
  modalForm({
    title: 'Autre mouvement de trésorerie',
    description: 'Utilisez ce formulaire pour une recette ou une dépense exceptionnelle non rattachée à une vente ou un achat.',
    fields: movementFields(accounts, {
      withNature: true,
      natureOptions: [
        { value: 'other_in', label: 'Autre entrée (recette exceptionnelle)' },
        { value: 'other_out', label: 'Autre sortie (dépense exceptionnelle)' },
      ],
    }),
    submitLabel: 'Enregistrer le mouvement',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      const direction = values.nature === 'other_in' ? 'in' : 'out';
      const result = await runAction(
        () =>
          addCashMovement({
            date: values.date,
            amount,
            accountId: values.accountId,
            direction,
            nature: values.nature,
            note: values.note,
            activityId: getFilters().activityId || undefined,
          }),
        { successMessage: 'Mouvement enregistré.' },
      );
      return Boolean(result);
    },
  });
}

function openTransferForm(accounts) {
  if (accounts.length < 2) {
    toast('Un transfert nécessite au moins deux comptes actifs.', 'warning');
    return;
  }
  modalForm({
    title: 'Transfert entre comptes',
    description: 'Le transfert crée une sortie et une entrée : il ne change pas la trésorerie totale.',
    fields: [
      { node: field({ name: 'date', label: 'Date', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'amount', label: 'Montant (FCFA)', type: 'number', min: '0', required: true }) },
      {
        node: field({
          name: 'fromAccountId',
          label: 'Compte de départ',
          type: 'select',
          value: accounts[0].id,
          options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
          required: true,
        }),
      },
      {
        node: field({
          name: 'toAccountId',
          label: 'Compte d’arrivée',
          type: 'select',
          value: accounts[1].id,
          options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
          required: true,
        }),
      },
      { node: field({ name: 'note', label: 'Note (facultatif)', value: '' }), span: 2 },
    ],
    submitLabel: 'Enregistrer le transfert',
    onSubmit: async (values) => {
      const amount = toNumber(values.amount, 0);
      if (amount <= 0) {
        toast('Le montant doit être supérieur à zéro.', 'warning');
        return false;
      }
      if (values.fromAccountId === values.toAccountId) {
        toast('Les comptes de départ et d’arrivée doivent être différents.', 'warning');
        return false;
      }
      const result = await runAction(
        () =>
          transferBetweenAccounts({
            date: values.date,
            amount,
            fromAccountId: values.fromAccountId,
            toAccountId: values.toAccountId,
            note: values.note,
            activityId: getFilters().activityId || undefined,
          }),
        { successMessage: 'Transfert enregistré.' },
      );
      return Boolean(result);
    },
  });
}

function openReconciliationForm(accounts) {
  const state = getState();
  const account = accounts.find((entry) => entry.id === selectedAccountId) || accounts[0];
  const computed = accountBalance(account, state.cashMovements);
  modalForm({
    title: 'Vérifier la caisse',
    description: 'Comparez le solde calculé par l’application avec l’argent réellement compté.',
    fields: [
      { node: field({ name: 'accountId', label: 'Compte', type: 'select', value: account.id, options: optionsFrom(accounts.map((entry) => ({ value: entry.id, label: entry.name }))) }), span: 2 },
      { node: field({ name: 'declared', label: 'Montant réellement compté (FCFA)', type: 'number', min: '0', required: true, hint: `Solde calculé : ${formatMoney(computed)}` }), span: 2 },
      { node: field({ name: 'date', label: 'Date de la vérification', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'note', label: 'Explication (facultatif)', value: '', placeholder: 'Erreur de caisse, dépense non saisie…' }), span: 2 },
    ],
    submitLabel: 'Enregistrer la correction',
    onSubmit: async (values) => {
      const currentState = getState();
      const target = accounts.find((entry) => entry.id === (values.accountId || account.id)) || account;
      const current = accountBalance(target, currentState.cashMovements);
      const declared = toNumber(values.declared, 0);
      const difference = Math.round((declared - current) * 100) / 100;
      if (difference === 0) {
        toast('Aucun écart : la caisse est juste.', 'success');
        return true;
      }
      const result = await runAction(
        () =>
          addCashMovement({
            date: values.date,
            accountId: target.id,
            direction: difference > 0 ? 'in' : 'out',
            amount: Math.abs(difference),
            nature: difference > 0 ? 'other_in' : 'other_out',
            note: `Correction de caisse — ${values.note || 'écart constaté'}`,
            activityId: getFilters().activityId || undefined,
          }),
        { successMessage: `Correction de ${formatMoney(Math.abs(difference))} enregistrée.` },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx, api) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');
  const accounts = state.cashAccounts;
  const activeAccounts = accounts.filter((account) => account.active !== false);
  const filters = getFilters();

  wrapper.append(
    pageHeader({
      title: 'Trésorerie',
      subtitle: 'Comptes, mouvements réels, apports, retraits et transferts.',
      actions: [
        button({ label: 'Nouveau compte', iconName: 'plus', variant: 'primary', onClick: () => openAccountForm({}) }),
        button({ label: 'Apport', iconName: 'download', onClick: () => (activeAccounts.length > 0 ? openContributionForm(activeAccounts) : toast('Créez d’abord un compte actif.', 'warning')) }),
        button({ label: 'Retrait', iconName: 'upload', onClick: () => (activeAccounts.length > 0 ? openWithdrawalForm(activeAccounts) : toast('Créez d’abord un compte actif.', 'warning')) }),
        button({ label: 'Transfert', iconName: 'refresh', onClick: () => openTransferForm(activeAccounts) }),
        button({ label: 'Autre mouvement', iconName: 'plus', onClick: () => (activeAccounts.length > 0 ? openManualMovementForm(activeAccounts) : toast('Créez d’abord un compte actif.', 'warning')) }),
        button({ label: 'Vérifier la caisse', iconName: 'check', onClick: () => (activeAccounts.length > 0 ? openReconciliationForm(activeAccounts) : toast('Créez d’abord un compte actif.', 'warning')) }),
      ],
    }),
  );

  if (state.activities.length === 0) {
    wrapper.append(needsActivityNotice({ ctx }));
  }

  const treasury = treasuryBalance({ cashAccounts: state.cashAccounts, cashMovements: state.cashMovements });
  const cashIn = cashInTotal({ cashMovements: state.cashMovements, filters });
  const cashOut = cashOutTotal({ cashMovements: state.cashMovements, filters });
  const contributions = contributionsTotal({ cashMovements: state.cashMovements, filters });
  const withdrawals = withdrawalsTotal({ cashMovements: state.cashMovements, filters });

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Trésorerie totale', value: formatMoney(treasury), hint: 'Tous comptes actifs', iconName: 'banknote' }).outerHTML)}
        ${raw(kpiCard({ label: 'Entrées de la période', value: formatMoney(cashIn), hint: 'Hors apports et transferts', tone: 'positive', iconName: 'arrowRight' }).outerHTML)}
        ${raw(kpiCard({ label: 'Sorties de la période', value: formatMoney(cashOut), hint: 'Hors transferts internes', tone: 'negative', iconName: 'arrowLeft' }).outerHTML)}
        ${raw(kpiCard({ label: 'Apports / retraits', value: `${formatMoney(contributions)} / ${formatMoney(withdrawals)}`, hint: 'Indicateurs distincts du résultat', iconName: 'wallet' }).outerHTML)}
      </div>
    `),
  );

  /* ----------------------------- comptes ------------------------------- */
  const accountsGrid = element('<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"></div>');
  if (accounts.length === 0) {
    accountsGrid.append(element(html`<p class="text-sm text-muted">Aucun compte de trésorerie.</p>`));
  }
  for (const account of accounts) {
    const balance = accountBalance(account, state.cashMovements);
    const card = element(html`
      <div class="card card-pad ${account.active === false ? 'opacity-60' : ''}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-semibold text-brand-dark">${account.name}</p>
            <p class="text-xs text-muted">${(CASH_ACCOUNT_TYPES.find((type) => type.value === account.type) || {}).label || account.type}</p>
          </div>
          <span class="badge ${account.active === false ? 'badge-neutral' : 'badge-brand'}">${account.active === false ? 'Inactif' : 'Actif'}</span>
        </div>
        <p class="kpi-value ${balance < 0 ? 'text-danger' : ''}">${formatMoney(balance)}</p>
        <p class="text-xs text-muted">Solde initial : ${formatMoney(account.initialBalance || 0)}</p>
        <div class="no-print mt-3 flex flex-wrap gap-1">
          <button type="button" class="btn-ghost btn-sm" data-account-edit="${account.id}">${raw(icon('edit', { size: 14 }))}<span>Modifier</span></button>
          <button type="button" class="btn-ghost btn-sm" data-account-toggle="${account.id}">${raw(icon('refresh', { size: 14 }))}<span>${account.active === false ? 'Activer' : 'Désactiver'}</span></button>
        </div>
      </div>
    `);
    accountsGrid.append(card);
  }
  wrapper.append(sectionCard({ title: 'Comptes de trésorerie', content: accountsGrid }));

  delegate(wrapper, 'click', '[data-account-edit]', (event, target) => {
    const account = state.cashAccounts.find((entry) => entry.id === target.dataset.accountEdit);
    if (account) openAccountForm({ account });
  });
  delegate(wrapper, 'click', '[data-account-toggle]', async (event, target) => {
    const account = state.cashAccounts.find((entry) => entry.id === target.dataset.accountToggle);
    if (!account) return;
    await runAction(() => toggleCashAccount(account.id, account.active === false), {
      successMessage: account.active === false ? 'Compte activé.' : 'Compte désactivé (exclu de la trésorerie totale).',
    });
  });

  /* ------------------------------ graphique ---------------------------- */
  const series = cashMonthlySeries(state.cashMovements, filters);
  if (series.length > 0) {
    const { wrapper: box, canvas } = chartBox({ height: 280, label: 'Entrées et sorties de trésorerie par mois' });
    wrapper.append(sectionCard({ title: 'Flux de trésorerie par mois', description: 'Hors transferts internes entre comptes.', content: box }));
    api.defer(() => {
      if (!canvas.isConnected) return;
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: series.map((entry) => formatMonthLabel(`${entry.key}-01`)),
          datasets: [
            { label: 'Entrées', data: series.map((entry) => entry.in), backgroundColor: CHART_COLORS.brand, borderRadius: 6 },
            { label: 'Sorties', data: series.map((entry) => entry.out), backgroundColor: CHART_COLORS.warning, borderRadius: 6 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 12 } },
            tooltip: { callbacks: { label: (context) => `${context.dataset.label} : ${formatMoney(context.parsed.y)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: CHART_COLORS.muted } },
            y: { beginAtZero: true, ticks: { color: CHART_COLORS.muted, callback: (value) => formatMoney(value, { symbol: false }) } },
          },
        },
      });
      api.charts.push(chart);
    });
  }

  /* ----------------------------- mouvements ---------------------------- */
  const movements = state.cashMovements
    .filter((movement) => {
      if (selectedAccountId && movement.accountId !== selectedAccountId) return false;
      if (filters.activityId && movement.activityId && movement.activityId !== filters.activityId) return false;
      const date = movement.date || '';
      if (filters.from && date < filters.from) return false;
      if (filters.to && date > filters.to) return false;
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const accountSelect = element(html`
    <div class="min-w-[220px]">
      <label class="label" for="cash-account-filter">Compte</label>
      <select id="cash-account-filter" class="input">
        <option value="">Tous les comptes</option>
        ${accounts.map(
          (account) => html`<option value="${account.id}" ${account.id === selectedAccountId ? 'selected' : ''}>${account.name}</option>`,
        )}
      </select>
    </div>
  `);

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher une nature, une note…',
    caption: 'Mouvements de trésorerie',
    columns: [
      { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
      { key: 'account', label: 'Compte', render: (row) => state.cashAccounts.find((account) => account.id === row.accountId)?.name || '—' },
      { key: 'nature', label: 'Nature', render: (row) => NATURE_LABELS[row.nature] || row.nature },
      {
        key: 'amount',
        label: 'Montant',
        align: 'right',
        render: (row) => html`<span class="${row.direction === 'in' ? 'text-brand-dark' : 'text-danger'}">${row.direction === 'in' ? '+' : '−'} ${formatMoney(row.amount)}</span>`,
      },
      { key: 'note', label: 'Note', render: (row) => row.note || '—' },
    ],
    rows: movements,
    empty: { title: 'Aucun mouvement', message: 'Les encaissements, paiements et dépenses apparaîtront ici.', iconName: 'banknote' },
  });

  const movementsSection = sectionCard({
    title: 'Mouvements de trésorerie',
    description: `${movements.length} mouvement(s) affiché(s).`,
    actions: [
      button({
        label: 'Exporter',
        iconName: 'download',
        onClick: () => {
          if (movements.length === 0) {
            toast('Aucun mouvement à exporter.', 'warning');
            return;
          }
          const { lines } = exportCashMovementsCsv({ movements, accounts: state.cashAccounts });
          toast(`${lines} mouvement(s) exporté(s) au format CSV.`, 'success');
        },
      }),
    ],
    content: element('<div></div>'),
  });
  const movementsSlot = movementsSection.querySelector('.card-pad');
  movementsSlot.replaceChildren(accountSelect, table.element);

  qs('#cash-account-filter', movementsSlot).addEventListener('change', (event) => {
    selectedAccountId = event.target.value;
    // Re-rendu complet : les soldes et la trésorerie totale restent cohérents.
    api.repaint();
  });

  wrapper.append(movementsSection);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Règles de trésorerie',
      items: [
        'Trésorerie = solde initial + entrées réelles − sorties réelles.',
        'Un transfert entre comptes crée deux mouvements et ne change pas la trésorerie totale.',
        'Un apport augmente le budget disponible ; ce n’est pas un chiffre d’affaires.',
        'Une dépense non payée n’impacte pas la trésorerie.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
