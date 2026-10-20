/* ---------------------------------------------------------------------------
 * Mon Commerce — point d'entrée
 * Initialise le stockage local, la coquille de l'application, le routeur et le
 * service worker (ouverture hors connexion). Aucune donnée n'est envoyée sur un
 * serveur : tout reste sur cet appareil.
 * ------------------------------------------------------------------------- */

import './styles/main.css';

import { FINANCE_RULES_TEXT, STORAGE_WARNING, ACCOUNTING_DISCLAIMER } from './config/constants.js';
import { html, element, qs, raw, downloadFile } from './shared/dom.js';
import { errorPanel, openModal, toast } from './shared/ui.js';
import { icon } from './shared/icons.js';
import { getSettings, getState, initializeStore, markFirstLaunchSeen, markBackupExported } from './services/state.js';
import { mountShell } from './app.js';
import { buildBackup, buildBackupFilename } from './services/backup.js';
import { backupStatus } from './services/environment.js';
import { ensureDemoData } from './services/demo.js';
import { startTour } from './shared/tour.js';
import { lockIsEnabled, lockTimeoutMs } from './services/lock.js';
import { showLockScreen } from './shared/lock-screen.js';

/** Écran bloquant si le navigateur ne peut pas enregistrer de données (L19). */
function showStorageFailure(error) {
  const view = qs('#view');
  const supported = typeof indexedDB !== 'undefined';
  const panel = errorPanel(error);
  panel.insertBefore(
    element(html`
      <div class="rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted">
        <p class="font-semibold text-ink">Prérequis de Mon Commerce</p>
        <ul class="mt-1 list-disc space-y-0.5 pl-5">
          <li>Navigateur récent : Chrome, Edge, Firefox ou Safari (2 dernières années).</li>
          <li>JavaScript activé.</li>
          <li>Stockage local IndexedDB autorisé${supported ? ' (détecté)' : ' — non détecté sur ce navigateur'}.</li>
          <li>HTTPS (ou localhost) pour l’ouverture hors connexion.</li>
        </ul>
        <p class="mt-2">Essayez un autre navigateur, désactivez le mode navigation privée, puis rechargez la page.</p>
      </div>
    `),
    panel.lastElementChild,
  );
  view.replaceChildren(panel);
  for (const selector of ['#nav-items', '#mobile-nav', '#activity-switcher', '#quick-sale']) {
    const node = qs(selector);
    if (node) node.classList.add('opacity-40', 'pointer-events-none');
  }
}

/** Présentation affichée au premier lancement : stockage local et règles. */
function showOnboarding() {
  const content = element(html`
    <div class="space-y-4">
      <div class="rounded-xl border border-warning/30 bg-amber-50 px-4 py-3">
        <p class="flex items-center gap-2 text-sm font-semibold text-warning">
          ${raw(icon('alert', { size: 18 }))}
          Où sont enregistrées vos données ?
        </p>
        <p class="mt-1 text-sm text-ink">${STORAGE_WARNING}</p>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-brand-dark">Comment vos chiffres sont calculés</h3>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
          ${FINANCE_RULES_TEXT.map((rule) => html`<li>${rule}</li>`)}
        </ul>
      </div>

      <div class="rounded-xl border border-line bg-canvas/70 px-4 py-3 text-sm text-ink">
        <p class="font-semibold">Pour commencer</p>
        <ol class="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted">
          <li>Créez une activité et saisissez votre capital de départ.</li>
          <li>Ajoutez vos produits avec leur prix d'achat et leur prix de vente.</li>
          <li>Enregistrez vos achats, puis vos ventes : stock, trésorerie et marges se calculent automatiquement.</li>
          <li>Exportez régulièrement une sauvegarde JSON depuis « Paramètres & sauvegardes ».</li>
          <li>Un doute sur un chiffre ? Ouvrez « Guide &amp; aide » : formules, vocabulaire et exemples y sont expliqués.</li>
        </ol>
      </div>

      <div class="rounded-xl border border-warning/30 bg-amber-50 px-4 py-3 text-xs text-ink">
        <p class="font-semibold text-warning">Outil de pilotage, pas une comptabilité certifiée</p>
        <p class="mt-1">${ACCOUNTING_DISCLAIMER}</p>
      </div>

      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" id="onboarding-ack" class="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand" />
        <span>J'ai compris que les données restent sur cet appareil et qu'il faut exporter des sauvegardes.</span>
      </label>
    </div>
  `);

  openModal({
    title: 'Bienvenue dans Mon Commerce',
    description: 'Achats, ventes, stock, dépenses, trésorerie et rentabilité — en français et en FCFA.',
    size: 'lg',
    content,
    actions: [
      {
        label: 'J’ai compris, commencer',
        variant: 'primary',
        onClick: async () => {
          const acknowledged = content.querySelector('#onboarding-ack');
          if (!acknowledged || !acknowledged.checked) {
            toast('Cochez la case pour confirmer que vous avez compris où sont enregistrées vos données.', 'warning', { duration: 6000 });
            return false;
          }
          await markFirstLaunchSeen();
          toast('Bienvenue ! Commencez par créer votre activité.', 'success', { duration: 5000 });
          setTimeout(() => startTour({ force: true }), 250);
          return true;
        },
      },
    ],
  });
}

/** Envoie au service worker les ressources réellement chargées (L20). */
async function precacheLoadedResources(registration) {
  const worker = registration.active || registration.waiting || registration.installing;
  if (!worker) return;
  const urls = new Set();
  for (const node of document.querySelectorAll('link[href], script[src]')) {
    const value = node.getAttribute('href') || node.getAttribute('src');
    if (!value) continue;
    const url = new URL(value, document.baseURI);
    if (url.origin === window.location.origin) urls.add(url.href);
  }
  for (const entry of performance.getEntriesByType('resource')) {
    try {
      const url = new URL(entry.name);
      if (url.origin === window.location.origin && /\.(js|css|woff2?|svg|png|webp)$/.test(url.pathname)) urls.add(url.href);
    } catch {
      /* entrée non exploitable */
    }
  }
  worker.postMessage({ type: 'CACHE_URLS', urls: [...urls] });
}

/** Enregistre le service worker en production (ouverture hors connexion). */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Une nouvelle version est disponible. Rechargez la page pour l’utiliser.', 'info', { duration: 8000 });
        }
      });
    });
    await navigator.serviceWorker.ready;
    await precacheLoadedResources(registration);
  } catch (error) {
    console.warn('[Mon Commerce] Service worker non enregistré :', error);
  }
}

/** Télécharge une sauvegarde complète (utilisé par le rappel automatique). */
function downloadBackup({ silent = false } = {}) {
  const payload = buildBackup(getState());
  const filename = buildBackupFilename();
  downloadFile(filename, JSON.stringify(payload, null, 2), 'application/json');
  void markBackupExported();
  if (!silent) toast(`Sauvegarde enregistrée : ${filename}`, 'success', { duration: 6000 });
  return filename;
}

/**
 * Sauvegarde automatique à l'ouverture (L2) si l'utilisateur l'a activée et
 * que le délai choisi est dépassé. Désactivée par défaut : aucun téléchargement
 * ne démarre sans une décision explicite.
 */
async function maybeAutoBackup() {
  const settings = getSettings();
  if (!settings.autoBackupOnOpen) return;
  const status = backupStatus(settings);
  if (!status.due) return;
  try {
    downloadBackup({ silent: true });
    toast('Sauvegarde automatique exportée (téléchargements du navigateur).', 'info', { duration: 7000 });
  } catch (error) {
    toast('La sauvegarde automatique a échoué : exportez-la depuis les paramètres.', 'warning', { duration: 7000 });
  }
}

/* ------------------------------ verrouillage ----------------------------- */

let autoLockTimer = null;
let lockVisible = false;

/** Affiche l'écran de verrouillage si le verrou est activé. */
function lockApplication(reason = '') {
  const settings = getSettings();
  if (!lockIsEnabled(settings) || lockVisible) return;
  lockVisible = true;
  if (autoLockTimer) clearTimeout(autoLockTimer);
  showLockScreen({
    settings,
    reason,
    onUnlocked: () => {
      lockVisible = false;
      armAutoLock();
    },
  });
}

/** Programme le reverrouillage après la durée d'inactivité choisie. */
function armAutoLock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  const settings = getSettings();
  if (!lockIsEnabled(settings)) return;
  const timeout = lockTimeoutMs(settings);
  if (timeout <= 0) return;
  autoLockTimer = setTimeout(() => lockApplication('Application verrouillée après une période d’inactivité.'), timeout);
}

/** Surveille l'inactivité et le passage en arrière-plan. */
function installLockWatchers() {
  const reset = () => {
    if (!lockVisible) armAutoLock();
  };
  for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
    document.addEventListener(eventName, reset, { passive: true });
  }
  const manualLock = qs('#lock-now');
  if (manualLock) {
    manualLock.addEventListener('click', () => lockApplication('Verrouillage demandé manuellement.'));
  }
  document.addEventListener('visibilitychange', () => {
    const settings = getSettings();
    if (!lockIsEnabled(settings) || !settings.lockOnHidden) return;
    if (document.visibilityState === 'hidden') {
      lockApplication('Application verrouillée pendant qu’elle était en arrière-plan.');
    } else if (!lockVisible) {
      armAutoLock();
    }
  });
  armAutoLock();
}

/** Démarre l'interface (après déverrouillage éventuel). */
function startApplication() {
  mountShell();
  if (!getSettings().onboardingDone) showOnboarding();
  else if (!getSettings().tourDone) setTimeout(() => startTour(), 400);
  registerServiceWorker();
  maybeAutoBackup();
  installLockWatchers();
}

async function bootstrap() {
  try {
    await initializeStore();
    await ensureDemoData();
  } catch (error) {
    console.error('[Mon Commerce] Initialisation impossible :', error);
    showStorageFailure(error);
    return;
  }

  if (lockIsEnabled(getSettings())) {
    lockVisible = true;
    showLockScreen({
      settings: getSettings(),
      onUnlocked: () => {
        lockVisible = false;
        startApplication();
      },
    });
    return;
  }
  startApplication();
}

void bootstrap();
