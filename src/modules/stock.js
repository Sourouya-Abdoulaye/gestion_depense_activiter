/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Mouvements de stock »
 *
 * Historique complet et traçable des entrées et sorties. Le stock n'est jamais
 * saisi directement : il découle de ces mouvements (ventes, achats, retours,
 * pertes, inventaires). Les corrections documentées sont créées ici.
 * ------------------------------------------------------------------------- */

import { MANUAL_STOCK_REASONS, STOCK_REASON_MAP } from '../config/constants.js';
import { html, element, qs, raw, delegate } from '../shared/dom.js';
import { formatMoney, formatQuantity, toNumber } from '../shared/format.js';
import { formatDate } from '../shared/dates.js';
import { getFilters } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import { button, kpiCard, noticePanel, openModal, pageHeader, toast } from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { openStockAdjustment } from '../shared/stock-form.js';
import { getState } from '../services/state.js';
import { computeStockState, sortMovements, stockValue } from '../services/stock.js';
import { exportStockMovementsCsv } from '../services/csv.js';

export const meta = { path: 'stock', title: 'Mouvements de stock' };

/* Filtre produit conservé tant que la page reste ouverte. */
let selectedProductId = '';

function directionBadge(movement) {
  const quantity = toNumber(movement.quantity, 0);
  if (quantity > 0) return html`<span class="badge badge-brand">Entrée</span>`;
  if (quantity < 0) return html`<span class="badge badge-danger">Sortie</span>`;
  return html`<span class="badge badge-neutral">Neutre</span>`;
}

function productSheet(product, stockState, movements) {
  const entry = stockState[product.id] || { quantity: 0, value: 0, averageCost: 0 };
  const list = sortMovements(movements.filter((movement) => movement.productId === product.id)).reverse();
  const rows = list
    .map(
      (movement) => html`
        <tr>
          <td class="whitespace-nowrap">${formatDate(movement.date)}</td>
          <td>${STOCK_REASON_MAP[movement.reason]?.label || movement.reason}</td>
          <td class="text-right ${toNumber(movement.quantity, 0) < 0 ? 'text-danger' : 'text-brand-dark'}">${formatQuantity(movement.quantity)}</td>
          <td class="text-right">${movement.unitCost === null || movement.unitCost === undefined ? '—' : formatMoney(movement.unitCost)}</td>
          <td class="text-muted">${movement.note || ''}</td>
        </tr>
      `,
    )
    .join('');

  openModal({
    title: `Fiche de stock — ${product.name}`,
    size: 'lg',
    content: element(html`
      <div class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-line bg-canvas/60 p-3">
            <p class="kpi-label">Quantité disponible</p>
            <p class="kpi-value">${formatQuantity(entry.quantity, product.unit)}</p>
          </div>
          <div class="rounded-lg border border-line bg-canvas/60 p-3">
            <p class="kpi-label">Coût moyen pondéré</p>
            <p class="kpi-value">${formatMoney(entry.averageCost)}</p>
          </div>
          <div class="rounded-lg border border-line bg-canvas/60 p-3">
            <p class="kpi-label">Valeur du stock</p>
            <p class="kpi-value">${formatMoney(entry.value)}</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Date</th><th>Motif</th><th class="text-right">Quantité</th><th class="text-right">Coût unitaire</th><th>Note</th></tr>
            </thead>
            <tbody>${raw(rows) || ''}</tbody>
          </table>
        </div>
        ${list.length === 0 ? html`<p class="text-sm text-muted">Aucun mouvement pour ce produit.</p>` : ''}
      </div>
    `),
  });
}

function paint(ctx, api) {
  const state = getState();
  const settings = state.settings || {};
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Mouvements de stock' }));
    wrapper.append(needsActivityNotice({ ctx }));
    return wrapper;
  }

  const stockState = computeStockState(state.stockMovements, state.products);
  const products = state.products;
  const filters = getFilters();

  const scoped = sortMovements(
    state.stockMovements.filter((movement) => {
      if (filters.activityId && movement.activityId && movement.activityId !== filters.activityId) return false;
      if (selectedProductId && movement.productId !== selectedProductId) return false;
      const date = movement.date || '';
      if (filters.from && date < filters.from) return false;
      if (filters.to && date > filters.to) return false;
      return true;
    }),
  ).reverse();

  const totalIn = scoped.reduce((total, movement) => total + Math.max(toNumber(movement.quantity, 0), 0), 0);
  const totalOut = scoped.reduce((total, movement) => total + Math.abs(Math.min(toNumber(movement.quantity, 0), 0)), 0);

  wrapper.append(
    pageHeader({
      title: 'Mouvements de stock',
      subtitle: 'Chaque entrée et chaque sortie est conservée : le stock est toujours recalculable.',
      actions: [
        button({ label: 'Nouveau mouvement', iconName: 'plus', variant: 'primary', onClick: () => openStockAdjustment({}) }),
        button({
          label: 'Exporter',
          iconName: 'download',
          onClick: () => {
            if (scoped.length === 0) {
              toast('Aucun mouvement à exporter sur cette période.', 'warning');
              return;
            }
            const activity = state.activities.find((entry) => entry.id === filters.activityId);
            const { lines } = exportStockMovementsCsv({ movements: scoped, products, activityName: activity ? activity.name : '' });
            toast(`${lines} mouvement(s) exporté(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Mouvements affichés', value: String(scoped.length), hint: `${state.stockMovements.length} au total`, iconName: 'layers' }).outerHTML)}
        ${raw(kpiCard({ label: 'Quantités entrées', value: formatQuantity(totalIn), tone: 'positive', iconName: 'plus' }).outerHTML)}
        ${raw(kpiCard({ label: 'Quantités sorties', value: formatQuantity(totalOut), tone: 'negative', iconName: 'arrowRight' }).outerHTML)}
        ${raw(kpiCard({ label: 'Valeur du stock', value: formatMoney(stockValue(stockState)), hint: 'Tous produits confondus', iconName: 'box' }).outerHTML)}
      </div>
    `),
  );

  const section = element(html`
    <section class="card">
      <header class="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div class="min-w-[220px] flex-1">
          <label class="label" for="stock-product-filter">Filtrer par produit</label>
          <select id="stock-product-filter" class="input">
            <option value="">Tous les produits</option>
            ${products.map(
              (product) => html`<option value="${product.id}" ${product.id === selectedProductId ? 'selected' : ''}>${product.name}</option>`,
            )}
          </select>
        </div>
        <p class="text-xs text-muted">Période et activité : voir la barre de filtres ci-dessus.</p>
      </header>
      <div class="card-pad">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Produit</th>
                <th>Sens</th>
                <th>Motif</th>
                <th class="text-right">Quantité</th>
                <th class="text-right">Coût unitaire</th>
                <th class="text-right"><span class="sr-only">Fiche</span></th>
              </tr>
            </thead>
            <tbody>
              ${scoped.length === 0
                ? html`<tr><td colspan="7" class="py-8 text-center text-sm text-muted">Aucun mouvement sur cette période.</td></tr>`
                : scoped.map((movement) => {
                    const product = products.find((entry) => entry.id === movement.productId);
                    return html`
                      <tr>
                        <td class="whitespace-nowrap">${formatDate(movement.date)}</td>
                        <td class="font-medium">${product ? product.name : 'Produit supprimé'}</td>
                        <td>${directionBadge(movement)}</td>
                        <td class="text-muted">${STOCK_REASON_MAP[movement.reason]?.label || movement.reason}</td>
                        <td class="text-right tabular-nums font-semibold ${toNumber(movement.quantity, 0) < 0 ? 'text-danger' : 'text-brand-dark'}">
                          ${formatQuantity(movement.quantity)}
                        </td>
                        <td class="text-right tabular-nums">${movement.unitCost === null || movement.unitCost === undefined ? '—' : formatMoney(movement.unitCost)}</td>
                        <td class="text-right">
                          ${product
                            ? html`<button type="button" class="btn-ghost btn-sm" data-sheet="${product.id}" title="Voir la fiche produit">${raw(icon('box', { size: 14 }))}</button>`
                            : ''}
                        </td>
                      </tr>
                    `;
                  })}
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-muted">${scoped.length} mouvement(s) affiché(s).</p>
      </div>
    </section>
  `);

  qs('#stock-product-filter', section).addEventListener('change', (event) => {
    selectedProductId = event.target.value;
    api.repaint();
  });

  delegate(section, 'click', '[data-sheet]', (event, target) => {
    const product = products.find((entry) => entry.id === target.dataset.sheet);
    if (product) productSheet(product, stockState, state.stockMovements);
  });

  wrapper.append(section);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Comment le stock est calculé',
      items: [
        'Le stock n’augmente qu’à la réception d’un achat, jamais à la simple commande.',
        'Les sorties de vente sont figées au coût moyen pondéré du moment.',
        'Les retours réintègrent le stock ; les annulations créent un mouvement compensatoire.',
        `Motifs manuels : ${MANUAL_STOCK_REASONS.map((value) => STOCK_REASON_MAP[value]?.label || value).join(', ')}.`,
        settings.allowNegativeStock
          ? 'Le stock négatif est autorisé dans vos paramètres.'
          : 'Une vente est refusée si le stock disponible est insuffisant (modifiable dans les paramètres).',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
