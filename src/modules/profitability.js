/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Rentabilité »
 *
 * Assistant de fixation des prix. Toute estimation affiche ses hypothèses et
 * ne garantit jamais un bénéfice : elle indique un seuil de rentabilité et des
 * taux calculés à partir du coût d'acquisition réel (frais inclus).
 * ------------------------------------------------------------------------- */

import { html, element, qs, raw } from '../shared/dom.js';
import { formatMoney, formatPercent, formatQuantity, toNumber } from '../shared/format.js';
import { getFilters } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import { kpiCard, noticePanel, pageHeader, sectionCard } from '../shared/ui.js';
import { getState } from '../services/state.js';
import { computeStockState, currentUnitCost } from '../services/stock.js';
import { productMargins } from '../services/finance.js';
import { priceForMarginRate, priceForMarkupRate, simulate, simulationAssumptions } from '../services/profitability.js';

export const meta = { path: 'rentabilite', title: 'Rentabilité' };

/* --------------------------- formulaire de calcul ----------------------- */

function buildCalculator(state) {
  const products = state.products.filter((product) => product.status !== 'archived');
  const stockState = computeStockState(state.stockMovements, state.products);
  const first = products[0] || null;

  const form = element(html`
    <form novalidate class="grid gap-4 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label class="label" for="sim-product">Produit (pour préremplir le coût et le prix)</label>
        <select id="sim-product" class="input" name="productId">
          <option value="">— Saisie libre —</option>
          ${products.map(
            (product) => html`<option value="${product.id}" ${first && product.id === first.id ? 'selected' : ''}>${product.name}</option>`,
          )}
        </select>
      </div>
      <div class="sm:col-span-2">
        <label class="label" for="sim-unit-cost">Coût d’acquisition unitaire (FCFA)</label>
        <input id="sim-unit-cost" name="unitCost" class="input" type="number" min="0" step="any" inputmode="decimal"
          value="${first ? currentUnitCost(stockState, first.id, first) : 0}" />
        <p class="mt-1 text-xs text-muted">Coût moyen pondéré des achats, frais d’approvisionnement inclus.</p>
      </div>
      <div class="sm:col-span-2">
        <label class="label" for="sim-price">Prix de vente unitaire (FCFA)</label>
        <input id="sim-price" name="price" class="input" type="number" min="0" step="any" inputmode="decimal" value="${first ? first.price : 0}" />
      </div>
      <div>
        <label class="label" for="sim-quantity">Quantité à vendre</label>
        <input id="sim-quantity" name="quantity" class="input" type="number" min="1" step="any" inputmode="decimal" value="1" />
      </div>
      <div>
        <label class="label" for="sim-fixed">Charges fixes de la période (FCFA)</label>
        <input id="sim-fixed" name="fixedCosts" class="input" type="number" min="0" step="any" inputmode="decimal" value="0" />
      </div>
      <div>
        <label class="label" for="sim-loss">Taux de perte / casse (%)</label>
        <input id="sim-loss" name="lossRate" class="input" type="number" min="0" max="99" step="any" inputmode="decimal" value="0" />
      </div>
      <div>
        <label class="label" for="sim-target">Bénéfice visé (FCFA, facultatif)</label>
        <input id="sim-target" name="target" class="input" type="number" min="0" step="any" inputmode="decimal" value="0" />
      </div>
    </form>
  `);

  const resultsHost = element('<div class="space-y-4"></div>');

  const readInputs = () => {
    const productId = qs('#sim-product', form).value;
    return {
      productId,
      unitCost: toNumber(qs('#sim-unit-cost', form).value, 0),
      price: toNumber(qs('#sim-price', form).value, 0),
      quantity: toNumber(qs('#sim-quantity', form).value, 1) || 1,
      fixedCosts: toNumber(qs('#sim-fixed', form).value, 0),
      lossRate: toNumber(qs('#sim-loss', form).value, 0) / 100,
      target: toNumber(qs('#sim-target', form).value, 0),
      includeFixedCosts: true,
    };
  };

  const renderResults = () => {
    const input = readInputs();
    const result = simulate(input);
    const assumptions = simulationAssumptions(input, result);
    const unitsForTarget = input.target > 0 && result.unitMargin > 0
      ? Math.ceil((input.fixedCosts + input.target) / result.unitMargin)
      : null;

    const cards = [
      { label: 'Marge unitaire', value: formatMoney(result.unitMargin), tone: result.unitMargin >= 0 ? 'positive' : 'negative', hint: 'Prix de vente − coût effectif' },
      { label: 'Taux de marge', value: formatPercent(result.marginRate), hint: 'Marge ÷ coût d’acquisition' },
      { label: 'Taux de marque', value: formatPercent(result.markupRate), hint: 'Marge ÷ prix de vente' },
      { label: 'Marge brute (quantité)', value: formatMoney(result.grossMargin), tone: result.grossMargin >= 0 ? 'positive' : 'negative', hint: `${formatQuantity(result.quantity)} unité(s)` },
      { label: 'Résultat estimé', value: formatMoney(result.netResult), tone: result.netResult >= 0 ? 'positive' : 'negative', hint: 'Après charges fixes saisies' },
      { label: 'Chiffre d’affaires', value: formatMoney(result.revenue), hint: 'Quantité × prix de vente' },
      { label: 'Coût total', value: formatMoney(result.totalCost), hint: result.lossRate > 0 ? `Coût effectif ${formatMoney(result.effectiveUnitCost)} / unité` : 'Quantité × coût d’acquisition' },
      {
        label: 'Seuil de rentabilité',
        value: result.breakEvenUnits === null ? '—' : `${formatQuantity(result.breakEvenUnits)} unité(s)`,
        hint: result.breakEvenRevenue === null ? 'Charges fixes ÷ marge unitaire' : formatMoney(result.breakEvenRevenue),
      },
    ];

    const cardsMarkup = cards
      .map((card) => raw(kpiCard(card).outerHTML))
      .join('');

    resultsHost.replaceChildren(
      element(html`
        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">${raw(cardsMarkup)}</div>
          ${unitsForTarget !== null
            ? html`
                <div class="rounded-lg border border-brand/30 bg-brand-light/60 px-4 py-3 text-sm text-brand-dark">
                  Pour atteindre un bénéfice de <strong>${formatMoney(input.target)}</strong>, il faut vendre environ
                  <strong>${formatQuantity(unitsForTarget)} unité(s)</strong> (hors imprévus).
                </div>
              `
            : ''}
          ${result.warnings.length > 0
            ? html`
                <div class="rounded-lg border border-warning/30 bg-amber-50 px-4 py-3">
                  <p class="text-sm font-semibold text-warning">Points de vigilance</p>
                  <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink">
                    ${result.warnings.map((warning) => html`<li>${warning}</li>`)}
                  </ul>
                </div>
              `
            : ''}
          <div class="rounded-lg border border-line bg-canvas/60 px-4 py-3">
            <p class="text-sm font-semibold text-brand-dark">Hypothèses retenues</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
              ${assumptions.map((assumption) => html`<li>${assumption}</li>`)}
            </ul>
          </div>
        </div>
      `),
    );
  };

  // Préremplissage au choix du produit.
  qs('#sim-product', form).addEventListener('change', (event) => {
    const product = products.find((entry) => entry.id === event.target.value);
    if (!product) return;
    qs('#sim-unit-cost', form).value = String(currentUnitCost(stockState, product.id, product));
    qs('#sim-price', form).value = String(product.price ?? 0);
    renderResults();
  });
  for (const input of form.querySelectorAll('input')) input.addEventListener('input', renderResults);

  renderResults();

  return { form, resultsHost, renderResults };
}

/* ------------------------------ conseil de prix ------------------------- */

function buildPriceAdvisor() {
  const container = element(html`
    <div class="grid gap-4 lg:grid-cols-3">
      <div>
        <label class="label" for="adv-cost">Coût d’acquisition unitaire (FCFA)</label>
        <input id="adv-cost" class="input" type="number" min="0" step="any" inputmode="decimal" value="0" />
      </div>
      <div>
        <label class="label" for="adv-rate">Taux visé (%)</label>
        <input id="adv-rate" class="input" type="number" min="0" step="any" inputmode="decimal" value="30" />
      </div>
      <div>
        <label class="label" for="adv-mode">Taux exprimé en</label>
        <select id="adv-mode" class="input">
          <option value="margin">Taux de marge (sur le coût)</option>
          <option value="markup">Taux de marque (sur le prix de vente)</option>
        </select>
      </div>
      <div class="lg:col-span-3">
        <div class="rounded-lg border border-line bg-canvas/60 px-4 py-3 text-sm" data-advisor-result></div>
      </div>
    </div>
  `);

  const resultSlot = qs('[data-advisor-result]', container);
  const update = () => {
    const cost = toNumber(qs('#adv-cost', container).value, 0);
    const rate = toNumber(qs('#adv-rate', container).value, 0) / 100;
    const mode = qs('#adv-mode', container).value;
    const price = mode === 'markup' ? priceForMarkupRate(cost, rate) : priceForMarginRate(cost, rate);
    if (price === null) {
      resultSlot.innerHTML = '<span class="text-danger">Un taux de marque doit être inférieur à 100 %.</span>';
      return;
    }
    resultSlot.innerHTML = `Prix de vente conseillé : <strong class="text-brand-dark">${formatMoney(price)}</strong> pour un coût de ${formatMoney(cost)}.`;
  };
  for (const input of container.querySelectorAll('input, select')) input.addEventListener('input', update);
  update();
  return container;
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Rentabilité' }));
    wrapper.append(needsActivityNotice({ ctx }));
    return wrapper;
  }

  wrapper.append(
    pageHeader({
      title: 'Rentabilité',
      subtitle: 'Estimez la marge, le seuil de rentabilité et le prix de vente conseillé.',
    }),
  );

  const calculator = buildCalculator(state);
  wrapper.append(
    sectionCard({
      title: 'Simulateur de vente',
      description: 'Les résultats se recalculent pendant la saisie.',
      content: element('<div></div>'),
    }),
  );
  const calcCard = wrapper.lastElementChild;
  const calcSlot = calcCard.querySelector('.card-pad');
  calcSlot.replaceChildren(calculator.form, calculator.resultsHost);

  wrapper.append(
    sectionCard({
      title: 'Prix conseillé',
      description: 'À partir d’un coût et d’un taux cible.',
      content: buildPriceAdvisor(),
    }),
  );

  /* ------------------------ marges réelles par produit ------------------ */
  const margins = productMargins({
    sales: state.sales,
    returns: state.returns,
    products: state.products,
    filters: { activityId: getFilters().activityId },
  }).slice(0, 12);

  if (margins.length > 0) {
    const rows = margins
      .map(
        (entry) => html`
          <tr>
            <td data-label="Produit" class="font-medium">${entry.label}</td>
            <td data-label="Quantité" class="text-right">${formatQuantity(entry.quantity, entry.unit)}</td>
            <td data-label="Chiffre d’affaires" class="text-right">${formatMoney(entry.revenue)}</td>
            <td data-label="Marge" class="text-right ${entry.margin < 0 ? 'text-danger' : 'text-brand-dark'}">${formatMoney(entry.margin)}</td>
            <td data-label="Taux" class="text-right">${formatPercent(entry.marginRate)}</td>
          </tr>
        `,
      )
      .join('');
    wrapper.append(
      sectionCard({
        title: 'Marges réelles réalisées',
        description: 'Calculées sur les ventes enregistrées (coût figé au moment de la vente).',
        content: element(html`
          <div class="table-wrap">
            <table class="table table-stack">
              <thead>
                <tr><th>Produit</th><th class="text-right">Quantité</th><th class="text-right">Chiffre d’affaires</th><th class="text-right">Marge</th><th class="text-right">Taux</th></tr>
              </thead>
              <tbody>${raw(rows)}</tbody>
            </table>
          </div>
        `),
      }),
    );
  }

  wrapper.append(
    noticePanel({
      tone: 'warning',
      title: 'Simulation indicative',
      items: [
        'Ces calculs sont des estimations : ils supposent que toutes les unités sont vendues et encaissées.',
        'La marge réelle dépend des frais d’acquisition, des pertes, des remises et des retours.',
        'Vérifiez toujours le coût moyen pondéré affiché dans « Produits & stock » avant de fixer un prix.',
      ],
    }),
  );

  return wrapper;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: () => paint(ctx) }).root; } };
