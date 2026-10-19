/* ---------------------------------------------------------------------------
 * Mon Commerce — constantes centralisées
 * Ce fichier ne dépend ni du DOM ni d'IndexedDB : il est importable par les
 * tests Node, les services métier et l'interface.
 * ------------------------------------------------------------------------- */

export const APP_NAME = 'Mon Commerce';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export const CURRENCY_SYMBOL = 'FCFA';
export const CURRENCY_CODE = 'XOF';
export const LOCALE = 'fr-FR';

/** Arrondi monétaire documenté : 2 décimales, arrondi « au plus proche ». */
export const MONEY_DECIMALS = 2;

export const ACTIVITY_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

export const DOCUMENT_STATUS = {
  DRAFT: 'draft',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  VALIDATED: 'validated',
  CANCELLED: 'cancelled',
};

/** Moyens de paiement demandés par le cahier des charges. */
export const PAYMENT_METHODS = ['Espèces', 'Flooz', 'TMoney', 'Virement', 'Autre'];

/** Catégories de dépenses demandées par le cahier des charges. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Transport',
  'Emballage',
  'Publicité',
  'Loyer',
  'Énergie',
  'Frais de transaction',
  'Entretien',
  'Salaire',
  'Taxes',
  'Autres',
];

export const DEFAULT_PRODUCT_CATEGORIES = [
  'Vêtements',
  'Chaussures',
  'Téléphones',
  'Accessoires',
  'Alimentation',
  'Cosmétiques',
  'Autres',
];

/**
 * Nature d'une dépense : détermine son traitement financier.
 * - operating : charge d'exploitation, déduite du résultat de la période.
 * - supply    : frais d'approvisionnement déjà intégrés au coût d'acquisition
 *               des marchandises → jamais déduits une seconde fois du résultat.
 * - investment: bien durable, sort de trésorerie mais reste un actif.
 * - personal  : apport/retrait de l'exploitant, ce n'est pas une charge.
 */
export const EXPENSE_NATURES = [
  {
    value: 'operating',
    label: "Dépense d'exploitation",
    hint: 'Loyer, salaire, énergie… Déduite du résultat de la période.',
  },
  {
    value: 'supply',
    label: "Frais d'approvisionnement",
    hint: 'Transport, emballage des marchandises : déjà compris dans le coût des produits vendus.',
  },
  {
    value: 'investment',
    label: 'Investissement',
    hint: 'Achat durable (matériel, mobilier) : sort de trésorerie, hors résultat de la période.',
  },
  {
    value: 'personal',
    label: 'Retrait personnel',
    hint: "Argent sorti du commerce pour l'exploitant : ce n'est pas une charge.",
  },
];

export const EXPENSE_NATURE_VALUES = EXPENSE_NATURES.map((n) => n.value);

export const STOCK_REASONS = [
  { value: 'opening', label: 'Stock initial', direction: 'in' },
  { value: 'purchase_receipt', label: 'Réception d’achat', direction: 'in' },
  { value: 'sale', label: 'Vente', direction: 'out' },
  { value: 'return_in', label: 'Retour client', direction: 'in' },
  { value: 'return_out', label: 'Retour au fournisseur', direction: 'out' },
  { value: 'loss', label: 'Perte', direction: 'out' },
  { value: 'breakage', label: 'Casse', direction: 'out' },
  { value: 'sale_cancel', label: 'Annulation de vente', direction: 'in' },
  { value: 'purchase_cancel', label: 'Annulation de réception', direction: 'out' },
  { value: 'correction', label: 'Correction documentée', direction: 'adjust' },
];

export const STOCK_REASON_MAP = Object.fromEntries(STOCK_REASONS.map((r) => [r.value, r]));

/** Motifs manuels proposés à l'utilisateur (hors mouvements automatiques). */
export const MANUAL_STOCK_REASONS = ['opening', 'loss', 'breakage', 'return_out', 'correction'];

export const PRODUCT_UNITS = ['pièce', 'paire', 'carton', 'sac', 'sachet', 'kg', 'litre', 'mètre', 'boîte', 'service'];

export const CASH_ACCOUNT_TYPES = [
  { value: 'cash', label: 'Caisse (espèces)' },
  { value: 'mobile', label: 'Portefeuille mobile' },
  { value: 'bank', label: 'Compte bancaire' },
];

export const CASH_MOVEMENT_NATURES = [
  { value: 'sale_payment', label: 'Encaissement sur vente', direction: 'in' },
  { value: 'customer_payment', label: 'Règlement client', direction: 'in' },
  { value: 'purchase_payment', label: 'Paiement fournisseur', direction: 'out' },
  { value: 'supplier_refund', label: 'Remboursement fournisseur', direction: 'in' },
  { value: 'expense', label: 'Dépense payée', direction: 'out' },
  { value: 'customer_refund', label: 'Remboursement client', direction: 'out' },
  { value: 'capital_in', label: 'Apport', direction: 'in' },
  { value: 'withdrawal', label: 'Retrait', direction: 'out' },
  { value: 'transfer_in', label: 'Transfert entrant', direction: 'in' },
  { value: 'transfer_out', label: 'Transfert sortant', direction: 'out' },
  { value: 'other_in', label: 'Autre entrée', direction: 'in' },
  { value: 'other_out', label: 'Autre sortie', direction: 'out' },
];

export const CASH_NATURE_MAP = Object.fromEntries(CASH_MOVEMENT_NATURES.map((n) => [n.value, n]));

export const PERIOD_PRESETS = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: 'Cette semaine' },
  { value: 'month', label: 'Ce mois' },
  { value: 'quarter', label: 'Ce trimestre' },
  { value: 'year', label: 'Cette année' },
  { value: 'all', label: 'Tout l’historique' },
  { value: 'custom', label: 'Période personnalisée' },
];

export const DATE_FORMATS = [
  { value: 'dd/MM/yyyy', label: '31/12/2026' },
  { value: 'dd-MM-yyyy', label: '31-12-2026' },
  { value: 'yyyy-MM-dd', label: '2026-12-31' },
];

/** Routes de navigation principale. */
export const ROUTES = [
  { path: 'tableau-de-bord', label: 'Tableau de bord', icon: 'dashboard', group: 'Pilotage', mobile: true },
  { path: 'activites', label: 'Activités & budgets', icon: 'activity', group: 'Pilotage' },
  { path: 'produits', label: 'Produits & stock', icon: 'box', group: 'Catalogue', mobile: true },
  { path: 'achats', label: 'Achats', icon: 'cart', group: 'Catalogue' },
  { path: 'stock', label: 'Mouvements de stock', icon: 'layers', group: 'Catalogue' },
  { path: 'ventes', label: 'Ventes & caisse', icon: 'receipt', group: 'Commercial', mobile: true },
  { path: 'depenses', label: 'Dépenses', icon: 'wallet', group: 'Commercial' },
  { path: 'tresorerie', label: 'Trésorerie', icon: 'banknote', group: 'Finances', mobile: true },
  { path: 'clients', label: 'Clients & créances', icon: 'users', group: 'Finances' },
  { path: 'fournisseurs', label: 'Fournisseurs & dettes', icon: 'truck', group: 'Finances' },
  { path: 'rapports', label: 'Rapports', icon: 'chart', group: 'Analyse', mobile: true },
  { path: 'rentabilite', label: 'Assistant de rentabilité', icon: 'calculator', group: 'Analyse' },
  { path: 'parametres', label: 'Paramètres & sauvegardes', icon: 'settings', group: 'Analyse' },
  { path: 'aide', label: 'Guide & aide', icon: 'help', group: 'Analyse' },
];

export const DEFAULT_ROUTE = 'tableau-de-bord';

export const STORAGE_WARNING = [
  'Vos données sont enregistrées uniquement dans ce navigateur, sur cet appareil. Il n’y a ni compte, ni serveur, ni synchronisation.',
  'Supprimer les données du navigateur, perdre l’appareil ou changer d’appareil peut entraîner la perte de vos données.',
  'Exportez régulièrement une sauvegarde JSON depuis « Paramètres & sauvegardes » et conservez-la en lieu sûr (clé USB, e-mail, cloud).',
].join(' ');

export const FINANCE_RULES_TEXT = [
  'Chiffre d’affaires : ventes validées, nettes des remises et des retours.',
  'Encaissements : uniquement les paiements réellement reçus (les créances sont exclues).',
  'Coût des produits vendus : coût moyen pondéré des unités vendues, figé au moment de la vente.',
  'Marge brute = chiffre d’affaires net − coût des produits vendus.',
  'Résultat estimé = marge brute − dépenses d’exploitation de la période.',
  'Valeur du stock = quantité disponible × coût moyen pondéré.',
  'Créance client = montants dus − paiements reçus − avoirs. Dette fournisseur : idem côté achats.',
  'Trésorerie = solde initial + entrées réelles − sorties réelles.',
  'Budget restant, bénéfice, chiffre d’affaires et trésorerie sont des indicateurs différents.',
];
