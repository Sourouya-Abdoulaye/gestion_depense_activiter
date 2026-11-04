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
import { icon } from '../shared/icons.js';
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

/* ------------------------------ sous-vues ------------------------------- */

function sectionHeading(title) {
  return element(html`
    <div class="mb-2 flex items-center gap-3">
      <h2 class="text-sm font-semibold text-brand-dark">${title}</h2>
      <span class="h-px flex-1 bg-line"></span>
    </div>
  `);
}

function buildHero({ activity, period, actions }) {
  const initial = String(activity ? activity.name : 'Mon Commerce').trim().charAt(0).toUpperCase();
  const hero = element(html`
    <section class="dashboard-hero relative overflow-hidden rounded-card border border-brand/15 px-4 py-4 sm:px-6 sm:py-5">
      <div class="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex min-w-0 items-center gap-3">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-lg font-bold text-white shadow-sm">${initial}</span>
          <div class="min-w-0">
            <p class="text-[0.62rem] font-bold uppercase tracking-[0.12em] text-brand">Tableau de bord</p>
            <h1 class="mt-0.5 line-clamp-2 text-lg font-semibold leading-tight text-brand-dark sm:text-2xl">${activity ? activity.name : 'Votre activité'}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted">
              <span>${periodLabel(period, formatDate)}</span>
              <span class="h-1 w-1 rounded-full bg-line"></span>
              <span>Données locales</span>
            </p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2" data-hero-actions></div>
      </div>
    </section>
  `);
  hero.querySelector('[data-hero-actions]').append(...actions);
  return hero;
}

function buildBudgetCard(activity, state) {
  const budget = activityBudget(activity, { cashMovements: state.cashMovements });
  const ratio = budget.available > 0 ? Math.min(budget.consumed / budget.available, 1) : 0;
  const percent = Math.round(ratio * 100);
  const barTone = ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-brand';
  const targetPercent = budget.target > 0 ? Math.min(budget.targetProgress, 1) : 0;
  return element(html`
    <div class="card p-4 sm:p-5">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="grid h-8 w-8 place-items-center rounded-lg bg-brand-light/70 text-brand-dark">${raw(icon('wallet', { size: 16 }))}</span>
          <div>
            <h2 class="text-sm font-semibold text-brand-dark">Budget</h2>
            <p class="text-[0.65rem] text-muted">Cumulé sur l’activité</p>
          </div>
        </div>
        <span class="badge ${budget.remaining >= 0 ? 'badge-brand' : 'badge-danger'}">${formatMoney(budget.remaining)} restant</span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-3">
        <div><p class="text-[0.65rem] text-muted">Capital</p><p class="mt-0.5 text-sm font-semibold tabular-nums">${formatMoney(budget.initialCapital)}</p></div>
        <div><p class="text-[0.65rem] text-muted">Apports</p><p class="mt-0.5 text-sm font-semibold tabular-nums">${formatMoney(budget.contributions)}</p></div>
        <div><p class="text-[0.65rem] text-muted">Consommé</p><p class="mt-0.5 text-sm font-semibold tabular-nums text-warning">${formatMoney(budget.consumed)}</p></div>
        <div><p class="text-[0.65rem] text-muted">Budget total</p><p class="mt-0.5 text-sm font-semibold tabular-nums">${formatMoney(budget.available)}</p></div>
      </div>

      <div class="mt-3">
        <div class="flex items-center justify-between text-[0.68rem] text-muted"><span>Budget utilisé</span><span>${percent} %</span></div>
        <div class="mt-1 h-2 overflow-hidden rounded-full bg-canvas"><div class="h-full rounded-full ${barTone}" style="width:${percent}%"></div></div>
      </div>
      ${budget.target > 0
        ? html`<div class="mt-2">
            <div class="flex items-center justify-between text-[0.65rem] text-muted"><span>Objectif de dépenses</span><span>${Math.round(targetPercent * 100)} %</span></div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas"><div class="h-full rounded-full ${targetPercent >= 1 ? 'bg-danger' : 'bg-brand'}" style="width:${Math.round(targetPercent * 100)}%"></div></div>
          </div>`
        : ''}
    </div>
  `);
}

function buildInsightCard({ ctx, kpis, alerts, overdueReceivables, overduePayables }) {
  let iconName = 'chart';
  let title = 'Votre marge en un mot';
  let text = 'Suivez l’évolution de votre marge dans les rapports.';
  let actionLabel = 'Voir les rapports';
  let path = 'rapports';

  if (overdueReceivables.length > 0) {
    iconName = 'users';
    title = 'Une relance à prévoir';
    text = `${overdueReceivables.length} créance(s) client sont en retard de paiement.`;
    actionLabel = 'Voir les créances';
    path = 'clients';
  } else if (alerts.length > 0) {
    iconName = 'box';
    title = 'Stock à surveiller';
    text = `${alerts.length} produit(s) sont sous le seuil d’alerte.`;
    actionLabel = 'Voir le stock';
    path = 'produits';
  } else if (overduePayables.length > 0) {
    iconName = 'truck';
    title = 'Échéance fournisseur';
    text = `${overduePayables.length} dette(s) fournisseur sont échues.`;
    actionLabel = 'Voir les dettes';
    path = 'fournisseurs';
  } else if (kpis.revenue <= 0) {
    iconName = 'receipt';
    title = 'Donnez vie à votre tableau de bord';
    text = 'Enregistrez une première vente pour suivre votre activité en temps réel.';
    actionLabel = 'Vendre maintenant';
    path = 'ventes';
  } else {
    text = `Votre marge brute représente ${formatPercent(kpis.grossMargin / kpis.revenue)} du chiffre d’affaires.`;
  }

  const card = element(html`
    <section class="insight-card relative overflow-hidden rounded-card px-4 py-4 text-white sm:px-5">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-white/15">${raw(icon(iconName, { size: 16 }))}</span>
      <h2 class="mt-3 text-sm font-semibold text-white">${title}</h2>
      <p class="mt-1 text-[0.72rem] leading-relaxed text-white/80">${text}</p>
      <button type="button" class="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-white hover:text-brand-light" data-insight-action>
        ${actionLabel} ${raw(icon('arrowRight', { size: 12 }))}
      </button>
    </section>
  `);
  card.querySelector('[data-insight-action]').addEventListener('click', () => ctx.navigate(path));
  return card;
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
    buildHero({
      activity,
      period,
      actions: [
        button({ label: 'Ventes & caisse', iconName: 'plus', variant: 'primary', onClick: () => ctx.navigate('ventes') }),
        button({ label: 'Voir les rapports', iconName: 'chart', onClick: () => ctx.navigate('rapports') }),
      ],
    }),
  );

  const performanceCards = [
    kpiCard({ label: 'Chiffre d’affaires net', value: formatMoney(kpis.revenue), hint: kpis.salesCount > 0 ? `${kpis.salesCount} vente(s)` : 'Aucune vente', iconName: 'receipt', accent: true, tooltip: 'Ventes validées de la période, moins les remises et les retours. Ce n’est pas l’argent déjà encaissé.' }),
    kpiCard({ label: 'Marge brute', value: formatMoney(kpis.grossMargin), hint: kpis.revenue > 0 ? `Taux ${formatPercent(kpis.grossMargin / kpis.revenue)}` : 'Aucune vente', tone: kpis.grossMargin >= 0 ? 'positive' : 'negative', iconName: 'chart', tooltip: 'Chiffre d’affaires net moins le coût moyen pondéré des produits vendus. Le coût est figé au moment de chaque vente.' }),
    kpiCard({ label: 'Résultat estimé', value: formatMoney(kpis.estimatedResult), hint: 'Charges déduites', tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative', iconName: 'banknote', tooltip: 'Marge brute moins les dépenses d’exploitation de la période. Les achats de stock, investissements et retraits personnels ne sont pas déduits ici.' }),
    kpiCard({ label: 'Trésorerie', value: formatMoney(kpis.treasury), hint: 'Comptes actifs', iconName: 'wallet', tooltip: 'Solde initial des comptes + argent réellement entré − argent réellement sorti. Les créances et dettes non réglées sont exclues.' }),
  ];
  const flowCards = [
    kpiCard({ label: 'Encaissements', value: formatMoney(kpis.cashIn), hint: 'Reçus sur la période', iconName: 'download', tooltip: 'Paiements effectivement reçus sur la période (ventes, règlements clients, apports). Les ventes à crédit non payées n’y figurent pas.' }),
    kpiCard({ label: 'Créances clients', value: formatMoney(kpis.receivables), hint: 'À recevoir', tone: kpis.receivables > 0 ? 'warning' : 'neutral', iconName: 'users', tooltip: 'Reste à recevoir sur les ventes à crédit : montant des ventes − paiements reçus − avoirs. Ce n’est pas encore de la trésorerie.' }),
    kpiCard({ label: 'Dettes fournisseurs', value: formatMoney(kpis.payables), hint: 'À payer', tone: kpis.payables > 0 ? 'warning' : 'neutral', iconName: 'truck', tooltip: 'Reste à payer sur les achats : montant des achats − paiements − retours. Une dette n’a pas encore impacté la trésorerie.' }),
    kpiCard({ label: 'Valeur du stock', value: formatMoney(kpis.stockValue), hint: 'Coût moyen', iconName: 'box', tooltip: 'Quantité disponible × coût moyen pondéré, calculé à partir de tous les mouvements de stock. Une perte ou une casse réduit cette valeur.' }),
  ];

  const kpiSection = element('<section class="space-y-3"></section>');
  const performanceGrid = element('<div class="grid grid-cols-2 gap-3 xl:grid-cols-4"></div>');
  performanceGrid.append(...performanceCards);
  const flowGrid = element('<div class="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4"></div>');
  flowGrid.append(...flowCards);
  kpiSection.append(sectionHeading('Performance'), performanceGrid, sectionHeading('Flux & soldes'), flowGrid);
  wrapper.append(kpiSection);

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
  const chartCard = sectionCard({
    title: 'Chiffre d’affaires et dépenses',
    description: hasData ? undefined : 'Aucune donnée sur la période sélectionnée.',
    content: box,
  });
  const sideColumn = element('<div class="space-y-4"></div>');
  if (activity) sideColumn.append(buildBudgetCard(activity, state));
  sideColumn.append(buildInsightCard({ ctx, kpis, alerts, overdueReceivables, overduePayables }));
  const mainGrid = element('<div class="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,1fr)] xl:items-start"></div>');
  mainGrid.append(chartCard, sideColumn);
  wrapper.append(mainGrid);

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
