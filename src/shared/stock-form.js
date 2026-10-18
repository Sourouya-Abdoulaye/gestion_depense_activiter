/* ---------------------------------------------------------------------------
 * Mon Commerce — formulaire d'ajustement de stock
 *
 * Toute correction est un mouvement documenté : rien n'est modifié en
 * silence. Le motif, la date et une note explicative sont conservés.
 * ------------------------------------------------------------------------- */

import { MANUAL_STOCK_REASONS, STOCK_REASON_MAP } from '../config/constants.js';
import { toNumber } from './format.js';
import { todayISO } from './dates.js';
import { field, modalForm, optionsFrom, toast, runAction } from './ui.js';
import { adjustStock } from '../services/actions.js';
import { getState } from '../services/state.js';
import { computeProductStock } from '../services/stock.js';

export function openStockAdjustment({ product = null, onDone = null } = {}) {
  const state = getState();
  const products = state.products.filter((entry) => entry.status !== 'archived');
  if (products.length === 0) {
    toast('Aucun produit actif : ajoutez d’abord un produit.', 'warning', { duration: 5000 });
    return;
  }

  const currentStock = (productId) => {
    const entry = products.find((item) => item.id === productId);
    return computeProductStock(state.stockMovements, productId, entry ? entry.cost : 0);
  };
  const initial = currentStock(product ? product.id : products[0].id);

  const fields = [
    {
      node: field({
        name: 'productId',
        label: 'Produit',
        type: 'select',
        value: product ? product.id : products[0].id,
        disabled: Boolean(product),
        options: optionsFrom(products.map((entry) => ({ value: entry.id, label: entry.name }))),
      }),
      span: 2,
    },
    {
      node: field({
        name: 'mode',
        label: 'Type de mouvement',
        type: 'select',
        value: 'in',
        options: [
          { value: 'in', label: 'Entrée (stock initial, réintégration…)' },
          { value: 'out', label: 'Sortie (perte, casse, retour fournisseur…)' },
          { value: 'set', label: 'Corriger la quantité (inventaire)' },
        ],
      }),
    },
    {
      node: field({
        name: 'reason',
        label: 'Motif',
        type: 'select',
        value: 'opening',
        options: optionsFrom(
          MANUAL_STOCK_REASONS.map((value) => ({ value, label: STOCK_REASON_MAP[value]?.label || value })),
        ),
      }),
    },
    {
      node: field({
        name: 'quantity',
        label: 'Quantité',
        type: 'number',
        min: '0',
        value: 1,
        hint: 'Pour « corriger la quantité », indiquez la quantité réellement comptée après inventaire.',
      }),
    },
    { node: field({ name: 'date', label: 'Date du mouvement', type: 'date', value: todayISO(), required: true }) },
    {
      node: field({
        name: 'unitCost',
        label: 'Coût unitaire (FCFA)',
        type: 'number',
        min: '0',
        value: initial.averageCost || 0,
        hint: 'Laisser à zéro pour utiliser automatiquement le coût moyen pondéré.',
      }),
    },
    { node: field({ name: 'note', label: 'Note explicative (facultatif)', value: '', placeholder: 'Ex. inventaire du 18/10' }), span: 2 },
  ];

  modalForm({
    title: product ? `Ajuster le stock — ${product.name}` : 'Ajuster le stock',
    description: 'Chaque correction crée un mouvement traçable dans l’historique.',
    size: 'lg',
    fields,
    submitLabel: 'Enregistrer le mouvement',
    onSubmit: async (values) => {
      const productId = product ? product.id : values.productId;
      const quantity = toNumber(values.quantity, 0);
      if (!values.date) {
        toast('La date du mouvement est obligatoire.', 'warning');
        return false;
      }
      if (!productId) {
        toast('Choisissez un produit.', 'warning');
        return false;
      }
      if (values.mode === 'set') {
        if (quantity < 0) {
          toast('La quantité comptée ne peut pas être négative.', 'warning');
          return false;
        }
      } else if (quantity <= 0) {
        toast('La quantité doit être supérieure à zéro.', 'warning');
        return false;
      }

      const payload = {
        productId,
        date: values.date,
        reason: values.reason,
        note: values.note,
        unitCost: toNumber(values.unitCost, 0) || undefined,
      };
      const result = await runAction(
        () =>
          values.mode === 'set'
            ? adjustStock({ ...payload, mode: 'set', targetQuantity: quantity })
            : adjustStock({ ...payload, direction: values.mode, quantity }),
        { successMessage: 'Mouvement de stock enregistré.' },
      );
      if (!result) return false;
      if (onDone) onDone();
      return true;
    },
  });
}
