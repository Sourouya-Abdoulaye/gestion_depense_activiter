/* ---------------------------------------------------------------------------
 * Mon Commerce — coquille de l'application
 * Navigation, sélecteur d'activité, état de connexion, notifications et
 * enregistrement des écrans dans le routeur.
 * ------------------------------------------------------------------------- */

import { APP_VERSION, ROUTES } from './config/constants.js';
import { html, element, qs, mount, raw, downloadFile } from './shared/dom.js';
import { icon } from './shared/icons.js';
import { toast, runAction } from './shared/ui.js';
import { navigate, registerRoutes, render, startRouter, currentRoute } from './shared/router.js';
import { getState, currentActivity, getSettings, setCurrentActivity, subscribe, saveSettings, markBackupExported } from './services/state.js';
import { lowStockAlerts, computeStockState } from './services/stock.js';
import { receivableList, payableList } from './services/finance.js';
import { resetViewState, setViewState } from './shared/view-state.js';
import {
  backupReminderMessage,
  backupStatus,
  getEnvironmentStatus,
  isBackupReminderSnoozed,
  requestPersistentStorage,
  snoozeBackupReminder,
} from './services/environment.js';
import { buildBackup, buildBackupFilename } from './services/backup.js';
import { exitDemoMode, isDemoMode } from './services/demo.js';
import { lockIsEnabled } from './services/lock.js';

/* --------------------------- enregistrement ------------------------------ */

const MODULE_LOADERS = {
  'tableau-de-bord': () => import('./modules/dashboard.js'),
  activites: () => import('./modules/activities.js'),
  produits: () => import('./modules/products.js'),
  achats: () => import('./modules/purchases.js'),
  stock: () => import('./modules/stock.js'),
  ventes: () => import('./modules/sales.js'),
  depenses: () => import('./modules/expenses.js'),
  tresorerie: () => import('./modules/cash.js'),
  clients: () => import('./modules/customers.js'),
  fournisseurs: () => import('./modules/suppliers.js'),
  employes: () => import('./modules/employees.js'),
  imports: () => import('./modules/imports.js'),
  rapports: () => import('./modules/reports.js'),
  rentabilite: () => import('./modules/profitability.js'),
  parametres: () => import('./modules/settings.js'),
  aide: () => import('./modules/help.js'),
};

/* ------------------------------- navigation ----------------------------- */

function navBadges(state) {
  const settings = getSettings();
  const stockState = computeStockState(state.stockMovements, state.products);
  const alerts = lowStockAlerts(state.products, stockState, settings.defaultAlertThreshold || 0);
  const overdueReceivables = receivableList({
    sales: state.sales,
    payments: state.payments,
    returns: state.returns,
  }).filter((entry) => entry.overdueDays > 0).length;
  const overduePayables = payableList({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
  }).filter((entry) => entry.overdueDays > 0).length;
  return {
    produits: alerts.length,
    clients: overdueReceivables,
    fournisseurs: overduePayables,
  };
}

function renderNavigation() {
  const state = getState();
  const badges = navBadges(state);
  const active = currentRoute();
  const groups = new Map();
  for (const route of ROUTES) {
    if (!groups.has(route.group)) groups.set(route.group, []);
    groups.get(route.group).push(route);
  }

  const markup = [...groups.entries()]
    .map(
      ([group, routes]) => html`
        <div class="mb-1">
          <p class="px-3 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-wider text-muted">${group}</p>
          ${routes.map((route) => {
            const count = badges[route.path] || 0;
            return html`
              <a
                href="#/${route.path}"
                class="nav-link ${active === route.path ? 'nav-link-active' : ''}"
                ${active === route.path ? 'aria-current="page"' : ''}
              >
                <span class="shrink-0">${raw(icon(route.icon, { size: 17 }))}</span>
                <span class="min-w-0 flex-1 truncate">${route.label}</span>
                ${count > 0 ? html`<span class="badge ${active === route.path ? 'bg-white text-brand-dark' : 'badge-warning'}">${count}</span>` : ''}
              </a>
            `;
          })}
        </div>
      `,
    )
    .join('');

  mount(qs('#nav-items'), markup);
}

function renderMobileNavigation() {
  const active = currentRoute();
  const routes = ROUTES.filter((route) => route.mobile);
  mount(
    qs('#mobile-nav'),
    routes
      .map(
        (route) => html`
          <a
            href="#/${route.path}"
            class="flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[0.65rem] font-semibold ${active === route.path ? 'bg-brand-light text-brand-dark' : 'text-muted'}"
          >
            ${raw(icon(route.icon, { size: 18 }))}
            <span class="truncate">${route.label.split(' ')[0]}</span>
          </a>
        `,
      )
      .join(''),
  );
}

function renderActivitySwitcher() {
  const state = getState();
  const activity = currentActivity();
  const activities = state.activities || [];
  const slot = qs('#activity-switcher');

  if (activities.length === 0) {
    mount(
      slot,
      html`
        <a href="#/activites" class="block rounded-lg border border-dashed border-brand/40 bg-brand-light/50 px-3 py-2 text-xs font-semibold text-brand-dark">
          + Créer votre première activité
        </a>
      `,
    );
    return;
  }

  const node = element(html`
    <div class="rounded-lg border border-line bg-canvas/70 p-2">
      <label class="label mb-1" for="activity-switch">Activité suivie</label>
      <select id="activity-switch" class="input text-sm">
        ${activities.map(
          (entry) => html`<option value="${entry.id}" ${activity && activity.id === entry.id ? 'selected' : ''}>
            ${entry.name}${entry.status === 'archived' ? ' (archivée)' : ''}
          </option>`,
        )}
      </select>
      <p class="mt-1 truncate text-[0.7rem] text-muted" id="sidebar-activity-summary-inner"></p>
    </div>
  `);
  node.querySelector('select').addEventListener('change', async (event) => {
    await setCurrentActivity(event.target.value);
    setViewState({ activityId: '' });
    toast('Activité changée.', 'info', { duration: 2000 });
  });
  slot.replaceChildren(node);
}

function renderSidebarSummary() {
  const slot = qs('#sidebar-activity-summary');
  const state = getState();
  const activity = currentActivity();
  if (!activity) {
    slot.textContent = 'Aucune activité sélectionnée.';
    return;
  }
  slot.textContent = `${state.products.filter((product) => product.activityId === activity.id).length} produit(s) — ${state.sales.filter((sale) => sale.activityId === activity.id).length} vente(s)`;
  const inner = qs('#sidebar-activity-summary-inner');
  if (inner) {
    inner.textContent = activity.description || activity.category || 'Suivi des ventes, achats, stock et trésorerie.';
  }
}

/* ------------------------------ état réseau ----------------------------- */

function renderNetStatus() {
  const badge = qs('#net-status');
  const label = badge.querySelector('[data-role="net-label"]');
  const dot = badge.querySelector('span');
  const online = navigator.onLine;
  label.textContent = online ? 'En ligne' : 'Hors ligne';
  dot.className = `h-1.5 w-1.5 rounded-full ${online ? 'bg-brand' : 'bg-warning'}`;
  badge.classList.toggle('badge-warning', !online);
  badge.classList.toggle('badge-neutral', online);
}

/* --------------------- bandeau d'état et sauvegardes -------------------- */

let environmentCache = null;
let statusToken = 0;

/** Exporte immédiatement une sauvegarde depuis le bandeau (L2). */
function exportBackupFromBanner() {
  try {
    const payload = buildBackup(getState());
    const filename = buildBackupFilename();
    downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
    void markBackupExported();
    toast(`Sauvegarde enregistrée : ${filename}`, 'success', { duration: 6000 });
  } catch (error) {
    toast(error && error.message ? error.message : 'Export impossible.', 'error', { duration: 7000 });
  }
}

/** Demande le stockage persistant depuis le bandeau. */
async function askPersistentStorage() {
  const granted = await requestPersistentStorage();
  environmentCache = null;
  toast(
    granted ? 'Stockage persistant accordé : les données sont mieux protégées contre l’éviction.' : 'Le navigateur n’a pas accordé le stockage persistant.',
    granted ? 'success' : 'warning',
    { duration: 6000 },
  );
  refreshShell();
}

/**
 * Bandeau d'état : stockage éphémère (L5), installation PWA (L5/L20),
 * rappel de sauvegarde (L1/L2) et stockage persistant (L5).
 */
async function paintStatusBar() {
  const token = ++statusToken;
  const bar = qs('#status-bar');
  if (!bar) return;

  const settings = getSettings();
  if (!environmentCache) {
    try {
      environmentCache = await getEnvironmentStatus();
    } catch {
      environmentCache = null;
    }
  }
  if (token !== statusToken) return;
  const env = environmentCache;

  const messages = [];
  if (isDemoMode()) {
    messages.push({
      tone: 'info',
      text: 'Mode démonstration : les données affichées sont fictives et stockées séparément. Aucune vraie donnée n’est utilisée.',
      actions: [{ label: 'Quitter la démo', action: 'exit-demo', primary: true }],
    });
  }
  if (env && env.ephemeral) {
    messages.push({
      tone: 'danger',
      text: 'Stockage temporaire probable (navigation privée ?) : vos données peuvent disparaître à la fermeture du navigateur. Exportez une sauvegarde.',
      actions: [
        { label: 'Exporter', action: 'export', primary: true },
        { label: 'En savoir plus', href: '#/aide' },
      ],
    });
  }
  if (env && env.ios && !env.standalone) {
    messages.push({
      tone: 'info',
      text: 'Sur iPhone/iPad, ajoutez Mon Commerce à l’écran d’accueil pour éviter que Safari efface les données.',
      actions: [{ label: 'Comment installer', href: '#/aide' }],
    });
  }
  const backup = backupStatus(settings);
  if (backup.due && !isBackupReminderSnoozed(settings)) {
    messages.push({
      tone: 'warning',
      text: backupReminderMessage(settings),
      actions: [
        { label: 'Exporter maintenant', action: 'export', primary: true },
        { label: 'Plus tard', action: 'snooze' },
      ],
    });
  }
  if (env && env.persistedSupported && !env.persisted && !env.ephemeral) {
    messages.push({
      tone: 'neutral',
      text: 'Le navigateur peut évincer vos données pour libérer de l’espace. Demandez le stockage persistant.',
      actions: [{ label: 'Demander', action: 'persist' }],
    });
  }

  if (messages.length === 0) {
    bar.hidden = true;
    bar.className = 'hidden items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium';
    return;
  }

  const toneClass = {
    danger: 'bg-danger text-white',
    warning: 'bg-warning text-white',
    info: 'bg-brand-dark text-white',
    neutral: 'bg-canvas text-ink border-b border-line',
  };
  bar.hidden = false;
  bar.className = 'no-print flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs font-medium';
  mount(
    bar,
    messages.map(
      (message, index) => html`
        <div class="flex flex-wrap items-center gap-2 ${toneClass[message.tone] || toneClass.neutral} ${messages.length > 1 ? 'w-full justify-center rounded px-2 py-1 sm:w-auto' : ''}" data-status="${index}">
          <span>${message.text}</span>
          ${(message.actions || []).map((action) =>
            action.href
              ? html`<a href="${action.href}" class="font-bold underline underline-offset-2">${action.label}</a>`
              : html`<button type="button" class="rounded border border-current/40 px-2 py-0.5 font-bold ${action.primary ? 'bg-white/15' : ''}" data-status-action="${action.action}" data-status-index="${index}">${action.label}</button>`,
          )}
        </div>
      `,
    ),
  );

  for (const button of bar.querySelectorAll('[data-status-action]')) {
    button.addEventListener('click', () => {
      if (button.dataset.statusAction === 'export') exportBackupFromBanner();
      else if (button.dataset.statusAction === 'exit-demo') exitDemoMode();
      else if (button.dataset.statusAction === 'snooze') {
        runAction(() => saveSettings(snoozeBackupReminder(1)), { silent: true }).then(() => refreshShell());
        toast('Rappel reporté à demain.', 'info', { duration: 3000 });
      } else if (button.dataset.statusAction === 'persist') {
        void askPersistentStorage();
      }
    });
  }
}

/* -------------------------------- actions ------------------------------- */

export { runAction };

export function refreshShell() {
  renderNavigation();
  renderMobileNavigation();
  renderActivitySwitcher();
  renderSidebarSummary();
  void paintStatusBar();
  const settings = getSettings();
  qs('#shop-name-top').textContent = settings.shopName || 'Gestion commerciale';
  qs('#app-version').textContent = APP_VERSION;
  const lockButton = qs('#lock-now');
  if (lockButton) {
    lockButton.hidden = !lockIsEnabled(settings);
  }
}

/* -------------------------------- démarrage ----------------------------- */

export function mountShell() {
  registerRoutes(MODULE_LOADERS);
  refreshShell();

  const toggle = qs('#nav-toggle');
  const sidebar = qs('#sidebar');
  const backdrop = qs('#nav-backdrop');

  const closeNav = () => {
    sidebar.classList.add('-translate-x-full');
    backdrop.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    if (isOpen) {
      closeNav();
    } else {
      sidebar.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
  backdrop.addEventListener('click', closeNav);
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') && window.innerWidth < 1024) closeNav();
  });

  // Action rapide : ouvre l'écran des ventes puis son formulaire dès qu'il est
  // disponible (le module est chargé à la demande).
  qs('#quick-sale').addEventListener('click', () => {
    navigate('ventes');
    const tryOpen = (attempt = 0) => {
      const trigger = document.querySelector('.open-sale-form, #open-sale-form');
      if (trigger) {
        trigger.click();
        return;
      }
      if (attempt < 30) setTimeout(() => tryOpen(attempt + 1), 100);
    };
    setTimeout(() => tryOpen(), 100);
  });

  window.addEventListener('online', renderNetStatus);
  window.addEventListener('offline', renderNetStatus);
  renderNetStatus();

  // L'abonnement vit aussi longtemps que la page : la coquille (navigation,
  // badges, bandeau de sauvegarde) reste synchronisée avec l'état applicatif.
  subscribe(() => refreshShell());

  startRouter({
    onRouteChange: () => {
      renderNavigation();
      renderMobileNavigation();
      closeNav();
    },
  });
}

export function resetFilters() {
  resetViewState();
}

export { render };
