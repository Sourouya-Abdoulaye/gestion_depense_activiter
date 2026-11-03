/* ---------------------------------------------------------------------------
 * Mon Commerce — assistant conversationnel local
 *
 * Transforme le contenu du guide en réponses courtes, cherchables et
 * contextualisées avec les chiffres réels de l'utilisateur. Aucune requête
 * réseau, aucun modèle externe : le moteur est déterministe et testable.
 *
 * Le service ne touche pas au DOM. L'interface fournit un contexte :
 *   { state, period, periodLabel, activityId, activity, now }
 * ------------------------------------------------------------------------- */

import { formatMoney } from '../shared/format.js';
import {
  activityBudget,
  computeKpis,
  payableList,
  receivableList,
} from './finance.js';
import {
  computeStockState,
  lowStockAlerts,
  stockValue as computeStockValue,
} from './stock.js';
import { periodLabel } from './reports.js';

/* ----------------------------- suggestions ------------------------------- */

export const QUICK_QUESTIONS = [
  'Comment démarrer ?',
  'Pourquoi CA et trésorerie diffèrent ?',
  'Où voir mes créances ?',
  'Comment sauvegarder ?',
  'Comment fonctionne le stock ?',
  'Mes données sont-elles privées ?',
];

const LINKS = {
  dashboard: { label: 'Tableau de bord', path: 'tableau-de-bord' },
  activities: { label: 'Activités & budgets', path: 'activites' },
  products: { label: 'Produits & stock', path: 'produits' },
  purchases: { label: 'Achats', path: 'achats' },
  stock: { label: 'Mouvements de stock', path: 'stock' },
  sales: { label: 'Ventes & caisse', path: 'ventes' },
  expenses: { label: 'Dépenses', path: 'depenses' },
  cash: { label: 'Trésorerie', path: 'tresorerie' },
  customers: { label: 'Clients & créances', path: 'clients' },
  suppliers: { label: 'Fournisseurs & dettes', path: 'fournisseurs' },
  employees: { label: 'Employés & paie', path: 'employes' },
  imports: { label: 'Import de relevés', path: 'imports' },
  reports: { label: 'Rapports', path: 'rapports' },
  profitability: { label: 'Rentabilité', path: 'rentabilite' },
  settings: { label: 'Paramètres & sauvegardes', path: 'parametres' },
  help: { label: 'Assistant & aide', path: 'aide' },
};

/* ------------------------------- contexte -------------------------------- */

function contextData(context = {}) {
  const state = context.state || {};
  const period = context.period || null;
  const activityId = context.activityId || '';
  const kpis = computeKpis(state, { activityId, period });
  return {
    state,
    period,
    activityId,
    kpis,
    periodLabel: context.periodLabel || periodLabel(period, null),
  };
}

/* ------------------------------ réponses --------------------------------- */

function welcome() {
  return {
    role: 'assistant',
    headline: 'Bonjour.',
    text: 'Posez votre question : je réponds avec les chiffres de la période affichée.',
  };
}

function answerStart() {
  return {
    headline: 'Démarrer en 4 étapes',
    text: 'Suivez cet ordre pour démarrer proprement.',
    bullets: [
      'Créer l’activité et saisir le capital de départ.',
      'Ajouter les produits avec prix d’achat, prix de vente et stock initial.',
      'Enregistrer les achats, puis les ventes.',
      'Exporter une sauvegarde JSON depuis les paramètres.',
    ],
    links: [LINKS.activities, LINKS.products, LINKS.sales],
  };
}

function answerCapabilities() {
  return {
    headline: 'Voici ce que je sais faire',
    text: 'Je réponds sur les ventes, achats, stock, dépenses, trésorerie, créances, dettes, sauvegardes et indicateurs. Posez votre question ou choisissez un sujet.',
    links: [LINKS.dashboard, LINKS.help],
  };
}

function answerRevenue(context) {
  const { kpis } = contextData(context);
  return {
    headline: `Chiffre d’affaires net : ${formatMoney(kpis.revenue)}`,
    text:
      kpis.salesCount > 0
        ? `${kpis.salesCount} vente(s) validée(s) sur la période.${kpis.returnsValue > 0 ? ` ${formatMoney(kpis.returnsValue)} de retours déduits.` : ''} La trésorerie peut être inférieure si des ventes sont à crédit.`
        : 'Aucune vente validée sur la période. La trésorerie peut déjà contenir des encaissements antérieurs.',
    links: [LINKS.sales, LINKS.reports],
  };
}

function answerMargin(context) {
  const { kpis } = contextData(context);
  return {
    headline: `Marge brute : ${formatMoney(kpis.grossMargin)}`,
    text: `Chiffre d’affaires net moins le coût des produits vendus (${formatMoney(kpis.costOfGoodsSold)}). Le coût est figé au moment de chaque vente.`,
    links: [LINKS.reports, LINKS.profitability],
  };
}

function answerResult(context) {
  const { kpis } = contextData(context);
  return {
    headline: `Résultat estimé : ${formatMoney(kpis.estimatedResult)}`,
    text: `Marge brute moins ${formatMoney(kpis.operatingExpenses)} de charges d’exploitation. C’est une estimation de pilotage, pas un bilan comptable.`,
    links: [LINKS.reports, LINKS.expenses],
  };
}

function answerCash(context) {
  const { kpis } = contextData(context);
  return {
    headline: `Trésorerie : ${formatMoney(kpis.treasury)}`,
    text: 'Solde réel des comptes actifs. Les ventes à crédit n’y entrent qu’au moment du paiement.',
    links: [LINKS.cash],
  };
}

function answerReceivables(context) {
  const { state, kpis, activityId } = contextData(context);
  const entries = receivableList({
    sales: state.sales || [],
    payments: state.payments || [],
    returns: state.returns || [],
    filters: { activityId },
    reference: context.now || new Date(),
  });
  const overdue = entries.filter((entry) => entry.overdueDays > 0).length;
  return {
    headline: `Créances clients : ${formatMoney(kpis.receivables)}`,
    text:
      entries.length === 0
        ? 'Aucune créance ouverte : toutes les ventes à crédit sont réglées.'
        : `${entries.length} créance(s) ouverte(s)${overdue > 0 ? `, dont ${overdue} en retard` : ''}. Une créance est due mais pas encore encaissée.`,
    links: [LINKS.customers, LINKS.sales],
  };
}

function answerPayables(context) {
  const { state, kpis, activityId } = contextData(context);
  const entries = payableList({
    purchases: state.purchases || [],
    payments: state.payments || [],
    returns: state.returns || [],
    filters: { activityId },
    reference: context.now || new Date(),
  });
  const overdue = entries.filter((entry) => entry.overdueDays > 0).length;
  return {
    headline: `Dettes fournisseurs : ${formatMoney(kpis.payables)}`,
    text:
      entries.length === 0
        ? 'Aucune dette ouverte : tous les achats sont réglés.'
        : `${entries.length} dette(s) ouverte(s)${overdue > 0 ? `, dont ${overdue} échue(s)` : ''}. Une dette est due mais pas encore payée.`,
    links: [LINKS.suppliers, LINKS.purchases],
  };
}

function answerBudget(context) {
  const { state } = contextData(context);
  const activity = context.activity || null;
  if (!activity) {
    return {
      text: 'Aucune activité sélectionnée. Créez une activité avec son capital de départ pour suivre un budget.',
      links: [LINKS.activities],
    };
  }
  const budget = activityBudget(activity, { cashMovements: state.cashMovements || [] });
  return {
    headline: `Budget restant : ${formatMoney(budget.remaining)}`,
    text: `Pour « ${activity.name} » : capital et apports (${formatMoney(budget.available)}) moins les sorties réelles (${formatMoney(budget.consumed)}). Le budget ne compte pas les encaissements de ventes.`,
    links: [LINKS.activities, LINKS.cash],
  };
}

function answerStock(context, question) {
  const { state, activityId } = contextData(context);
  const products = (state.products || []).filter((product) => !activityId || product.activityId === activityId);
  const movements = (state.stockMovements || []).filter((movement) => !activityId || movement.activityId === activityId);
  const stockState = computeStockState(movements, products);
  const value = computeStockValue(stockState);
  const alerts = lowStockAlerts(products, stockState, (state.settings && state.settings.defaultAlertThreshold) || 0);
  const alertText = alerts.length > 0 ? `${alerts.length} produit(s) sous le seuil d’alerte. ` : '';
  if (isHowTo(question)) {
    return {
      headline: 'Stock et coût moyen pondéré',
      text: `${alertText}Valeur actuelle : ${formatMoney(value)}. Les réceptions augmentent le stock, les ventes le diminuent ; il est valorisé au coût moyen pondéré, frais d’achat inclus.`,
      links: [LINKS.stock, LINKS.products],
    };
  }
  return {
    headline: `Valeur du stock : ${formatMoney(value)}`,
    text: `${alertText}Quantité disponible × coût moyen pondéré. Le stock restant est un actif, pas une charge de la période.`,
    links: [LINKS.products, LINKS.stock],
  };
}

function isHowTo(question) {
  const words = normalizeText(question).split(' ');
  return words.some((word) =>
    ['comment', 'faire', 'enregistrer', 'ajouter', 'creer', 'saisir', 'imprimer', 'modifier', 'supprimer', 'utiliser', 'gerer', 'fonctionne', 'fonctionnement', 'calculer', 'verifier', 'suivre', 'vendre', 'acheter', 'encaisser'].includes(word),
  );
}

function answerSales(context, question) {
  const { kpis } = contextData(context);
  if (isHowTo(question)) {
    return {
      headline: 'Comment enregistrer une vente',
      text: `Ouvrez Ventes & caisse, choisissez les produits, puis encaissez tout ou partie. Pour une vente à crédit, sélectionnez un client.${kpis.salesCount > 0 ? ` Sur la période : ${kpis.salesCount} vente(s), ${formatMoney(kpis.revenue)}.` : ''}`,
      links: [LINKS.sales, LINKS.products],
    };
  }
  if (kpis.salesCount === 0) {
    return {
      headline: 'Aucune vente sur la période',
      text: 'Pour vendre, ouvrez Ventes & caisse, choisissez les produits puis validez. Le stock, la trésorerie et les créances se mettent à jour automatiquement.',
      links: [LINKS.sales, LINKS.products],
    };
  }
  return {
    headline: `${kpis.salesCount} vente(s) : ${formatMoney(kpis.revenue)}`,
    text: `Panier moyen : ${formatMoney(kpis.averageBasket)}. Le stock, la trésorerie et les créances sont mis à jour à la validation.`,
    links: [LINKS.sales, LINKS.customers],
  };
}

function answerExpenses(context, question) {
  const { kpis } = contextData(context);
  if (isHowTo(question)) {
    return {
      headline: 'Ajouter une dépense',
      text: `Ouvrez Dépenses, choisissez la nature, saisissez le montant et le compte. Seules les charges d’exploitation réduisent le résultat.${kpis.operatingExpenses > 0 ? ` Sur la période : ${formatMoney(kpis.operatingExpenses)}.` : ''}`,
      links: [LINKS.expenses, LINKS.cash],
    };
  }
  return {
    headline: `Dépenses d’exploitation : ${formatMoney(kpis.operatingExpenses)}`,
    text: 'Seules les charges d’exploitation réduisent le résultat. L’approvisionnement, l’investissement et le retrait personnel sortent de la trésorerie sans réduire le résultat.',
    links: [LINKS.expenses, LINKS.cash],
  };
}

function answerDashboard(context) {
  const { kpis } = contextData(context);
  return {
    headline: 'Votre synthèse',
    bullets: [
      `Chiffre d’affaires : ${formatMoney(kpis.revenue)}`,
      `Marge brute : ${formatMoney(kpis.grossMargin)}`,
      `Résultat estimé : ${formatMoney(kpis.estimatedResult)}`,
      `Trésorerie : ${formatMoney(kpis.treasury)}`,
    ],
    text: 'Les détails et les alertes sont sur le tableau de bord.',
    links: [LINKS.dashboard, LINKS.reports],
  };
}

function answerCaVsCash() {
  return {
    headline: 'Vendre n’est pas encaisser',
    text: 'Une vente à crédit augmente le chiffre d’affaires immédiatement, mais pas la trésorerie. Exemple : 100 000 FCFA vendus, dont 40 000 à crédit → CA +100 000, trésorerie +60 000, créance 40 000.',
    links: [LINKS.sales, LINKS.customers, LINKS.cash],
  };
}

function answerActivity() {
  return {
    headline: 'À quoi sert une activité ?',
    text: 'Elle regroupe un commerce : nom, date de début, capital de départ et budget cible facultatif. Vous pouvez suivre plusieurs activités séparément.',
    links: [LINKS.activities, LINKS.cash],
  };
}

function answerProducts() {
  return {
    headline: 'Ajouter un produit',
    text: 'Renseignez nom, unité, prix d’achat, prix de vente et seuil d’alerte. Le stock initial se saisit comme mouvement d’ouverture.',
    links: [LINKS.products, LINKS.stock],
  };
}

function answerPurchases() {
  return {
    headline: 'Enregistrer un achat',
    text: 'Ajoutez les lignes, le transport et les autres frais. La réception alimente le stock ; les paiements fractionnés créent les dettes fournisseurs.',
    links: [LINKS.purchases, LINKS.suppliers],
  };
}

function answerCustomers() {
  return {
    headline: 'Clients & créances',
    text: 'Créez une fiche client, puis vendez à crédit en le sélectionnant. L’écran Clients permet de suivre et d’encaisser le restant dû.',
    links: [LINKS.customers, LINKS.sales],
  };
}

function answerSuppliers() {
  return {
    headline: 'Fournisseurs & dettes',
    text: 'Créez une fiche fournisseur, puis enregistrez un achat à crédit. L’écran Fournisseurs permet de suivre et de régler les dettes.',
    links: [LINKS.suppliers, LINKS.purchases],
  };
}

function answerStockMovements() {
  return {
    headline: 'Mouvements de stock',
    text: 'Cet écran historise toutes les entrées et sorties : achats, ventes, retours, pertes, casses et corrections. Le stock est recalculé à partir de ces mouvements.',
    links: [LINKS.stock, LINKS.products],
  };
}

function answerReports() {
  return {
    headline: 'Rapports et exports',
    text: 'Les Rapports réunissent la synthèse, les ventes, achats, dépenses, produits, trésorerie, créances et dettes. Vous pouvez exporter en CSV ou PDF.',
    links: [LINKS.reports, LINKS.dashboard],
  };
}

function answerProfitability() {
  return {
    headline: 'Assistant de rentabilité',
    text: 'Il simule une marge, un seuil de rentabilité ou un prix de vente conseillé. Les hypothèses restent affichées avec le résultat.',
    links: [LINKS.profitability, LINKS.reports],
  };
}

function answerEmployees() {
  return {
    headline: 'Employés & paie',
    text: 'Créez une fiche employé puis cliquez sur l’icône de paiement. Le salaire versé devient une dépense d’exploitation.',
    links: [LINKS.employees, LINKS.expenses],
  };
}

function answerImports() {
  return {
    headline: 'Importer un relevé',
    text: 'Importez un CSV exporté par votre banque ou votre opérateur mobile money. Les lignes déjà importées sont ignorées. Aucune connexion bancaire automatique.',
    links: [LINKS.imports, LINKS.cash],
  };
}

function answerBackup() {
  return {
    headline: 'Sauvegarder vos données',
    text: 'Vos données restent dans ce navigateur. Exportez régulièrement un fichier JSON depuis Paramètres & sauvegardes et conservez-le ailleurs.',
    links: [LINKS.settings],
  };
}

function answerPrivacy() {
  return {
    headline: 'Vos données restent locales',
    text: 'Aucun compte, aucun serveur, aucune synchronisation. Tout est stocké dans le navigateur de cet appareil.',
    links: [LINKS.settings],
  };
}

function answerOffline() {
  return {
    headline: 'Fonctionnement hors ligne',
    text: 'Après un premier chargement réussi, le navigateur garde l’application en cache. Un indicateur « Hors ligne » apparaît en haut.',
    links: [LINKS.settings],
  };
}

function answerDemo() {
  return {
    headline: 'Mode démonstration',
    text: 'Il utilise un jeu de données fictif dans une base séparée. Vos données réelles ne sont ni lues ni modifiées.',
    links: [LINKS.help],
  };
}

function answerFilters() {
  return {
    headline: 'Période et activité',
    text: 'La période et l’activité choisies s’appliquent aux écrans d’analyse et à l’assistant. « Tout l’historique » ignore les dates.',
    links: [LINKS.dashboard, LINKS.reports],
  };
}

function answerArchive() {
  return {
    headline: 'Archivage par exercice',
    text: 'L’archivage exporte une archive puis retire les opérations soldées antérieures à la date choisie. Les impayés et l’historique du stock sont conservés.',
    links: [LINKS.settings, LINKS.reports],
  };
}

function answerAccounting() {
  return {
    headline: 'Outil de pilotage, pas comptabilité certifiée',
    text: 'Les montants sont des estimations. Pour vos déclarations, transmettez vos exports à un comptable.',
    links: [LINKS.reports, LINKS.settings],
  };
}

function answerLock() {
  return {
    headline: 'Verrouillage par code PIN',
    text: 'Le code PIN verrouille l’accès à l’interface sur cet appareil. Il ne chiffre pas les données.',
    links: [LINKS.settings],
  };
}

function answerPassword() {
  return {
    headline: 'Code PIN ou mot de passe ?',
    text: 'Le code PIN verrouille l’application ; le mot de passe protège un fichier de sauvegarde. Un mot de passe perdu ne peut pas être récupéré.',
    links: [LINKS.settings, LINKS.help],
  };
}

function answerCancel() {
  return {
    headline: 'Annuler sans perdre l’historique',
    text: 'La vente annulée reste dans l’historique. Le stock est réintégré et l’argent encore détenu est remboursé.',
    links: [LINKS.sales, LINKS.stock],
  };
}

function answerContributions() {
  return {
    headline: 'Apports et retraits',
    text: 'Un apport augmente la trésorerie et le budget ; un retrait les diminue. Ni l’un ni l’autre ne modifie le résultat.',
    links: [LINKS.cash, LINKS.activities],
  };
}

function answerTransport() {
  return {
    headline: 'Pas de double comptage',
    text: 'Le transport et les frais d’achat sont inclus dans le coût des marchandises. Ils ne sont pas déduits une seconde fois.',
    links: [LINKS.purchases, LINKS.expenses],
  };
}

function answerCostFreeze() {
  return {
    headline: 'Le coût d’une vente reste figé',
    text: 'Le coût est figé à la validation pour ne pas modifier une marge déjà publiée. Un diagnostic dans Rapports montre l’écart sans changer les données.',
    links: [LINKS.reports],
  };
}

function answerSettings() {
  return {
    headline: 'Paramètres & sauvegardes',
    text: 'Vous y gérez le nom du commerce, les catégories, les moyens de paiement, les sauvegardes, le code PIN et l’archivage.',
    links: [LINKS.settings],
  };
}

function answerDashboardScreen() {
  return {
    headline: 'Tableau de bord',
    text: 'Il résume la période : chiffre d’affaires, marge, résultat, trésorerie, créances, dettes, stock et alertes.',
    links: [LINKS.dashboard, LINKS.reports],
  };
}

function answerThanks() {
  return {
    text: 'Avec plaisir. Si un chiffre vous étonne, demandez-moi son calcul.',
  };
}

function answerFarewell() {
  return { text: 'À bientôt. Pensez à exporter une sauvegarde après vos dernières saisies.' };
}

function fallback() {
  return {
    headline: 'Je n’ai pas trouvé cette information',
    text: 'Essayez avec un mot-clé comme « stock », « trésorerie » ou « sauvegarde », ou choisissez une question.',
    followUps: QUICK_QUESTIONS.slice(0, 4),
    isFallback: true,
  };
}

/* ------------------------------- moteur ---------------------------------- */

const STOPWORDS = new Set(
  `a au aux avec ce cet cette ces c d de des du elle en est et eu il ils je j la le les leur leurs lui ma mais me mes moins mon ne nos notre nous on ou par pas plus pour qu que qui quoi sa sans se ses si son sont sur ta te tes toi ton tres tu un une vos votre vous y ete etee etes etons etant suis es sommes etes sont serai seras sera serons serez seront avoir ai as avons avez ont aurai auras aura aurons aurez auront fait faire fais faisons faites font peux peut pouvons pouvez peuvent dois doit devons devez doivent`.split(
    /\s+/,
  ),
);

function normalizeText(value) {
  return String(value ?? '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function stem(word) {
  if (word.length <= 4) return word;
  return word
    .replace(/(aux|eaux)$/, '')
    .replace(/(ements|ement)$/, '')
    .replace(/(ations|ation)$/, '')
    .replace(/(er|ez|es|s|x|e)$/, '');
}

function tokenMatches(word, keyword) {
  if (word === keyword) return true;
  if (word.length < 4 || keyword.length < 4) return false;
  const left = stem(word);
  const right = stem(keyword);
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function prepareTopic(topic) {
  return {
    ...topic,
    phrases: (topic.phrases || []).map(normalizeText).filter(Boolean),
    keywords: (topic.keywords || []).map(normalizeText).filter(Boolean),
    titleWords: tokenize(topic.title || ''),
  };
}

const TOPICS = [
  {
    id: 'greeting',
    title: 'Bonjour',
    phrases: ['bonjour', 'salut', 'bonsoir', 'coucou', 'hello', 'hey'],
    answer: welcome,
  },
  {
    id: 'thanks',
    title: 'Merci',
    phrases: ['merci', 'merci beaucoup', 'super', 'parfait', 'c est clair', 'ok merci'],
    answer: answerThanks,
  },
  {
    id: 'farewell',
    title: 'Au revoir',
    phrases: ['au revoir', 'a bientot', 'bye', 'bonne journee'],
    answer: answerFarewell,
  },
  {
    id: 'capabilities',
    title: 'Que peux-tu faire',
    phrases: [
      'que peux tu faire',
      'que sais tu faire',
      'comment ca marche',
      'comment fonctionne l application',
      'a quoi sert mon commerce',
      'a quoi sert l application',
      'qui es tu',
      'tu es qui',
      'aide moi',
      'besoin d aide',
      'j ai besoin d aide',
    ],
    keywords: ['assistant', 'chatbot', 'capacites', 'fonctionnalites', 'sais', 'sers', 'sert'],
    answer: answerCapabilities,
  },
  {
    id: 'start',
    title: 'Comment démarrer',
    phrases: [
      'comment demarrer',
      'par ou commencer',
      'prise en main',
      'premier pas',
      'je debute',
      'comment utiliser l application',
      'comment utiliser mon commerce',
      'nouveau commerce',
      'commencer',
    ],
    keywords: ['demarrer', 'commencer', 'debut', 'debuter', 'premier', 'configurer', 'configuration', 'utiliser', 'decouvrir'],
    answer: answerStart,
  },
  {
    id: 'ca_vs_cash',
    title: 'Chiffre d’affaires et trésorerie',
    phrases: [
      'difference chiffre d affaires tresorerie',
      'chiffre d affaires et tresorerie',
      'ca et tresorerie',
      'pourquoi different',
      'pourquoi mon chiffre d affaires est different de ma tresorerie',
      'vendu pas encore encaisse',
      'vendre et encaisser',
    ],
    keywords: ['difference', 'different', 'ecart'],
    answer: answerCaVsCash,
  },
  {
    id: 'budget',
    title: 'Budget restant',
    phrases: [
      'budget restant',
      'mon budget',
      'budget de l activite',
      'budget et tresorerie',
      'difference budget tresorerie',
      'capital et apports',
    ],
    keywords: ['budget', 'budgets'],
    answer: answerBudget,
  },
  {
    id: 'revenue',
    title: 'Chiffre d’affaires',
    phrases: [
      'chiffre d affaires',
      'mon ca',
      'mon chiffre d affaires',
      'combien j ai vendu',
      'ventes de la periode',
      'revenu',
      'revenus',
    ],
    keywords: ['revenu', 'revenus', 'affaires'],
    answer: answerRevenue,
  },
  {
    id: 'margin',
    title: 'Marge brute',
    phrases: ['marge brute', 'ma marge', 'taux de marge', 'marge commerciale', 'combien je gagne sur une vente'],
    keywords: ['marge', 'marges'],
    answer: answerMargin,
  },
  {
    id: 'result',
    title: 'Résultat estimé',
    phrases: ['resultat estime', 'mon resultat', 'mon benefice', 'combien je gagne', 'resultat de la periode', 'benefice'],
    keywords: ['resultat', 'benefice', 'profit', 'gagner', 'gagne'],
    answer: answerResult,
  },
  {
    id: 'cash',
    title: 'Trésorerie',
    phrases: [
      'ma tresorerie',
      'combien j ai en caisse',
      'solde de caisse',
      'solde de tresorerie',
      'transfert entre comptes',
      'compte bancaire',
      'mobile money',
      'caisse et banque',
    ],
    keywords: ['tresorerie', 'caisse', 'banque', 'bancaire', 'mobile', 'compte', 'comptes', 'transfert', 'solde', 'especes'],
    answer: answerCash,
  },
  {
    id: 'receivables',
    title: 'Créances clients',
    phrases: [
      'mes creances',
      'argent a recevoir',
      'client doit',
      'clients doivent',
      'impaye',
      'impayes',
      'creance client',
      'creances clients',
      'en retard',
    ],
    keywords: ['creance', 'creances', 'recevoir', 'impaye', 'impayes', 'retard', 'relance', 'relancer', 'doit'],
    answer: answerReceivables,
  },
  {
    id: 'payables',
    title: 'Dettes fournisseurs',
    phrases: [
      'mes dettes',
      'dette fournisseur',
      'dettes fournisseurs',
      'argent a payer',
      'facture fournisseur',
      'echeance',
      'fournisseur a payer',
    ],
    keywords: ['dette', 'dettes', 'payer', 'paiement', 'echeance', 'facture', 'fournisseur', 'fournisseurs'],
    answer: answerPayables,
  },
  {
    id: 'customers',
    title: 'Clients',
    phrases: ['mes clients', 'liste des clients', 'ajouter un client', 'creer un client', 'fiche client', 'nouveau client'],
    keywords: ['client', 'clients', 'cliente', 'clientele'],
    answer: answerCustomers,
  },
  {
    id: 'suppliers',
    title: 'Fournisseurs',
    phrases: [
      'mes fournisseurs',
      'liste des fournisseurs',
      'ajouter un fournisseur',
      'creer un fournisseur',
      'fiche fournisseur',
      'nouveau fournisseur',
    ],
    keywords: ['fournisseur', 'fournisseurs'],
    answer: answerSuppliers,
  },
  {
    id: 'cancel',
    title: 'Annulation',
    phrases: ['annuler une vente', 'annulation de vente', 'supprimer une vente', 'corriger une vente', 'erreur de vente', 'annuler un achat', 'annulation'],
    keywords: ['annuler', 'annulation', 'supprimer', 'suppression', 'corriger', 'correction'],
    answer: answerCancel,
  },
  {
    id: 'sales',
    title: 'Ventes',
    phrases: [
      'comment vendre',
      'enregistrer une vente',
      'faire une vente',
      'nouvelle vente',
      'vente a credit',
      'vendre a credit',
      'imprimer un recu',
      'recu',
      'retour client',
      'remise',
      'mes ventes',
      'voir les ventes',
    ],
    keywords: ['vente', 'ventes', 'vendre', 'vendu', 'encaisser', 'encaissement', 'recu', 'credit', 'remise', 'retour'],
    answer: answerSales,
  },
  {
    id: 'purchases',
    title: 'Achats',
    phrases: [
      'comment acheter',
      'enregistrer un achat',
      'faire un achat',
      'nouvel achat',
      'commande fournisseur',
      'reception d achat',
      'transport achat',
      'frais d achat',
      'mes achats',
      'voir les achats',
    ],
    keywords: ['achat', 'achats', 'acheter', 'reception', 'receptionner', 'transport', 'approvisionnement', 'commande'],
    answer: answerPurchases,
  },
  {
    id: 'expenses',
    title: 'Dépenses',
    phrases: [
      'comment ajouter une depense',
      'saisir une depense',
      'mes depenses',
      'nature de depense',
      'natures de depense',
      'depense d exploitation',
      'charge d exploitation',
      'loyer',
      'publicite',
      'investissement',
      'retrait personnel',
    ],
    keywords: ['depense', 'depenses', 'charge', 'charges', 'loyer', 'salaire', 'salaires', 'energie', 'publicite', 'investissement', 'retrait'],
    answer: answerExpenses,
  },
  {
    id: 'employees',
    title: 'Employés et paie',
    phrases: ['mes employes', 'ajouter un employe', 'fiche employe', 'payer un salaire', 'salaire employe', 'paie', 'bulletin de paie', 'cotisations sociales'],
    keywords: ['employe', 'employes', 'salaire', 'salaires', 'paie', 'bulletin', 'cotisation', 'cotisations'],
    answer: answerEmployees,
  },
  {
    id: 'products',
    title: 'Produits',
    phrases: [
      'ajouter un produit',
      'creer un produit',
      'nouveau produit',
      'mes produits',
      'catalogue',
      'prix d achat et prix de vente',
      'seuil d alerte',
      'stock initial',
      'supprimer un produit',
      'modifier un produit',
    ],
    keywords: ['produit', 'produits', 'article', 'articles', 'catalogue', 'reference', 'seuil', 'alerte'],
    answer: answerProducts,
  },
  {
    id: 'stock',
    title: 'Stock et CMP',
    phrases: [
      'valeur du stock',
      'cout moyen pondere',
      'cmp',
      'stock restant',
      'quantite disponible',
      'mon stock',
      'etat du stock',
      'perte de stock',
      'casse',
      'inventaire',
      'valorisation du stock',
    ],
    keywords: ['stock', 'stocks', 'cmp', 'valorisation', 'valoriser', 'quantite', 'quantites', 'perte', 'pertes', 'casse', 'casses', 'inventaire', 'disponible', 'disponibilite'],
    answer: answerStock,
  },
  {
    id: 'stock_movements',
    title: 'Mouvements de stock',
    phrases: ['mouvement de stock', 'mouvements de stock', 'historique du stock', 'entrees et sorties', 'entree de stock', 'sortie de stock'],
    keywords: ['mouvement', 'mouvements', 'entree', 'entrees', 'sortie', 'sorties', 'historique'],
    answer: answerStockMovements,
  },
  {
    id: 'activity',
    title: 'Activité',
    phrases: ['creer une activite', 'ajouter une activite', 'nouvelle activite', 'mon activite', 'capital de depart', 'activite et budget', 'activites et budgets'],
    keywords: ['activite', 'activites', 'capital', 'commerce', 'boutique', 'business'],
    answer: answerActivity,
  },
  {
    id: 'dashboard',
    title: 'Tableau de bord',
    phrases: ['tableau de bord', 'ou est le tableau de bord', 'accueil de l application', 'vue d ensemble', 'synthese de la periode', 'indicateurs cles'],
    keywords: ['tableau', 'bord', 'dashboard', 'accueil', 'synthese', 'indicateur', 'indicateurs'],
    answer: answerDashboard,
  },
  {
    id: 'reports',
    title: 'Rapports',
    phrases: ['rapport', 'rapports', 'export csv', 'export pdf', 'imprimer un rapport', 'journal comptable', 'comparer les periodes', 'bilan de la periode'],
    keywords: ['rapport', 'rapports', 'export', 'exports', 'exporter', 'csv', 'pdf', 'imprimer', 'impression', 'journal'],
    answer: answerReports,
  },
  {
    id: 'profitability',
    title: 'Rentabilité',
    phrases: ['seuil de rentabilite', 'prix de vente conseille', 'assistant de rentabilite', 'simuler une marge', 'simulateur de rentabilite', 'rentabilite'],
    keywords: ['rentabilite', 'seuil', 'simulateur', 'simulation', 'conseille', 'conseiller'],
    answer: answerProfitability,
  },
  {
    id: 'imports',
    title: 'Import de relevés',
    phrases: ['importer un releve', 'import de releve', 'releve bancaire', 'releve mobile money', 'importer un csv', 'import csv', 'importer des operations'],
    keywords: ['import', 'imports', 'importer', 'releve', 'releves'],
    answer: answerImports,
  },
  {
    id: 'backup',
    title: 'Sauvegarde',
    phrases: [
      'comment sauvegarder',
      'sauvegarde',
      'sauvegarde json',
      'export json',
      'restaurer une sauvegarde',
      'restaurer',
      'perdre mes donnees',
      'mes donnees sont elles sauvegardees',
      'sauvegarde automatique',
      'backup',
    ],
    keywords: ['sauvegarde', 'sauvegardes', 'sauvegarder', 'backup', 'restaurer', 'restauration', 'json'],
    answer: answerBackup,
  },
  {
    id: 'privacy',
    title: 'Confidentialité',
    phrases: [
      'ou sont stockees mes donnees',
      'mes donnees sont elles en securite',
      'donnees confidentielles',
      'mes donnees restent elles sur l appareil',
      'pas de serveur',
      'cloud',
      'synchronisation',
    ],
    keywords: ['donnee', 'donnees', 'stockee', 'stockees', 'serveur', 'serveurs', 'confidentialite', 'prive', 'privee', 'cloud', 'synchronisation', 'local'],
    answer: answerPrivacy,
  },
  {
    id: 'offline',
    title: 'Hors ligne',
    phrases: ['hors ligne', 'sans internet', 'mode hors ligne', 'installer l application', 'installer sur telephone', 'pwa', 'service worker', 'pas de connexion'],
    keywords: ['internet', 'connexion', 'installer', 'installation', 'pwa', 'cache', 'worker'],
    answer: answerOffline,
  },
  {
    id: 'demo',
    title: 'Mode démonstration',
    phrases: ['mode demonstration', 'mode demo', 'donnees fictives', 'essayer sans risque', 'tester l application'],
    keywords: ['demo', 'demonstration', 'fictif', 'fictives', 'essayer', 'essai'],
    answer: answerDemo,
  },
  {
    id: 'filters',
    title: 'Filtres et période',
    phrases: ['changer la periode', 'changer d activite', 'filtre', 'filtres', 'tout l historique', 'periode affichee', 'filtrer les ventes', 'filtrer par date'],
    keywords: ['periode', 'periodes', 'filtre', 'filtres', 'filtrer', 'date', 'dates', 'historique', 'mois', 'annee', 'jour'],
    answer: answerFilters,
  },
  {
    id: 'archive',
    title: 'Archivage',
    phrases: ['archiver', 'archivage', 'archivage par exercice', 'cloture', 'purge', 'exercice precedent', 'anciennes operations', 'retirer les anciennes operations'],
    keywords: ['archivage', 'archiver', 'archive', 'archives', 'exercice', 'exercices', 'cloture', 'purge', 'ancien', 'anciennes'],
    answer: answerArchive,
  },
  {
    id: 'accounting',
    title: 'Comptabilité',
    phrases: ['comptabilite', 'outil comptable', 'tva', 'bilan comptable', 'amortissement', 'comptabilite certifiee', 'declaration fiscale', 'comptable'],
    keywords: ['comptabilite', 'comptable', 'tva', 'bilan', 'amortissement', 'amortissements', 'certifie', 'certifiee', 'declaration', 'declarations'],
    answer: answerAccounting,
  },
  {
    id: 'lock',
    title: 'Verrouillage',
    phrases: ['code pin', 'verrouiller l application', 'verrouillage', 'deverrouiller', 'securiser l application', 'code de securite'],
    keywords: ['pin', 'verrou', 'verrouillage', 'verrouiller', 'deverrouiller', 'code'],
    answer: answerLock,
  },
  {
    id: 'password',
    title: 'Mot de passe de sauvegarde',
    phrases: ['mot de passe', 'sauvegarde chiffree', 'chiffrer la sauvegarde', 'chiffrement', 'fichier protege', 'mot de passe perdu'],
    keywords: ['chiffrer', 'chiffrement', 'chiffree', 'crypte', 'crypter', 'protege'],
    answer: answerPassword,
  },
  {
    id: 'contributions',
    title: 'Apports et retraits',
    phrases: ['apport', 'apports', 'retrait personnel', 'retirer de l argent', 'capital est il un benefice', 'apport ou benefice', 'exploitant'],
    keywords: ['apport', 'apports', 'retrait', 'retraits', 'capital', 'exploitant'],
    answer: answerContributions,
  },
  {
    id: 'transport',
    title: 'Transport et frais d’achat',
    phrases: ['transport compte deux fois', 'frais d approvisionnement', 'transport achat', 'frais d achat', 'double comptage', 'compte deux fois'],
    keywords: ['transport', 'approvisionnement', 'double'],
    answer: answerTransport,
  },
  {
    id: 'cost_freeze',
    title: 'Coût figé',
    phrases: ['cout fige', 'ancienne vente', 'corriger un achat', 'recalculer le cout', 'cout de la vente ne change pas', 'prix d achat corrige'],
    keywords: ['fige', 'figee', 'ancienne', 'anciennes', 'recalcul'],
    answer: answerCostFreeze,
  },
  {
    id: 'settings',
    title: 'Paramètres',
    phrases: ['parametres', 'reglages', 'nom du commerce', 'categories', 'moyens de paiement', 'format de date', 'modifier le nom du commerce', 'configuration'],
    keywords: ['parametre', 'parametres', 'reglage', 'reglages', 'categories', 'moyens', 'format'],
    answer: answerSettings,
  },
  {
    id: 'dashboard_screen',
    title: 'Écran tableau de bord',
    phrases: ['a quoi sert le tableau de bord', 'ecran tableau de bord'],
    answer: answerDashboardScreen,
  },
];

const PREPARED_TOPICS = TOPICS.map(prepareTopic);

function scoreTopic(topic, question, words) {
  const padded = ` ${question} `;
  let score = 0;

  for (const phrase of topic.phrases) {
    if (padded.includes(` ${phrase} `)) score += 12 + phrase.split(' ').length * 2;
  }

  for (const keyword of topic.keywords) {
    if (keyword.includes(' ')) {
      if (padded.includes(` ${keyword} `)) score += 10 + keyword.split(' ').length * 2;
    } else if (words.some((word) => tokenMatches(word, keyword))) {
      score += 4;
    }
  }

  for (const word of topic.titleWords) {
    if (words.includes(word)) score += 1;
  }

  return score;
}

function runAnswer(topic, context, question) {
  const value = typeof topic.answer === 'function' ? topic.answer(context, question) : topic.answer;
  return { ...value, topic: topic.id };
}

/**
 * Répond à une question en français à partir du guide local et du contexte.
 * @param {string} question
 * @param {{state?: object, period?: object, periodLabel?: string, activityId?: string, activity?: object, now?: Date}} context
 * @returns {{headline?: string, text: string, bullets?: string[], links?: Array<{label:string,path:string}>, followUps?: string[], topic: string, isFallback?: boolean}}
 */
export function answerQuestion(question, context = {}) {
  const normalized = normalizeText(question);
  if (!normalized) return { ...fallback(), topic: 'fallback' };
  const words = tokenize(normalized);
  let best = null;

  for (const topic of PREPARED_TOPICS) {
    const score = scoreTopic(topic, normalized, words);
    if (score > 0 && (!best || score > best.score)) best = { topic, score };
  }

  if (!best || best.score < 4) return { ...fallback(), topic: 'fallback' };
  return runAnswer(best.topic, context, normalized);
}

/** Message d’accueil commun aux deux interfaces de chat. */
export function getWelcomeMessage() {
  return welcome();
}

