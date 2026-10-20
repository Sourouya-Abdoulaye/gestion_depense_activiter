/* ---------------------------------------------------------------------------
 * Mon Commerce — visite guidée (L23)
 *
 * Parcours pas-à-pas au premier lancement, rejouable depuis le Guide & aide.
 * La visite ne modifie aucune donnée métier : elle navigue entre les écrans et
 * affiche une fiche explicative.
 * ------------------------------------------------------------------------- */

import { html, element, raw } from './dom.js';
import { icon } from './icons.js';
import { navigate } from './router.js';
import { getSettings, saveSettings } from '../services/state.js';

const STEPS = [
  {
    route: 'tableau-de-bord',
    title: 'Bienvenue dans Mon Commerce',
    text: 'Le tableau de bord résume votre activité : chiffre d’affaires, marge, résultat estimé et trésorerie. Ces indicateurs sont différents et complémentaires.',
  },
  {
    route: 'activites',
    title: '1. Créez votre activité',
    text: 'Une activité regroupe vos produits, vos ventes et votre budget. Commencez par celle que vous gérez réellement, puis saisissez votre capital de départ.',
  },
  {
    route: 'produits',
    title: '2. Ajoutez vos produits',
    text: 'Renseignez le prix d’achat, le prix de vente et le stock initial. Le coût moyen pondéré et les alertes de stock se calculent ensuite automatiquement.',
  },
  {
    route: 'ventes',
    title: '3. Enregistrez une vente',
    text: 'Une vente met à jour le stock, la trésorerie et les créances. Le reçu peut être imprimé ou téléchargé en PDF depuis la liste des ventes.',
  },
  {
    route: 'tresorerie',
    title: '4. Suivez l’argent réel',
    text: 'La trésorerie ne compte que les encaissements et décaissements réels. Une vente à crédit crée une créance, pas de l’argent disponible.',
  },
  {
    route: 'rapports',
    title: '5. Analysez la période',
    text: 'Les rapports comparent la période à la précédente et exportent en CSV, PDF ou journal comptable simplifié. Pensez à vérifier la période affichée.',
  },
  {
    route: 'parametres',
    title: '6. Protégez vos données',
    text: 'Tout reste sur cet appareil. Exportez régulièrement une sauvegarde, activez éventuellement un code PIN et configurez vos reçus.',
  },
  {
    route: 'aide',
    title: 'Besoin d’aide ?',
    text: 'Le Guide & aide explique chaque écran, les formules et le vocabulaire. Vous pouvez relancer cette visite à tout moment depuis cette page.',
  },
];

let activeTour = null;

/** Démarre la visite (une seule à la fois). */
export function startTour({ force = false } = {}) {
  if (activeTour) return;
  const settings = getSettings();
  if (!force && settings.tourDone) return;

  let index = 0;
  const card = element(html`
    <div class="fixed bottom-4 right-4 z-[60] w-[min(92vw,380px)] rounded-2xl border border-brand/30 bg-white p-4 shadow-float" role="dialog" aria-label="Visite guidée">
      <div class="flex items-start gap-2">
        <span class="mt-0.5 text-brand-dark">${raw(icon('lightbulb', { size: 20 }))}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[0.65rem] font-bold uppercase tracking-wider text-muted" data-tour-step></p>
          <h2 class="mt-0.5 text-base font-semibold text-brand-dark" data-tour-title></h2>
          <p class="mt-1 text-sm text-ink" data-tour-text></p>
        </div>
        <button type="button" class="btn-ghost btn-sm" data-tour-close aria-label="Fermer la visite">×</button>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <button type="button" class="btn-ghost btn-sm" data-tour-skip>Passer</button>
        <div class="flex gap-1">
          <button type="button" class="btn-ghost btn-sm" data-tour-prev>Précédent</button>
          <button type="button" class="btn-primary btn-sm" data-tour-next>Suivant</button>
        </div>
      </div>
    </div>
  `);
  document.body.append(card);

  const title = card.querySelector('[data-tour-title]');
  const text = card.querySelector('[data-tour-text]');
  const stepLabel = card.querySelector('[data-tour-step]');
  const prev = card.querySelector('[data-tour-prev]');
  const next = card.querySelector('[data-tour-next]');

  const finish = (completed) => {
    card.remove();
    activeTour = null;
    if (completed) void saveSettings({ tourDone: true });
  };

  const draw = () => {
    const step = STEPS[index];
    stepLabel.textContent = `Visite guidée — étape ${index + 1} sur ${STEPS.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    prev.disabled = index === 0;
    next.textContent = index === STEPS.length - 1 ? 'Terminer' : 'Suivant';
    navigate(step.route);
  };

  card.querySelector('[data-tour-close]').addEventListener('click', () => finish(false));
  card.querySelector('[data-tour-skip]').addEventListener('click', () => finish(false));
  prev.addEventListener('click', () => {
    if (index > 0) {
      index -= 1;
      draw();
    }
  });
  next.addEventListener('click', () => {
    if (index >= STEPS.length - 1) {
      finish(true);
      return;
    }
    index += 1;
    draw();
  });

  activeTour = { card, finish };
  draw();
}

/** Ferme la visite si elle est ouverte (changement de session, verrouillage). */
export function stopTour() {
  if (activeTour) {
    activeTour.card.remove();
    activeTour = null;
  }
}
