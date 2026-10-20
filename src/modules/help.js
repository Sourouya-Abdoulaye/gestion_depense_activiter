/* ---------------------------------------------------------------------------
 * Mon Commerce — écran « Guide & aide »
 *
 * Explication complète de l'application : à quoi sert chaque écran, comment
 * lire le chiffre d'affaires, la marge, le résultat, la trésorerie et le
 * budget, avec les chiffres réels de l'utilisateur et un exemple chiffré.
 * Le contenu est pédagogique : il n'enregistre aucune donnée.
 * ------------------------------------------------------------------------- */

import { APP_VERSION, ACCOUNTING_DISCLAIMER, EXPENSE_NATURES, FINANCE_RULES_TEXT } from '../config/constants.js';
import { html, element, raw } from '../shared/dom.js';
import { formatMoney } from '../shared/format.js';
import { formatDate } from '../shared/dates.js';
import { getPeriod, getViewState } from '../shared/view-state.js';
import { createPage } from '../shared/screen.js';
import { button, confirmDialog, kpiCard, noticePanel, pageHeader, sectionCard } from '../shared/ui.js';
import { icon } from '../shared/icons.js';
import { startTour } from '../shared/tour.js';
import { enterDemoMode, exitDemoMode, isDemoMode, resetDemoMode } from '../services/demo.js';
import { currentActivity, getState } from '../services/state.js';
import { activityBudget, computeKpis, payableList, receivableList } from '../services/finance.js';
import { periodLabel } from '../services/reports.js';

export const meta = { path: 'aide', title: 'Guide & aide' };

/* ------------------------------- composants ------------------------------ */

function jumpButton(label, targetId) {
  const node = button({ label, iconName: 'arrowRight' });
  node.addEventListener('click', () => {
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return node;
}

function helpSection(id, { title, description = '', content }) {
  const node = sectionCard({ title, description, content });
  node.id = id;
  node.classList.add('scroll-mt-24');
  return node;
}

function detailsBlock({ title, body, iconName = '' }) {
  return html`
    <details class="group rounded-xl border border-line bg-white">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span class="flex min-w-0 items-center gap-2 text-sm font-semibold text-brand-dark">
          ${iconName ? raw(icon(iconName, { size: 16, className: 'shrink-0' })) : ''}
          <span class="min-w-0">${title}</span>
        </span>
        <span class="shrink-0 text-muted transition-transform group-open:rotate-180">${raw(icon('chevronDown', { size: 16 }))}</span>
      </summary>
      <div class="border-t border-line px-4 py-3 text-sm text-ink">${body}</div>
    </details>
  `;
}

function bullets(items = [], className = 'list-disc space-y-1 pl-5') {
  return html`<ul class="${className} text-sm text-ink">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

function formulaLine(label, formula, detail = '') {
  return html`
    <div class="rounded-xl border border-line bg-canvas/50 p-3">
      <p class="text-sm font-semibold text-brand-dark">${label}</p>
      <p class="mt-1 font-mono text-xs text-ink">${formula}</p>
      ${detail ? html`<p class="mt-1 text-xs text-muted">${detail}</p>` : ''}
    </div>
  `;
}

/* --------------------------- chiffres de l'utilisateur ------------------- */

function buildLiveKpis(state, ctx) {
  const view = getViewState();
  const period = getPeriod();
  const activity = view.activityId
    ? state.activities.find((entry) => entry.id === view.activityId) || null
    : currentActivity();

  const kpis = computeKpis(state, { activityId: view.activityId, period });
  const budget = activity ? activityBudget(activity, { cashMovements: state.cashMovements }) : null;
  const overdueReceivables = receivableList({
    sales: state.sales,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: view.activityId },
  }).filter((entry) => entry.overdueDays > 0).length;
  const overduePayables = payableList({
    purchases: state.purchases,
    payments: state.payments,
    returns: state.returns,
    filters: { activityId: view.activityId },
  }).filter((entry) => entry.overdueDays > 0).length;

  const cards = [
    {
      label: 'Chiffre d’affaires net',
      value: formatMoney(kpis.revenue),
      hint: `${kpis.salesCount} vente(s) validée(s), nettes de ${formatMoney(kpis.returnsValue)} de retours`,
      tone: 'neutral',
      iconName: 'receipt',
    },
    {
      label: 'Encaissements',
      value: formatMoney(kpis.cashIn),
      hint: 'Argent réellement reçu sur la période (hors apports)',
      tone: 'positive',
      iconName: 'wallet',
    },
    {
      label: 'Marge brute',
      value: formatMoney(kpis.grossMargin),
      hint: `Après ${formatMoney(kpis.costOfGoodsSold)} de coût des produits vendus`,
      tone: kpis.grossMargin >= 0 ? 'positive' : 'negative',
      iconName: 'chart',
    },
    {
      label: 'Résultat estimé',
      value: formatMoney(kpis.estimatedResult),
      hint: `Après ${formatMoney(kpis.operatingExpenses)} de dépenses d’exploitation`,
      tone: kpis.estimatedResult >= 0 ? 'positive' : 'negative',
      iconName: 'banknote',
    },
    {
      label: 'Trésorerie',
      value: formatMoney(kpis.treasury),
      hint: 'Solde de tous les comptes actifs (indépendant de la période)',
      tone: 'neutral',
      iconName: 'banknote',
    },
    {
      label: 'Créances clients',
      value: formatMoney(kpis.receivables),
      hint: overdueReceivables > 0 ? `${overdueReceivables} créance(s) en retard` : 'Montants restant à recevoir',
      tone: kpis.receivables > 0 ? 'warning' : 'neutral',
      hintTone: overdueReceivables > 0 ? 'danger' : '',
      iconName: 'users',
    },
    {
      label: 'Dettes fournisseurs',
      value: formatMoney(kpis.payables),
      hint: overduePayables > 0 ? `${overduePayables} dette(s) échue(s)` : 'Montants restant à payer',
      tone: kpis.payables > 0 ? 'warning' : 'neutral',
      hintTone: overduePayables > 0 ? 'danger' : '',
      iconName: 'truck',
    },
    {
      label: budget ? 'Budget restant' : 'Valeur du stock',
      value: budget ? formatMoney(budget.remaining) : formatMoney(kpis.stockValue),
      hint: budget
        ? `Capital + apports ${formatMoney(budget.available)} − consommé ${formatMoney(budget.consumed)}`
        : 'Quantité disponible × coût moyen pondéré',
      tone: budget ? (budget.remaining >= 0 ? 'positive' : 'negative') : 'neutral',
      iconName: budget ? 'activity' : 'box',
    },
  ];

  const header = element(html`
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-brand">${activity ? activity.name : 'Toutes les activités'}</span>
        <span class="badge badge-neutral">${periodLabel(period, (value) => formatDate(value))}</span>
        <span class="text-xs text-muted">Recalculé à l’instant à partir de vos opérations.</span>
      </div>
      ${state.activities.length === 0
        ? noticePanel({
            tone: 'warning',
            title: 'Aucune activité enregistrée',
            message: 'Les chiffres ci-dessous restent à zéro tant que vous n’avez pas créé une activité et saisi des opérations. Le guide reste utilisable pour comprendre le fonctionnement.',
          })
        : ''}
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${raw(cards.map((card) => kpiCard(card).outerHTML).join(''))}
      </div>
    </div>
  `);

  const actions = element('<div class="no-print mt-3 flex flex-wrap gap-2"></div>');
  actions.append(
    button({ label: 'Voir le tableau de bord', iconName: 'dashboard', variant: 'primary', onClick: () => ctx.navigate('tableau-de-bord') }),
    button({ label: 'Voir les rapports', iconName: 'chart', onClick: () => ctx.navigate('rapports') }),
  );
  header.append(actions);

  return header;
}

/* ------------------------------- contenu -------------------------------- */

function buildOverview() {
  const cards = [
    { iconName: 'cart', title: 'Acheter', text: 'Enregistrez les achats fournisseurs : le stock, le coût moyen pondéré et les dettes se mettent à jour.' },
    { iconName: 'receipt', title: 'Vendre', text: 'Encaissez au comptant ou à crédit, imprimez un reçu, gérez les retours et les annulations sans perdre l’historique.' },
    { iconName: 'wallet', title: 'Suivre l’argent', text: 'Caisse, banque et mobile money : chaque entrée et sortie réelle est tracée, transferts internes compris.' },
    { iconName: 'chart', title: 'Comprendre', text: 'Chiffre d’affaires, marge, résultat, trésorerie et budget sont recalculés en continu et expliqués ici.' },
  ];

  return element(html`
    <div class="space-y-4">
      <p class="text-sm text-ink">
        <strong>Mon Commerce</strong> réunit dans une seule application la gestion d’un petit commerce :
        les produits, les achats, les ventes, le stock, les dépenses, la trésorerie, les clients et les
        fournisseurs. Tout est calculé à partir de vos opérations réelles : aucune statistique n’est
        inventée ni saisie à la main.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        ${cards.map(
          (card) => html`
            <div class="rounded-xl border border-line bg-canvas/40 p-3">
              <p class="flex items-center gap-2 text-sm font-semibold text-brand-dark">
                ${raw(icon(card.iconName, { size: 16 }))} ${card.title}
              </p>
              <p class="mt-1 text-xs text-muted">${card.text}</p>
            </div>
          `,
        )}
      </div>
      <div class="rounded-xl border border-brand/30 bg-brand-light/60 px-4 py-3 text-sm text-ink">
        <p class="font-semibold">Vos données restent sur cet appareil</p>
        <p class="mt-1 text-xs text-muted">
          Aucun compte, aucun serveur, aucune synchronisation. Les données sont stockées dans le navigateur.
          Exportez régulièrement une sauvegarde JSON depuis « Paramètres & sauvegardes ».
        </p>
      </div>
    </div>
  `);
}

function buildRevenueExplainer() {
  return element(html`
    <div class="space-y-4">
      <p class="text-sm text-ink">
        Le <strong>chiffre d’affaires</strong> mesure ce que vous avez <em>vendu</em>, pas ce que vous avez
        <em>encaissé</em>. Une vente à crédit augmente le chiffre d’affaires immédiatement, mais reste une
        créance tant que le client n’a pas payé.
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        ${formulaLine(
          'Chiffre d’affaires brut',
          'Σ (quantité × prix de vente) + frais − remises',
          'Uniquement les ventes validées. Les brouillons et les ventes annulées sont exclus.',
        )}
        ${formulaLine(
          'Chiffre d’affaires net',
          'CA brut − retours clients',
          'C’est le montant affiché dans les indicateurs « Chiffre d’affaires ».',
        )}
        ${formulaLine(
          'Marge brute',
          'CA net − coût des produits vendus',
          'Le coût est figé au moment de la vente (coût moyen pondéré des achats, frais inclus).',
        )}
        ${formulaLine(
          'Résultat estimé',
          'Marge brute − dépenses d’exploitation',
          'Loyer, salaire, énergie, publicité… Les investissements et retraits personnels ne sont pas des charges.',
        )}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-brand/30 bg-brand-light/50 p-3">
          <p class="text-sm font-semibold text-brand-dark">Ce qui compte dans le chiffre d’affaires</p>
          ${bullets([
            'Les ventes validées, au prix réel de la ligne.',
            'Les frais supplémentaires facturés au client.',
            'Les remises et les retours sont déduits.',
          ], 'mt-2 list-disc space-y-1 pl-5 text-xs text-ink')}
        </div>
        <div class="rounded-xl border border-warning/30 bg-amber-50 p-3">
          <p class="text-sm font-semibold text-warning">Ce qui ne compte pas</p>
          ${bullets([
            'Les encaissements partiels d’une vente à crédit.',
            'Les apports de capital et les emprunts.',
            'Les ventes annulées ou encore en brouillon.',
            'Le stock restant (il est un actif, pas une vente).',
          ], 'mt-2 list-disc space-y-1 pl-5 text-xs text-ink')}
        </div>
      </div>

      <div class="rounded-xl border border-line bg-canvas/50 p-3">
        <p class="text-sm font-semibold text-brand-dark">Pourquoi le chiffre d’affaires et la trésorerie diffèrent</p>
        <p class="mt-1 text-xs text-ink">
          Exemple : vous vendez 100 000 FCFA de marchandises dont 40 000 FCFA à crédit. Le chiffre
          d’affaires augmente de 100 000 FCFA, mais la trésorerie n’augmente que de 60 000 FCFA. Les
          40 000 FCFA restants apparaissent dans les <strong>créances clients</strong> jusqu’au paiement.
        </p>
      </div>
    </div>
  `);
}

function buildIndicatorGuide() {
  const entries = [
    {
      label: 'Chiffre d’affaires',
      formula: 'Ventes validées − remises − retours',
      where: 'Tableau de bord, Ventes, Rapports',
      note: 'Mesure l’activité commerciale sur la période sélectionnée.',
    },
    {
      label: 'Encaissements',
      formula: 'Paiements réellement reçus',
      where: 'Tableau de bord, Ventes, Trésorerie',
      note: 'Ne compte ni les créances, ni les apports de capital.',
    },
    {
      label: 'Coût des produits vendus',
      formula: 'Quantité vendue × coût moyen pondéré',
      where: 'Tableau de bord, Rapports, Rentabilité',
      note: 'Coût figé au moment de chaque vente, frais d’achat inclus.',
    },
    {
      label: 'Marge brute',
      formula: 'Chiffre d’affaires − coût des produits vendus',
      where: 'Tableau de bord, Rapports, Rentabilité',
      note: 'Marge commerciale avant les charges de fonctionnement.',
    },
    {
      label: 'Résultat estimé',
      formula: 'Marge brute − dépenses d’exploitation',
      where: 'Tableau de bord, Rapports',
      note: 'Estimation : ne remplace pas un bilan comptable.',
    },
    {
      label: 'Trésorerie',
      formula: 'Solde initial + entrées réelles − sorties réelles',
      where: 'Trésorerie, Tableau de bord',
      note: 'Les transferts entre comptes ne changent pas le total.',
    },
    {
      label: 'Budget restant',
      formula: 'Capital de départ + apports − argent réellement sorti',
      where: 'Activités & budgets',
      note: 'Indicateur de budget : il ignore les encaissements de ventes.',
    },
    {
      label: 'Créance / dette',
      formula: 'Dû − paiements − retours',
      where: 'Clients & créances, Fournisseurs & dettes',
      note: 'Une créance est de l’argent à recevoir ; une dette, à payer.',
    },
    {
      label: 'Valeur du stock',
      formula: 'Quantité disponible × coût moyen pondéré',
      where: 'Produits & stock, Rapports',
      note: 'Le stock restant n’est pas une charge de la période.',
    },
    {
      label: 'Seuil de rentabilité',
      formula: 'Charges fixes ÷ marge unitaire',
      where: 'Assistant de rentabilité',
      note: 'Nombre d’unités à vendre pour couvrir les charges fixes.',
    },
  ];

  return element(html`
    <div class="grid gap-3 sm:grid-cols-2">
      ${entries.map(
        (entry) => html`
          <div class="rounded-xl border border-line bg-white p-3">
            <p class="text-sm font-semibold text-brand-dark">${entry.label}</p>
            <p class="mt-1 font-mono text-xs text-ink">${entry.formula}</p>
            <p class="mt-1 text-xs text-muted">${entry.note}</p>
            <p class="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-brand">Où le voir : ${entry.where}</p>
          </div>
        `,
      )}
    </div>
  `);
}

function buildSteps(ctx) {
  const steps = [
    {
      title: 'Créer une activité et son capital',
      text: 'Une activité regroupe un commerce : nom, date de début, capital de départ et budget cible facultatif. Le capital est ajouté à la trésorerie du compte choisi.',
      path: 'activites',
      label: 'Activités & budgets',
    },
    {
      title: 'Créer un compte de trésorerie',
      text: 'Caisse, banque ou mobile money. Indiquez le solde déjà présent avant d’utiliser l’application. Les comptes inactifs sont exclus du total.',
      path: 'tresorerie',
      label: 'Trésorerie',
    },
    {
      title: 'Ajouter les produits',
      text: 'Nom, unité, prix d’achat, prix de vente et seuil d’alerte. Le stock initial peut être saisi comme un mouvement d’ouverture.',
      path: 'produits',
      label: 'Produits & stock',
    },
    {
      title: 'Enregistrer les achats',
      text: 'Ajoutez les lignes, le transport et les autres frais : ils sont répartis au prorata dans le coût d’acquisition. La réception alimente le stock.',
      path: 'achats',
      label: 'Achats',
    },
    {
      title: 'Enregistrer les ventes',
      text: 'Choisissez les produits, encaissez tout ou partie, ou laissez à crédit en sélectionnant un client. Le stock et les marges se calculent automatiquement.',
      path: 'ventes',
      label: 'Ventes & caisse',
    },
    {
      title: 'Saisir les dépenses',
      text: 'Précisez la nature : exploitation (déduite du résultat), approvisionnement, investissement ou retrait personnel (trésorerie seulement).',
      path: 'depenses',
      label: 'Dépenses',
    },
    {
      title: 'Suivre et exporter',
      text: 'Consultez les rapports, la rentabilité et le tableau de bord, puis exportez une sauvegarde JSON et vos CSV/PDF.',
      path: 'rapports',
      label: 'Rapports',
    },
  ];

  const container = element('<div class="space-y-3"></div>');
  steps.forEach((step, index) => {
    const card = element(html`
      <div class="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">${index + 1}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-brand-dark">${step.title}</p>
          <p class="mt-0.5 text-xs text-muted">${step.text}</p>
          <div class="mt-2"></div>
        </div>
      </div>
    `);
    card.querySelector('.mt-2').append(
      button({ label: step.label, iconName: 'arrowRight', onClick: () => ctx.navigate(step.path) }),
    );
    container.append(card);
  });

  return container;
}

function buildScreens() {
  const screens = [
    {
      iconName: 'dashboard',
      title: 'Tableau de bord',
      text: 'Synthèse de la période : chiffre d’affaires, marge, résultat, trésorerie, créances, dettes, valeur du stock, alertes et meilleurs produits. Le graphique compare le chiffre d’affaires et les dépenses.',
    },
    {
      iconName: 'activity',
      title: 'Activités & budgets',
      text: 'Créer et suivre une ou plusieurs activités. Affiche le capital, les apports, le budget consommé et restant, indépendamment du bénéfice et de la trésorerie.',
    },
    {
      iconName: 'box',
      title: 'Produits & stock',
      text: 'Catalogue des produits : prix d’achat, prix de vente, marge unitaire, quantité disponible, seuil d’alerte et valeur du stock au coût moyen pondéré.',
    },
    {
      iconName: 'cart',
      title: 'Achats',
      text: 'Bons d’achat fournisseurs avec lignes, transport et frais répartis. La réception crée les mouvements de stock et les paiements fractionnés créent les dettes.',
    },
    {
      iconName: 'layers',
      title: 'Mouvements de stock',
      text: 'Historique de toutes les entrées et sorties : achats, ventes, retours, pertes, casses et corrections. Le stock est toujours recalculé, jamais saisi directement.',
    },
    {
      iconName: 'receipt',
      title: 'Ventes & caisse',
      text: 'Ventes comptant ou à crédit, remises, encaissements fractionnés, retours, annulation et reçu imprimable ou PDF. Le coût de revient est figé à la validation.',
    },
    {
      iconName: 'wallet',
      title: 'Dépenses',
      text: 'Dépenses classées par nature. Seules les dépenses d’exploitation réduisent le résultat ; les autres impactent uniquement la trésorerie.',
    },
    {
      iconName: 'banknote',
      title: 'Trésorerie',
      text: 'Comptes, mouvements réels, apports, retraits, transferts internes et vérification de caisse. La trésorerie totale additionne les comptes actifs.',
    },
    {
      iconName: 'users',
      title: 'Clients & créances',
      text: 'Fiches clients, montants restant à recevoir, retards et encaissement direct d’une vente à crédit.',
    },
    {
      iconName: 'truck',
      title: 'Fournisseurs & dettes',
      text: 'Fiches fournisseurs, dettes ouvertes, échéances et règlement direct d’un achat.',
    },
    {
      iconName: 'chart',
      title: 'Rapports',
      text: 'Rapport d’activité complet (synthèse, ventes, achats, dépenses, produits, trésorerie, créances, dettes) avec exports CSV, PDF et impression.',
    },
    {
      iconName: 'calculator',
      title: 'Assistant de rentabilité',
      text: 'Simulez une marge, un seuil de rentabilité ou un prix de vente conseillé. Les hypothèses sont toujours affichées avec le résultat.',
    },
    {
      iconName: 'settings',
      title: 'Paramètres & sauvegardes',
      text: 'Nom du commerce, catégories, moyens de paiement, formats de date, sauvegarde et restauration JSON, réinitialisation des données.',
    },
    {
      iconName: 'help',
      title: 'Guide & aide',
      text: 'Cette page : définitions, formules, prise en main, exemple chiffré et réponses aux questions fréquentes.',
    },
  ];

  const container = element('<div class="space-y-2"></div>');
  for (const screen of screens) {
    container.append(
      element(detailsBlock({
        title: screen.title,
        iconName: screen.iconName,
        body: html`<p class="text-sm text-muted">${screen.text}</p>`,
      })),
    );
  }
  return container;
}

function buildGlossary() {
  const terms = [
    ['Activité', 'Un commerce ou un projet suivi séparément : il possède son capital, son budget et ses opérations.'],
    ['Coût moyen pondéré (CMP)', 'Coût moyen des unités achetées, frais d’approvisionnement inclus. Il sert à valoriser le stock et à calculer la marge.'],
    ['Coût des produits vendus', 'Valeur d’achat des unités effectivement vendues, figée au moment de la vente.'],
    ['Chiffre d’affaires', 'Montant des ventes validées sur la période, net des remises et des retours.'],
    ['Encaissement', 'Argent réellement reçu. Un encaissement partiel ne modifie pas le chiffre d’affaires.'],
    ['Créance client', 'Somme qu’un client doit encore payer après une vente à crédit.'],
    ['Dette fournisseur', 'Somme qu’il reste à payer après un achat à crédit.'],
    ['Marge brute', 'Chiffre d’affaires net moins le coût des produits vendus.'],
    ['Résultat estimé', 'Marge brute moins les dépenses d’exploitation de la période.'],
    ['Trésorerie', 'Argent disponible sur les comptes : solde initial + entrées réelles − sorties réelles.'],
    ['Budget restant', 'Capital de départ + apports − argent réellement sorti pour l’activité.'],
    ['Apport', 'Argent ajouté par l’exploitant : ce n’est ni un chiffre d’affaires ni un bénéfice.'],
    ['Retrait personnel', 'Argent pris par l’exploitant : cela réduit la trésorerie, pas le résultat.'],
    ['Dépense d’exploitation', 'Charge du fonctionnement courant (loyer, salaire, énergie, publicité) déduite du résultat.'],
    ['Investissement', 'Achat durable (matériel, mobilier) : sort de trésorerie mais reste un actif, hors résultat de la période.'],
    ['Retour', 'Marchandise rendue par un client ou renvoyée à un fournisseur ; il crée un document compensatoire.'],
    ['Annulation', 'La vente ou l’achat reste dans l’historique avec le statut « annulé » ; des mouvements inverses rétablissent le stock et la trésorerie.'],
    ['Période', 'Plage de dates utilisée pour les indicateurs. Le filtre est commun à tous les écrans.'],
  ];
  return element(html`
    <div class="grid gap-3 sm:grid-cols-2">
      ${terms.map(
        (term) => html`
          <div class="rounded-xl border border-line bg-canvas/40 p-3">
            <p class="text-sm font-semibold text-brand-dark">${term[0]}</p>
            <p class="mt-0.5 text-xs text-muted">${term[1]}</p>
          </div>
        `,
      )}
    </div>
  `);
}

function buildFaq() {
  const items = [
    {
      title: 'Pourquoi mon chiffre d’affaires est-il différent de ma trésorerie ?',
      body: 'Le chiffre d’affaires compte les ventes validées, même si le client n’a pas encore payé. La trésorerie ne compte que l’argent réellement reçu ou sorti. Une vente à crédit crée donc une créance, pas de l’argent disponible.',
    },
    {
      title: 'Pourquoi le budget restant n’est-il pas égal à la trésorerie ?',
      body: 'Le budget restant est un indicateur de budget : capital de départ + apports − argent réellement sorti. Il ne tient pas compte des ventes encaissées. La trésorerie, elle, inclut les encaissements. Les deux peuvent donc être très différents.',
    },
    {
      title: 'Comment le stock est-il valorisé ?',
      body: 'Chaque réception d’achat met à jour le coût moyen pondéré, frais d’approvisionnement compris. Le stock vaut quantité disponible × coût moyen pondéré. Le coût d’une vente est figé au moment de la vente.',
    },
    {
      title: 'Une dépense de transport est-elle comptée deux fois ?',
      body: 'Non. Les frais d’approvisionnement (transport, emballage) sont intégrés au coût d’acquisition des marchandises. Ils ne sont jamais déduits une seconde fois du résultat. Seules les dépenses d’exploitation le sont.',
    },
    {
      title: 'Que se passe-t-il quand j’annule une vente ?',
      body: 'La vente reste dans l’historique avec le statut « annulée ». Le stock est réintégré et l’argent encore détenu est remboursé par le compte choisi. Aucun document n’est supprimé silencieusement.',
    },
    {
      title: 'Les apports et retraits sont-ils du bénéfice ?',
      body: 'Non. Un apport augmente la trésorerie et le budget disponible, un retrait les diminue. Ce sont des mouvements de l’exploitant : ils ne modifient ni le chiffre d’affaires ni le résultat.',
    },
    {
      title: 'Mes données sont-elles sauvegardées automatiquement ?',
      body: 'Les données sont écrites dans le navigateur de cet appareil à chaque opération. Ce n’est pas une sauvegarde externe : exportez régulièrement un fichier JSON depuis « Paramètres & sauvegardes » et conservez-le ailleurs.',
    },
    {
      title: 'Puis-je utiliser l’application hors connexion ?',
      body: 'Oui, après un premier chargement réussi et en HTTPS. Le service worker met l’application en cache. Un indicateur « Hors ligne » s’affiche dans la barre supérieure.',
    },
    {
      title: 'Comment changer la période ou l’activité analysée ?',
      body: 'Utilisez la barre de filtres en haut des écrans d’analyse (tableau de bord, rapports, ventes, etc.). Le choix est conservé lorsque vous passez d’un écran à l’autre.',
    },
    {
      title: 'Les chiffres de cette page sont-ils des exemples ?',
      body: 'Non : la section « Vos chiffres du moment » utilise vos opérations réelles et la période sélectionnée. L’exemple chiffré plus bas est clairement présenté comme un exemple pédagogique.',
    },
    {
      title: 'Comment suivre les salaires d’un employé ?',
      body: 'Ouvrez « Employés & paie », créez une fiche puis cliquez sur l’icône de paiement. Le salaire versé devient une dépense d’exploitation reliée à la fiche. Le salaire de référence n’est qu’une valeur par défaut : aucun bulletin de paie légal n’est produit et les cotisations sociales ne sont pas gérées.',
    },
    {
      title: 'Puis-je importer un relevé bancaire ou mobile money ?',
      body: 'Oui, via « Import de relevés » : exportez un CSV depuis votre banque ou votre opérateur, déposez-le, vérifiez les colonnes détectées puis choisissez le traitement. Aucune connexion automatique à une banque n’est effectuée et les lignes déjà importées sont ignorées.',
    },
    {
      title: 'Que fait exactement l’archivage par exercice ?',
      body: 'Il exporte une archive JSON de la période, puis retire du quotidien les ventes, achats, dépenses et paiements soldés antérieurs à la date choisie. Les pièces encore impayées sont conservées, les soldes de trésorerie sont reportés en ouverture et l’historique des mouvements de stock reste intact pour garantir la valorisation. Un instantané permet d’annuler.',
    },
    {
      title: 'Pourquoi mes anciens mouvements de stock restent-ils après un archivage ?',
      body: 'Le stock est valorisé au coût moyen pondéré en rejouant tous les mouvements. Les supprimer fausserait la valeur du stock actuel. Ils sont donc conservés, alors que les documents commerciaux volumineux (ventes, achats, dépenses) peuvent être archivés.',
    },
    {
      title: 'Qu’est-ce que le mode démonstration ?',
      body: 'C’est un jeu de données fictif, stocké dans une base séparée de vos données réelles. Il sert à découvrir l’application sans risque. Un bandeau permanent rappelle le mode démo et permet de revenir aux données réelles ; rien n’est mélangé.',
    },
    {
      title: 'Pourquoi le coût d’une ancienne vente ne change-t-il pas après une correction d’achat ?',
      body: 'C’est un choix de fiabilité : les marges déjà publiées ne sont pas réécrites silencieusement. Un diagnostic en lecture seule, dans les rapports, montre l’écart qu’un recalcul produirait, sans modifier les données.',
    },
  ];

  const container = element('<div class="space-y-2"></div>');
  for (const item of items) {
    container.append(
      element(detailsBlock({
        title: item.title,
        iconName: 'help',
        body: html`<p class="text-sm text-muted">${item.body}</p>`,
      })),
    );
  }
  return container;
}

function buildExample() {
  const rows = [
    ['Capital de départ', '40 000 FCFA', 'Ajouté à la trésorerie et au budget disponible.'],
    ['Achat de 21 pantalons à 1 500 FCFA', '31 500 FCFA', 'Entre en stock.'],
    ['Transport de l’achat', '2 000 FCFA', 'Réparti dans le coût d’acquisition : (31 500 + 2 000) ÷ 21 ≈ 1 595,24 FCFA par pantalon.'],
    ['Publicité', '600 FCFA', 'Dépense d’exploitation, déduite du résultat.'],
    ['Vente de 20 pantalons à 2 500 FCFA', '50 000 FCFA', 'Chiffre d’affaires de la période.'],
  ];

  return element(html`
    <div class="space-y-4">
      <p class="text-sm text-ink">
        Exemple pédagogique du cahier des charges. Il montre comment les indicateurs se déduisent les uns
        des autres — il ne provient pas de vos données.
      </p>
      <div class="table-wrap">
        <table class="table table-stack">
          <thead>
            <tr><th>Opération</th><th class="text-right">Montant</th><th>Effet</th></tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) => html`
                <tr>
                  <td data-label="Opération" class="font-medium">${row[0]}</td>
                  <td data-label="Montant" class="text-right font-semibold tabular-nums">${row[1]}</td>
                  <td data-label="Effet" class="text-muted">${row[2]}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        ${formulaLine('Chiffre d’affaires', '50 000 FCFA', '20 pantalons × 2 500 FCFA.')}
        ${formulaLine('Coût des produits vendus', '≈ 31 904,76 FCFA', '20 × 1 595,24 FCFA.')}
        ${formulaLine('Marge brute', '≈ 18 095,24 FCFA', '50 000 − 31 904,76.')}
        ${formulaLine('Résultat estimé', '≈ 17 495,24 FCFA', '18 095,24 − 600 de publicité.')}
        ${formulaLine('Budget restant', '5 900 FCFA', '40 000 − 31 500 − 2 000 − 600, avant la vente.')}
        ${formulaLine('Trésorerie finale', '55 900 FCFA', '40 000 − 34 100 décaissés + 50 000 encaissés.')}
      </div>
      <p class="text-xs text-muted">
        Le stock restant (1 pantalon) vaut ≈ 1 595,24 FCFA : c’est un actif, pas une charge. Il n’est donc
        pas déduit du résultat.
      </p>
    </div>
  `);
}

/* --------------------------------- rendu -------------------------------- */

function paint(ctx) {
  const state = getState();
  const wrapper = element('<div class="space-y-4"></div>');

  wrapper.append(
    pageHeader({
      title: 'Guide & aide',
      subtitle: 'Tout comprendre : les écrans, le chiffre d’affaires, la marge, le résultat, la trésorerie et le budget.',
      actions: [
        button({
          label: 'Visite guidée',
          iconName: 'lightbulb',
          onClick: () => startTour({ force: true }),
        }),
        ...(isDemoMode()
          ? [
              button({
                label: 'Quitter la démo',
                iconName: 'arrowLeft',
                onClick: async () => {
                  const quit = await confirmDialog({
                    title: 'Quitter le mode démonstration ?',
                    message: 'L’application va recharger vos données réelles.',
                    details: 'Les données fictives restent dans leur base séparée : vos vraies données n’ont pas été modifiées.',
                    confirmLabel: 'Quitter la démo',
                    variant: 'primary',
                  });
                  if (quit) exitDemoMode();
                },
              }),
            ]
          : []),
        button({
          label: isDemoMode() ? 'Réinitialiser la démo' : 'Mode démonstration',
          iconName: 'activity',
          onClick: async () => {
            if (isDemoMode()) {
              const reset = await confirmDialog({
                title: 'Réinitialiser la démonstration ?',
                message: 'Les données fictives seront recréées au prochain chargement.',
                details: 'Vos données réelles ne sont pas concernées : elles restent dans une base séparée.',
                confirmLabel: 'Réinitialiser',
              });
              if (reset) await resetDemoMode();
              return;
            }
            const go = await confirmDialog({
              title: 'Ouvrir le mode démonstration ?',
              message: 'L’application va recharger un jeu de données fictif pour vous faire découvrir les écrans.',
              details: 'La démonstration utilise une base IndexedDB séparée : vos données réelles ne sont ni lues, ni modifiées. Vous pourrez revenir aux données réelles depuis le bandeau.',
              confirmLabel: 'Essayer la démo',
              variant: 'primary',
            });
            if (go) enterDemoMode();
          },
        }),
        button({
          label: 'Voir mes chiffres',
          iconName: 'chart',
          variant: 'primary',
          onClick: () => {
            const target = document.getElementById('aide-chiffres');
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }),
      ],
    }),
  );

  const sommaire = element('<div class="no-print flex flex-wrap gap-2"></div>');
  for (const [label, id] of [
    ['Vos chiffres', 'aide-chiffres'],
    ['Chiffre d’affaires', 'aide-chiffre-affaires'],
    ['Indicateurs', 'aide-indicateurs'],
    ['Prise en main', 'aide-demarrage'],
    ['Les écrans', 'aide-ecrans'],
    ['Vocabulaire', 'aide-vocabulaire'],
    ['Questions fréquentes', 'aide-faq'],
    ['Exemple chiffré', 'aide-exemple'],
  ]) {
    sommaire.append(jumpButton(label, id));
  }
  wrapper.append(sommaire);

  wrapper.append(
    noticePanel({
      tone: 'info',
      title: 'Un guide qui utilise vos vrais chiffres',
      items: [
        'La section « Vos chiffres du moment » est calculée à partir de vos opérations et de la période sélectionnée.',
        'Les formules sont rappelées à côté de chaque indicateur pour que vous puissiez vérifier un montant.',
        'Aucune donnée n’est modifiée par cette page : elle est uniquement explicative.',
      ],
    }),
  );

  wrapper.append(
    noticePanel({
      tone: 'warning',
      title: 'Outil de pilotage, pas une comptabilité certifiée',
      message: ACCOUNTING_DISCLAIMER,
    }),
  );

  wrapper.append(
    helpSection('aide-vue', {
      title: 'À quoi sert Mon Commerce ?',
      description: 'Une application complète, en français et en FCFA, pour piloter un petit commerce.',
      content: buildOverview(),
    }),
  );

  wrapper.append(
    helpSection('aide-chiffres', {
      title: 'Vos chiffres du moment',
      description: 'Les indicateurs clés, recalculés à partir de vos opérations.',
      content: buildLiveKpis(state, ctx),
    }),
  );

  wrapper.append(
    helpSection('aide-chiffre-affaires', {
      title: 'Comprendre le chiffre d’affaires',
      description: 'Ce que vous vendez, ce que vous encaissez et pourquoi les deux diffèrent.',
      content: buildRevenueExplainer(),
    }),
  );

  wrapper.append(
    helpSection('aide-indicateurs', {
      title: 'Tous les indicateurs et leurs formules',
      description: 'Où trouver chaque chiffre et ce qu’il signifie exactement.',
      content: buildIndicatorGuide(),
    }),
  );

  wrapper.append(
    helpSection('aide-demarrage', {
      title: 'Prise en main en 7 étapes',
      description: 'L’ordre conseillé pour démarrer sans se tromper.',
      content: buildSteps(ctx),
    }),
  );

  wrapper.append(
    helpSection('aide-ecrans', {
      title: 'Chaque écran expliqué',
      description: 'Ouvrez un écran pour voir son rôle et ses actions principales.',
      content: buildScreens(),
    }),
  );

  wrapper.append(
    helpSection('aide-vocabulaire', {
      title: 'Vocabulaire du commerce et de la gestion',
      description: 'Les mots utilisés dans l’application, en langage simple.',
      content: buildGlossary(),
    }),
  );

  wrapper.append(
    helpSection('aide-faq', {
      title: 'Questions fréquentes',
      description: 'Les réponses aux situations les plus courantes.',
      content: buildFaq(),
    }),
  );

  wrapper.append(
    helpSection('aide-exemple', {
      title: 'Exemple chiffré complet',
      description: 'Un cas concret pour vérifier que vous lisez bien vos indicateurs.',
      content: buildExample(),
    }),
  );

  wrapper.append(
    helpSection('aide-regles', {
      title: 'Règles de calcul appliquées partout',
      description: 'Les conventions communes à tous les écrans.',
      content: element(html`<div class="space-y-3">${bullets(FINANCE_RULES_TEXT)}</div>`),
    }),
  );

  const expenseNatures = element(html`
    <div class="mt-3 space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">Les quatre natures de dépense</p>
      ${EXPENSE_NATURES.map(
        (nature) => html`
          <div class="rounded-xl border border-line bg-canvas/40 p-3">
            <p class="text-sm font-semibold text-brand-dark">${nature.label}</p>
            <p class="mt-0.5 text-xs text-muted">${nature.hint}</p>
          </div>
        `,
      )}
    </div>
  `);
  wrapper.append(
    helpSection('aide-depenses', {
      title: 'Comprendre les dépenses',
      description: 'Toutes les sorties d’argent ne réduisent pas le bénéfice.',
      content: expenseNatures,
    }),
  );

  wrapper.append(
    noticePanel({
      tone: 'warning',
      title: 'Pensez à sauvegarder',
      message: `Vos données restent dans ce navigateur (version ${APP_VERSION}). Exportez régulièrement une sauvegarde JSON depuis « Paramètres & sauvegardes ».`,
      items: [
        'Une sauvegarde permet de changer d’appareil ou de récupérer vos données.',
        'Sans export, vider les données du navigateur efface définitivement les opérations.',
      ],
    }),
  );

  return wrapper;
}

/* ------------------------------- export --------------------------------- */

export default {
  meta,
  render(ctx) {
    return createPage({
      ctx,
      filters: true,
      paint: () => paint(ctx),
    }).root;
  },
};
