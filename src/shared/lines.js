/* ---------------------------------------------------------------------------
 * Mon Commerce — éditeur de lignes de produits
 *
 * Composant partagé par les ventes et les achats : choix du produit, quantité,
 * prix unitaire, remise de ligne et total recalculé en direct. Les valeurs sont
 * lues via getLines() puis confiées aux services métier, seuls habilités à
 * valider définitivement (stock, CMP, frais d'acquisition…).
 * ------------------------------------------------------------------------- */

import { element, html, qs, raw } from './dom.js';
import { formatMoney, toNumber } from './format.js';
import { icon } from './icons.js';

/**
 * @param {object} options
 * @param {Array} options.products catalogue courant (les archivés sont exclus)
 * @param {'price'|'cost'} [options.priceField] champ pré-rempli au choix du produit
 * @param {boolean} [options.allowDiscount] affiche la colonne remise
 * @param {Array} [options.initial] lignes existantes (édition)
 */
export function createLinesEditor({ products = [], priceField = 'price', allowDiscount = true, initial = [] } = {}) {
  const catalogue = products.filter((product) => product.status !== 'archived');

  const container = element(html`
    <div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Produit</th>
              <th scope="col" class="text-right">Quantité</th>
              <th scope="col" class="text-right">Prix unitaire</th>
              ${allowDiscount ? html`<th scope="col" class="text-right">Remise</th>` : ''}
              <th scope="col" class="text-right">Total</th>
              <th scope="col" class="text-right"><span class="sr-only">Retirer</span></th>
            </tr>
          </thead>
          <tbody data-lines-body></tbody>
        </table>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" class="btn-ghost btn-sm" data-add-line>
          ${raw(icon('plus', { size: 14 }))}<span>Ajouter une ligne</span>
        </button>
        <p class="text-sm font-semibold text-brand-dark">Sous-total : <span data-lines-subtotal>—</span></p>
      </div>
      <p class="mt-1 text-xs text-muted" data-lines-hint></p>
    </div>
  `);

  const body = qs('[data-lines-body]', container);
  const subtotalSlot = qs('[data-lines-subtotal]', container);
  const hintSlot = qs('[data-lines-hint]', container);
  let changeHandler = null;

  if (catalogue.length === 0) {
    hintSlot.textContent = 'Aucun produit disponible : ajoutez d’abord un produit dans « Produits & stock ».';
  }

  function computeLineTotal(line) {
    return toNumber(line.quantity, 0) * toNumber(line.unitPrice, 0) - (allowDiscount ? toNumber(line.discount, 0) : 0);
  }

  function readRow(row) {
    return {
      productId: qs('[data-line-product]', row).value,
      quantity: toNumber(qs('[data-line-quantity]', row).value, 0),
      unitPrice: toNumber(qs('[data-line-price]', row).value, 0),
      discount: allowDiscount ? toNumber(qs('[data-line-discount]', row).value, 0) : 0,
    };
  }

  function refresh() {
    let subtotal = 0;
    for (const row of [...body.querySelectorAll('tr')]) {
      const total = computeLineTotal(readRow(row));
      subtotal += total;
      const totalSlot = qs('[data-line-total]', row);
      totalSlot.textContent = qs('[data-line-product]', row).value ? formatMoney(total) : '—';
    }
    subtotalSlot.textContent = formatMoney(subtotal);
    if (typeof changeHandler === 'function') changeHandler(subtotal);
    return subtotal;
  }

  function rowElement(line = {}) {
    const selected = catalogue.find((product) => product.id === line.productId) || null;
    const defaultPrice = line.unitPrice !== undefined ? line.unitPrice : selected ? selected[priceField] : '';
    const row = element(html`
      <tr>
        <td class="min-w-[180px]">
          <select class="input" data-line-product aria-label="Produit de la ligne">
            <option value="">— Choisir un produit —</option>
            ${catalogue.map(
              (product) => html`<option value="${product.id}" ${product.id === line.productId ? 'selected' : ''}>
                ${product.name}${product.reference ? ` (${product.reference})` : ''}
              </option>`,
            )}
          </select>
        </td>
        <td class="w-28">
          <input type="number" class="input text-right" data-line-quantity min="0" step="any" inputmode="decimal"
            value="${line.quantity !== undefined ? line.quantity : 1}" aria-label="Quantité" />
        </td>
        <td class="w-32">
          <input type="number" class="input text-right" data-line-price min="0" step="any" inputmode="decimal"
            value="${defaultPrice}" aria-label="Prix unitaire" />
        </td>
        ${
          allowDiscount
            ? html`<td class="w-28">
                <input type="number" class="input text-right" data-line-discount min="0" step="any" inputmode="decimal"
                  value="${line.discount !== undefined ? line.discount : 0}" aria-label="Remise de la ligne" />
              </td>`
            : ''
        }
        <td class="text-right font-semibold tabular-nums" data-line-total>—</td>
        <td class="text-right">
          <button type="button" class="btn-ghost btn-sm" data-remove-line aria-label="Retirer cette ligne">
            ${raw(icon('trash', { size: 14 }))}
          </button>
        </td>
      </tr>
    `);

    const productSelect = qs('[data-line-product]', row);
    const priceInput = qs('[data-line-price]', row);

    productSelect.addEventListener('change', () => {
      const product = catalogue.find((entry) => entry.id === productSelect.value);
      if (product) priceInput.value = String(product[priceField] ?? '');
      refresh();
    });
    for (const field of row.querySelectorAll('input')) field.addEventListener('input', refresh);
    qs('[data-remove-line]', row).addEventListener('click', () => {
      row.remove();
      if (body.querySelectorAll('tr').length === 0) addLine();
      refresh();
    });

    return row;
  }

  function addLine(line = {}) {
    body.append(rowElement(line));
    refresh();
  }

  function setLines(lines = []) {
    body.replaceChildren();
    if (lines.length === 0) addLine();
    else for (const line of lines) body.append(rowElement(line));
    refresh();
  }

  qs('[data-add-line]', container).addEventListener('click', () => addLine());

  setLines(initial);

  return {
    element: container,
    addLine,
    setLines,
    refresh,
    /** Lignes exploitables (produit choisi et quantité positive). */
    getLines() {
      return [...body.querySelectorAll('tr')]
        .map(readRow)
        .filter((line) => line.productId && line.quantity > 0);
    },
    /** Lignes telles que saisies, y compris incomplètes (contrôle des erreurs). */
    getRawLines() {
      return [...body.querySelectorAll('tr')].map(readRow);
    },
    onChange(handler) {
      changeHandler = handler;
      return container;
    },
  };
}
