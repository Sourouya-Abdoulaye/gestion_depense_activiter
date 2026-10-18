/* ---------------------------------------------------------------------------
 * Mon Commerce — ossature commune des écrans
 *
 * Regroupe ce que tous les écrans partagent :
 *   • la page avec sa barre de filtres (activité + période) ;
 *   • un cycle de rafraîchissement piloté par l'état applicatif ;
 *   • la gestion du cycle de vie des graphiques (création / destruction).
 *
 * Aucune donnée n'est inventée : chaque écran recalcule ses chiffres à partir
 * des opérations enregistrées.
 * ------------------------------------------------------------------------- */

import { element, mount, qs, clear } from './dom.js';
import { filterBar } from './filters.js';
import { getState, subscribe } from '../services/state.js';

/** Détruit proprement une liste de graphiques Chart.js. */
export function destroyCharts(charts = []) {
  for (const chart of charts.splice(0)) {
    try {
      chart.destroy();
    } catch (error) {
      console.warn('[Mon Commerce] Destruction d’un graphique impossible :', error);
    }
  }
}

/**
 * Crée l'ossature d'un écran.
 *
 * @param {object} options
 * @param {object} options.ctx contexte fourni par le routeur
 * @param {boolean} [options.filters] affiche la barre de filtres
 * @param {string} [options.lockedActivityId] fige l'activité (filtre désactivé)
 * @param {(api: {charts: Array, defer: Function}) => Node} options.paint
 *        construit le contenu à partir de l'état courant. `defer` permet
 *        d'exécuter une fonction APRÈS l'insertion dans le DOM (graphiques).
 * @returns {{root: Node, repaint: Function}}
 */
export function createPage({ ctx = {}, filters = true, lockedActivityId = '', paint }) {
  const root = element('<div class="space-y-4"></div>');
  const content = element('<div class="space-y-4"></div>');
  const charts = [];

  const repaint = () => {
    destroyCharts(charts);
    const node = paint({ charts, defer: (fn) => setTimeout(fn, 0), repaint });
    if (node) mount(content, node);
    else clear(content);
  };

  if (filters) {
    const bar = filterBar({ activities: getState().activities || [], lockedActivityId });
    bar.onChange(() => repaint());
    root.append(bar);
  }

  root.append(content);
  repaint();

  if (typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(subscribe(() => repaint()));
    ctx.onCleanup(() => destroyCharts(charts));
  }

  return { root, repaint };
}

/** Avertissement affiché lorsqu'aucune activité n'existe encore. */
export function needsActivityNotice({ ctx, message = 'Créez d’abord une activité pour enregistrer des opérations.' }) {
  const wrapper = element(`
    <div class="card card-pad flex flex-col items-start gap-3">
      <h2 class="text-base font-semibold text-brand-dark">Aucune activité commerciale</h2>
      <p class="text-sm text-muted">${message}</p>
      <button type="button" class="btn-primary" data-go-activities>Créer une activité</button>
    </div>
  `);
  qs('[data-go-activities]', wrapper).addEventListener('click', () => ctx.navigate('activites'));
  return wrapper;
}

/* ------------------------------ utilitaires ------------------------------ */

/** Construit un formulaire à deux colonnes à partir de champs. */
export function formGrid(fields = [], { columns = 2 } = {}) {
  const grid = element(`<div class="grid gap-4 ${columns === 1 ? '' : 'sm:grid-cols-2'}"></div>`);
  for (const item of fields) {
    if (!item) continue;
    const node = item.node || item;
    if (item.span === 2) node.classList.add('sm:col-span-2');
    grid.append(node);
  }
  return grid;
}

/** Formulaire complet avec en-tête facultatif. */
export function buildForm(fields = [], { columns = 2, extra = null } = {}) {
  const form = element('<form novalidate class="space-y-4"></form>');
  form.append(formGrid(fields, { columns }));
  if (extra) form.append(extra);
  return form;
}
