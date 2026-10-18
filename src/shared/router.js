/* ---------------------------------------------------------------------------
 * Mon Commerce — routeur (navigation par ancre, sans dépendance)
 *
 * Les écrans sont chargés à la demande (import dynamique) pour garder un
 * démarrage rapide. Chaque écran exporte :
 *   • meta  : { path, title, subtitle }
 *   • render: (contexte) => Node | Promise<Node>
 *   • unmount (facultatif) : nettoyage lors du changement d'écran
 * ------------------------------------------------------------------------- */

import { DEFAULT_ROUTE } from '../config/constants.js';
import { toast } from './ui.js';

const registry = new Map();
const cleanups = new Set();
let currentPath = '';
let renderToken = 0;

export function registerRoute(path, loader) {
  registry.set(path, loader);
}

export function registerRoutes(map) {
  for (const [path, loader] of Object.entries(map)) registry.set(path, loader);
}

export function pathFromHash(hash = window.location.hash) {
  const cleaned = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  return cleaned || DEFAULT_ROUTE;
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path}`;
  if (window.location.hash === target) {
    render();
    return;
  }
  if (replace) window.location.replace(`${window.location.pathname}${window.location.search}${target}`);
  else window.location.hash = target;
}

export function currentRoute() {
  return currentPath;
}

export function onCleanup(handler) {
  cleanups.add(handler);
  return () => cleanups.delete(handler);
}

function runCleanups() {
  for (const handler of cleanups) {
    try {
      handler();
    } catch (error) {
      console.error('[Mon Commerce] Erreur lors du nettoyage d’un écran :', error);
    }
  }
  cleanups.clear();
}

/**
 * Rend l'écran correspondant à l'ancre courante.
 * @param {{onRouteChange?: Function}} options
 */
export async function render({ onRouteChange = null } = {}) {
  const path = pathFromHash();
  const target = (registry.has(path) ? path : DEFAULT_ROUTE);
  currentPath = target;
  if (target !== path) {
    window.location.hash = `#/${target}`;
    return;
  }

  const view = document.getElementById('view');
  if (!view) return;

  runCleanups();
  const token = ++renderToken;

  const loader = registry.get(target);
  if (!loader) {
    view.replaceChildren();
    view.append(Object.assign(document.createElement('p'), { className: 'text-sm text-muted', textContent: 'Écran introuvable.' }));
    return;
  }

  try {
    const module = await loader();
    if (token !== renderToken) return;
    const context = {
      path: target,
      navigate,
      onCleanup,
      setTitle(title) {
        document.title = `${title} — Mon Commerce`;
      },
    };
    const node = await module.default.render(context);
    if (token !== renderToken) return;
    view.replaceChildren(node);
    if (typeof view.scrollIntoView === 'function') view.scrollIntoView({ block: 'start' });
    if (onRouteChange) onRouteChange(target, module.default.meta || {});
    if (module.default.meta && module.default.meta.title) {
      document.title = `${module.default.meta.title} — Mon Commerce`;
    }
  } catch (error) {
    console.error('[Mon Commerce] Échec du rendu de l’écran :', error);
    if (token !== renderToken) return;
    const { errorPanel } = await import('./ui.js');
    view.replaceChildren(errorPanel(error, () => render({ onRouteChange })));
  }
}

export function startRouter(options = {}) {
  window.addEventListener('hashchange', () => render(options));
  if (!window.location.hash) window.location.replace(`#/${DEFAULT_ROUTE}`);
  else render(options);
}

export function handleRouteError(error) {
  toast(error && error.message ? error.message : 'Une erreur est survenue.', 'error', { duration: 6000 });
}
