/* ---------------------------------------------------------------------------
 * Mon Commerce — documents imprimables et PDF (jsPDF)
 *
 * Deux usages :
 *   • reçu de vente (PDF téléchargeable et version imprimable) ;
 *   • rapport d'activité complet (synthèse, ventes, achats, stock, trésorerie,
 *     créances, dettes, hypothèses).
 * Ce module est chargé à la demande pour ne pas alourdir le démarrage.
 * ------------------------------------------------------------------------- */

import { jsPDF } from 'jspdf';
import { CURRENCY_SYMBOL, FINANCE_RULES_TEXT } from '../config/constants.js';
import { formatDate } from '../shared/dates.js';
import { escapeHtml as escape } from '../shared/format.js';
import { formatMoney, formatPercent, formatQuantity } from '../shared/format.js';

const BRAND = [21, 128, 61];
const DARK = [22, 101, 52];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const LIGHT = [220, 252, 231];

/** Modèles de reçus (L13). Le rendu PDF et l'impression partagent ces variantes. */
export const RECEIPT_TEMPLATES = [
  { value: 'classic', label: 'Classique', description: 'En-tête vert, tableau contrasté, mise en page A4.' },
  { value: 'compact', label: 'Compact', description: 'Format A5, marges réduites, idéal pour une imprimante thermique.' },
  { value: 'minimal', label: 'Minimal', description: 'Noir et blanc, sans aplat de couleur, économique à l’impression.' },
];

const RECEIPT_THEMES = {
  classic: { headerFill: DARK, headerText: [255, 255, 255], zebra: true, fontSize: 9, tableHeaderHeight: 20 },
  compact: { headerFill: LIGHT, headerText: DARK, zebra: false, fontSize: 8, tableHeaderHeight: 18 },
  minimal: { headerFill: null, headerText: INK, zebra: false, fontSize: 9, tableHeaderHeight: 18 },
};

function receiptTheme(template) {
  return RECEIPT_THEMES[template] || RECEIPT_THEMES.classic;
}

function imageFormat(dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp)/i.exec(String(dataUrl || ''));
  if (!match) return 'PNG';
  const kind = match[1].toLowerCase();
  if (kind === 'jpg' || kind === 'jpeg') return 'JPEG';
  if (kind === 'webp') return 'WEBP';
  return 'PNG';
}

/** Dessine le logo s'il existe ; une image invalide ne doit jamais bloquer l'édition. */
function drawLogo(doc, settings, { x, y, size }) {
  if (!settings?.logoDataUrl) return false;
  try {
    doc.addImage(settings.logoDataUrl, imageFormat(settings.logoDataUrl), x, y, size, size);
    return true;
  } catch {
    return false;
  }
}

function shopContactLines(settings) {
  return [settings?.shopPhone, settings?.shopAddress, settings?.shopTaxId].filter(Boolean);
}

/** Pied de page commun aux reçus PDF (message libre + mentions). */
function drawReceiptFooter(doc, settings, { margin, pageWidth, y }) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const usable = pageWidth - margin * 2;
  let cursor = Math.max(y, pageHeight - 92);
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(1);
  doc.line(margin, cursor, pageWidth - margin, cursor);
  cursor += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  if (settings?.receiptFooter) {
    const lines = doc.splitTextToSize(String(settings.receiptFooter), usable);
    doc.text(lines, margin, cursor);
    cursor += lines.length * 12 + 2;
  }
  const contact = shopContactLines(settings).join(' — ');
  if (contact) {
    const lines = doc.splitTextToSize(contact, usable);
    doc.text(lines, margin, cursor);
    cursor += lines.length * 11 + 2;
  }
  doc.setFontSize(8);
  doc.text(
    doc.splitTextToSize(
      'Reçu généré depuis les opérations enregistrées. Conservez-le comme justificatif. Données locales, non synchronisées.',
      usable,
    ),
    margin,
    cursor,
  );
}

function pdfTable(doc, { startY, columns, rows, margin, pageWidth, zebra = true, theme }) {
  const style = theme || { headerFill: DARK, headerText: [255, 255, 255], zebra, fontSize: 9, tableHeaderHeight: 20 };
  const usable = pageWidth - margin * 2;
  const widths = columns.map((column) => column.width * usable);
  const headerHeight = style.tableHeaderHeight || 20;
  const fontSize = style.fontSize || 9;
  const rowPadding = Math.round(fontSize * 1.8);
  let y = startY;

  const drawHeader = () => {
    if (style.headerFill) {
      doc.setFillColor(...style.headerFill);
      doc.rect(margin, y, usable, headerHeight, 'F');
    } else {
      doc.setDrawColor(...LIGHT);
      doc.setLineWidth(0.8);
      doc.line(margin, y + headerHeight, margin + usable, y + headerHeight);
    }
    doc.setTextColor(...(style.headerText || INK));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    let x = margin;
    columns.forEach((column, index) => {
      const align = column.align === 'right' ? 'right' : 'left';
      const tx = align === 'right' ? x + widths[index] - 4 : x + 4;
      doc.text(String(column.label), tx, y + headerHeight - 6, { align });
      x += widths[index];
    });
    y += headerHeight;
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
    const cells = row.map((value, index) => (value === null || value === undefined ? '' : String(value)));
    const lineCount = Math.max(
      ...cells.map((value, index) => doc.splitTextToSize(value, widths[index] - 8).length),
    );
    const rowHeight = Math.max(rowPadding, 4 + lineCount * (fontSize + 2));

    if (style.zebra && rowIndex % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, y, usable, rowHeight, 'F');
    }
    let x = margin;
    doc.setFontSize(fontSize);
    cells.forEach((value, index) => {
      const align = columns[index].align === 'right' ? 'right' : 'left';
      const tx = align === 'right' ? x + widths[index] - 4 : x + 4;
      const lines = doc.splitTextToSize(value, widths[index] - 8);
      doc.text(lines, tx, y + fontSize + 3, { align });
      x += widths[index];
    });
    y += rowHeight;
  });

  return y;
}

function docHeader(doc, { title, settings, activityName, periodLabel, margin, pageWidth, showLogo = true, monochrome = false }) {
  const compact = pageWidth < 300;
  const logoSize = compact ? 26 : 34;
  const hasLogo = showLogo && drawLogo(doc, settings, { x: margin, y: compact ? 18 : 24, size: logoSize });
  const textX = hasLogo ? margin + logoSize + 10 : margin;

  doc.setFillColor(...(monochrome ? INK : BRAND));
  doc.rect(0, 0, pageWidth, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 13 : 16);
  doc.setTextColor(...(monochrome ? INK : DARK));
  doc.text(settings?.shopName || 'Mon Commerce', textX, compact ? 34 : 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  shopContactLines(settings)
    .slice(0, compact ? 1 : 2)
    .forEach((line, index) => doc.text(String(line), textX, (compact ? 44 : 57) + index * 10));

  doc.setFontSize(compact ? 8 : 9);
  const titleY = compact ? 62 : 82;
  const lines = [title, activityName ? `Activité : ${activityName}` : 'Toutes les activités', periodLabel];
  lines.filter(Boolean).forEach((line, index) => doc.text(line, margin, titleY + index * (compact ? 10 : 12)));

  if (!compact) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(8);
    const stamp = `Édité le ${formatDate(new Date())} — ${CURRENCY_SYMBOL} (XOF)`;
    doc.text(stamp, pageWidth - margin, 44, { align: 'right' });
    doc.text('Mon Commerce — application locale, données non synchronisées', pageWidth - margin, 56, { align: 'right' });
  }

  const ruleY = compact ? titleY + lines.length * 10 + 6 : 122;
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(1);
  doc.line(margin, ruleY, pageWidth - margin, ruleY);

  doc.setTextColor(...INK);
  return ruleY + 16;
}

/** Reçu de vente au format PDF. */
export function buildSaleReceiptPdf(sale, context = {}) {
  const { settings, activity, customer, payments = [], returns = [], netTotal, balance } = context;
  const template = settings?.receiptTemplate || 'classic';
  const theme = receiptTheme(template);
  const compact = template === 'compact';
  const doc = new jsPDF({ unit: 'pt', format: compact ? [148, 210] : 'a4' });
  const margin = compact ? 22 : 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const usable = pageWidth - margin * 2;

  let y = docHeader(doc, {
    title: `Reçu de vente ${sale.reference}`,
    settings,
    activityName: activity ? activity.name : '',
    periodLabel: `Date : ${formatDate(sale.date)}`,
    margin,
    pageWidth,
    showLogo: settings?.receiptShowLogo !== false,
    monochrome: template === 'minimal',
  });

  doc.setFontSize(compact ? 9 : 10);
  doc.setFont('helvetica', 'bold');
  doc.text('Client', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(customer ? `${customer.name}${customer.phone ? ` — ${customer.phone}` : ''}` : 'Client de passage', margin + (compact ? 44 : 60), y);
  y += compact ? 20 : 24;

  const columns = [
    { label: 'Produit', width: 0.42 },
    { label: 'Qté', width: 0.12, align: 'right' },
    { label: 'Prix unitaire', width: 0.2, align: 'right' },
    { label: 'Total', width: 0.26, align: 'right' },
  ];
  const rows = (sale.lines || []).map((line) => [
    line.label,
    formatQuantity(line.quantity, line.unit),
    formatMoney(line.unitPrice),
    formatMoney(line.quantity * line.unitPrice - (line.discount || 0)),
  ]);
  y = pdfTable(doc, { startY: y, columns, rows, margin, pageWidth, theme });

  const totals = [];
  totals.push(['Sous-total', formatMoney((sale.lines || []).reduce((total, line) => total + line.quantity * line.unitPrice, 0))]);
  if (sale.discount) totals.push(['Remise', `− ${formatMoney(sale.discount)}`]);
  if (sale.otherFees) totals.push(['Frais', formatMoney(sale.otherFees)]);
  const returnsValue = returns.reduce((total, item) => total + item.total, 0);
  if (returnsValue > 0) totals.push(['Retours', `− ${formatMoney(returnsValue)}`]);
  totals.push(['TOTAL', formatMoney(netTotal ?? 0)]);
  totals.push(['Montant payé', formatMoney(payments.reduce((total, payment) => total + (payment.direction === 'in' ? payment.amount : -payment.amount), 0))]);
  totals.push(['Solde restant dû', formatMoney(balance ?? 0)]);

  y += 12;
  const totalsX = margin + usable * (compact ? 0.32 : 0.5);
  totals.forEach(([label, value], index) => {
    const isTotal = label === 'TOTAL';
    const isBalance = label === 'Solde restant dû';
    doc.setFont('helvetica', isTotal || isBalance ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? (compact ? 11 : 12) : compact ? 9 : 10);
    doc.setTextColor(...(isBalance && (balance ?? 0) > 0 ? [220, 38, 38] : isTotal && template !== 'minimal' ? DARK : INK));
    doc.text(label, totalsX, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    if (isTotal) {
      doc.setDrawColor(...(template === 'minimal' ? INK : BRAND));
      doc.line(totalsX, y - 12, pageWidth - margin, y - 12);
    }
    y += isTotal ? 20 : 16;
  });

  y += 10;
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(compact ? 8 : 9);
  doc.text(
    `Paiements : ${payments.length > 0 ? payments.map((payment) => `${payment.method} ${formatMoney(payment.amount)}`).join(', ') : 'aucun (vente à crédit)'}`,
    margin,
    y,
  );
  y += compact ? 12 : 14;

  drawReceiptFooter(doc, settings, { margin, pageWidth, y });

  return { doc, filename: `recu-${sale.reference}.pdf` };
}

export function downloadSaleReceiptPdf(sale, context) {
  const { doc, filename } = buildSaleReceiptPdf(sale, context);
  doc.save(filename);
  return filename;
}

/** Version imprimable du reçu (impression directe depuis le navigateur). */
export function printSaleReceipt(sale, context = {}) {
  const { settings, activity, customer, payments = [], returns = [], netTotal, balance } = context;
  const template = settings?.receiptTemplate || 'classic';
  const rows = (sale.lines || [])
    .map(
      (line) => `<tr>
        <td>${escape(line.label)}</td>
        <td class="right">${escape(formatQuantity(line.quantity, line.unit))}</td>
        <td class="right">${escape(formatMoney(line.unitPrice))}</td>
        <td class="right">${escape(formatMoney(line.quantity * line.unitPrice - (line.discount || 0)))}</td>
      </tr>`,
    )
    .join('');
  const returnsValue = returns.reduce((total, item) => total + item.total, 0);
  const paid = payments.reduce((total, payment) => total + (payment.direction === 'in' ? payment.amount : -payment.amount), 0);
  const contactLines = shopContactLines(settings)
    .map((line) => `<p class="contact">${escape(String(line))}</p>`)
    .join('');
  const logo =
    settings?.receiptShowLogo !== false && settings?.logoDataUrl
      ? `<img class="logo" src="${escape(settings.logoDataUrl)}" alt="Logo ${escape(settings?.shopName || 'Mon Commerce')}" />`
      : '';

  const markup = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<title>Reçu ${escape(sale.reference)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111827; margin: 24px; }
  h1 { color: #166534; font-size: 18px; margin: 0 0 4px; }
  .muted { color: #6B7280; font-size: 12px; }
  .header { display: flex; align-items: flex-start; gap: 12px; }
  .logo { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; }
  .contact { margin: 2px 0 0; color: #6B7280; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th { background: #166534; color: #fff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #E5E7EB; padding: 8px; }
  .right { text-align: right; }
  .totals { margin-top: 16px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .total { border-top: 2px solid #15803D; font-weight: 700; font-size: 15px; color: #166534; }
  .totals .due { color: #DC2626; font-weight: 700; }
  .bar { height: 6px; background: #15803D; margin: -24px -24px 24px; }
  footer { margin-top: 28px; border-top: 1px solid #DCFCE7; padding-top: 10px; color: #6B7280; font-size: 11px; }
  footer p { margin: 0 0 4px; }
  body.compact { margin: 14px; font-size: 12px; }
  body.compact .bar { margin: -14px -14px 16px; height: 4px; }
  body.compact h1 { font-size: 15px; }
  body.compact table { font-size: 11px; margin-top: 10px; }
  body.compact th, body.compact td { padding: 5px; }
  body.compact th { background: #DCFCE7; color: #166534; }
  body.compact .totals { width: 240px; font-size: 11px; }
  body.compact .totals .total { font-size: 13px; }
  body.minimal { margin: 24px; color: #111827; }
  body.minimal .bar { display: none; }
  body.minimal h1 { color: #111827; }
  body.minimal th { background: transparent; color: #111827; border-bottom: 2px solid #111827; }
  body.minimal td { border-bottom: 1px solid #D1D5DB; }
  body.minimal .totals .total { border-top: 2px solid #111827; color: #111827; }
  @media print {
    body { margin: 0; }
    body.compact { margin: 0; }
    ${template === 'compact' ? '@page { size: A5; margin: 8mm; }' : '@page { size: A4; margin: 12mm; }'}
  }
</style></head>
<body class="${escape(template)}">
  <div class="bar"></div>
  <header class="header">
    ${logo}
    <div>
      <h1>${escape(settings?.shopName || 'Mon Commerce')}</h1>
      <p class="muted" style="margin:0">Reçu de vente ${escape(sale.reference)} — ${escape(formatDate(sale.date))}</p>
      <p class="muted" style="margin:0">${escape(activity ? activity.name : '')} ${customer ? `— Client : ${escape(customer.name)}` : '— Client de passage'}</p>
      ${contactLines}
    </div>
  </header>
  <table>
    <thead><tr><th>Produit</th><th class="right">Qté</th><th class="right">Prix unitaire</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${sale.discount ? `<div><span>Remise</span><span>− ${escape(formatMoney(sale.discount))}</span></div>` : ''}
    ${sale.otherFees ? `<div><span>Frais</span><span>${escape(formatMoney(sale.otherFees))}</span></div>` : ''}
    ${returnsValue > 0 ? `<div><span>Retours</span><span>− ${escape(formatMoney(returnsValue))}</span></div>` : ''}
    <div class="total"><span>TOTAL</span><span>${escape(formatMoney(netTotal ?? 0))}</span></div>
    <div><span>Montant payé</span><span>${escape(formatMoney(paid))}</span></div>
    <div class="due"><span>Solde restant dû</span><span>${escape(formatMoney(balance ?? 0))}</span></div>
  </div>
  <footer>
    ${settings?.receiptFooter ? `<p>${escape(String(settings.receiptFooter))}</p>` : ''}
    <p>Mon Commerce — reçu généré depuis les opérations enregistrées. Données locales, non synchronisées.</p>
  </footer>
  <script>window.addEventListener('load', () => window.print());</script>
</body></html>`;

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return false;
  win.document.write(markup);
  win.document.close();
  return true;
}

/** Rapport PDF complet. */
export function buildReportPdf(report, { settings, activityName = '' } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const periodLabel =
    report.period && report.period.preset !== 'all'
      ? `Période : du ${formatDate(report.period.from)} au ${formatDate(report.period.to)}`
      : 'Période : tout l’historique';

  let y = docHeader(doc, {
    title: 'Rapport d’activité',
    settings,
    activityName,
    periodLabel,
    margin,
    pageWidth,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text('1. Synthèse financière', margin, y);
  y += 16;

  const kpiRows = [
    ['Chiffre d’affaires net', formatMoney(report.kpis.revenue)],
    ['Coût des produits vendus', formatMoney(report.kpis.costOfGoodsSold)],
    ['Marge brute', formatMoney(report.kpis.grossMargin)],
    ['Dépenses d’exploitation', formatMoney(report.kpis.operatingExpenses)],
    ['Résultat estimé', formatMoney(report.kpis.estimatedResult)],
    ['Valeur du stock', formatMoney(report.kpis.stockValue)],
    ['Trésorerie', formatMoney(report.kpis.treasury)],
    ['Créances clients', formatMoney(report.kpis.receivables)],
    ['Dettes fournisseurs', formatMoney(report.kpis.payables)],
  ];

  y = pdfTable(doc, {
    startY: y,
    columns: [
      { label: 'Indicateur', width: 0.6 },
      { label: 'Valeur', width: 0.4, align: 'right' },
    ],
    rows: kpiRows,
    margin,
    pageWidth,
  });

  const sections = [
    {
      title: '2. Ventes de la période',
      columns: [
        { label: 'Référence', width: 0.3 },
        { label: 'Date', width: 0.2 },
        { label: 'Client', width: 0.25 },
        { label: 'Total', width: 0.25, align: 'right' },
      ],
      rows: report.salesTable.map((row) => [row.reference, formatDate(row.date), row.customer, formatMoney(row.total)]),
    },
    {
      title: '3. Achats de la période',
      columns: [
        { label: 'Référence', width: 0.3 },
        { label: 'Date', width: 0.2 },
        { label: 'Fournisseur', width: 0.25 },
        { label: 'Total', width: 0.25, align: 'right' },
      ],
      rows: report.purchasesTable.map((row) => [row.reference, formatDate(row.date), row.supplier, formatMoney(row.total)]),
    },
    {
      title: '4. Produits les plus vendus',
      columns: [
        { label: 'Produit', width: 0.4 },
        { label: 'Quantité', width: 0.15, align: 'right' },
        { label: 'Chiffre d’affaires', width: 0.22, align: 'right' },
        { label: 'Marge', width: 0.23, align: 'right' },
      ],
      rows: report.topProducts.map((row) => [row.label, formatQuantity(row.quantity), formatMoney(row.revenue), formatMoney(row.margin)]),
    },
    {
      title: '5. Dépenses par catégorie',
      columns: [
        { label: 'Catégorie', width: 0.6 },
        { label: 'Montant', width: 0.4, align: 'right' },
      ],
      rows: report.expensesByCategory.map((row) => [row.category, formatMoney(row.amount)]),
    },
    {
      title: '6. Trésorerie par compte',
      columns: [
        { label: 'Compte', width: 0.45 },
        { label: 'Type', width: 0.25 },
        { label: 'Solde', width: 0.3, align: 'right' },
      ],
      rows: report.treasury.byAccount.map((row) => [row.account.name, row.account.type, formatMoney(row.balance)]),
    },
    {
      title: '7. Créances clients ouvertes',
      columns: [
        { label: 'Vente', width: 0.35 },
        { label: 'Date', width: 0.25 },
        { label: 'Solde dû', width: 0.2, align: 'right' },
        { label: 'Retard (jours)', width: 0.2, align: 'right' },
      ],
      rows: report.receivables.list.map((row) => [row.sale.reference, formatDate(row.sale.date), formatMoney(row.balance), String(row.overdueDays || 0)]),
    },
    {
      title: '8. Dettes fournisseurs ouvertes',
      columns: [
        { label: 'Achat', width: 0.35 },
        { label: 'Date', width: 0.25 },
        { label: 'Solde dû', width: 0.2, align: 'right' },
        { label: 'Retard (jours)', width: 0.2, align: 'right' },
      ],
      rows: report.payables.list.map((row) => [row.purchase.reference, formatDate(row.purchase.date), formatMoney(row.balance), String(row.overdueDays || 0)]),
    },
    {
      title: '9. Alertes de stock',
      columns: [
        { label: 'Produit', width: 0.5 },
        { label: 'Quantité', width: 0.17, align: 'right' },
        { label: 'Seuil', width: 0.16, align: 'right' },
        { label: 'État', width: 0.17 },
      ],
      rows: report.stock.alerts.map((row) => [row.name, formatQuantity(row.quantity), formatQuantity(row.threshold), row.severity]),
    },
  ];

  for (const section of sections) {
    if (section.rows.length === 0) continue;
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = margin + 10;
    }
    y += 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text(section.title, margin, y);
    y += 14;
    y = pdfTable(doc, { startY: y, columns: section.columns, rows: section.rows, margin, pageWidth });
  }

  doc.addPage();
  let assumptionsY = margin + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text('Hypothèses de calcul et limites', margin, assumptionsY);
  assumptionsY += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  for (const rule of FINANCE_RULES_TEXT) {
    const lines = doc.splitTextToSize(`• ${rule}`, pageWidth - margin * 2);
    doc.text(lines, margin, assumptionsY);
    assumptionsY += lines.length * 13 + 4;
  }
  assumptionsY += 8;
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text(
    doc.splitTextToSize(
      'Le résultat estimé est indicatif : il suppose que les ventes de la période sont encaissées et que les dépenses saisies sont complètes. Bénéfice, chiffre d’affaires, budget restant et trésorerie sont des indicateurs différents.',
      pageWidth - margin * 2,
    ),
    margin,
    assumptionsY,
  );

  const pageCount = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${page} / ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }

  const slug = report.period && report.period.preset !== 'all' ? `${report.period.from}_${report.period.to}` : 'historique';
  return { doc, filename: `mon-commerce-rapport-${slug}.pdf` };
}

export function downloadReportPdf(report, context) {
  const { doc, filename } = buildReportPdf(report, context);
  doc.save(filename);
  return filename;
}

export { formatPercent };
