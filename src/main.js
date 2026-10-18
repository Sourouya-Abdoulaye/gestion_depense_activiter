/* ---------------------------------------------------------------------------
 * Mon Commerce — point d'entrée
 * Initialise le stockage local, la coquille de l'application, le routeur et le
 * service worker (ouverture hors connexion). Aucune donnée n'est envoyée sur un
 * serveur : tout reste sur cet appareil.
 * ------------------------------------------------------------------------- */

import './styles/main.css';

import { FINANCE_RULES_TEXT, STORAGE_WARNING } from './config/constants.js';
import { html, element, qs, raw } from './shared/dom.js';
import { errorPanel, openModal, toast } from './shared/ui.js';
import { icon } from './shared/icons.js';
import { getSettings, initializeStore, markFirstLaunchSeen } from './services/state.js';
import { mountShell } from './app.js';

/** Écran bloquant si le navigateur ne peut pas enregistrer de données. */
function showStorageFailure(error) {
  const view = qs('#view');
  view.replaceChildren(errorPanel(error));
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
        </ol>
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
          return true;
        },
      },
    ],
  });
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
  } catch (error) {
    console.warn('[Mon Commerce] Service worker non enregistré :', error);
  }
}

async function bootstrap() {
  try {
    await initializeStore();
  } catch (error) {
    console.error('[Mon Commerce] Initialisation impossible :', error);
    showStorageFailure(error);
    return;
  }

  mountShell();
  if (!getSettings().onboardingDone) showOnboarding();
  registerServiceWorker();
}

void bootstrap();
