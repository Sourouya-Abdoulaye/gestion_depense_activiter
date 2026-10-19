/* ---------------------------------------------------------------------------
 * Mon Commerce — composants d'interface réutilisables
 * Cartes KPI, tableaux, modales accessibles, notifications, états vides.
 * ------------------------------------------------------------------------- */

import { escapeHtml } from './format.js';
import { element, fragment, html, mount, qs, qsa, raw, formValues, clearFieldErrors } from './dom.js';
import { icon } from './icons.js';

/* ------------------------------ notifications --------------------------- */

const TOAST_STYLES = {
  success: { classes: 'bg-white border-brand text-ink', icon: 'check', iconClass: 'text-brand' },
  error: { classes: 'bg-white border-danger text-ink', icon: 'alert', iconClass: 'text-danger' },
  warning: { classes: 'bg-white border-warning text-ink', icon: 'alert', iconClass: 'text-warning' },
  info: { classes: 'bg-white border-line text-ink', icon: 'info', iconClass: 'text-muted' },
};

/**
 * Notification discrète en haut de l'écran.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 */
export function toast(message, type = 'success', { duration = 4200 } = {}) {
  const root = qs('#toast-root');
  if (!root) return () => {};
  const style = TOAST_STYLES[type] || TOAST_STYLES.info;
  const node = element(html`
    <div
      class="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border-l-4 ${style.classes} px-4 py-3 shadow-float"
      role="${type === 'error' ? 'alert' : 'status'}"
    >
      <span class="${style.iconClass} mt-0.5 shrink-0">${raw(icon(style.icon, { size: 18 }))}</span>
      <p class="flex-1 text-sm">${message}</p>
      <button type="button" class="shrink-0 text-muted hover:text-ink" aria-label="Fermer la notification">
        ${raw(icon('close', { size: 16 }))}
      </button>
    </div>
  `);
  root.append(node);

  let timer = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    node.remove();
  };
  node.querySelector('button').addEventListener('click', close);
  if (duration > 0) timer = setTimeout(close, duration);
  return close;
}

/**
 * Exécute une action métier en gérant les erreurs : toute erreur est signalée
 * à l'utilisateur (aucun échec silencieux). Les erreurs de stockage sont
 * relayées après notification, car elles sont bloquantes.
 */
export async function runAction(action, { successMessage = '', silent = false } = {}) {
  try {
    const result = await action();
    if (successMessage && !silent) toast(successMessage, 'success');
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : 'Une erreur est survenue.';
    toast(message, 'error', { duration: 7000 });
    if (error && error.name === 'StorageError') throw error;
    return null;
  }
}

/** Bouton standard avec icône facultative. */
export function button({ label, iconName = '', variant = 'ghost', onClick = null, title = '', disabled = false, className = '' }) {
  const variantClass = {
    primary: 'btn-primary',
    danger: 'btn-danger',
    warning: 'btn-warning',
    ghost: 'btn-ghost',
    dark: 'btn-dark',
  }[variant] || 'btn-ghost';
  const node = element(html`
    <button type="button" class="${variantClass} ${className}" title="${title}" ${disabled ? 'disabled' : ''}>
      ${iconName ? raw(icon(iconName, { size: 16 })) : ''}<span>${label}</span>
    </button>
  `);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/* --------------------------------- modales ------------------------------ */

let openModalCount = 0;

/**
 * Modale accessible : focus déplacé à l'ouverture, fermeture par Échap ou
 * clic sur le fond, restitution du focus à la fermeture.
 * @param {{title: string, content: Node|string, actions?: Array, size?: 'sm'|'md'|'lg'|'xl', onClose?: Function, description?: string}} options
 */
export function openModal({ title, content, actions = [], size = 'md', onClose = null, description = '' }) {
  const root = qs('#modal-root');
  const previouslyFocused = document.activeElement;
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size] || 'max-w-2xl';

  const wrapper = element(html`
    <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/50 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        class="scroll-thin max-h-[95vh] w-full ${width} overflow-y-auto rounded-t-2xl bg-white shadow-float sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      ></div>
    </div>
  `);
  const panel = wrapper.querySelector('[role="dialog"]');

  const header = element(html`
    <header class="flex items-start gap-3 border-b border-line px-5 py-4">
      <div class="min-w-0 flex-1">
        <h2 id="modal-title" class="truncate text-lg font-semibold text-brand-dark">${title}</h2>
        ${description ? html`<p class="mt-0.5 text-sm text-muted">${description}</p>` : ''}
      </div>
      <button type="button" data-modal-close class="btn-ghost btn-sm" aria-label="Fermer la fenêtre">
        ${raw(icon('close', { size: 16 }))}
      </button>
    </header>
  `);
  panel.append(header);

  const body = element('<div class="px-5 py-4"></div>');
  if (typeof content === 'string') body.append(fragment(content));
  else if (content) body.append(content);
  panel.append(body);

  const close = () => {
    wrapper.remove();
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) root.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    if (onClose) onClose();
  };

  if (actions && actions.length > 0) {
    const footer = element('<footer class="modal-actions flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3"></footer>');
    for (const action of actions) {
      const variant = {
        primary: 'btn-primary',
        danger: 'btn-danger',
        warning: 'btn-warning',
        ghost: 'btn-ghost',
        dark: 'btn-dark',
      }[action.variant || 'ghost'];
      const button = element(html`<button type="button" class="${variant}">${action.label}</button>`);
      button.addEventListener('click', async () => {
        if (!action.onClick) {
          close();
          return;
        }
        const result = await action.onClick({ close, body });
        if (result === false) return;
        if (action.closeOnClick !== false) close();
      });
      footer.append(button);
    }
    panel.append(footer);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
    if (event.key === 'Tab') {
      const focusable = qsa(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        panel,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  wrapper.addEventListener('click', (event) => {
    if (event.target === wrapper) close();
  });
  header.querySelector('[data-modal-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);

  root.hidden = false;
  root.append(wrapper);
  openModalCount += 1;

  const firstField = qs('input:not([type="hidden"]), select, textarea', panel) || qs('button', panel);
  if (firstField) setTimeout(() => firstField.focus(), 30);

  return { close, panel, body, wrapper };
}

/** Confirmation avant une action destructrice. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', variant = 'danger', details = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      size: 'sm',
      onClose: () => done(false),
      content: html`
        <p class="text-sm text-ink">${message}</p>
        ${details ? html`<div class="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">${details}</div>` : ''}
      `,
      actions: [
        { label: cancelLabel, variant: 'ghost', onClick: () => done(false) },
        { label: confirmLabel, variant, onClick: () => done(true) },
      ],
    });
    void modal;
  });
}

/** Saisie d'une valeur courte (motif d'annulation, quantité cible…). */
export function inputDialog({ title, label, type = 'text', value = '', placeholder = '', confirmLabel = 'Valider', description = '', min, max, step }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const form = element(html`
      <form novalidate>
        <label class="label" for="dialog-input">${label}</label>
        <input
          id="dialog-input"
          class="input"
          type="${type}"
          value="${value}"
          placeholder="${placeholder}"
          ${min !== undefined ? html`min="${min}"` : ''}
          ${max !== undefined ? html`max="${max}"` : ''}
          ${step !== undefined ? html`step="${step}"` : ''}
        />
      </form>
    `);
    openModal({
      title,
      description,
      size: 'sm',
      content: form,
      onClose: () => done(null),
      actions: [
        { label: 'Annuler', variant: 'ghost', onClick: () => done(null) },
        {
          label: confirmLabel,
          variant: 'primary',
          onClick: () => {
            const field = form.elements['dialog-input'] || form.querySelector('#dialog-input');
            done(field ? field.value : '');
            return true;
          },
        },
      ],
    });
  });
}

/* ------------------------------- structures ----------------------------- */

/** En-tête de page cohérent. */
export function pageHeader({ title, subtitle = '', actions = [], breadcrumb = '' }) {
  const node = element(html`
    <div class="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        ${breadcrumb ? html`<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">${breadcrumb}</p>` : ''}
        <h1 class="truncate text-xl font-bold text-brand-dark sm:text-2xl">${title}</h1>
        ${subtitle ? html`<p class="mt-1 text-sm text-muted">${subtitle}</p>` : ''}
      </div>
      ${actions.length > 0 ? html`<div class="page-actions no-print flex flex-wrap items-center gap-2"></div>` : ''}
    </div>
  `);
  if (actions.length > 0) {
    const slot = node.querySelector('.no-print');
    for (const action of actions) if (action) slot.append(action);
  }
  return node;
}

export function sectionCard({ title = '', description = '', actions = [], content, className = '' }) {
  const node = element(html`
    <section class="card ${className}">
      ${title || actions.length
        ? html`
            <header class="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div class="min-w-0">
                ${title ? html`<h2 class="text-base font-semibold text-brand-dark">${title}</h2>` : ''}
                ${description ? html`<p class="mt-0.5 text-xs text-muted">${description}</p>` : ''}
              </div>
              <div class="no-print flex flex-wrap items-center gap-2"></div>
            </header>
          `
        : ''}
      <div class="card-pad"></div>
    </section>
  `);
  const actionSlot = qs('header > div:last-child', node);
  if (actionSlot) for (const action of actions) actionSlot.append(action);
  const contentSlot = node.lastElementChild;
  if (typeof content === 'string') contentSlot.append(fragment(content));
  else if (content) contentSlot.append(content);
  return node;
}

export function kpiCard({ label, value, hint = '', tone = 'neutral', iconName = '', hintTone = '' }) {
  const tones = {
    neutral: 'text-ink',
    positive: 'text-brand',
    negative: 'text-danger',
    warning: 'text-warning',
  };
  return element(html`
    <div class="card card-pad">
      <div class="flex items-start justify-between gap-2">
        <p class="kpi-label">${label}</p>
        ${iconName ? html`<span class="text-brand-dark/70">${raw(icon(iconName, { size: 18 }))}</span>` : ''}
      </div>
      <p class="kpi-value ${tones[tone] || tones.neutral}">${value}</p>
      ${hint ? html`<p class="mt-1 text-xs ${hintTone === 'danger' ? 'text-danger' : hintTone === 'warning' ? 'text-warning' : 'text-muted'}">${hint}</p>` : ''}
    </div>
  `);
}

export function badge(text, tone = 'brand') {
  const className = {
    brand: 'badge-brand',
    neutral: 'badge-neutral',
    danger: 'badge-danger',
    warning: 'badge-warning',
  }[tone] || 'badge-neutral';
  return html`<span class="${className}">${text}</span>`;
}

export function emptyState({ title, message = '', actionLabel = '', onAction = null, iconName = 'info' }) {
  const node = element(html`
    <div class="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-full bg-brand-light text-brand-dark">
        ${raw(icon(iconName, { size: 22 }))}
      </span>
      <h3 class="text-base font-semibold text-brand-dark">${title}</h3>
      ${message ? html`<p class="max-w-md text-sm text-muted">${message}</p>` : ''}
      ${actionLabel ? html`<div class="mt-1"></div>` : ''}
    </div>
  `);
  if (actionLabel && onAction) {
    const button = element(html`<button type="button" class="btn-primary">${actionLabel}</button>`);
    button.addEventListener('click', onAction);
    node.lastElementChild.append(button);
  }
  return node;
}

export function loadingPanel(message = 'Chargement…') {
  return element(html`
    <div class="flex items-center justify-center gap-3 px-4 py-12 text-sm text-muted" role="status">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden="true"></span>
      <span>${message}</span>
    </div>
  `);
}

export function errorPanel(error, onRetry = null) {
  const message = error && error.message ? error.message : String(error || 'Erreur inconnue');
  const node = element(html`
    <div class="card card-pad flex flex-col items-start gap-3 border-danger/40">
      <div class="flex items-center gap-2 text-danger">
        ${raw(icon('alert', { size: 20 }))}
        <h3 class="text-base font-semibold">Une erreur est survenue</h3>
      </div>
      <p class="text-sm text-ink">${message}</p>
      ${error && error.code === 'quota'
        ? html`<p class="text-xs text-muted">Exportez une sauvegarde JSON puis libérez de l’espace dans les paramètres du navigateur.</p>`
        : ''}
      <div class="no-print"></div>
    </div>
  `);
  if (onRetry) {
    const button = element(html`<button type="button" class="btn-ghost">Réessayer</button>`);
    button.addEventListener('click', onRetry);
    node.lastElementChild.append(button);
  }
  return node;
}

/**
 * Tableau de données avec recherche facultative.
 * @param {{columns: Array<{key:string,label:string,render?:Function,align?:string,className?:string}>, rows: Array, empty?: object, searchable?: boolean, searchPlaceholder?: string, caption?: string}} options
 */
export function dataTable({ columns, rows = [], empty = {}, searchable = false, searchPlaceholder = 'Rechercher…', caption = '', onRowClick = null, initialLimit = 25 }) {
  const wrapper = element(html`
    <div>
      ${searchable
        ? html`
            <div class="no-print mb-3 flex flex-wrap items-center gap-2">
              <label class="relative flex-1 min-w-[200px]">
                <span class="sr-only">Rechercher dans le tableau</span>
                <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">${raw(icon('search', { size: 16 }))}</span>
                <input type="search" class="input pl-9" placeholder="${searchPlaceholder}" data-table-search />
              </label>
              <p class="text-xs text-muted" data-table-count></p>
            </div>
          `
        : ''}
      <div class="table-wrap">
        <table class="table table-stack">
          ${caption ? html`<caption class="sr-only">${caption}</caption>` : ''}
          <thead>
            <tr>
              ${columns.map(
                (column) =>
                  html`<th scope="col" class="${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}">${column.label}</th>`,
              )}
            </tr>
          </thead>
          <tbody data-table-body></tbody>
        </table>
      </div>
      <div data-table-empty class="hidden"></div>
      <div class="no-print mt-3 hidden text-center" data-table-more>
        <button type="button" class="btn-ghost btn-sm">Afficher plus de lignes</button>
      </div>
    </div>
  `);

  const tbody = qs('[data-table-body]', wrapper);
  const emptySlot = qs('[data-table-empty]', wrapper);
  const countSlot = qs('[data-table-count]', wrapper);
  const searchInput = qs('[data-table-search]', wrapper);
  const moreSlot = qs('[data-table-more]', wrapper);
  let limit = Math.max(initialLimit, 10);
  let filtered = rows;

  function rowMarkup(row) {
    return columns.map((column) => {
      const value = column.render ? column.render(row) : escapeHtml(row[column.key] ?? '');
      const isSafe = value && typeof value === 'object' && value.__html;
      const align = column.align === 'right' ? 'text-right tabular-nums' : column.align === 'center' ? 'text-center' : '';
      return `<td data-label="${escapeHtml(column.label || '')}" class="${align} ${column.className || ''}">${isSafe ? value.__html : escapeHtml(value)}</td>`;
    }).join('');
  }

  function draw() {
    const visible = filtered.slice(0, limit);
    mount(tbody, visible.map((row) => html`<tr data-row-id="${row.id || ''}">${raw(rowMarkup(row))}</tr>`).join('') || '');
    emptySlot.classList.toggle('hidden', filtered.length > 0);
    if (filtered.length === 0) {
      mount(
        emptySlot,
        emptyState({
          title: empty.title || 'Aucune donnée',
          message: empty.message || '',
          iconName: empty.iconName || 'info',
        }),
      );
    }
    if (countSlot) {
      countSlot.textContent =
        filtered.length === rows.length
          ? `${rows.length} ligne${rows.length > 1 ? 's' : ''}`
          : `${filtered.length} sur ${rows.length} ligne${rows.length > 1 ? 's' : ''}`;
    }
    moreSlot.classList.toggle('hidden', filtered.length <= limit);
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim().toLowerCase();
      filtered = term
        ? rows.filter((row) =>
            columns.some((column) => {
              const value = column.searchValue ? column.searchValue(row) : row[column.key];
              return String(value ?? '').toLowerCase().includes(term);
            }),
          )
        : rows;
      limit = Math.max(initialLimit, 10);
      draw();
    });
  }

  qs('button', moreSlot).addEventListener('click', () => {
    limit += 25;
    draw();
  });

  if (onRowClick) {
    tbody.addEventListener('click', (event) => {
      const tr = event.target.closest('tr[data-row-id]');
      if (!tr) return;
      const row = rows.find((entry) => String(entry.id) === tr.dataset.rowId);
      if (row) onRowClick(row, event);
    });
  }

  draw();

  return {
    element: wrapper,
    update(nextRows) {
      rows = nextRows;
      filtered = nextRows;
      limit = Math.max(initialLimit, 10);
      if (searchInput) searchInput.value = '';
      draw();
    },
  };
}

/** Liste de définitions (fiche détail, synthèse). */
export function definitionList(entries = [], { columns = 1 } = {}) {
  return element(html`
    <dl class="grid gap-x-6 gap-y-3 ${columns === 2 ? 'sm:grid-cols-2' : ''}">
      ${entries.map(
        (entry) => html`
          <div class="min-w-0">
            <dt class="text-xs font-semibold uppercase tracking-wide text-muted">${entry.label}</dt>
            <dd class="mt-0.5 text-sm ${entry.className || 'text-ink'}">${raw(entry.value ?? '—')}</dd>
          </div>
        `,
      )}
    </dl>
  `);
}

/** Bandeau d'information contextuel (hypothèses, avertissements). */
export function noticePanel({ tone = 'info', title = '', message = '', items = [] }) {
  const tones = {
    info: { classes: 'border-brand/30 bg-brand-light/60', iconColor: 'text-brand-dark', icon: 'info' },
    warning: { classes: 'border-warning/30 bg-amber-50', iconColor: 'text-warning', icon: 'alert' },
    danger: { classes: 'border-danger/30 bg-red-50', iconColor: 'text-danger', icon: 'alert' },
  }[tone] || {};
  return element(html`
    <div class="flex gap-3 rounded-xl border px-4 py-3 ${tones.classes}">
      <span class="${tones.iconColor} mt-0.5 shrink-0">${raw(icon(tones.icon, { size: 18 }))}</span>
      <div class="min-w-0 text-sm text-ink">
        ${title ? html`<p class="font-semibold">${title}</p>` : ''}
        ${message ? html`<p class="${title ? 'mt-0.5' : ''}">${message}</p>` : ''}
        ${items.length > 0
          ? html`<ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">${items.map((item) => html`<li>${item}</li>`)}</ul>`
          : ''}
      </div>
    </div>
  `);
}

/** Champ de formulaire standardisé (label + aide + erreur rendue par le validateur). */
export function field({ name, label, type = 'text', value = '', hint = '', required = false, options = null, placeholder = '', step = 'any', min = '', max = '', rows = 3, disabled = false, className = '' }) {
  const requiredMark = required ? html` <span class="text-danger" aria-hidden="true">*</span>` : '';
  let control;
  if (type === 'select') {
    control = html`
      <select id="field-${name}" name="${name}" class="input" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>
        ${(options || []).map(
          (option) => html`<option value="${option.value}" ${String(option.value) === String(value) ? 'selected' : ''}>${option.label}</option>`,
        )}
      </select>
    `;
  } else if (type === 'textarea') {
    control = html`<textarea id="field-${name}" name="${name}" class="input" rows="${rows}" placeholder="${placeholder}" ${disabled ? 'disabled' : ''}>${value}</textarea>`;
  } else if (type === 'checkbox') {
    control = html`
      <label class="flex items-start gap-2 text-sm">
        <input id="field-${name}" name="${name}" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand" ${value ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span>${hint || label}</span>
      </label>
    `;
    return element(html`<div class="${className}">${control}</div>`);
  } else {
    control = html`
      <input
        id="field-${name}"
        name="${name}"
        type="${type}"
        class="input"
        value="${value}"
        placeholder="${placeholder}"
        ${type === 'number' ? html`step="${step}" min="${min}" max="${max}" inputmode="decimal"` : ''}
        ${required ? 'required' : ''}
        ${disabled ? 'disabled' : ''}
      />
    `;
  }
  return element(html`
    <div class="${className}">
      <label class="label" for="field-${name}">${label}${requiredMark}</label>
      ${control}
      ${hint && type !== 'checkbox' ? html`<p class="field-hint">${hint}</p>` : ''}
    </div>
  `);
}

/** Convertit une liste de chaînes en options de select. */
export function optionsFrom(list = [], { placeholder = '' } = {}) {
  const options = list.map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  return placeholder ? [{ value: '', label: placeholder }, ...options] : options;
}

/** Statut d'un document (vente, achat, retour) affiché comme badge. */
export function documentStatusBadge(status) {
  const map = {
    validated: { label: 'Validée', tone: 'brand' },
    received: { label: 'Réceptionné', tone: 'brand' },
    ordered: { label: 'Commandé', tone: 'warning' },
    draft: { label: 'Brouillon', tone: 'neutral' },
    cancelled: { label: 'Annulée', tone: 'danger' },
  };
  const entry = map[status] || { label: status ? String(status) : '—', tone: 'neutral' };
  return badge(entry.label, entry.tone);
}

/**
 * Formulaire présenté dans une modale, avec gestion des erreurs.
 * `onSubmit(values, helpers)` doit renvoyer `false` pour laisser la fenêtre
 * ouverte (validation échouée par exemple). Toute exception est signalée à
 * l'utilisateur : aucun échec silencieux.
 */
export function modalForm({
  title,
  description = '',
  size = 'md',
  fields = [],
  extra = null,
  submitLabel = 'Enregistrer',
  cancelLabel = 'Annuler',
  onSubmit,
  columns = 2,
}) {
  const form = element('<form novalidate class="space-y-4"></form>');
  const grid = element(`<div class="grid gap-4 ${columns === 1 ? '' : 'sm:grid-cols-2'}"></div>`);
  for (const item of fields) {
    if (!item) continue;
    const node = item.node || item;
    if (item.span === 2) node.classList.add('sm:col-span-2');
    grid.append(node);
  }
  form.append(grid);
  if (extra) form.append(extra);

  return openModal({
    title,
    description,
    size,
    content: form,
    actions: [
      { label: cancelLabel, variant: 'ghost' },
      {
        label: submitLabel,
        variant: 'primary',
        onClick: async () => {
          clearFieldErrors(form);
          let outcome;
          try {
            outcome = await onSubmit(formValues(form), { form });
          } catch (error) {
            toast(error && error.message ? error.message : 'Une erreur est survenue.', 'error', { duration: 6500 });
            return false;
          }
          return outcome === false ? false : true;
        },
      },
    ],
  });
}

export { icon };
