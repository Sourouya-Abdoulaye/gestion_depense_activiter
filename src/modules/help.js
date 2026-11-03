/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Assistant & aide »
 *
 * Le guide long est remplacé par une conversation : l'utilisateur pose une
 * question en langage courant et reçoit une réponse courte, reliée à l'écran
 * concerné. Les règles de calcul restent disponibles dans un bloc replié.
 *
 * Aucune donnée n'est modifiée par cet écran.
 * ------------------------------------------------------------------------- */

import { ACCOUNTING_DISCLAIMER, APP_VERSION, EXPENSE_NATURES, FINANCE_RULES_TEXT } from '../config/constants.js';
import { html, element, raw } from '../shared/dom.js';
import { formatMoney } from '../shared/format.js';
import { formatDate } from '../shared/dates.js';
import { getPeriod, getViewState } from '../shared/view-state.js';
import { filterBar } from '../shared/filters.js';
import { button, confirmDialog, kpiCard, pageHeader } from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { startTour } from '../shared/tour.js';
import { createAssistantChat } from '../shared/assistant-chat.js';
import { enterDemoMode, exitDemoMode, isDemoMode, resetDemoMode } from '../services/demo.js';
import { currentActivity, getState, subscribe } from '../services/state.js';
import { computeKpis } from '../services/finance.js';
import { periodLabel } from '../services/reports.js';

export const meta = { path: 'aide', title: 'Assistant & aide' };

/* --------------------------- parcours conseillé ------------------------- */

function buildPath(ctx) {
  const steps = [
    { number: '1', title: 'Créer l’activité', hint: 'Capital et budget', path: 'activites' },
    { number: '2', title: 'Ajouter les produits', hint: 'Prix et stock initial', path: 'produits' },
    { number: '3', title: 'Vendre', hint: 'Comptant ou à crédit', path: 'ventes' },
    { number: '4', title: 'Sauvegarder', hint: 'Export JSON', path: 'parametres' },
  ];

  const section = element(html`
    <section class="space-y-2" aria-label="Pour démarrer">
      <h2 class="text-sm font-semibold text-brand-dark">Pour démarrer</h2>
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-1" data-path-grid></div>
    </section>
  `);

  const grid = section.querySelector('[data-path-grid]');
  for (const step of steps) {
    const card = element(html`
      <button
        type="button"
        class="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-2 text-left transition-colors hover:border-brand hover:bg-brand-light/50"
      >
        <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-[0.7rem] font-bold text-white">${step.number}</span>
        <span class="min-w-0">
          <span class="block truncate text-xs font-semibold text-brand-dark">${step.title}</span>
          <span class="block truncate text-[0.65rem] text-muted">${step.hint}</span>
        </span>
      </button>
    `);
    card.addEventListener('click', () => ctx.navigate(step.path));
    grid.append(card);
  }

  return section;
}

/* ------------------------------- thèmes --------------------------------- */

const THEMES = [
  { label: 'Ventes', question: 'Comment enregistrer une vente ?' },
  { label: 'Achats', question: 'Comment enregistrer un achat ?' },
  { label: 'Stock', question: 'Comment fonctionne le stock ?' },
  { label: 'Dépenses', question: 'Comment ajouter une dépense ?' },
  { label: 'Trésorerie', question: 'Comment fonctionne la trésorerie ?' },
  { label: 'Créances', question: 'Où voir mes créances ?' },
  { label: 'Dettes', question: 'Où voir mes dettes ?' },
  { label: 'Sauvegarde', question: 'Comment sauvegarder ?' },
];

function buildThemes(chat) {
  const section = element(html`
    <section class="card p-3" aria-label="Sujets fréquents">
      <h2 class="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Sujets</h2>
      <div class="mt-2 flex flex-wrap gap-1.5" data-theme-list></div>
    </section>
  `);

  const list = section.querySelector('[data-theme-list]');
  for (const theme of THEMES) {
    const chip = element(html`
      <button
        type="button"
        class="rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink hover:border-brand hover:bg-brand-light hover:text-brand-dark"
      >${theme.label}</button>
    `);
    chip.addEventListener('click', () => {
      chat.ask(theme.question);
      chat.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.append(chip);
  }

  return section;
}

function buildKpis() {
  const state = getState();
  const view = getViewState();
  const period = getPeriod();
  const kpis = computeKpis(state, { activityId: view.activityId, period });
  const activity = view.activityId
    ? (state.activities || []).find((entry) => entry.id === view.activityId) || null
    : currentActivity();
  const scope = view.activityId ? activity && activity.name ? activity.name : 'Activité sélectionnée' : 'Toutes les activités';

  const cards = [
    {
      label: 'Chiffre d’affaires',
      value: formatMoney(kpis.revenue),
      hint: kpis.salesCount > 0 ? `${kpis.salesCount} vente(s)` : 'Aucune vente',
      tone: 'neutral',
      iconName: 'receipt',
      compact: true,
    },
    {
      label: 'Marge brute',
      value: formatMoney(kpis.grossMargin),
      hint: kpis.revenue > 0 ? 'Coût des ventes' : '',
      tone: kpis.grossMargin >= 0 ? 'positive' : 'negative',
      iconName: 'chart',
      compact: true,
    },
    {
      label: 'Résultat estimé',
      value: formatMoney(kpis.estimatedResult),
      hint: kpis.operatingExpenses > 0 ? 'Charges déduites' : 'Aucune charge',
      tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative',
      iconName: 'banknote',
      compact: true,
    },
    {
      label: 'Trésorerie',
      value: formatMoney(kpis.treasury),
      hint: 'Comptes actifs',
      tone: 'neutral',
      iconName: 'wallet',
      compact: true,
    },
  ];

  return element(html`
    <section class="space-y-2" aria-label="Vos chiffres de la période">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-base font-semibold text-brand-dark">Vos chiffres</h2>
        <p class="text-[0.7rem] text-muted">${scope} · ${periodLabel(period, formatDate)}</p>
      </div>
      ${(state.activities || []).length === 0
        ? html`<p class="text-xs text-warning">
            Aucune activité enregistrée : les montants restent à zéro tant que vous n’avez pas créé une activité.
          </p>`
        : ''}
      <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        ${cards.map((card) => html`${raw(kpiCard(card).outerHTML)}`)}
      </div>
    </section>
  `);
}

/* --------------------------- règles repliées ---------------------------- */

function buildRules() {
  return element(html`
    <details class="group card">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <span class="flex min-w-0 items-center gap-2 text-sm font-semibold text-brand-dark">
          ${raw(icon('book', { size: 17 }))}
          <span>Règles et limites</span>
        </span>
        <span class="shrink-0 text-muted transition-transform group-open:rotate-180">
          ${raw(icon('chevronDown', { size: 16 }))}
        </span>
      </summary>
      <div class="border-t border-line px-4 py-3 sm:px-5">
        <ul class="list-disc space-y-1 pl-5 text-xs text-ink sm:text-sm">
          ${FINANCE_RULES_TEXT.map((rule) => html`<li>${rule}</li>`)}
        </ul>

        <p class="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Les quatre natures de dépense</p>
        <ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-ink sm:text-sm">
          ${EXPENSE_NATURES.map((nature) => html`<li><strong>${nature.label}</strong> — ${nature.hint}</li>`)}
        </ul>

        <div class="mt-4 rounded-xl border border-warning/30 bg-amber-50 px-3 py-2 text-xs text-ink">
          <p class="font-semibold text-warning">Outil de pilotage, pas une comptabilité certifiée</p>
          <p class="mt-1">${ACCOUNTING_DISCLAIMER}</p>
        </div>

        <p class="mt-3 text-[0.7rem] text-muted">
          Version ${APP_VERSION} — données stockées uniquement dans le navigateur de cet appareil.
        </p>
      </div>
    </details>
  `);
}

/* --------------------------------- rendu -------------------------------- */

function buildActions() {
  const actions = [
    button({
      label: 'Visite guidée',
      iconName: 'lightbulb',
      onClick: () => startTour({ force: true }),
    }),
  ];

  if (isDemoMode()) {
    actions.push(
      button({
        label: 'Quitter la démo',
        iconName: 'arrowLeft',
        onClick: async () => {
          const quit = await confirmDialog({
            title: 'Quitter le mode démonstration ?',
            message: 'L’application va recharger vos données réelles.',
            details: 'Les données fictives restent dans leur base séparée : vos vraies données n’ont pas été modifiées.',
            confirmLabel: 'Quitter la démo',
            variant: 'primary',
          });
          if (quit) exitDemoMode();
        },
      }),
    );
  }

  actions.push(
    button({
      label: isDemoMode() ? 'Réinit. démo' : 'Mode démo',
      iconName: 'activity',
      onClick: async () => {
        if (isDemoMode()) {
          const reset = await confirmDialog({
            title: 'Réinitialiser la démonstration ?',
            message: 'Les données fictives seront recréées au prochain chargement.',
            details: 'Vos données réelles ne sont pas concernées : elles restent dans une base séparée.',
            confirmLabel: 'Réinitialiser',
          });
          if (reset) await resetDemoMode();
          return;
        }
        const go = await confirmDialog({
          title: 'Ouvrir le mode démonstration ?',
          message: 'L’application va recharger un jeu de données fictif pour vous faire découvrir les écrans.',
          details:
            'La démonstration utilise une base IndexedDB séparée : vos données réelles ne sont ni lues, ni modifiées. Vous pourrez revenir aux données réelles depuis le bandeau.',
          confirmLabel: 'Essayer la démo',
          variant: 'primary',
        });
        if (go) enterDemoMode();
      },
    }),
  );

  return actions;
}

function paint(ctx) {
  const root = element('<div class="space-y-4"></div>');

  root.append(
    pageHeader({
      title: 'Assistant & aide',
      subtitle: 'Posez une question sur l’application ou vos chiffres.',
      actions: buildActions(),
      compact: true,
    }),
  );

  const kpiSlot = element('<div></div>');
  const refreshKpis = () => kpiSlot.replaceChildren(buildKpis());
  const bar = filterBar({ activities: getState().activities || [], compact: true });
  bar.onChange(refreshKpis);
  refreshKpis();

  const chat = createAssistantChat({
    variant: 'page',
    onNavigate: ctx.navigate,
  });
  const chatShell = element('<div class="h-[min(60dvh,520px)] min-h-[300px] max-h-[calc(100dvh-22rem)]"></div>');
  chatShell.append(chat.element);

  const aside = element('<aside class="order-2 space-y-3 lg:order-1"></aside>');
  aside.append(buildPath(ctx), buildThemes(chat));

  const chatColumn = element('<div class="order-1 min-w-0 lg:order-2"></div>');
  chatColumn.append(bar, chatShell);

  const layout = element('<div class="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start"></div>');
  layout.append(aside, chatColumn);
  root.append(layout);

  const kpiSection = element('<section class="space-y-3" aria-label="Vos chiffres de la période"></section>');
  kpiSection.append(kpiSlot);
  root.append(kpiSection);
  root.append(buildRules());

  if (typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(subscribe(refreshKpis));
    ctx.onCleanup(() => chat.destroy());
  }

  return root;
}

export default {
  meta,
  render(ctx) {
    return paint(ctx);
  },
};
