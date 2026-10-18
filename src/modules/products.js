/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Produits & stock »
 *
 * Le stock affiché n'est jamais un compteur saisi : il est recalculé par rejeu
 * des mouvements (coût moyen pondéré). L'écran montre donc la quantité, la
 * valeur du stock et les alertes de réapprovisionnement.
 * ------------------------------------------------------------------------- */

import { PRODUCT_UNITS } from '../config/constants.js';
import { html, element, raw, delegate } from '../shared/dom.js';
import { formatMoney, formatQuantity, toNumber } from '../shared/format.js';
import { todayISO } from '../shared/dates.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import {
  button,
  confirmDialog,
  dataTable,
  field,
  kpiCard,
  modalForm,
  optionsFrom,
  pageHeader,
  runAction,
  toast,
} from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { openStockAdjustment } from '../shared/stock-form.js';
import { getSettings, getState } from '../services/state.js';
import { computeStockState, lowStockAlerts, stockValue } from '../services/stock.js';
import { createProduct, deleteProduct, setProductStatus, updateProduct } from '../services/actions.js';
import { exportProductsCsv } from '../services/csv.js';

export const meta = { path: 'produits', title: 'Produits & stock' };

/* ------------------------------- formulaire ----------------------------- */

function productFormFields({ product = null }) {
  const settings = getSettings();
  const fields = [
    { node: field({ name: 'name', label: 'Nom du produit', value: product?.name || '', required: true, placeholder: 'Ex. Pantalon en jean' }) },
    { node: field({ name: 'reference', label: 'Référence (facultatif)', value: product?.reference || '' }) },
    {
      node: field({
        name: 'category',
        label: 'Catégorie',
        type: 'select',
        value: product?.category || '',
        options: optionsFrom(settings.productCategories || [], { placeholder: '— Aucune —' }),
      }),
    },
    {
      node: field({
        name: 'unit',
        label: 'Unité',
        type: 'select',
        value: product?.unit || 'pièce',
        options: optionsFrom(PRODUCT_UNITS),
      }),
    },
    {
      node: field({
        name: 'cost',
        label: 'Prix d’achat de référence (FCFA)',
        type: 'number',
        min: '0',
        value: product?.cost ?? 0,
        hint: 'Le coût réel utilisé par les calculs reste le coût moyen pondéré des achats.',
      }),
    },
    { node: field({ name: 'price', label: 'Prix de vente (FCFA)', type: 'number', min: '0', value: product?.price ?? 0, required: true }) },
    {
      node: field({
        name: 'alertThreshold',
        label: 'Seuil d’alerte (quantité)',
        type: 'number',
        min: '0',
        value: product?.alertThreshold ?? getSettings().defaultAlertThreshold ?? 0,
        hint: 'Une alerte apparaît dès que le stock atteint ce seuil.',
      }),
    },
    {
      node: field({
        name: 'description',
        label: 'Description (facultatif)',
        type: 'textarea',
        rows: 2,
        value: product?.description || '',
      }),
      span: 2,
    },
  ];

  if (!product) {
    fields.push(
      { node: field({ name: 'openingQuantity', label: 'Stock initial (facultatif)', type: 'number', min: '0', value: 0 }), span: 2 },
      { node: field({ name: 'openingUnitCost', label: 'Coût unitaire du stock initial (FCFA)', type: 'number', min: '0', value: 0, hint: 'Laisser à zéro pour utiliser le prix d’achat de référence.' }) },
      { node: field({ name: 'openingDate', label: 'Date du stock initial', type: 'date', value: todayISO() }) },
    );
  }

  return fields;
}

function openProductForm({ product = null }) {
  modalForm({
    title: product ? `Modifier ${product.name}` : 'Nouveau produit',
    size: 'lg',
    fields: productFormFields({ product }),
    submitLabel: product ? 'Enregistrer' : 'Créer le produit',
    onSubmit: async (values) => {
      if (!values.name || !String(values.name).trim()) {
        toast('Le nom du produit est obligatoire.', 'warning');
        return false;
      }
      const payload = {
        name: String(values.name).trim(),
        reference: values.reference,
        category: values.category,
        unit: values.unit,
        cost: toNumber(values.cost, 0),
        price: toNumber(values.price, 0),
        alertThreshold: toNumber(values.alertThreshold, 0),
        description: values.description,
      };
      const result = await runAction(
        () =>
          product
            ? updateProduct(product.id, payload)
            : createProduct({
                ...payload,
                openingQuantity: toNumber(values.openingQuantity, 0),
                openingUnitCost: toNumber(values.openingUnitCost, 0),
                openingDate: values.openingDate,
              }),
        { successMessage: product ? 'Produit modifié.' : 'Produit créé.' },
      );
      return Boolean(result);
    },
  });
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx) {
  const state = getState();
  const settings = getSettings();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Produits & stock' }));
    wrapper.append(needsActivityNotice({ ctx }));
    return wrapper;
  }

  const stockState = computeStockState(state.stockMovements, state.products);
  const alerts = lowStockAlerts(state.products, stockState, settings.defaultAlertThreshold || 0);
  const products = state.products;
  const activeProducts = products.filter((product) => product.status !== 'archived');

  wrapper.append(
    pageHeader({
      title: 'Produits & stock',
      subtitle: 'Catalogue, prix et niveaux de stock recalculés à partir des mouvements.',
      actions: [
        button({
          label: 'Nouveau produit',
          iconName: 'plus',
          variant: 'primary',
          onClick: () => openProductForm({}),
        }),
        button({
          label: 'Exporter le catalogue',
          iconName: 'download',
          onClick: () => {
            if (products.length === 0) {
              toast('Aucun produit à exporter.', 'warning');
              return;
            }
            const { lines } = exportProductsCsv({ products, stockState, categories: settings.productCategories });
            toast(`${lines} produit(s) exporté(s) au format CSV.`, 'success');
          },
        }),
      ],
    }),
  );

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Produits actifs', value: String(activeProducts.length), hint: `${products.length} au total (archivés compris)`, iconName: 'box' }).outerHTML)}
        ${raw(kpiCard({ label: 'Valeur du stock', value: formatMoney(stockValue(stockState)), hint: 'Quantités disponibles × coût moyen pondéré', iconName: 'layers' }).outerHTML)}
        ${raw(kpiCard({ label: 'Alertes de stock', value: String(alerts.length), hint: alerts.length > 0 ? 'Réapprovisionnement conseillé' : 'Aucune alerte', tone: alerts.length > 0 ? 'warning' : 'neutral', iconName: 'alert' }).outerHTML)}
        ${raw(kpiCard({ label: 'Quantités en stock', value: formatQuantity(Object.values(stockState).reduce((total, entry) => total + Math.max(entry.quantity, 0), 0)), hint: 'Tous produits confondus', iconName: 'layers' }).outerHTML)}
      </div>
    `),
  );

  const table = dataTable({
    searchable: true,
    searchPlaceholder: 'Rechercher un produit (nom, référence, catégorie)…',
    caption: 'Liste des produits',
    columns: [
      {
        key: 'name',
        label: 'Produit',
        render: (row) => html`<div class="min-w-0">
          <p class="font-semibold text-ink">${row.name}</p>
          <p class="text-xs text-muted">${row.reference || 'sans référence'}${row.status === 'archived' ? ' — archivé' : ''}</p>
        </div>`,
      },
      { key: 'category', label: 'Catégorie', render: (row) => row.category || '—' },
      { key: 'cost', label: 'Coût', align: 'right', render: (row) => formatMoney(row.cost) },
      { key: 'price', label: 'Prix de vente', align: 'right', render: (row) => formatMoney(row.price) },
      {
        key: 'margin',
        label: 'Marge unitaire',
        align: 'right',
        render: (row) => {
          const entry = stockState[row.id];
          const unitCost = entry && entry.quantity > 0 ? entry.averageCost : row.cost;
          const margin = toNumber(row.price, 0) - toNumber(unitCost, 0);
          const className = margin < 0 ? 'text-danger' : 'text-brand-dark';
          return html`<span class="${className}">${formatMoney(margin)}</span>`;
        },
      },
      {
        key: 'quantity',
        label: 'Stock',
        align: 'right',
        render: (row) => {
          const entry = stockState[row.id];
          const quantity = entry ? entry.quantity : 0;
          const negative = quantity < 0;
          return html`<span class="${negative ? 'text-danger font-semibold' : ''}">${formatQuantity(quantity, row.unit)}</span>`;
        },
      },
      {
        key: 'value',
        label: 'Valeur',
        align: 'right',
        render: (row) => {
          const entry = stockState[row.id];
          return formatMoney(entry ? entry.value : 0);
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (row) => html`
          <div class="flex flex-wrap justify-end gap-1">
            <button type="button" class="btn-ghost btn-sm" data-action="adjust" data-id="${row.id}" title="Ajuster le stock">${raw(icon('layers', { size: 14 }))}</button>
            <button type="button" class="btn-ghost btn-sm" data-action="edit" data-id="${row.id}" title="Modifier">${raw(icon('edit', { size: 14 }))}</button>
            <button type="button" class="btn-ghost btn-sm" data-action="toggle" data-id="${row.id}" title="${row.status === 'archived' ? 'Réactiver' : 'Archiver'}">${raw(icon('refresh', { size: 14 }))}</button>
            <button type="button" class="btn-danger btn-sm" data-action="delete" data-id="${row.id}" title="Supprimer">${raw(icon('trash', { size: 14 }))}</button>
          </div>
        `,
      },
    ],
    rows: [...products].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    empty: {
      title: 'Aucun produit',
      message: 'Ajoutez vos produits pour commencer à enregistrer achats et ventes.',
      iconName: 'box',
    },
  });

  delegate(table.element, 'click', '[data-action]', async (event, target) => {
    const product = products.find((entry) => entry.id === target.dataset.id);
    if (!product) return;
    const action = target.dataset.action;
    if (action === 'edit') openProductForm({ product });
    if (action === 'adjust') openStockAdjustment({ product });
    if (action === 'toggle') {
      const next = product.status === 'archived' ? 'active' : 'archived';
      await runAction(() => setProductStatus(product.id, next), {
        successMessage: next === 'archived' ? 'Produit archivé.' : 'Produit réactivé.',
      });
    }
    if (action === 'delete') {
      const confirmed = await confirmDialog({
        title: 'Supprimer ce produit ?',
        message: `${product.name} sera définitivement supprimé.`,
        details: 'La suppression est refusée si des mouvements de stock existent : archivez le produit dans ce cas pour préserver l’historique.',
        confirmLabel: 'Supprimer',
      });
      if (confirmed) await runAction(() => deleteProduct(product.id), { successMessage: 'Produit supprimé.' });
    }
  });

  wrapper.append(table.element);

  if (alerts.length > 0) {
    wrapper.append(
      element(html`
        <div class="card card-pad">
          <h2 class="text-base font-semibold text-brand-dark">Produits à réapprovisionner</h2>
          <ul class="mt-2 space-y-1 text-sm">
            ${alerts.slice(0, 12).map(
              (alert) => html`
                <li class="flex items-center justify-between gap-3 border-b border-line/70 py-1.5 last:border-0">
                  <span class="min-w-0 truncate">${alert.name}</span>
                  <span class="shrink-0 ${alert.severity === 'rupture' ? 'text-danger font-semibold' : 'text-warning'}">
                    ${formatQuantity(alert.quantity)} (seuil ${formatQuantity(alert.threshold)})
                  </span>
                </li>
              `,
            )}
          </ul>
          ${alerts.length > 12 ? html`<p class="mt-2 text-xs text-muted">… et ${alerts.length - 12} autre(s) produit(s).</p>` : ''}
        </div>
      `),
    );
  }

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: false, paint: () => paint(ctx) }).root; } };
