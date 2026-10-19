/* ---------------------------------------------------------------------------
 * Mon Commerce — barre de filtres (activité + période)
 * Composant partagé par le tableau de bord et les rapports.
 * ------------------------------------------------------------------------- */

import { PERIOD_PRESETS, ACTIVITY_STATUS } from '../config/constants.js';
import { formatDate } from './dates.js';
import { html, element, qs, raw } from './dom.js';
import { getPeriod, getViewState, setViewState } from './view-state.js';
import { icon } from './icons.js';

/**
 * Barre de filtres : sélection d'activité, période prédéfinie ou personnalisée.
 * @param {{activities: Array, showActivity?: boolean, onActivityLocked?: boolean, extra?: Node}} options
 */
export function filterBar({ activities = [], showActivity = true, lockedActivityId = '' } = {}) {
  const view = getViewState();
  const period = getPeriod();
  const activeActivities = activities.filter((activity) => activity.status === ACTIVITY_STATUS.ACTIVE);
  const archivedActivities = activities.filter((activity) => activity.status === ACTIVITY_STATUS.ARCHIVED);

  const node = element(html`
    <div class="card card-pad no-print filter-bar mb-4">
      <div class="flex flex-wrap items-end gap-3">
        ${showActivity
          ? html`
              <div class="min-w-[200px] flex-1">
                <label class="label" for="filter-activity">Activité</label>
                <select id="filter-activity" class="input" ${lockedActivityId ? 'disabled' : ''}>
                  <option value="">Toutes les activités</option>
                  ${activeActivities.length > 0 ? html`<optgroup label="Actives">${activeActivities.map((activity) => html`<option value="${activity.id}" ${view.activityId === activity.id ? 'selected' : ''}>${activity.name}</option>`)}</optgroup>` : ''}
                  ${archivedActivities.length > 0 ? html`<optgroup label="Archivées">${archivedActivities.map((activity) => html`<option value="${activity.id}" ${view.activityId === activity.id ? 'selected' : ''}>${activity.name}</option>`)}</optgroup>` : ''}
                </select>
              </div>
            `
          : html`<input type="hidden" id="filter-activity" value="${view.activityId}" />`}

        <div class="min-w-[170px]">
          <label class="label" for="filter-period">Période</label>
          <select id="filter-period" class="input">
            ${PERIOD_PRESETS.map(
              (preset) => html`<option value="${preset.value}" ${view.periodPreset === preset.value ? 'selected' : ''}>${preset.label}</option>`,
            )}
          </select>
        </div>

        <div class="flex flex-1 flex-wrap items-end gap-3 ${view.periodPreset === 'custom' ? '' : 'hidden'}" data-custom-range>
          <div>
            <label class="label" for="filter-from">Du</label>
            <input id="filter-from" type="date" class="input" value="${view.customFrom || period.from}" />
          </div>
          <div>
            <label class="label" for="filter-to">Au</label>
            <input id="filter-to" type="date" class="input" value="${view.customTo || period.to}" />
          </div>
        </div>

        <div class="ml-auto flex items-center gap-2 text-xs text-muted">
          <span class="hidden items-center gap-1 sm:flex">${raw(icon('clock', { size: 14 }))} <span data-period-label></span></span>
          <button type="button" class="btn-ghost btn-sm" data-reset-filters>Tout l’historique</button>
        </div>
      </div>
    </div>
  `);

  const activitySelect = qs('#filter-activity', node);
  const periodSelect = qs('#filter-period', node);
  const customRange = qs('[data-custom-range]', node);
  const fromInput = qs('#filter-from', node);
  const toInput = qs('#filter-to', node);
  const label = qs('[data-period-label]', node);

  function refreshLabel() {
    const current = getPeriod();
    const preset = PERIOD_PRESETS.find((entry) => entry.value === view.periodPreset);
    if (view.periodPreset === 'all') label.textContent = 'Tout l’historique';
    else label.textContent = `du ${formatDate(current.from)} au ${formatDate(current.to)}`;
  }

  async function apply(patch) {
    setViewState(patch);
    refreshLabel();
    if (typeof node.__onChange === 'function') await node.__onChange();
  }

  if (activitySelect && !lockedActivityId) {
    activitySelect.addEventListener('change', () => apply({ activityId: activitySelect.value }));
  }
  periodSelect.addEventListener('change', async () => {
    const isCustom = periodSelect.value === 'custom';
    customRange.classList.toggle('hidden', !isCustom);
    if (isCustom) {
      const current = getPeriod();
      if (!fromInput.value) fromInput.value = current.from;
      if (!toInput.value) toInput.value = current.to;
      await apply({ periodPreset: 'custom', customFrom: fromInput.value, customTo: toInput.value });
    } else {
      await apply({ periodPreset: periodSelect.value });
    }
  });
  fromInput.addEventListener('change', () => apply({ customFrom: fromInput.value }));
  toInput.addEventListener('change', () => apply({ customTo: toInput.value }));
  qs('[data-reset-filters]', node).addEventListener('click', async () => {
    periodSelect.value = 'all';
    customRange.classList.add('hidden');
    await apply({ periodPreset: 'all' });
  });

  refreshLabel();

  /** Permet à l'écran appelant de réagir aux changements de filtre. */
  node.onChange = (handler) => {
    node.__onChange = handler;
    return node;
  };

  return node;
}

/** Résumé textuel des filtres actifs (affiché dans les exports). */
export function describeFilters({ period, activityName, formatDateFn = formatDate }) {
  const range = period.preset === 'all' ? 'tout l’historique' : `du ${formatDateFn(period.from)} au ${formatDateFn(period.to)}`;
  return `${activityName || 'toutes les activités'} — ${range}`;
}
