/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Activités & budgets »
 *
 * Une activité regroupe les opérations d'un même commerce. Le budget d'une
 * activité (disponible, consommé, restant) est un indicateur DISTINCT du
 * bénéfice, du chiffre d'affaires et de la trésorerie : l'écran l'explique.
 * ------------------------------------------------------------------------- */

import { ACTIVITY_STATUS } from '../config/constants.js';
import { html, element, raw } from '../shared/dom.js';
import { formatMoney, toNumber } from '../shared/format.js';
import { formatDate, todayISO } from '../shared/dates.js';
import { createPage } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  emptyState,
  field,
  modalForm,
  noticePanel,
  optionsFrom,
  pageHeader,
  runAction,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { currentActivity, getState, getSettings, setCurrentActivity } from '../services/state.js';
import { activityBudget } from '../services/finance.js';
import { createActivity, deleteActivity, setActivityStatus, updateActivity } from '../services/actions.js';

export const meta = { path: 'activites', title: 'Activités & budgets' };

/* ------------------------------- formulaire ----------------------------- */

function activityFormFields({ activity = null, accounts = [], requireAccount = false } = {}) {
  const settings = getSettings();
  return [
    { node: field({ name: 'name', label: 'Nom de l’activité', value: activity?.name || '', required: true, placeholder: 'Ex. Vêtements Yopougon' }) },
    { node: field({ name: 'category', label: 'Catégorie (facultatif)', value: activity?.category || '', placeholder: 'Ex. Vêtements' }) },
    { node: field({ name: 'startDate', label: 'Date de début', type: 'date', value: activity?.startDate || todayISO(), required: true }) },
    { node: field({ name: 'endDate', label: 'Date de fin (facultatif)', type: 'date', value: activity?.endDate || '' }) },
    {
      node: field({
        name: 'initialCapital',
        label: 'Capital de départ (FCFA)',
        type: 'number',
        min: '0',
        value: activity?.initialCapital ?? 0,
        hint: activity ? 'Modifier ce montant ne déplace aucun argent déjà enregistré.' : 'Le capital est ajouté à la trésorerie du compte choisi.',
      }),
    },
    {
      node: field({
        name: 'accountId',
        label: 'Compte recevant le capital',
        type: 'select',
        value: accounts[0]?.id || '',
        required: requireAccount,
        options: optionsFrom(accounts.map((account) => ({ value: account.id, label: account.name }))),
        hint: 'Nécessaire uniquement si un capital de départ est saisi.',
      }),
    },
    { node: field({ name: 'targetBudget', label: 'Budget cible (facultatif, FCFA)', type: 'number', min: '0', value: activity?.targetBudget ?? 0, hint: 'Sert à mesurer la part du budget déjà consommée.' }) },
    {
      node: field({
        name: 'description',
        label: 'Description (facultatif)',
        type: 'textarea',
        value: activity?.description || '',
        rows: 2,
        placeholder: 'Activité de revente de vêtements au marché…',
      }),
      span: 2,
    },
    {
      node: field({
        name: 'status',
        label: 'Statut',
        type: 'select',
        value: activity?.status || ACTIVITY_STATUS.ACTIVE,
        options: [
          { value: ACTIVITY_STATUS.ACTIVE, label: 'Active' },
          { value: ACTIVITY_STATUS.ARCHIVED, label: 'Archivée' },
        ],
      }),
    },
    { node: field({ name: 'note', label: 'Note interne (facultatif)', value: activity?.note || '' }) },
  ].filter(Boolean);
}

function openActivityForm({ activity = null, onDone }) {
  const state = getState();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    toast('Créez d’abord un compte de trésorerie dans l’écran « Trésorerie ».', 'warning', { duration: 6000 });
    return;
  }
  modalForm({
    title: activity ? 'Modifier l’activité' : 'Nouvelle activité',
    description: 'Le budget disponible correspond au capital de départ augmenté des apports ultérieurs.',
    size: 'lg',
    fields: activityFormFields({ activity, accounts }),
    submitLabel: activity ? 'Enregistrer' : 'Créer l’activité',
    onSubmit: async (values) => {
      if (!values.name || !String(values.name).trim()) {
        toast('Le nom de l’activité est obligatoire.', 'warning');
        return false;
      }
      const payload = {
        name: String(values.name).trim(),
        category: values.category,
        description: values.description,
        startDate: values.startDate,
        endDate: values.endDate,
        initialCapital: toNumber(values.initialCapital, 0),
        targetBudget: toNumber(values.targetBudget, 0),
        accountId: values.accountId,
        status: values.status,
        note: values.note,
      };
      if (!activity && payload.initialCapital > 0 && !payload.accountId) {
        toast('Choisissez le compte de trésorerie qui reçoit le capital de départ.', 'warning');
        return false;
      }
      const result = await runAction(
        () => (activity ? updateActivity(activity.id, payload) : createActivity(payload)),
        { successMessage: activity ? 'Activité modifiée.' : 'Activité créée.' },
      );
      if (!result) return false;
      if (onDone) onDone();
      return true;
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function budgetCard(activity, budget) {
  const progress = budget.target > 0 ? Math.min(budget.targetProgress, 1) : 0;
  return element(html`
    <div class="rounded-lg border border-line bg-canvas/60 p-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">Budget</p>
        <span class="badge ${budget.remaining >= 0 ? 'badge-brand' : 'badge-danger'}">${formatMoney(budget.remaining)} restant</span>
      </div>
      <div class="mt-2 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <p class="text-xs text-muted">Disponible</p>
          <p class="font-semibold tabular-nums">${formatMoney(budget.available)}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Consommé</p>
          <p class="font-semibold tabular-nums text-warning">${formatMoney(budget.consumed)}</p>
        </div>
        <div>
          <p class="text-xs text-muted">Apports</p>
          <p class="font-semibold tabular-nums">${formatMoney(budget.contributions)}</p>
        </div>
      </div>
      ${budget.target > 0
        ? html`
            <div class="mt-3">
              <div class="flex items-center justify-between text-xs text-muted">
                <span>Consommation / budget cible</span>
                <span>${Math.round(progress * 100)} %</span>
              </div>
              <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-white">
                <div class="h-full rounded-full ${progress >= 1 ? 'bg-danger' : 'bg-brand'}" style="width:${Math.round(progress * 100)}%"></div>
              </div>
            </div>
          `
        : ''}
    </div>
  `);
}

function activityCard(activity, { budget, isCurrent }) {
  const card = element(html`
    <section class="card card-pad flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 class="flex items-center gap-2 text-base font-semibold text-brand-dark">
            ${activity.name}
            ${isCurrent ? html`<span class="badge badge-brand">Suivie</span>` : ''}
          </h2>
          <p class="mt-0.5 text-xs text-muted">
            ${activity.category || 'Sans catégorie'} — du ${formatDate(activity.startDate)}${activity.endDate ? ` au ${formatDate(activity.endDate)}` : ''}
          </p>
        </div>
        <span class="badge ${activity.status === ACTIVITY_STATUS.ARCHIVED ? 'badge-neutral' : 'badge-brand'}">
          ${activity.status === ACTIVITY_STATUS.ARCHIVED ? 'Archivée' : 'Active'}
        </span>
      </div>
      ${activity.description ? html`<p class="text-sm text-ink">${activity.description}</p>` : ''}
      ${budgetCard(activity, budget)}
      <div class="no-print flex flex-wrap gap-2">
        <button type="button" class="btn-ghost btn-sm" data-action="select">
          ${raw(icon('check', { size: 14 }))}<span>${isCurrent ? 'Déjà suivie' : 'Suivre'}</span>
        </button>
        <button type="button" class="btn-ghost btn-sm" data-action="edit">${raw(icon('edit', { size: 14 }))}<span>Modifier</span></button>
        <button type="button" class="btn-ghost btn-sm" data-action="toggle">${raw(icon('refresh', { size: 14 }))}<span>${activity.status === ACTIVITY_STATUS.ARCHIVED ? 'Réactiver' : 'Archiver'}</span></button>
        <button type="button" class="btn-danger btn-sm" data-action="delete">${raw(icon('trash', { size: 14 }))}<span>Supprimer</span></button>
      </div>
    </section>
  `);

  card.querySelector('[data-action="select"]').addEventListener('click', async () => {
    const result = await runAction(() => setCurrentActivity(activity.id), { successMessage: `Activité suivie : ${activity.name}.` });
    void result;
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openActivityForm({ activity }));

  card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
    const next = activity.status === ACTIVITY_STATUS.ARCHIVED ? ACTIVITY_STATUS.ACTIVE : ACTIVITY_STATUS.ARCHIVED;
    await runAction(() => setActivityStatus(activity.id, next), {
      successMessage: next === ACTIVITY_STATUS.ARCHIVED ? 'Activité archivée.' : 'Activité réactivée.',
    });
  });

  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Supprimer cette activité ?',
      message: `${activity.name} sera définitivement supprimée.`,
      details: 'La suppression est refusée si l’activité contient des produits, ventes, achats ou dépenses : archivez-la dans ce cas pour préserver l’historique.',
      confirmLabel: 'Supprimer',
    });
    if (!confirmed) return;
    await runAction(() => deleteActivity(activity.id), { successMessage: 'Activité supprimée.' });
  });

  return card;
}

function paint(ctx) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');
  const canCreate = state.cashAccounts.some((account) => account.active !== false);

  wrapper.append(
    pageHeader({
      title: 'Activités & budgets',
      subtitle: 'Chaque activité possède son capital, son budget et ses opérations.',
      actions: [
        button({
          label: 'Nouvelle activité',
          iconName: 'plus',
          variant: 'primary',
          onClick: () => openActivityForm({}),
        }),
      ],
    }),
  );

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Trois indicateurs différents',
      items: [
        'Budget restant = capital de départ + apports − argent réellement sorti.',
        'Trésorerie = solde des comptes (elle tient compte des ventes encaissées).',
        'Résultat estimé = marge brute − dépenses d’exploitation de la période.',
      ],
    }),
  );

  if (state.activities.length === 0) {
    wrapper.append(
      emptyState({
        title: 'Aucune activité pour le moment',
        message: canCreate
          ? 'Créez votre première activité et indiquez votre capital de départ.'
          : 'Créez d’abord un compte de trésorerie, puis votre première activité.',
        actionLabel: 'Créer une activité',
        iconName: 'activity',
        onAction: () => openActivityForm({}),
      }),
    );
    return wrapper;
  }

  const active = currentActivity();
  const grid = element('<div class="grid gap-4 lg:grid-cols-2"></div>');
  const sorted = [...state.activities].sort((a, b) => {
    if (a.status !== b.status) return a.status === ACTIVITY_STATUS.ACTIVE ? -1 : 1;
    return (a.startDate || '') < (b.startDate || '') ? 1 : -1;
  });
  for (const activity of sorted) {
    grid.append(
      activityCard(activity, {
        budget: activityBudget(activity, { cashMovements: state.cashMovements }),
        isCurrent: Boolean(active && active.id === activity.id),
      }),
    );
  }
  wrapper.append(grid);
  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: false, paint: () => paint(ctx) }).root; } };
