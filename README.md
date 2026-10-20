# Mon Commerce — gestion commerciale et financière

Application web de gestion **pour les petits commerçants** : achats, ventes, stock,
dépenses, trésorerie, clients/fournisseurs et rentabilité. L'interface, la
documentation et les messages sont **en français**, les montants sont en
**FCFA (XOF)**.

L'application fonctionne **entièrement dans le navigateur** : aucun compte, aucun
serveur, aucune synchronisation. Les données sont enregistrées dans
**IndexedDB**, sur l'appareil, et l'application s'ouvre **hors connexion** (PWA)
après un premier chargement. Version documentée : **1.2.0**.

---

## 1. Démarrage rapide

Prérequis : **Node.js 20 ou plus** (testé avec Node 24) et npm.

```bash
npm install      # installe les dépendances
npm run dev      # démarre le serveur de développement (http://localhost:5173)
```

Le serveur de développement ouvre l'application avec rechargement automatique.
Au premier lancement, un court écran d'accueil rappelle les règles de confidentialité
et la nécessité d'exporter des sauvegardes.

### Nouveautés de la version 1.2.0

- **Sauvegardes renforcées** : rappels configurables, export en un clic, export
  chiffré par mot de passe, aperçu détaillé et fusion par horodatage à l'import,
  instantané automatique et annulation du dernier import.
- **Sécurité locale** : verrouillage par code PIN (haché, jamais stocké en clair),
  auto-verrouillage par inactivité ou mise en arrière-plan.
- **Fiabilité** : détection du stockage éphémère, demande de stockage persistant,
  écran d'échec IndexedDB explicite, journal des opérations et annulation de la
  dernière opération.
- **Nouveaux écrans** : *Employés & paie* et *Import de relevés* (CSV bancaire ou
  mobile money, sans connexion externe).
- **Documents** : identité complète du commerce, logo, mentions légales, pied de
  page et trois modèles de reçus.
- **Analyse** : comparaison avec la période précédente, diagnostic de coût de
  revient en lecture seule, info-bulles sur les indicateurs.
- **Maintenance** : archivage par exercice et purge guidée après export.
- **Accompagnement** : FAQ enrichie, visite guidée rejouable et mode
  démonstration utilisant une base séparée (jamais mélangée aux données réelles).

### Scripts disponibles

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement Vite (port 5173). |
| `npm run build` | Construit l'application optimisée dans `dist/`. |
| `npm run preview` | Sert localement le contenu de `dist/` (port 4173). |
| `npm test` | Exécute la suite de tests (node:test), y compris le scénario de référence. |
| `npm run test:watch` | Relance les tests à chaque modification. |

---

## 2. Construction et prévisualisation

```bash
npm run build       # produit dist/
npm run preview     # vérifie le rendu de production sur http://localhost:4173
```

Le build est configuré avec `base: './'` : les liens sont **relatifs**, ce qui
permet de déployer l'application aussi bien à la racine d'un site que dans un
sous-dossier (`https://exemple.com/mon-commerce/`).

---

## 3. Déploiement

Le dossier `dist/` est **entièrement statique** : il suffit de le copier sur
n'importe quel hébergeur de fichiers (Apache, Nginx, GitHub Pages, Netlify,
Vercel, un simple partage réseau…).

Points à respecter :

1. **HTTPS obligatoire pour le mode hors connexion.** Les service workers ne
   fonctionnent qu'en HTTPS (ou sur `localhost`). Le service worker n'est
   d'ailleurs enregistré qu'en production.
2. **Ne pas réécrire les URL.** L'application utilise un routage par ancre
   (`#/ventes`, `#/stock`…) : aucune règle de réécriture n'est nécessaire.
3. **Sous-dossier.** Comme les chemins sont relatifs, déposer `dist/` dans un
   sous-dossier suffit.
4. **Mise à jour.** Remplacer les fichiers de `dist/` par la nouvelle version ;
   le service worker met son cache à jour à l'ouverture suivante.

> Important : les données métier ne sont **jamais** envoyées au serveur qui héberge
> l'application. Un hébergement différent (ou un simple dossier local) ne change
> rien à la confidentialité des données.

---

## 4. Utilisation hors connexion (PWA)

- L'application peut être **installée** depuis le navigateur (« Ajouter à l'écran
  d'accueil » / « Installer »).
- Après une première visite réussie, le service worker met les ressources en cache
  et l'application se rouvre **sans réseau**.
- Si une page n'a pas encore été mise en cache, un message « Hors ligne » clair
  s'affiche au lieu d'une erreur silencieuse.

---

## 5. Les écrans

| Écran | Ce qu'il permet |
| --- | --- |
| **Tableau de bord** | Indicateurs clés de la période, alertes de stock, derniers mouvements, accès rapide à une vente. |
| **Activités & budgets** | Créer et suivre une ou plusieurs activités : capital de départ, budget disponible/consommé/restant. |
| **Produits & stock** | Catalogue (nom, unité, coût, prix, seuil d'alerte), création/édition, stock initial. |
| **Achats** | Bons d'achat fournisseurs : lignes, frais (transport, autres) répartis au prorata, réception en stock, paiements fractionnés. |
| **Mouvements de stock** | Historique complet des entrées/sorties, entrées et sorties manuelles (perte, casse, correction, inventaire) tracées. |
| **Ventes & caisse** | Ventes comptant ou à crédit, remises, encaissements fractionnés, retours, annulation, reçu imprimable/PDF. |
| **Dépenses** | Dépenses classées par nature : exploitation, approvisionnement, investissement, personnel. |
| **Trésorerie** | Comptes (caisse, banque, mobile money), mouvements, virements internes, rapprochement. |
| **Clients & créances** | Fiches clients et liste des montants encore dus, encaissement direct. |
| **Fournisseurs & dettes** | Fiches fournisseurs et liste des dettes ouvertes, règlement direct. |
| **Employés & paie** | Fiches employés (rôle, contact, date d'embauche, salaire de référence, statut), suivi des salaires du mois et paiement relié à une dépense de personnel. |
| **Import de relevés** | Import d'un CSV de banque ou de mobile money : détection des colonnes, aperçu, déduplication, création de mouvements de trésorerie ou de dépenses. Aucune connexion externe. |
| **Rapports** | Synthèses datées, comparaison avec la période précédente, diagnostic de coût de revient, exports CSV (dont journal comptable simplifié), impressions et PDF. |
| **Assistant de rentabilité** | Seuil de rentabilité, marges par produit, simulation de prix. |
| **Paramètres & sauvegardes** | Identité du commerce, modèles de reçus, préférences, catégories, moyens de paiement, rappels de sauvegarde, verrouillage PIN, instantanés, journal des opérations, archivage par exercice, stockage local et réinitialisation. |
| **Guide & aide** | Explication complète : écrans, formules des indicateurs (chiffre d'affaires, marge, résultat, trésorerie, budget), vocabulaire, questions fréquentes, exemple chiffré, visite guidée, mode démonstration et vos chiffres réels. |

En dehors du **mode démonstration** (base séparée et bandeau permanent), aucune
donnée fictive n'est présentée comme réelle : tant qu'aucune opération n'a été
saisie, les écrans affichent un état vide explicite.

---

## 6. Sauvegardes, sécurité et maintenance

### Sauvegardes et restauration

Depuis **Paramètres & sauvegardes** :

- **Rappel de sauvegarde** : fréquence configurable (ou désactivée). Un bandeau
  indique depuis combien de jours aucune sauvegarde n'a été faite et propose un
  export en un clic. Une sauvegarde automatique au démarrage peut être activée :
  elle ne se déclenche que lorsque le rappel est échu.
- **Exporter** : produit un fichier JSON horodaté (toutes les données + réglages).
  L'export peut être **chiffré par mot de passe** (AES-GCM 256 bits, clé dérivée
  par PBKDF2-SHA256, 210 000 itérations). Le mot de passe n'est jamais enregistré :
  sans lui, le fichier est irrécupérable.
- **Restaurer** : importe un fichier JSON ou une sauvegarde chiffrée (détection
  automatique, mot de passe demandé si nécessaire). Un **aperçu détaillé** indique
  ce qui sera ajouté, mis à jour, identique ou ignoré (version plus ancienne),
  avec les décomptes par collection. Deux modes :
  - *Fusionner* : la version la plus récente gagne, en comparant les horodatages
    (`updatedAt` / `createdAt`) ; les autres enregistrements sont conservés ;
  - *Remplacer* : remplace intégralement les données actuelles.
  Un **instantané de sécurité** est créé automatiquement avant l'import et le
  dernier import peut être annulé.
- **Instantanés et journal** : les instantanés de sécurité et le journal des
  opérations permettent d'**annuler la dernière opération** depuis les paramètres.
  Ces données techniques restent locales et ne sont pas incluses dans les exports.
- **Réinitialiser** : efface toutes les données (confirmation écrite demandée).

Bon à savoir : les données vivent dans le navigateur de **cet appareil**.
Supprimer les données du navigateur, vider le cache ou changer d'appareil peut
les faire disparaître. **Exportez régulièrement** et conservez le fichier en lieu
sûr (clé USB, e-mail, cloud).

### Verrouillage local

Un **code PIN** peut protéger l'ouverture de l'application. Il est haché
(PBKDF2) et jamais stocké en clair. Après plusieurs essais erronés, la saisie est
temporisée. L'application se verrouille automatiquement après une période
d'inactivité ou lorsque l'onglet passe en arrière-plan ; un bouton « Verrouiller »
est disponible dans l'en-tête. Il ne s'agit pas d'un compte : les données restent
sur l'appareil et le PIN ne les chiffre pas au repos.

### Archivage et purge

L'écran des paramètres propose un **archivage par exercice** : il isole les
documents antérieurs à une date choisie après avoir produit une **archive JSON**
téléchargée. La purge guidée :

- conserve les documents impayés et **tout l'historique des mouvements de stock**
  (nécessaire au coût moyen pondéré) ;
- reporte les soldes de trésorerie dans une écriture d'ouverture ;
- demande une confirmation écrite et crée un instantané avant l'opération.

### Volume de données

L'application est prévue pour un petit commerce (quelques milliers d'opérations).
Les exports volumineux affichent une fenêtre de progression ; au-delà de 3 000
lignes, la génération du PDF demande une confirmation et l'export CSV est conseillé.
Utilisez l'archivage par exercice pour les historiques importants.

---

## 7. Conventions de calcul

- **Coût moyen pondéré (CMP)** : recalculé à partir des mouvements de stock ; le
  coût unitaire est **figé au moment de la vente** (prix de revient conservé).
- **Frais d'achat** (transport, autres) : répartis **au prorata** sur les lignes,
  puis intégrés au coût des produits.
- **Chiffre d'affaires** : ventes validées, nettes des remises et des retours.
- **Marge brute** = chiffre d'affaires net − coût des produits vendus.
- **Résultat estimé** = marge brute − dépenses d'**exploitation** de la période.
  Les natures *approvisionnement* (déjà dans le coût), *investissement* et
  *personnel* ne sont pas déduites du résultat ; elles n'affectent que la trésorerie.
- **Encaissements** : uniquement l'argent réellement reçu (les créances sont exclues) ;
  les apports de capital sont présentés séparément.
- **Trésorerie** = solde initial + entrées réelles − sorties réelles (virements
  internes exclus).
- **Budget restant** = capital de départ + apports − argent réellement sorti.
- **Retours** : enregistrés comme documents distincts ; **annulations** : les
  documents sont conservés et des mouvements compensatoires sont ajoutés (aucune
  suppression silencieuse).
- Les arrondis monétaires sont faits **à l'agrégation et à l'affichage** ; les
  calculs intermédiaires restent en précision complète.

Ces règles sont rappelées dans l'application (écrans *Activités*, *Rapports*, etc.).

---

## 8. Limites connues

- **Pas de backend ni de synchronisation multi-appareils** : les données restent
  locales à un navigateur/appareil. Le partage se fait via l'export/import JSON.
- **Pas de comptes multi-utilisateurs** : le verrouillage PIN protège l'ouverture,
  mais il n'existe ni profils, ni droits différenciés, ni mode consultation, ni
  collaboration en temps réel.
- **Dépendance au navigateur** : la suppression des données de navigation efface
  l'application et ses données si aucune sauvegarde n'a été exportée.
- **Volumétrie** : optimisé pour l'usage d'un petit commerce ; l'archivage par
  exercice limite l'historique actif, mais il n'y a pas de pagination complète des
  très grands historiques.
- **Devise** : FCFA uniquement (pas de multi-devises ni de taux de change).
- **Documents** : reçus/PDF générés côté navigateur, au format simple ; pas
  d'envoi direct au client ni de QR de paiement.
- **PWA hors connexion** : nécessite un premier chargement en ligne et HTTPS.
- **Comptabilité** : outil de pilotage, pas une comptabilité légale (pas de TVA,
  d'amortissements ni de plan comptable complet). L'export du journal simplifié
  aide la transmission au comptable, sans la remplacer.

Un inventaire détaillé de ces limites, avec leur **état d'avancement en version
1.2.0** et les solutions restant à décider, est disponible dans
[`LIMITES.md`](./LIMITES.md).

---

## 9. Architecture du code

```
index.html                 page hôte (coquille DOM)
vite.config.js             configuration Vite + Tailwind
public/                    manifeste PWA, service worker, icônes
src/
  main.js                  point d'entrée (démarrage, onboarding, service worker)
  app.js                   coquille applicative (navigation, badges, routeur)
  config/                  constantes et valeurs par défaut
  shared/                  utilitaires DOM, dates, formats, UI, graphiques, routeur
  database/                IndexedDB : schéma, migrations, accès bas niveau
  services/                logique métier pure (ventes, stock, trésorerie,
                           sauvegardes, chiffrement, archivage, démonstration…)
  modules/                 les 16 écrans (un fichier par écran)
  styles/                  design system Tailwind
tests/                     tests unitaires et scénario de référence
```

Principes :

- **Séparation nette** entre la logique métier (`services/`, sans DOM) et
  l'interface (`modules/`, `shared/`).
- **Aucune statistique stockée** : les indicateurs sont recalculés à partir des
  opérations, ce qui garantit leur cohérence.
- **Erreurs explicites** : les échecs d'enregistrement et les validations sont
  signalés à l'utilisateur ; pas d'échec silencieux.
- **Traçabilité** : les documents sont annulés par mouvements compensatoires et
  jamais supprimés silencieusement ; les magasins techniques (instantanés,
  journal, empreintes d'import) sont exclus des exports et de l'état métier.
- **Mode démonstration isolé** : il utilise une base IndexedDB distincte
  (`mon-commerce-demo`) ; les données réelles ne sont ni lues ni modifiées.

---

## 10. Tests

```bash
npm test
```

Les tests couvrent le stock (CMP, entrées/sorties, valorisation), les ventes, les
achats, la trésorerie, la rentabilité, les sauvegardes, les utilitaires partagés,
la sécurité (chiffrement des sauvegardes, verrouillage PIN), l'environnement
(stockage éphémère), la comptabilité simplifiée, l'import de relevés, l'archivage
et la purge, ainsi que les **scénarios obligatoires du cahier des charges** —
notamment l'exemple de référence :

> Capital 40 000 FCFA, achat de 21 pantalons à 1 500 FCFA, transport 2 000 FCFA,
> publicité 600 FCFA, 20 pantalons vendus à 2 500 FCFA.

La suite compte plus de 120 tests et s'exécute sans navigateur (logique métier
pure, IndexedDB simulée lorsque nécessaire).

---

## 11. Accessibilité et charte graphique

- Navigation au clavier (focus visibles, fermeture des fenêtres par `Échap`,
  piège de focus dans les modales), libellés et rôles ARIA, contrastes soignés.
- Palette imposée par le cahier des charges :

| Rôle | Couleur |
| --- | --- |
| Vert principal | `#15803D` |
| Vert foncé | `#166534` |
| Vert clair | `#DCFCE7` |
| Blanc | `#FFFFFF` |
| Noir profond (texte) | `#111827` |
| Gris clair (fond) | `#F3F4F6` |
| Gris secondaire | `#6B7280` |
| Rouge (erreurs) | `#DC2626` |
| Orange (avertissements) | `#D97706` |

---

## 12. Licence

MIT.
