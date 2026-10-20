/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Rapports »
 *
 * Rapport d'activité complet : synthèse, ventes, achats, dépenses, produits,
 * trésorerie, créances, dettes et hypothèses de calcul. Chaque chiffre est
 * recalculé à la demande et le rapport affiche toujours sa période, son
 * activité et ses conventions.
 * ------------------------------------------------------------------------- */

import { FINANCE_RULES_TEXT, ACCOUNTING_DISCLAIMER } from '../config/constants.js';
import { html, element, raw } from '../shared/dom.js';
import { formatMoney, formatPercent, formatQuantity } from '../shared/format.js';
import { formatDate, formatMonthLabel } from '../shared/dates.js';
import { getPeriod, getViewState } from '../shared/view-state.js';
import { createPage } from '../shared/screen.js';
import { button, confirmDialog, kpiCard, nextFrame, noticePanel, pageHeader, progressDialog, sectionCard, toast } from '../shared/ui.js';
import { openModal } from '../shared/ui.js';
import { chartBox, CHART_COLORS, Chart } from '../shared/charts.js';
import { getState } from '../services/state.js';
import { buildReport, comparePeriods, periodLabel, reportToSections } from '../services/reports.js';
import { simulateCostRecalculation } from '../services/recalc.js';
import { exportAccountingCsv, exportReportCsv } from '../services/csv.js';

export const meta = { path: 'rapports', title: 'Rapports' };

/* ------------------------------- impression ----------------------------- */

function printReport(report, activityName) {
  const sections = reportToSections(report, {
    formatDate: (value) => formatDate(value),
    formatMoney: (value) => formatMoney(value),
    formatQuantity: (value) => formatQuantity(value),
  });
  const win = window.open('', '_blank', 'width=1024,height=768');
  if (!win) return false;

  const body = sections
    .filter((section) => section.rows.length > 0)
    .map(
      (section) => `
        <section>
          <h2>${section.title}</h2>
          <table>
            <thead><tr>${section.columns.map((column) => `<th>${column}</th>`).join('')}</tr></thead>
            <tbody>${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </section>`,
    )
    .join('');

  const assumptions = FINANCE_RULES_TEXT.map((rule) => `<li>${rule}</li>`).join('');

  win.document.write(`<!doctype html>
    <html lang="fr"><head><meta charset="utf-8" />
    <title>Rapport d’activité — Mon Commerce</title>
    <style>
      body { font-family: system-ui, Arial, sans-serif; color: #111827; margin: 24px; }
      h1 { color: #166534; font-size: 20px; }
      h2 { color: #166534; font-size: 14px; margin-top: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
      th, td { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; }
      th { background: #dcfce7; color: #166534; }
      td:last-child, th:last-child { text-align: right; }
      .muted { color: #6b7280; font-size: 12px; }
      ul { font-size: 12px; color: #374151; }
    </style></head><body>
    <h1>Rapport d’activité${activityName ? ` — ${activityName}` : ''}</h1>
    <p class="muted">Période : ${periodLabel(report.period, (value) => formatDate(value))} — généré le ${formatDate(report.generatedAt)}.</p>
    ${body}
    <h2>Hypothèses de calcul</h2>
    <ul>${assumptions}</ul>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}

/* ----------------------- diagnostic du coût figé (L14) ------------------ */

function openCostDiagnostic(state, period) {
  const result = simulateCostRecalculation(state, { from: period?.from || '', to: period?.to || '' });
  const body = element(html`
    <div class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg border border-line bg-canvas/60 p-3">
          <p class="text-xs uppercase tracking-wide text-muted">Coût figé</p>
          <p class="mt-1 font-semibold tabular-nums">${formatMoney(result.totalFrozen)}</p>
        </div>
        <div class="rounded-lg border border-line bg-canvas/60 p-3">
          <p class="text-xs uppercase tracking-wide text-muted">Coût simulé</p>
          <p class="mt-1 font-semibold tabular-nums">${formatMoney(result.totalRecalculated)}</p>
        </div>
        <div class="rounded-lg border border-line bg-canvas/60 p-3">
          <p class="text-xs uppercase tracking-wide text-muted">Écart simulé</p>
          <p class="mt-1 font-semibold tabular-nums ${result.difference > 0 ? 'text-danger' : result.difference < 0 ? 'text-brand' : ''}">
            ${result.difference > 0 ? '+' : ''}${formatMoney(result.difference)}
          </p>
        </div>
      </div>
      ${result.rows.length === 0
        ? html`<p class="text-sm text-muted">Aucun écart : les coûts figés correspondent au rejeu des mouvements de stock sur la période (${result.linesCount} ligne(s) de vente analysée(s)).</p>`
        : html`
            <div class="table-wrap">
              <table class="table table-stack">
                <thead>
                  <tr>
                    <th>Date</th><th>Vente</th><th>Produit</th><th class="text-right">Qté</th>
                    <th class="text-right">Coût figé</th><th class="text-right">Coût simulé</th><th class="text-right">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  ${result.rows.slice(0, 100).map(
                    (row) => html`
                      <tr>
                        <td data-label="Date">${formatDate(row.date)}</td>
                        <td data-label="Vente">${row.reference}</td>
                        <td data-label="Produit">${row.product}</td>
                        <td data-label="Qté" class="text-right tabular-nums">${formatQuantity(row.quantity)}</td>
                        <td data-label="Coût figé" class="text-right tabular-nums">${formatMoney(row.frozen)}</td>
                        <td data-label="Coût simulé" class="text-right tabular-nums">${formatMoney(row.recalculated)}</td>
                        <td data-label="Écart" class="text-right tabular-nums ${row.difference > 0 ? 'text-danger' : 'text-brand'}">
                          ${row.difference > 0 ? '+' : ''}${formatMoney(row.difference)}
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
            ${result.rows.length > 100 ? html`<p class="text-xs text-muted">Affichage limité à 100 écarts sur ${result.rows.length}. Exportez le rapport pour analyser le détail.</p>` : ''}
          `}
      <div class="rounded-lg border border-warning/30 bg-amber-50 p-3 text-xs text-ink">
        <p class="font-semibold text-warning">Simulation en lecture seule</p>
        <p class="mt-1">
          Le coût figé est un choix de fiabilité : une vente passée ne change pas quand un prix d’achat est corrigé plus tard.
          Ce diagnostic montre ce qu’un recalcul donnerait ; il ne modifie ni les ventes, ni les mouvements de stock, ni les marges déjà publiées.
        </p>
      </div>
    </div>
  `);
  openModal({
    title: 'Diagnostic du coût de revient',
    description: `${periodLabel(period, (value) => formatDate(value))} — ${result.salesCount} vente(s), ${result.linesCount} ligne(s).`,
    size: 'lg',
    content: body,
  });
}

/* --------------------------------- rendu -------------------------------- */

function sectionTable(section) {
  if (section.rows.length === 0) return null;
  return sectionCard({
    title: section.title,
    content: element(html`
      <div class="table-wrap">
        <table class="table table-stack">
          <thead>
            <tr>
              ${section.columns.map(
                (column, index) => html`<th scope="col" class="${index > 0 ? 'text-right' : ''}">${column}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${section.rows.map(
              (row) => html`<tr>${row.map((cell, index) => html`<td data-label="${section.columns[index] || ''}" class="${index > 0 ? 'text-right tabular-nums' : ''}">${cell}</td>`)}</tr>`,
            )}
          </tbody>
        </table>
      </div>
    `),
  });
}

function paint(ctx, api) {
  const state = getState();
  const view = getViewState();
  const period = getPeriod();
  const wrapper = element('<div class="space-y-4"></div>');

  if (state.activities.length === 0) {
    wrapper.append(pageHeader({ title: 'Rapports' }));
    wrapper.append(
      emptyStateLike(ctx),
    );
    return wrapper;
  }

  const report = buildReport(state, { activityId: view.activityId, period, limit: 15 });
  const activityName = report.activity ? report.activity.name : '';

  wrapper.append(
    pageHeader({
      title: 'Rapport d’activité',
      subtitle: `${activityName ? `${activityName} — ` : ''}${periodLabel(period, (value) => formatDate(value))}.`,
      actions: [
        button({
          label: 'Exporter CSV',
          iconName: 'download',
          onClick: async () => {
            const progress = progressDialog({ title: 'Export CSV', message: 'Préparation des sections…' });
            try {
              progress.update(20);
              await nextFrame();
              const count = exportReportCsv(report, { activityName });
              progress.update(100);
              if (count === 0) {
                toast('Aucune donnée à exporter sur cette période.', 'warning');
                return;
              }
              toast(`${count} fichier(s) CSV générés (un par section non vide).`, 'success', { duration: 6000 });
            } catch (error) {
              toast(error && error.message ? error.message : 'Export CSV impossible.', 'error', { duration: 7000 });
            } finally {
              setTimeout(() => progress.close(), 350);
            }
          },
        }),
        button({
          label: 'Exporter PDF',
          iconName: 'download',
          onClick: async () => {
            const rows =
              report.salesTable.length +
              report.purchasesTable.length +
              report.topProducts.length +
              report.expensesByCategory.length +
              report.receivables.list.length +
              report.payables.list.length;
            if (rows > 3000) {
              const proceed = await confirmDialog({
                title: 'Rapport volumineux',
                message: `${rows} lignes seront mises en page dans le PDF. Sur un appareil modeste, cela peut prendre plusieurs secondes.`,
                details: 'L’export CSV est plus rapide et mieux adapté aux gros volumes. Vous pouvez aussi réduire la période.',
                confirmLabel: 'Générer quand même',
                cancelLabel: 'Utiliser le CSV',
              });
              if (!proceed) return;
            }
            const progress = progressDialog({ title: 'Génération du PDF', message: 'Mise en page du rapport…' });
            try {
              progress.update(20);
              await nextFrame();
              const { downloadReportPdf } = await import('../services/documents.js');
              progress.update(55, 'Écriture des tableaux…');
              await nextFrame();
              const filename = downloadReportPdf(report, { settings: state.settings, activityName });
              progress.update(100, 'Terminé.');
              toast(`Rapport PDF enregistré : ${filename}`, 'success');
            } catch (error) {
              toast(error && error.message ? error.message : 'Génération du PDF impossible.', 'error', { duration: 6000 });
            } finally {
              setTimeout(() => progress.close(), 350);
            }
          },
        }),
        button({
          label: 'Export comptable',
          iconName: 'book',
          title: 'Journal simplifié en partie double, à transmettre à un comptable',
          onClick: () => {
            const result = exportAccountingCsv({
              state,
              activityId: view.activityId,
              activityName,
              period,
            });
            if (result.lines === 0) {
              toast('Aucune écriture comptable sur cette période.', 'warning');
              return;
            }
            toast(
              `Journal comptable exporté : ${result.lines} ligne(s), débit ${formatMoney(result.totals.debit)} = crédit ${formatMoney(result.totals.credit)}${result.balanced ? '' : ' (déséquilibre à vérifier)'}.`,
              result.balanced ? 'success' : 'warning',
              { duration: 8000 },
            );
          },
        }),
        button({
          label: 'Imprimer',
          iconName: 'printer',
          onClick: () => {
            const opened = printReport(report, activityName);
            if (!opened) toast('Autorisez l’ouverture de fenêtres pour imprimer le rapport.', 'warning', { duration: 6000 });
          },
        }),
      ],
    }),
  );

  const kpis = report.kpis;
  wrapper.append(
    noticePanel({
      tone: 'warning',
      title: 'Rapport de pilotage',
      message: ACCOUNTING_DISCLAIMER,
    }),
  );
  wrapper.append(
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Chiffre d’affaires net', value: formatMoney(kpis.revenue), hint: `${kpis.salesCount} vente(s)`, iconName: 'receipt', tooltip: 'Ventes validées, nettes des remises et retours de la période.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Marge brute', value: formatMoney(kpis.grossMargin), hint: `Coût des produits : ${formatMoney(kpis.costOfGoodsSold)}`, tone: kpis.grossMargin >= 0 ? 'positive' : 'negative', iconName: 'chart', tooltip: 'Chiffre d’affaires net − coût moyen pondéré des produits vendus (figé à la vente).' }).outerHTML)}
        ${raw(kpiCard({ label: 'Résultat estimé', value: formatMoney(kpis.estimatedResult), hint: `Dépenses d’exploitation : ${formatMoney(kpis.operatingExpenses)}`, tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative', iconName: 'banknote', tooltip: 'Marge brute − dépenses d’exploitation. Hors investissements, approvisionnements déjà dans le coût et retraits personnels.' }).outerHTML)}
        ${raw(kpiCard({ label: 'Trésorerie', value: formatMoney(kpis.treasury), hint: `Stock : ${formatMoney(kpis.stockValue)}`, iconName: 'wallet', tooltip: 'Argent réellement disponible sur les comptes à la fin de la période. Différent du bénéfice et du budget.' }).outerHTML)}
      </div>
    `),
  );

  /* ------------------------- comparaison de périodes -------------------- */
  const comparison = comparePeriods(state, { activityId: view.activityId, period });
  if (comparison) {
    const toneClass = (value, invert = false) => {
      if (value === 0) return 'text-muted';
      const positive = invert ? value < 0 : value > 0;
      return positive ? 'text-brand' : 'text-danger';
    };
    wrapper.append(
      sectionCard({
        title: 'Comparaison avec la période précédente',
        description: `${periodLabel(comparison.previous, (value) => formatDate(value))} — même durée (L11).`,
        content: element(html`
          <div class="table-wrap">
            <table class="table table-stack">
              <thead>
                <tr>
                  <th>Indicateur</th>
                  <th class="text-right">Période affichée</th>
                  <th class="text-right">Période précédente</th>
                  <th class="text-right">Écart</th>
                  <th class="text-right">Variation</th>
                </tr>
              </thead>
              <tbody>
                ${comparison.metrics.map(
                  (metric) => html`
                    <tr>
                      <td data-label="Indicateur" class="font-medium">${metric.label}</td>
                      <td data-label="Période affichée" class="text-right tabular-nums">${formatMoney(metric.current)}</td>
                      <td data-label="Période précédente" class="text-right tabular-nums text-muted">${formatMoney(metric.previous)}</td>
                      <td data-label="Écart" class="text-right tabular-nums ${toneClass(metric.delta, metric.key === 'operatingExpenses')}">
                        ${metric.delta > 0 ? '+' : ''}${formatMoney(metric.delta)}
                      </td>
                      <td data-label="Variation" class="text-right tabular-nums ${toneClass(metric.delta, metric.key === 'operatingExpenses')}">
                        ${metric.percent === null ? '—' : `${metric.percent > 0 ? '+' : ''}${formatPercent(metric.percent)}`}
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-xs text-muted">
            Une variation n’est pas un jugement : une hausse des dépenses peut être un investissement utile. Les périodes sans historique affichent « — ».
          </p>
        `),
      }),
    );
  }

  /* ------------------------------- graphique ---------------------------- */
  const monthly = report.series.monthly || [];
  const hasMonthly = monthly.some((entry) => entry.revenue !== 0 || entry.expenses !== 0);
  if (hasMonthly) {
    const { wrapper: box, canvas } = chartBox({ height: 300, label: 'Évolution mensuelle du chiffre d’affaires et des dépenses' });
    wrapper.append(sectionCard({ title: 'Évolution mensuelle', description: 'Chiffre d’affaires, marge brute et dépenses d’exploitation.', content: box }));
    api.defer(() => {
      if (!canvas.isConnected) return;
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: monthly.map((entry) => formatMonthLabel(`${entry.key}-01`)),
          datasets: [
            { label: 'Chiffre d’affaires', data: monthly.map((entry) => entry.revenue), borderColor: CHART_COLORS.brand, backgroundColor: CHART_COLORS.brandArea, fill: true, tension: 0.3, pointRadius: 3 },
            { label: 'Marge brute', data: monthly.map((entry) => entry.margin), borderColor: CHART_COLORS.ink, backgroundColor: 'transparent', tension: 0.3, pointRadius: 3 },
            { label: 'Dépenses', data: monthly.map((entry) => entry.expenses), borderColor: CHART_COLORS.warning, backgroundColor: 'transparent', tension: 0.3, pointRadius: 3 },
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
            x: { grid: { display: false }, ticks: { color: CHART_COLORS.muted } },
            y: { ticks: { color: CHART_COLORS.muted, callback: (value) => formatMoney(value, { symbol: false }) } },
          },
        },
      });
      api.charts.push(chart);
    });
  }

  /* -------------------------------- sections ---------------------------- */
  const sections = reportToSections(report, {
    formatDate: (value) => formatDate(value),
    formatMoney: (value) => formatMoney(value),
    formatQuantity: (value) => formatQuantity(value),
  });

  for (const section of sections) {
    const table = sectionTable(section);
    if (table) wrapper.append(table);
  }

  /* ------------------------ diagnostic coût figé (L14) ------------------ */
  const diagnosticContent = element(html`
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-sm text-muted">
        Le coût d’achat des produits vendus est figé au moment de la vente. Lancez un diagnostic pour comparer
        ce coût à un recalcul sur la période, sans modifier vos données.
      </p>
    </div>
  `);
  const diagnosticButton = button({
    label: 'Lancer le diagnostic',
    iconName: 'calculator',
    onClick: () => openCostDiagnostic(state, report.period),
  });
  diagnosticContent.append(diagnosticButton);
  wrapper.append(
    sectionCard({
      title: 'Coût de revient figé',
      description: 'Outil de contrôle en lecture seule (L14).',
      content: diagnosticContent,
    }),
  );

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Hypothèses et conventions de calcul',
      items: report.assumptions || FINANCE_RULES_TEXT,
    }),
  );

  return wrapper;
}

function emptyStateLike(ctx) {
  const node = element(html`
    <div class="card card-pad flex flex-col items-start gap-3">
      <h2 class="text-base font-semibold text-brand-dark">Aucune activité commerciale</h2>
      <p class="text-sm text-muted">Créez une activité, puis enregistrez des opérations pour générer des rapports.</p>
      <button type="button" class="btn-primary" data-go>Créer une activité</button>
    </div>
  `);
  node.querySelector('[data-go]').addEventListener('click', () => ctx.navigate('activites'));
  return node;
}

export default { meta, render(ctx) { return createPage({ ctx, filters: true, paint: (api) => paint(ctx, api) }).root; } };
