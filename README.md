# Mon Commerce — gestion commerciale et financière

Application web de gestion **pour les petits commerçants** : achats, ventes, stock,
dépenses, trésorerie, clients/fournisseurs et rentabilité. L'interface, la
documentation et les messages sont **en français**, les montants sont en
**FCFA (XOF)**.

L'application fonctionne **entièrement dans le navigateur** : aucun compte, aucun
serveur, aucune synchronisation. Les données sont enregistrées dans
**IndexedDB**, sur l'appareil, et l'application s'ouvre **hors connexion** (PWA)
après un premier chargement.

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
| **Rapports** | Synthèses datées, exports CSV, impressions et PDF. |
| **Assistant de rentabilité** | Seuil de rentabilité, marges par produit, simulation de prix. |
| **Paramètres & sauvegardes** | Nom du commerce, catégories, moyens de paiement, formats, sauvegarde/restauration, réinitialisation. |

Aucune donnée de démonstration n'est présentée comme réelle : tant qu'aucune
opération n'a été saisie, les écrans affichent un état vide explicite.

---

## 6. Sauvegardes et restauration

Depuis **Paramètres & sauvegardes** :

- **Exporter** : produit un fichier JSON horodaté (toutes les données + réglages).
- **Restaurer** : importer un fichier JSON, avec **deux modes** :
  - *Fusionner* : ajoute et met à jour les enregistrements existants, conserve le reste ;
  - *Remplacer* : remplace intégralement les données actuelles.
  Un aperçu (version, date, décompte des enregistrements) est affiché avant l'import.
- **Réinitialiser** : efface toutes les données (confirmation écrite demandée).

Bon à savoir : les données vivent dans le navigateur de **cet appareil**.
Supprimer les données du navigateur, vider le cache ou changer d'appareil peut
les faire disparaître. **Exportez régulièrement** et conservez le fichier en lieu
sûr (clé USB, e-mail, cloud).

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
- **Pas de comptes ni de droits d'accès** : toute personne ayant accès à l'appareil
  accède aux données.
- **Dépendance au navigateur** : la suppression des données de navigation efface
  l'application et ses données si aucune sauvegarde n'a été exportée.
- **Volumétrie** : optimisé pour l'usage d'un petit commerce ; les très grands
  historiques ralentissent l'affichage des rapports.
- **Devise** : FCFA uniquement (pas de multi-devises ni de taux de change).
- **Documents** : reçus/PDF générés côté navigateur, au format simple.
- **PWA hors connexion** : nécessite un premier chargement en ligne et HTTPS.

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
  services/                logique métier pure (ventes, stock, trésorerie, …)
  modules/                 les 13 écrans (un fichier par écran)
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

---

## 10. Tests

```bash
npm test
```

Les tests couvrent le stock (CMP, entrées/sorties, valorisation), les ventes, les
achats, la trésorerie, la rentabilité, les sauvegardes, les utilitaires partagés,
ainsi que les **scénarios obligatoires du cahier des charges** — notamment
l'exemple de référence :

> Capital 40 000 FCFA, achat de 21 pantalons à 1 500 FCFA, transport 2 000 FCFA,
> publicité 600 FCFA, 20 pantalons vendus à 2 500 FCFA.

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
# gestion_depense_activiter
