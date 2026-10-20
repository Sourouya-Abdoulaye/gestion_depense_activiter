/* ---------------------------------------------------------------------------
 * Mon Commerce — rapports (logique pure)
 *
 * Tous les chiffres d'un rapport sont recalculés à la demande depuis les
 * opérations sources : aucune statistique n'est stockée en dur. Le rapport
 * affiche toujours sa période, son activité et ses hypothèses.
 * ------------------------------------------------------------------------- */

import { FINANCE_RULES_TEXT } from '../config/constants.js';
import { eachDay, previousPeriod, toISODate } from '../shared/dates.js';
import { roundMoney } from '../shared/format.js';
import {
  activitySummary,
  cashInTotal,
  cashOutTotal,
  computeKpis,
  dailySeries,
  expensesByCategory,
  expensesByNature,
  filterRecords,
  isReceivedPurchase,
  isCancelled,
  monthlySeries,
  productMargins,
  purchaseTotal,
  receivableList,
  payableList,
  saleTotal,
  topProducts,
  totalPayables,
  totalReceivables,
  treasuryByAccount,
  treasuryBalance,
} from './finance.js';
import { computeStockState, lowStockAlerts, movementSummary, stockValue } from './stock.js';

/** Libellé lisible d'une période de rapport. */
export function periodLabel(period, formatDate) {
  if (!period) return 'Tout l’historique';
  if (period.preset === 'all') return 'Tout l’historique';
  if (period.from === period.to) return formatDate ? formatDate(period.from) : period.from;
  const from = formatDate ? formatDate(period.from) : period.from;
  const to = formatDate ? formatDate(period.to) : period.to;
  return `du ${from} au ${to}`;
}

/**
 * Comparaison de la période affichée avec la période précédente de même durée
 * (L11). Retourne null pour « tout l'historique ».
 */
export function comparePeriods(state, { activityId = '', period } = {}) {
  const previous = previousPeriod(period);
  if (!previous) return null;
  const current = computeKpis(state, { activityId, period });
  const before = computeKpis(state, { activityId, period: previous });
  const metrics = [
    { key: 'revenue', label: 'Chiffre d’affaires net' },
    { key: 'grossMargin', label: 'Marge brute' },
    { key: 'estimatedResult', label: 'Résultat estimé' },
    { key: 'operatingExpenses', label: 'Dépenses d’exploitation' },
    { key: 'cashIn', label: 'Encaissements' },
  ].map((metric) => {
    const currentValue = Number(current[metric.key] || 0);
    const previousValue = Number(before[metric.key] || 0);
    const delta = currentValue - previousValue;
    const percent = previousValue === 0 ? null : delta / Math.abs(previousValue);
    return { ...metric, current: currentValue, previous: previousValue, delta, percent };
  });
  return { previous, current, before, metrics };
}

/**
 * Construit un rapport complet.
 * @param {object} state données complètes
 * @param {{activityId?: string, period: {from:string,to:string,preset?:string}, limit?: number}} options
 */
export function buildReport(state, { activityId = '', period, limit = 20 } = {}) {
  const filters = { activityId, from: period?.from, to: period?.to };
  const activity = (state.activities || []).find((entry) => entry.id === activityId) || null;
  const stockState = computeStockState(state.stockMovements || [], state.products || []);

  const sales = filterRecords(state.sales || [], filters).filter((sale) => sale.status === 'validated' && !isCancelled(sale));
  const purchases = filterRecords(state.purchases || [], filters).filter(isReceivedPurchase);

  const treasuryEntries = treasuryByAccount({ cashAccounts: state.cashAccounts, cashMovements: state.cashMovements });
  const treasuryTotal = activityId
    ? roundMoney(
        treasuryBalance({
          cashAccounts: state.cashAccounts,
          cashMovements: (state.cashMovements || []).filter((movement) => movement.activityId === activityId),
        }),
      )
    : treasuryBalance({ cashAccounts: state.cashAccounts, cashMovements: state.cashMovements });

  return {
    generatedAt: new Date().toISOString(),
    period: period || null,
    activity,
    filters,
    kpis: computeKpis(state, { activityId, period }),
    summary: activitySummary({
      sales: state.sales,
      returns: state.returns,
      purchases: state.purchases,
      expenses: state.expenses,
      filters,
    }),
    series: {
      monthly: monthlySeries({ sales: state.sales, returns: state.returns, expenses: state.expenses, filters }),
      daily:
        period && period.preset && period.preset !== 'all'
          ? dailySeries({
              sales: state.sales,
              returns: state.returns,
              expenses: state.expenses,
              filters,
              days: eachDay(period.from, period.to, 400),
            })
          : [],
    },
    salesTable: sales
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((sale) => ({
        id: sale.id,
        reference: sale.reference,
        date: sale.date,
        customer: (state.customers || []).find((customer) => customer.id === sale.customerId)?.name || '',
        total: saleTotal(sale),
        status: sale.status,
      })),
    purchasesTable: purchases
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((purchase) => ({
        id: purchase.id,
        reference: purchase.reference,
        date: purchase.date,
        supplier: (state.suppliers || []).find((supplier) => supplier.id === purchase.supplierId)?.name || '',
        total: purchaseTotal(purchase),
        status: purchase.status,
      })),
    topProducts: topProducts({
      sales: state.sales,
      returns: state.returns,
      products: state.products,
      filters,
      limit,
    }),
    productMargins: productMargins({ sales: state.sales, returns: state.returns, products: state.products, filters }).slice(0, limit),
    expensesByCategory: expensesByCategory({ expenses: state.expenses, filters }),
    expensesByNature: expensesByNature({ expenses: state.expenses, filters }),
    stock: {
      value: stockValue(stockState),
      alerts: lowStockAlerts(state.products || [], stockState, state.settings?.defaultAlertThreshold || 0),
      movements: movementSummary(state.stockMovements || [], filters),
      productCount: (state.products || []).length,
    },
    treasury: {
      total: treasuryTotal,
      byAccount: treasuryEntries,
      cashIn: cashInTotal({ cashMovements: state.cashMovements, filters }),
      cashOut: cashOutTotal({ cashMovements: state.cashMovements, filters }),
    },
    receivables: {
      total: totalReceivables({ sales: state.sales, payments: state.payments, returns: state.returns, filters: { activityId } }),
      list: receivableList({ sales: state.sales, payments: state.payments, returns: state.returns, filters: { activityId } }),
    },
    payables: {
      total: totalPayables({ purchases: state.purchases, payments: state.payments, returns: state.returns, filters: { activityId } }),
      list: payableList({ purchases: state.purchases, payments: state.payments, returns: state.returns, filters: { activityId } }),
    },
    assumptions: FINANCE_RULES_TEXT,
  };
}

/**
 * Convertit un rapport en sections tabulaires, prêtes pour l'export CSV ou PDF.
 * @returns {Array<{title: string, columns: string[], rows: Array<Array<string|number>>}>}
 */
export function reportToSections(report, { formatDate, formatMoney, formatQuantity, methodLabels = {} } = {}) {
  const money = formatMoney || ((value) => String(value));
  const date = formatDate || ((value) => String(value));
  const quantity = formatQuantity || ((value) => String(value));
  const sections = [];

  sections.push({
    title: 'Synthèse financière',
    columns: ['Indicateur', 'Valeur'],
    rows: [
      ['Chiffre d’affaires net', money(report.kpis.revenue)],
      ['Chiffre d’affaires brut', money(report.kpis.grossRevenue)],
      ['Retours clients', money(report.kpis.returnsValue)],
      ['Coût des produits vendus', money(report.kpis.costOfGoodsSold)],
      ['Marge brute', money(report.kpis.grossMargin)],
      ['Dépenses d’exploitation', money(report.kpis.operatingExpenses)],
      ['Résultat estimé', money(report.kpis.estimatedResult)],
      ['Valeur du stock', money(report.kpis.stockValue)],
      ['Trésorerie', money(report.kpis.treasury)],
      ['Créances clients', money(report.kpis.receivables)],
      ['Dettes fournisseurs', money(report.kpis.payables)],
      ['Nombre de ventes', String(report.kpis.salesCount)],
      ['Panier moyen', money(report.kpis.averageBasket)],
    ],
  });

  sections.push({
    title: 'Ventes de la période',
    columns: ['Référence', 'Date', 'Client', 'Total'],
    rows: report.salesTable.map((row) => [row.reference, date(row.date), row.customer, money(row.total)]),
  });

  sections.push({
    title: 'Achats de la période',
    columns: ['Référence', 'Date', 'Fournisseur', 'Total'],
    rows: report.purchasesTable.map((row) => [row.reference, date(row.date), row.supplier, money(row.total)]),
  });

  sections.push({
    title: 'Produits les plus vendus',
    columns: ['Produit', 'Quantité', 'Chiffre d’affaires', 'Marge'],
    rows: report.topProducts.map((row) => [row.label, quantity(row.quantity), money(row.revenue), money(row.margin)]),
  });

  sections.push({
    title: 'Dépenses par catégorie',
    columns: ['Catégorie', 'Montant'],
    rows: report.expensesByCategory.map((row) => [row.category, money(row.amount)]),
  });

  sections.push({
    title: 'Dépenses par nature',
    columns: ['Nature', 'Montant'],
    rows: Object.entries(report.expensesByNature).map(([nature, amount]) => [nature, money(amount)]),
  });

  sections.push({
    title: 'Trésorerie par compte',
    columns: ['Compte', 'Type', 'Solde'],
    rows: report.treasury.byAccount.map((row) => [row.account.name, row.account.type, money(row.balance)]),
  });

  sections.push({
    title: 'Créances clients ouvertes',
    columns: ['Client', 'Vente', 'Date', 'Solde'],
    rows: report.receivables.list.map((row) => [
      (row.sale.customerId && row.sale.reference) || row.sale.reference,
      row.sale.reference,
      date(row.sale.date),
      money(row.balance),
    ]),
  });

  sections.push({
    title: 'Dettes fournisseurs ouvertes',
    columns: ['Fournisseur', 'Achat', 'Date', 'Solde'],
    rows: report.payables.list.map((row) => [row.purchase.supplierId || '', row.purchase.reference, date(row.purchase.date), money(row.balance)]),
  });

  sections.push({
    title: 'Alertes de stock',
    columns: ['Produit', 'Quantité', 'Seuil', 'État'],
    rows: report.stock.alerts.map((row) => [row.name, quantity(row.quantity), quantity(row.threshold), row.severity]),
  });

  return sections;
}

/** Lignes plates pour un export CSV unique (une ligne par valeur). */
export function reportToFlatRows(report) {
  return [
    { section: 'Période', indicateur: 'Du', valeur: report.period ? report.period.from : '' },
    { section: 'Période', indicateur: 'Au', valeur: report.period ? report.period.to : '' },
    { section: 'Activité', indicateur: 'Nom', valeur: report.activity ? report.activity.name : 'Toutes les activités' },
    { section: 'Résultat', indicateur: 'Chiffre d’affaires net', valeur: report.kpis.revenue },
    { section: 'Résultat', indicateur: 'Coût des produits vendus', valeur: report.kpis.costOfGoodsSold },
    { section: 'Résultat', indicateur: 'Marge brute', valeur: report.kpis.grossMargin },
    { section: 'Résultat', indicateur: 'Dépenses d’exploitation', valeur: report.kpis.operatingExpenses },
    { section: 'Résultat', indicateur: 'Résultat estimé', valeur: report.kpis.estimatedResult },
    { section: 'Trésorerie', indicateur: 'Solde total', valeur: report.kpis.treasury },
    { section: 'Trésorerie', indicateur: 'Entrées', valeur: report.treasury.cashIn },
    { section: 'Trésorerie', indicateur: 'Sorties', valeur: report.treasury.cashOut },
    { section: 'Créances/Dettes', indicateur: 'Créances clients', valeur: report.kpis.receivables },
    { section: 'Créances/Dettes', indicateur: 'Dettes fournisseurs', valeur: report.kpis.payables },
    { section: 'Stock', indicateur: 'Valeur du stock', valeur: report.kpis.stockValue },
  ];
}

export { toISODate };
