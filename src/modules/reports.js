/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Rapports »
 *
 * Rapport d'activité complet : synthèse, ventes, achats, dépenses, produits,
 * trésorerie, créances, dettes et hypothèses de calcul. Chaque chiffre est
 * recalculé à la demande et le rapport affiche toujours sa période, son
 * activité et ses conventions.
 * ------------------------------------------------------------------------- */

import { FINANCE_RULES_TEXT } from '../config/constants.js';
import { html, element, raw } from '../shared/dom.js';
import { formatMoney, formatQuantity } from '../shared/format.js';
import { formatDate, formatMonthLabel } from '../shared/dates.js';
import { getPeriod, getViewState } from '../shared/view-state.js';
import { createPage } from '../shared/screen.js';
import { button, kpiCard, noticePanel, pageHeader, sectionCard, toast } from '../shared/ui.js';
import { chartBox, CHART_COLORS, Chart } from '../shared/charts.js';
import { getState } from '../services/state.js';
import { buildReport, periodLabel, reportToSections } from '../services/reports.js';
import { exportReportCsv } from '../services/csv.js';

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

/* --------------------------------- rendu -------------------------------- */

function sectionTable(section) {
  if (section.rows.length === 0) return null;
  return sectionCard({
    title: section.title,
    content: element(html`
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${section.columns.map(
                (column, index) => html`<th scope="col" class="${index > 0 ? 'text-right' : ''}">${column}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${section.rows.map(
              (row) => html`<tr>${row.map((cell, index) => html`<td class="${index > 0 ? 'text-right tabular-nums' : ''}">${cell}</td>`)}</tr>`,
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
          onClick: () => {
            const count = exportReportCsv(report, { activityName });
            if (count === 0) {
              toast('Aucune donnée à exporter sur cette période.', 'warning');
              return;
            }
            toast(`${count} fichier(s) CSV générés (un par section non vide).`, 'success', { duration: 6000 });
          },
        }),
        button({
          label: 'Exporter PDF',
          iconName: 'download',
          onClick: async () => {
            try {
              const { downloadReportPdf } = await import('../services/documents.js');
              const filename = downloadReportPdf(report, { settings: state.settings, activityName });
              toast(`Rapport PDF enregistré : ${filename}`, 'success');
            } catch (error) {
              toast(error && error.message ? error.message : 'Génération du PDF impossible.', 'error', { duration: 6000 });
            }
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
    element(html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(kpiCard({ label: 'Chiffre d’affaires net', value: formatMoney(kpis.revenue), hint: `${kpis.salesCount} vente(s)`, iconName: 'receipt' }).outerHTML)}
        ${raw(kpiCard({ label: 'Marge brute', value: formatMoney(kpis.grossMargin), hint: `Coût des produits : ${formatMoney(kpis.costOfGoodsSold)}`, tone: kpis.grossMargin >= 0 ? 'positive' : 'negative', iconName: 'chart' }).outerHTML)}
        ${raw(kpiCard({ label: 'Résultat estimé', value: formatMoney(kpis.estimatedResult), hint: `Dépenses d’exploitation : ${formatMoney(kpis.operatingExpenses)}`, tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative', iconName: 'banknote' }).outerHTML)}
        ${raw(kpiCard({ label: 'Trésorerie', value: formatMoney(kpis.treasury), hint: `Stock : ${formatMoney(kpis.stockValue)}`, iconName: 'wallet' }).outerHTML)}
      </div>
    `),
  );

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
