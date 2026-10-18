/* ---------------------------------------------------------------------------
 * Mon Commerce — état de vue partagé (période et activité sélectionnées)
 *
 * Ces préférences d'affichage sont communes à tous les écrans : un filtre
 * choisi sur le tableau de bord reste actif si l'on change de page.
 * ------------------------------------------------------------------------- */

import { periodRange } from './dates.js';

const state = {
  periodPreset: 'month',
  customFrom: '',
  customTo: '',
  activityId: '',
};

const listeners = new Set();

export function getViewState() {
  return { ...state };
}

/** Plage de dates effective pour la période sélectionnée. */
export function getPeriod(reference = new Date()) {
  return periodRange(
    state.periodPreset,
    { from: state.customFrom, to: state.customTo },
    reference,
  );
}

/** Filtres prêts à l'emploi pour les services financiers. */
export function getFilters() {
  const period = getPeriod();
  return { activityId: state.activityId || '', from: period.from, to: period.to, period };
}

export function setViewState(patch = {}) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in state)) continue;
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (changed) for (const listener of listeners) listener(getViewState());
  return changed;
}

export function subscribeView(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetViewState() {
  state.periodPreset = 'month';
  state.customFrom = '';
  state.customTo = '';
  state.activityId = '';
  for (const listener of listeners) listener(getViewState());
}
