/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Tableau de bord »
 *
 * Synthèse du commerce : chiffre d'affaires, marge, résultat estimé, budget,
 * trésorerie, créances, dettes et alertes. Tous les chiffres sont recalculés
 * à partir des opérations enregistrées : rien n'est saisi ni inventé.
 * ------------------------------------------------------------------------- */

import { html, element, raw } from '../shared/dom.js';
import { formatMoney, formatPercent, formatQuantity } from '../shared/format.js';
import { eachDay, formatDate, formatMonthLabel } from '../shared/dates.js';
import { getPeriod, getViewState } from '../shared/view-state.js';
import { createPage, needsActivityNotice } from '../shared/screen.js';
import { button, dataTable, emptyState, kpiCard, noticePanel, pageHeader, sectionCard } from '../shared/ui.js';
import { chartBox, CHART_COLORS, Chart } from '../shared/charts.js';
import { currentActivity, getState } from '../services/state.js';
import { periodLabel } from '../services/reports.js';
import {
  activityBudget,
  computeKpis,
  dailySeries,
  monthlySeries,
  payableList,
  receivableList,
  saleTotal,
  topProducts,
} from '../services/finance.js';
import { lowStockAlerts } from '../services/stock.js';

export const meta = { path: 'tableau-de-bord', title: 'Tableau de bord' };

/* ------------------------------- graphiques ----------------------------- */

function buildSeries(state, filters, period) {
  const days = eachDay(period.from, period.to);
  if (days.length > 0 && days.length <= 62) {
    const series = dailySeries({ sales: state.sales, returns: state.returns, expenses: state.expenses, filters, days });
    return {
      labels: days.map((day) => formatDate(day)),
      revenue: series.map((entry) => entry.revenue),
      expenses: series.map((entry) => entry.expenses),
    };
  }
  const series = monthlySeries({ sales: state.sales, returns: state.returns, expenses: state.expenses, filters });
  return {
    labels: series.map((entry) => formatMonthLabel(`${entry.key}-01`)),
    revenue: series.map((entry) => entry.revenue),
    expenses: series.map((entry) => entry.expenses),
  };
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx, api) {
  const state = getState();
  const view = getViewState();
  const period = getPeriod();
  const filters = getFiltersFromView(view, period);
  const wrapper = element('<div class="space-y-4"></div>');

  const activity = view.activityId
    ? state.activities.find((entry) => entry.id === view.activityId) || null
    : currentActivity();

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Tableau de bord', subtitle: 'Vue d’ensemble de votre commerce.' }));
    wrapper.append(needsActivityNotice({ ctx }));
    return wrapper;
  }

  const kpis = computeKpis(state, { activityId: view.activityId, period });
  const settings = state.settings || {};
  const alerts = lowStockAlerts(state.products, kpis.stockState, settings.defaultAlertThreshold || 0);
  const overdueReceivables = receivableList({
    sales: state.sales,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: view.activityId },
  }).filter((entry) => entry.overdueDays > 0);
  const overduePayables = payableList({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: view.activityId },
  }).filter((entry) => entry.overdueDays > 0);

  wrapper.append(
    pageHeader({
      title: activity ? activity.name : 'Tableau de bord',
      subtitle: `Période analysée : ${periodLabel(period, (value) => formatDate(value))}.`,
      actions: [
        button({ label: 'Ventes & caisse', iconName: 'plus', variant: 'primary', onClick: () => ctx.navigate('ventes') }),
        button({ label: 'Voir les rapports', iconName: 'chart', onClick: () => ctx.navigate('rapports') }),
      ],
    }),
  );

  if (activity) {
    const budget = activityBudget(activity, { cashMovements: state.cashMovements });
    const progress = budget.target > 0 ? Math.min(budget.targetProgress, 1) : 0;
    wrapper.append(
      element(html`
        <div class="card card-pad">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 class="text-base font-semibold text-brand-dark">Budget de l’activité</h2>
              <p class="text-xs text-muted">
                Les indicateurs de résultat portent sur la période sélectionnée ; le budget cumule toute l’activité.
              </p>
            </div>
            <span class="badge ${budget.remaining >= 0 ? 'badge-brand' : 'badge-danger'}">${formatMoney(budget.remaining)} restant</span>
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-4">
            <div><p class="text-xs text-muted">Capital de départ</p><p class="font-semibold tabular-nums">${formatMoney(budget.initialCapital)}</p></div>
            <div><p class="text-xs text-muted">Apports cumulés</p><p class="font-semibold tabular-nums">${formatMoney(budget.contributions)}</p></div>
            <div><p class="text-xs text-muted">Budget consommé</p><p class="font-semibold tabular-nums text-warning">${formatMoney(budget.consumed)}</p></div>
            <div><p class="text-xs text-muted">Budget disponible</p><p class="font-semibold tabular-nums">${formatMoney(budget.available)}</p></div>
          </div>
          ${budget.target > 0
            ? html`
                <div class="mt-3">
                  <div class="flex items-center justify-between text-xs text-muted">
                    <span>Budget cible : ${formatMoney(budget.target)}</span>
                    <span>${Math.round(progress * 100)} % consommé</span>
                  </div>
                  <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-canvas">
                    <div class="h-full rounded-full ${progress >= 1 ? 'bg-danger' : 'bg-brand'}" style="width:${Math.round(progress * 100)}%"></div>
                  </div>
                </div>
              `
            : ''}
        </div>
      `),
    );
  }

  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Chiffre d’affaires net', value: formatMoney(kpis.revenue), hint: `Net de ${formatMoney(kpis.returnsValue)} de retours`, iconName: 'receipt', tooltip: 'Ventes validées de la période, moins les remises et les retours. Ce n’est pas l’argent déjà encaissé.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Marge brute', value: formatMoney(kpis.grossMargin), hint: kpis.revenue > 0 ? `Taux de marge : ${formatPercent(kpis.grossMargin / kpis.revenue)}` : 'Aucune vente sur la période', tone: kpis.grossMargin >= 0 ? 'positive' : 'negative', iconName: 'chart', tooltip: 'Chiffre d’affaires net moins le coût moyen pondéré des produits vendus. Le coût est figé au moment de chaque vente.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Résultat estimé', value: formatMoney(kpis.estimatedResult), hint: `Après ${formatMoney(kpis.operatingExpenses)} de charges d’exploitation`, tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative', iconName: 'banknote', tooltip: 'Marge brute moins les dépenses d’exploitation de la période. Les achats de stock, investissements et retraits personnels ne sont pas déduits ici.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Trésorerie', value: formatMoney(kpis.treasury), hint: 'Soldes des comptes actifs', iconName: 'wallet', tooltip: 'Solde initial des comptes + argent réellement entré − argent réellement sorti. Les créances et dettes non réglées sont exclues.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Encaissements', value: formatMoney(kpis.cashIn), hint: 'Argent réellement reçu sur la période', iconName: 'download', tooltip: 'Paiements effectivement reçus sur la période (ventes, règlements clients, apports). Les ventes à crédit non payées n’y figurent pas.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Créances clients', value: formatMoney(kpis.receivables), hint: 'Montants restant à recevoir', tone: kpis.receivables > 0 ? 'warning' : 'neutral', iconName: 'users', tooltip: 'Reste à recevoir sur les ventes à crédit : montant des ventes − paiements reçus − avoirs. Ce n’est pas encore de la trésorerie.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Dettes fournisseurs', value: formatMoney(kpis.payables), hint: 'Montants restant à payer', tone: kpis.payables > 0 ? 'warning' : 'neutral', iconName: 'truck', tooltip: 'Reste à payer sur les achats : montant des achats − paiements − retours. Une dette n’a pas encore impacté la trésorerie.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Valeur du stock', value: formatMoney(kpis.stockValue), hint: 'Au coût moyen pondéré', iconName: 'box', tooltip: 'Quantité disponible × coût moyen pondéré, calculé à partir de tous les mouvements de stock. Une perte ou une casse réduit cette valeur.' }).outerHTML)}
      </div>
    `),
  );

  const alertItems = [];
  if (alerts.length > 0) {
    alertItems.push(
      `${alerts.length} produit(s) à réapprovisionner : ${alerts.slice(0, 4).map((alert) => `${alert.name} (${formatQuantity(alert.quantity)})`).join(', ')}${alerts.length > 4 ? '…' : ''}`,
    );
  }
  if (overdueReceivables.length > 0) {
    alertItems.push(`${overdueReceivables.length} créance(s) client en retard de paiement.`);
  }
  if (overduePayables.length > 0) {
    alertItems.push(`${overduePayables.length} dette(s) fournisseur échue(s) à régler.`);
  }
  if (kpis.estimatedResult < 0) {
    alertItems.push('Le résultat estimé de la période est négatif : vérifiez les dépenses et les prix de vente.');
  }

  if (alertItems.length > 0) {
    wrapper.append(noticePanel({ tone: alerts.length > 0 || kpis.estimatedResult < 0 ? 'warning' : 'info', title: 'Points d’attention', items: alertItems }));
  }

  /* ------------------------------- graphique ---------------------------- */
  const series = buildSeries(state, filters, period);
  const hasData = series.revenue.some((value) => value !== 0) || series.expenses.some((value) => value !== 0);
  const { wrapper: box, canvas } = chartBox({ height: 300, label: 'Chiffre d’affaires et dépenses de la période' });
  wrapper.append(
    sectionCard({
      title: 'Chiffre d’affaires et dépenses',
      description: hasData ? undefined : 'Aucune donnée sur la période sélectionnée.',
      content: box,
    }),
  );

  if (hasData) {
    api.defer(() => {
      if (!canvas.isConnected) return;
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: series.labels,
          datasets: [
            { label: 'Chiffre d’affaires', data: series.revenue, backgroundColor: CHART_COLORS.brand, borderRadius: 5 },
            { label: 'Dépenses d’exploitation', data: series.expenses, backgroundColor: CHART_COLORS.warning, borderRadius: 5 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: (context) => `${context.dataset.label} : ${formatMoney(context.parsed.y)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: CHART_COLORS.muted, maxRotation: 0, autoSkip: true } },
            y: { beginAtZero: true, grid: { color: 'rgba(107,114,128,0.15)' }, ticks: { color: CHART_COLORS.muted, callback: (value) => formatMoney(value, { symbol: false }) } },
          },
        },
      });
      api.charts.push(chart);
    });
  }

  /* ---------------------------- meilleurs produits ---------------------- */
  const best = topProducts({ sales: state.sales, returns: state.returns, products: state.products, filters, limit: 5 });
  if (best.length > 0) {
    const rows = best
      .map(
        (entry, index) => html`
          <tr>
            <td data-label="#" class="text-muted">${index + 1}</td>
            <td data-label="Produit" class="font-medium">${entry.label}</td>
            <td data-label="Quantité" class="text-right">${formatQuantity(entry.quantity, entry.unit)}</td>
            <td data-label="Chiffre d’affaires" class="text-right">${formatMoney(entry.revenue)}</td>
            <td data-label="Marge" class="text-right ${entry.margin < 0 ? 'text-danger' : 'text-brand-dark'}">${formatMoney(entry.margin)}</td>
          </tr>
        `,
      )
      .join('');
    wrapper.append(
      sectionCard({
        title: 'Meilleurs produits de la période',
        description: 'Classés par chiffre d’affaires.',
        content: element(html`
          <div class="table-wrap">
            <table class="table table-stack">
              <thead>
                <tr><th>#</th><th>Produit</th><th class="text-right">Quantité</th><th class="text-right">Chiffre d’affaires</th><th class="text-right">Marge</th></tr>
              </thead>
              <tbody>${raw(rows)}</tbody>
            </table>
          </div>
        `),
      }),
    );
  }

  /* ------------------------------ ventes récentes ----------------------- */
  const recent = [...state.sales]
    .filter((sale) => !view.activityId || sale.activityId === view.activityId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8);

  if (recent.length > 0) {
    const table = dataTable({
      caption: 'Ventes récentes',
      columns: [
        { key: 'reference', label: 'Référence', render: (row) => html`<span class="font-semibold">${row.reference}</span>` },
        { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
        {
          key: 'customer',
          label: 'Client',
          render: (row) => state.customers.find((entry) => entry.id === row.customerId)?.name || 'Client de passage',
        },
        {
          key: 'total',
          label: 'Total',
          align: 'right',
          render: (row) => formatMoney(saleTotal(row)),
        },
      ],
      rows: recent,
      initialLimit: 8,
    });
    wrapper.append(sectionCard({ title: 'Ventes récentes', description: 'Les huit dernières ventes, toutes périodes confondues.', content: table.element }));
  }

  if (state.sales.length === 0 && state.purchases.length === 0) {
    wrapper.append(
      emptyState({
        title: 'Commencez par vos premières opérations',
        message: 'Enregistrez un achat pour alimenter le stock, puis une vente : le tableau de bord se remplira automatiquement.',
        actionLabel: 'Créer une activité',
        iconName: 'activity',
        onAction: () => ctx.navigate('activites'),
      }),
    );
  }

  return wrapper;
}

/* ------------------------------- utilitaires ---------------------------- */

function getFiltersFromView(view, period) {
  return { activityId: view.activityId || '', from: period.from, to: period.to, period };
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
