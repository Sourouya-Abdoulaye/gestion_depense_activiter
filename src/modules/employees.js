/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Employés & paie » (L10)
 *
 * Fiches locales (nom, rôle, salaire de référence) et versement des salaires.
 * Un salaire versé est une dépense d'exploitation ordinaire, reliée à la fiche
 * employé : il apparaît donc aussi dans les dépenses et le résultat.
 * ------------------------------------------------------------------------- */

import { html, element, raw, delegate } from '../shared/dom.js';
import { formatMoney } from '../shared/format.js';
import { formatDate, todayISO } from '../shared/dates.js';
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
  optionsFrom,
  pageHeader,
  runAction,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { getSettings, getState } from '../services/state.js';
import { deleteEmployee, payEmployeeSalary, saveEmployee, setEmployeeStatus } from '../services/actions.js';

export const meta = { path: 'employes', title: 'Employés & paie' };

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
}

function salaryExpenses(employeeId) {
  return getState().expenses.filter(
    (expense) => expense.employeeId === employeeId && expense.category === 'Salaire',
  );
}

function paidThisMonth(employeeId) {
  const key = monthKey();
  return salaryExpenses(employeeId)
    .filter((expense) => String(expense.date || '').startsWith(key))
    .reduce((total, expense) => total + Number(expense.amount || 0), 0);
}

/* ------------------------------- formulaires ---------------------------- */

function openEmployeeForm({ employee = null } = {}) {
  const state = getState();
  modalForm({
    title: employee ? 'Modifier l’employé' : 'Nouvel employé',
    description: 'La fiche sert à suivre les salaires versés ; aucun bulletin de paie légal n’est produit.',
    fields: [
      { node: field({ name: 'name', label: 'Nom complet', value: employee?.name || '', required: true, placeholder: 'Ex. Awa Traoré' }) },
      { node: field({ name: 'phone', label: 'Téléphone', type: 'tel', value: employee?.phone || '', placeholder: 'Ex. 90 00 00 00' }) },
      { node: field({ name: 'role', label: 'Rôle / poste', value: employee?.role || '', placeholder: 'Ex. Vendeuse' }) },
      { node: field({ name: 'hiredAt', label: 'Date d’embauche', type: 'date', value: employee?.hiredAt || todayISO() }) },
      { node: field({ name: 'salary', label: 'Salaire mensuel de référence (FCFA)', type: 'number', min: '0', step: '1', value: employee?.salary ?? '' }) },
      {
        node: field({
          name: 'activityId',
          label: 'Activité (facultatif)',
          type: 'select',
          value: employee?.activityId || '',
          options: optionsFrom(
            state.activities.map((activity) => ({ value: activity.id, label: activity.name })),
            { placeholder: 'Toutes les activités' },
          ),
        }),
      },
      {
        node: field({
          name: 'status',
          label: 'Statut',
          type: 'select',
          value: employee?.status || 'active',
          options: [
            { value: 'active', label: 'Actif' },
            { value: 'inactive', label: 'Inactif' },
          ],
        }),
      },
      { node: field({ name: 'note', label: 'Note (facultatif)', type: 'textarea', rows: 2, value: employee?.note || '' }), span: 2 },
    ],
    submitLabel: employee ? 'Enregistrer' : 'Créer la fiche',
    onSubmit: async (values) => {
      const result = await runAction(
        () => saveEmployee({ id: employee ? employee.id : undefined, ...values }),
        { successMessage: employee ? 'Fiche employé modifiée.' : 'Employé ajouté.' },
      );
      return Boolean(result);
    },
  });
}

function openSalaryForm(employee) {
  const state = getState();
  const settings = getSettings();
  const accounts = state.cashAccounts.filter((account) => account.active !== false);
  if (accounts.length === 0) {
    toast('Créez d’abord un compte de trésorerie.', 'warning');
    return;
  }
  const defaultActivity = employee.activityId || getFilters().activityId || '';

  modalForm({
    title: `Payer le salaire de ${employee.name}`,
    description: 'Le versement crée une dépense d’exploitation et une sortie de trésorerie.',
    fields: [
      { node: field({ name: 'period', label: 'Période concernée', value: monthLabel(), required: true }) },
      { node: field({ name: 'date', label: 'Date de paiement', type: 'date', value: todayISO(), required: true }) },
      { node: field({ name: 'amount', label: 'Montant versé (FCFA)', type: 'number', min: '0.01', step: '0.01', value: employee.salary || '', required: true }) },
      {
        node: field({
          name: 'accountId',
          label: 'Compte de trésorerie',
          type: 'select',
          required: true,
          value: accounts[0]?.id || '',
          options: accounts.map((account) => ({ value: account.id, label: account.name })),
        }),
      },
      {
        node: field({
          name: 'paymentMethod',
          label: 'Moyen de paiement',
          type: 'select',
          value: settings.paymentMethods[0] || 'Espèces',
          options: settings.paymentMethods.map((method) => ({ value: method, label: method })),
        }),
      },
      {
        node: field({
          name: 'activityId',
          label: 'Activité',
          type: 'select',
          value: defaultActivity,
          options: optionsFrom(
            state.activities.map((activity) => ({ value: activity.id, label: activity.name })),
          ),
        }),
      },
      { node: field({ name: 'note', label: 'Note (facultatif)', type: 'textarea', rows: 2, value: '' }), span: 2 },
    ],
    submitLabel: 'Enregistrer le paiement',
    onSubmit: async (values) => {
      const result = await runAction(
        () => payEmployeeSalary({ ...values, employeeId: employee.id }),
        { successMessage: `Salaire de ${employee.name} enregistré.` },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function paint() {
  const state = getState();
  const filters = getFilters();
  const employees = (state.employees || []).filter(
    (employee) => !filters.activityId || !employee.activityId || employee.activityId === filters.activityId,
  );
  const wrapper = element('<div class="space-y-4"></div>');

  wrapper.append(
    pageHeader({
      title: 'Employés & paie',
      subtitle: 'Fiches locales et suivi des salaires versés.',
      actions: [button({ label: 'Nouvel employé', iconName: 'plus', variant: 'primary', onClick: () => openEmployeeForm({}) })],
    }),
  );

  const active = employees.filter((employee) => employee.status !== 'inactive');
  const payroll = active.reduce((total, employee) => total + Number(employee.salary || 0), 0);
  const paid = employees.reduce((total, employee) => total + paidThisMonth(employee.id), 0);

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Employés', value: String(employees.length), hint: `${active.length} actif(s)`, iconName: 'users' }).outerHTML)}
        ${raw(kpiCard({ label: 'Masse salariale de référence', value: formatMoney(payroll), hint: 'Somme des salaires mensuels des fiches actives', iconName: 'wallet', tooltip: 'Indicatif : seuls les salaires réellement versés deviennent des dépenses.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Salaires versés ce mois', value: formatMoney(paid), hint: monthLabel(), tone: paid > 0 ? 'positive' : 'neutral', iconName: 'banknote' }).outerHTML)}
        ${raw(kpiCard({ label: 'Fiches inactives', value: String(employees.length - active.length), hint: 'Historique conservé, sans nouvelle paie', iconName: 'info' }).outerHTML)}
      </div>
    `),
  );

  if (employees.length === 0) {
    wrapper.append(
      emptyState({
        title: 'Aucun employé',
        message: 'Ajoutez une fiche pour suivre les salaires versés. Vous pouvez aussi continuer à saisir les salaires comme de simples dépenses.',
        actionLabel: 'Nouvel employé',
        iconName: 'users',
        onAction: () => openEmployeeForm({}),
      }),
    );
  } else {
    const table = dataTable({
      searchable: true,
      searchPlaceholder: 'Rechercher un employé (nom, rôle, téléphone)…',
      caption: 'Liste des employés',
      columns: [
        {
          key: 'name',
          label: 'Employé',
          render: (row) => html`<div class="min-w-0">
            <p class="font-semibold text-ink">${row.name}${row.status === 'inactive' ? html` <span class="badge badge-neutral">inactif</span>` : ''}</p>
            <p class="text-xs text-muted">${row.role || 'rôle non précisé'} — ${row.phone || 'sans téléphone'}</p>
          </div>`,
        },
        { key: 'hiredAt', label: 'Embauché le', render: (row) => (row.hiredAt ? formatDate(row.hiredAt) : '—') },
        { key: 'salary', label: 'Salaire de référence', align: 'right', render: (row) => formatMoney(row.salary || 0) },
        {
          key: 'paid',
          label: 'Versé ce mois',
          align: 'right',
          render: (row) => {
            const amount = paidThisMonth(row.id);
            return html`<span class="${amount > 0 ? 'text-brand-dark font-semibold' : 'text-muted'}">${formatMoney(amount)}</span>`;
          },
        },
        {
          key: 'actions',
          label: 'Actions',
          align: 'right',
          render: (row) => html`
            <div class="flex justify-end gap-1">
              <button type="button" class="btn-primary btn-sm" data-action="pay" data-id="${row.id}" title="Payer un salaire" ${row.status === 'inactive' ? 'disabled' : ''}>${raw(icon('banknote', { size: 14 }))}</button>
              <button type="button" class="btn-ghost btn-sm" data-action="edit" data-id="${row.id}" title="Modifier">${raw(icon('edit', { size: 14 }))}</button>
              <button type="button" class="btn-ghost btn-sm" data-action="toggle" data-id="${row.id}" title="${row.status === 'inactive' ? 'Réactiver' : 'Désactiver'}">${raw(icon(row.status === 'inactive' ? 'check' : 'close', { size: 14 }))}</button>
              <button type="button" class="btn-danger btn-sm" data-action="delete" data-id="${row.id}" title="Supprimer">${raw(icon('trash', { size: 14 }))}</button>
            </div>
          `,
        },
      ],
      rows: employees,
      empty: { title: 'Aucun employé', message: 'Ajoutez votre premier employé.', iconName: 'users' },
    });

    delegate(table.element, 'click', '[data-action]', async (event, target) => {
      const employee = state.employees.find((entry) => entry.id === target.dataset.id);
      if (!employee) return;
      const action = target.dataset.action;
      if (action === 'pay') openSalaryForm(employee);
      if (action === 'edit') openEmployeeForm({ employee });
      if (action === 'toggle') {
        await runAction(() => setEmployeeStatus(employee.id, employee.status === 'inactive' ? 'active' : 'inactive'), {
          successMessage: employee.status === 'inactive' ? 'Employé réactivé.' : 'Employé désactivé.',
        });
      }
      if (action === 'delete') {
        const confirmed = await confirmDialog({
          title: 'Supprimer cette fiche employé ?',
          message: `${employee.name} sera définitivement supprimé.`,
          details: 'La suppression est refusée si des salaires ont été versés : désactivez la fiche pour conserver l’historique.',
          confirmLabel: 'Supprimer',
        });
        if (confirmed) await runAction(() => deleteEmployee(employee.id), { successMessage: 'Employé supprimé.' });
      }
    });

    wrapper.append(table.element);
  }

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Ce module ne produit pas de bulletins de paie',
      items: [
        'Les salaires versés sont des dépenses d’exploitation : ils réduisent le résultat et la trésorerie.',
        'Le salaire de référence sert de valeur par défaut ; vous pouvez verser un montant différent (avance, prime, retenue).',
        'Les cotisations sociales, impôts sur le salaire et contrats de travail ne sont pas gérés.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint }).root; } };
