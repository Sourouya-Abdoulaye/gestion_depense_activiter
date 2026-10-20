# Limites de Mon Commerce et solutions proposées

> **Document de suivi — état au 20 octobre 2026, version 1.2.0.**
> Ce document recense les limites de l'application, les solutions proposées et,
> pour chacune, ce qui a été **implémenté**, ce qui reste **partiel** et ce qui
> demeure **hors périmètre** sans backend. Chaque limite conserve le schéma :
> **Constat → Impact → Solution(s) proposée(s) → Type → Effort → Priorité.**

- Application : `Mon Commerce` (PWA, français, FCFA, hors ligne, 100 % navigateur)
- Version concernée : 1.2.0 (schéma de base : 4)
- Nature du document : analyse des limites, pistes de résolution et état d'avancement

## Comment lire ce document

| Colonne | Signification |
| --- | --- |
| **Type** | `Usage` = solution organisationnelle, sans développement · `Doc` = explication à ajouter · `Config` = réglage navigateur/appareil · `Produit` = évolution à développer · `Infra` = nécessite un serveur |
| **Effort** | `Faible` (heures) · `Moyen` (jours) · `Élevé` (semaines) |
| **Priorité** | `P1` critique · `P2` important · `P3` confort |
| **État 1.2.0** | `Implémenté` = solution en place et testée · `Partiel` = une partie utile est livrée, le reste est décrit · `Non implémenté` = piste non retenue pour l'instant · `Hors périmètre` = nécessite un backend ou une décision de développement séparée |

## État d'avancement (version 1.2.0)

| Réf | Limite | État 1.2.0 | Ce qui est livré / ce qui reste |
| --- | --- | --- | --- |
| L1 | Données sur un seul appareil | **Hors périmètre** | Mono-appareil assumé ; export/import JSON comme palliatif (L2/L3). Synchronisation serveur non développée. |
| L2 | Sauvegardes manuelles | **Implémenté** | Rappel configurable, export en un clic, sauvegarde automatique à l'ouverture lorsque le rappel est échu. |
| L3 | Conflits de restauration | **Implémenté** | Aperçu détaillé, fusion arbitrée par horodatage, instantané avant import, annulation du dernier import. |
| L4 | Volumétrie | **Partiel** | Archivage par exercice, purge guidée après export, garde volume et documentation des ordres de grandeur. Pagination complète non faite. |
| L5 | Stockage éphémère | **Implémenté** | Détection navigation privée/stockage éphémère, demande de stockage persistant, aide à l'installation iOS, écran d'échec IndexedDB. |
| L6 | Aucun droit d'accès | **Partiel** | Verrouillage PIN local (haché), anti-bruteforce, auto-verrouillage. Pas de profils multiples ni de mode consultation. |
| L7 | Données non chiffrées | **Partiel** | Sauvegarde exportée chiffrée (AES-GCM 256 + PBKDF2-SHA256) et explication dans le guide. Pas de chiffrement au repos. |
| L8 | Devise unique | **Non implémenté** | FCFA/XOF uniquement ; limite documentée. Multi-devises et taux de change non développés. |
| L9 | Pas de comptabilité légale | **Partiel** | Avertissements dans l'application et le guide, export CSV du journal simplifié en partie double. Pas de TVA, d'amortissements ni de plan comptable complet. |
| L10 | Pas de RH / paie | **Partiel** | Fiches employés et paiement de salaire relié à une dépense de personnel. Pas de contrats ni de bulletins de paie. |
| L11 | Rapports limités | **Partiel** | Comparaison avec la période précédente. Filtres avancés et rapports programmés non développés. |
| L12 | Pas de corbeille | **Partiel** | Journal des opérations, annulation de la dernière opération, traçabilité par mouvements compensatoires. Pas de corbeille avec restauration. |
| L13 | Documents peu personnalisables | **Partiel** | Trois modèles de reçus, identité, logo, coordonnées, mentions légales et pied de page. Pas d'envoi direct ni de QR de contact. |
| L14 | Coût de revient figé | **Implémenté** | Explication dans le guide et diagnostic d'écarts en lecture seule. Le recalcul ne réécrit jamais les coûts figés (choix de fiabilité). |
| L15 | Arrondis affichés | **Implémenté** | Option d'affichage des centimes (auto / 0 / 2 décimales). |
| L16 | Stock négatif bloqué | **Implémenté** | Proposition de mouvement d'ouverture à la volée lors d'une vente avec stock insuffisant. Pas d'autorisation négative avec justification. |
| L17 | Indicateurs distincts | **Implémenté** | Info-bulles « ? » sur les indicateurs et explications détaillées dans le guide. |
| L18 | Calculs côté client | **Implémenté** | Fenêtre de progression pour les exports, confirmation au-delà de 3 000 lignes, conseil d'export CSV. |
| L19 | Dépendance au navigateur | **Implémenté** | Prérequis navigateur, messages de repli si IndexedDB ou le service worker est indisponible, bannière de stockage éphémère. |
| L20 | Hors ligne partiel | **Partiel** | Cache du service worker v3 et pré-cache des ressources chargées, écran hors ligne explicite. Pas de pré-cache exhaustif ni de file d'attente (nécessiterait un backend). |
| L21 | Aucune intégration tierce | **Partiel** | Import CSV local de relevés bancaires/mobile money avec détection de colonnes, aperçu et déduplication. QR de paiement et agrégateurs non développés. |
| L22 | Pas de collaboration | **Hors périmètre** | Collaboration temps réel et profils multi-utilisateurs non développés ; les statuts des ventes/achats restent locaux. |
| L23 | Formation absente | **Implémenté** | FAQ enrichie, visite guidée rejouable, mode démonstration sur une base IndexedDB séparée. |

> Les sections détaillées ci-dessous conservent le constat d'origine et les pistes
> proposées. Pour l'état réel, se référer au tableau ci-dessus et au récapitulatif final.

---

## 1. Données et sauvegarde

### L1 — Données stockées uniquement sur l'appareil
- **Constat** : tout est enregistré dans IndexedDB du navigateur, sur un seul appareil.
- **Impact** : aucun accès depuis un autre téléphone/ordinateur ; pas de travail en équipe.
- **Solutions proposées** :
  1. (Usage) Établir une règle interne : un seul appareil « maître » par commerce.
  2. (Produit) Export/import JSON assisté et régulier, rappel automatique selon une fréquence choisie.
  3. (Infra) Ajouter plus tard une synchronisation optionnelle via un serveur (Supabase, Firebase, PocketBase) ou un fichier partagé.
- **Type** : Usage/Produit/Infra · **Effort** : Faible (usage) → Élevé (synchronisation) · **Priorité** : P1

### L2 — Sauvegardes manuelles uniquement
- **Constat** : aucune copie de sécurité automatique hors du navigateur.
- **Impact** : perte totale possible si le navigateur est nettoyé, si l'appareil est perdu ou réinitialisé.
- **Solutions proposées** :
  1. (Produit) Rappel périodique « dernière sauvegarde il y a X jours » + export en un clic.
  2. (Produit) Export automatique vers un fichier téléchargé à intervalle défini.
  3. (Produit) Sauvegarde vers un dossier choisi (API File System Access) quand le navigateur le permet.
  4. (Usage) Conserver le fichier JSON sur clé USB, e-mail ou cloud, et le nommer avec la date.
- **Type** : Produit/Usage · **Effort** : Faible (rappel) → Moyen (export planifié) · **Priorité** : P1

### L3 — Restauration sans gestion fine des conflits
- **Constat** : seulement deux modes, « fusionner » ou « remplacer ».
- **Impact** : risque d'écraser des saisies récentes lors d'une fusion sur plusieurs appareils.
- **Solutions proposées** :
  1. (Produit) Aperçu détaillé avant import (ce qui sera ajouté / modifié / supprimé).
  2. (Produit) Fusion avec résolution par horodatage (la version la plus récente gagne).
  3. (Produit) Journal des imports avec possibilité d'annuler le dernier import.
- **Type** : Produit · **Effort** : Moyen · **Priorité** : P2

### L4 — Volumétrie limitée par le quota du navigateur
- **Constat** : espace dépendant du navigateur ; historique chargé en mémoire au démarrage.
- **Impact** : au-delà de plusieurs dizaines de milliers d'opérations, lenteurs et risque de quota atteint.
- **Solutions proposées** :
  1. (Produit) Pagination / chargement différé des écrans les plus lourds.
  2. (Produit) Archivage par exercice (clôturer une année et l'isoler du quotidien).
  3. (Produit) Purge guidée des données anciennes après export.
  4. (Doc) Documenter les ordres de grandeur raisonnables (milliers d'opérations).
- **Type** : Produit/Doc · **Effort** : Moyen → Élevé · **Priorité** : P2

### L5 — Stockage éphémère en navigation privée (et sur iOS)
- **Constat** : en navigation privée, ou sur iOS pour un site non installé, les données peuvent disparaître.
- **Impact** : perte silencieuse des opérations saisies.
- **Solutions proposées** :
  1. (Produit) Détection et bandeau « navigation privée détectée : les données ne seront pas conservées ».
  2. (Produit) Invitation à installer la PWA (« Ajouter à l'écran d'accueil »).
  3. (Produit) Demande de stockage persistant dès le premier lancement.
- **Type** : Produit · **Effort** : Faible → Moyen · **Priorité** : P1

---

## 2. Sécurité et confidentialité

### L6 — Aucun compte ni droit d'accès
- **Constat** : toute personne ayant l'appareil voit toutes les données.
- **Impact** : pas de séparation employé/patron, pas de confidentialité en cas de prêt du téléphone.
- **Solutions proposées** :
  1. (Produit) Verrouillage par code PIN/biométrie à l'ouverture (WebAuthn / API de verrouillage locale).
  2. (Produit) Mode « consultation » en lecture seule.
  3. (Usage) Protéger l'appareil par un verrou système et ne pas laisser la session ouverte.
- **Type** : Produit/Usage · **Effort** : Moyen · **Priorité** : P2

### L7 — Données non chiffrées
- **Constat** : les montants sont lisibles dans la base locale du navigateur.
- **Impact** : une personne ayant un accès technique à l'appareil peut lire les données.
- **Solutions proposées** :
  1. (Produit) Chiffrement de la sauvegarde JSON exportée (mot de passe).
  2. (Produit) Chiffrement au repos via une clé dérivée d'un code PIN.
  3. (Doc) Expliquer clairement dans le guide que la sécurité repose sur l'appareil.
- **Type** : Produit/Doc · **Effort** : Élevé · **Priorité** : P3

---

## 3. Périmètre fonctionnel

### L8 — Devise unique (FCFA / XOF)
- **Constat** : pas de multi-devises ni de taux de change.
- **Impact** : inadapté aux commerces multi-devises ou frontaliers.
- **Solutions proposées** :
  1. (Produit) Champ « devise » par activité + table de taux de conversion.
  2. (Produit) Choix de la devise et du format à l'installation.
  3. (Doc) Indiquer la limite pour éviter les attentes erronées.
- **Type** : Produit/Doc · **Effort** : Élevé · **Priorité** : P3

### L9 — Ce n'est pas une comptabilité certifiée
- **Constat** : indicateurs « estimés » (marge, résultat) sans plan comptable, TVA ni amortissements.
- **Impact** : ne remplace pas un logiciel comptable ni un expert-comptable.
- **Solutions proposées** :
  1. (Doc) Avertissement clair dans l'application et le guide : outil de pilotage, pas de comptabilité légale.
  2. (Produit) Export structuré (écritures simplifiées) à destination d'un comptable.
  3. (Produit) Gestion de la TVA et des amortissements (chantier important).
- **Type** : Doc/Produit · **Effort** : Faible (doc) → Élevé (TVA) · **Priorité** : P2

### L10 — Pas de gestion RH / paie
- **Constat** : « Salaire » n'est qu'une catégorie de dépense.
- **Impact** : pas de suivi des employés, de contrats ni de bulletins.
- **Solutions proposées** :
  1. (Produit) Fiche « employé » et suivi des salaires versés.
  2. (Usage) Utiliser les dépenses avec une note par employé en attendant.
- **Type** : Produit/Usage · **Effort** : Moyen · **Priorité** : P3

### L11 — Rapports et comparaisons limités
- **Constat** : exports CSV/PDF/impression, pas de comparaison entre périodes ni de tableau de bord personnalisable.
- **Impact** : analyses manuelles dans un tableur pour aller plus loin.
- **Solutions proposées** :
  1. (Produit) Comparaison « période N vs période N-1 ».
  2. (Produit) Filtres avancés (par catégorie, produit, moyen de paiement).
  3. (Produit) Rapports programmés / envoyés par e-mail.
- **Type** : Produit · **Effort** : Moyen · **Priorité** : P2

### L12 — Suppressions contraintes et pas de corbeille
- **Constat** : une activité/produit avec des opérations ne peut pas être supprimé (archivage) ; les documents sont annulés, pas retirés.
- **Impact** : impression de ne pas pouvoir « nettoyer » une erreur.
- **Solutions proposées** :
  1. (Doc) Expliquer la logique de traçabilité (rien n'est supprimé silencieusement).
  2. (Produit) Corbeille avec restauration avant suppression définitive.
  3. (Produit) Outil d'annulation du dernier mouvement (« annuler la dernière opération »).
- **Type** : Doc/Produit · **Effort** : Moyen · **Priorité** : P2

### L13 — Documents (reçu, rapport) peu personnalisables
- **Constat** : mise en page simple, logo et nom du commerce uniquement.
- **Impact** : image de marque limitée, modèles professionnels absents.
- **Solutions proposées** :
  1. (Produit) Modèles de reçus (plusieurs mises en page).
  2. (Produit) Personnalisation (mentions légales, coordonnées, QR de contact).
  3. (Produit) Envoi direct du reçu au client (lien ou PDF partagé).
- **Type** : Produit · **Effort** : Moyen · **Priorité** : P3

---

## 4. Règles de calcul et cohérence métier

### L14 — Coût de revient figé à la vente
- **Constat** : le coût moyen pondéré d'une vente passée n'est pas recalculé si un prix d'achat change ensuite.
- **Impact** : une correction d'achat ne corrige pas rétroactivement les marges passées.
- **Solutions proposées** :
  1. (Doc) L'expliquer dans le guide (c'est un choix de fiabilité, pas un bug).
  2. (Produit) Outil de « recalcul de période » avec confirmation explicite et journal des écarts.
- **Type** : Doc/Produit · **Effort** : Faible (doc) → Élevé (recalcul) · **Priorité** : P2

### L15 — Arrondis à 2 décimales à l'affichage
- **Constat** : affichage arrondi ; calculs internes en pleine précision.
- **Impact** : de très légers écarts apparents entre lignes et totaux.
- **Solutions proposées** :
  1. (Doc) Préciser que l'arrondi se fait à l'affichage et à l'agrégation.
  2. (Produit) Option « afficher les centimes » / paramétrage de décimales.
- **Type** : Doc/Produit · **Effort** : Faible · **Priorité** : P3

### L16 — Stock négatif refusé par défaut
- **Constat** : une vente au-delà du stock est bloquée sauf réglage contraire.
- **Impact** : blocage d'une vente réelle (marchandise non saisie en stock).
- **Solutions proposées** :
  1. (Produit) Message d'aide proposant « créer un mouvement d'ouverture » à la volée.
  2. (Produit) Autorisation ponctuelle avec justification et trace.
  3. (Doc) Expliquer le paramètre « autoriser le stock négatif ».
- **Type** : Produit/Doc · **Effort** : Faible → Moyen · **Priorité** : P2

### L17 — Budget, bénéfice, chiffre d'affaires et trésorerie sont distincts
- **Constat** : quatre indicateurs différents qui ne coïncident pas.
- **Impact** : incompréhension fréquente (« pourquoi ce n'est pas le même chiffre ? »).
- **Solutions proposées** :
  1. (Doc) Déjà expliqué dans le Guide & aide ; renforcer avec des infobulles contextuelles.
  2. (Produit) Un écran « D'où viennent mes chiffres » avec la démonstration pas-à-pas d'un cas réel.
  3. (Produit) Info-bulles « ? » à côté de chaque indicateur.
- **Type** : Doc/Produit · **Effort** : Faible · **Priorité** : P3

---

## 5. Performance et technique

### L18 — Tout est calculé côté client
- **Constat** : pas de serveur ; génération de PDF/impression dans le navigateur.
- **Impact** : lenteur sur appareils modestes pour de gros rapports.
- **Solutions proposées** :
  1. (Produit) Génération progressive / en tâche de fond avec indicateur.
  2. (Produit) Limiter les exports volumineux et proposer un découpage par période.
  3. (Doc) Conseiller l'export CSV pour les gros volumes.
- **Type** : Produit/Doc · **Effort** : Moyen · **Priorité** : P3

### L19 — Dépendance au navigateur et à HTTPS
- **Constat** : nécessite JavaScript, navigateur moderne, HTTPS pour le hors ligne.
- **Impact** : inutilisable sur vieux navigateurs ou en HTTP simple (hors localhost).
- **Solutions proposées** :
  1. (Doc) Prérequis clairement listés (navigateurs supportés, HTTPS).
  2. (Produit) Message de repli explicite quand IndexedDB ou le service worker est indisponible.
  3. (Infra) Fournir une version packagée (application de bureau) si nécessaire.
- **Type** : Doc/Produit/Infra · **Effort** : Faible (doc) → Élevé (desktop) · **Priorité** : P2

### L20 — PWA hors ligne partielle au premier chargement
- **Constat** : il faut une première visite en ligne ; une page non mise en cache affiche « Hors ligne ».
- **Impact** : premier usage sans réseau impossible.
- **Solutions proposées** :
  1. (Produit) Pré-cache exhaustif et écran d'état hors ligne plus explicite.
  2. (Produit) File d'attente des opérations hors ligne puis synchronisation (seulement si backend).
- **Type** : Produit · **Effort** : Moyen → Élevé · **Priorité** : P3

### L21 — Aucune API ni intégration tierce
- **Constat** : pas de connexion banque, mobile money, ni logiciel tiers.
- **Impact** : rapprochement bancaire et encaissements manuels.
- **Solutions proposées** :
  1. (Produit) Import CSV de relevés bancaires / mobile money.
  2. (Produit) Génération de QR de paiement (selon opérateur).
  3. (Infra) Connexion à des agrégateurs de paiement (hors périmètre actuel).
- **Type** : Produit/Infra · **Effort** : Élevé · **Priorité** : P3

---

## 6. Organisation du travail et usage

### L22 — Pas de collaboration ni de validation
- **Constat** : pas de rôles, pas de circuit de validation (brouillon → validé → payé).
- **Impact** : inadapté aux équipes avec séparation des tâches.
- **Solutions proposées** :
  1. (Produit) Statuts et validations (déjà partiels sur ventes/achats) à étendre aux dépenses.
  2. (Produit) Multi-utilisateurs sur un même appareil (profils locaux avec PIN).
  3. (Infra) Collaboration temps réel via serveur.
- **Type** : Produit/Infra · **Effort** : Élevé · **Priorité** : P3

### L23 — Formation et accompagnement absents
- **Constat** : le Guide & aide explique l'application, mais pas le vocabulaire métier en détail ni la compta.
- **Impact** : erreurs de saisie par méconnaissance de gestion.
- **Solutions proposées** :
  1. (Doc) Ajouter des fiches « premiers pas » et une courte FAQ métier.
  2. (Produit) Mode démonstration avec jeu de données fictif clairement identifié (jamais mélangé aux vraies données).
  3. (Produit) Visite guidée pas-à-pas au premier lancement.
- **Type** : Doc/Produit · **Effort** : Faible → Moyen · **Priorité** : P2

---

## Récapitulatif et état d'avancement

| Réf | Limite | Solution principale | État 1.2.0 | Type | Effort | Priorité |
| --- | --- | --- | --- | --- | --- | --- |
| L2 | Sauvegardes manuelles | Rappel + export planifié | **Implémenté** | Produit | Faible→Moyen | P1 |
| L1 | Mono-appareil | Jeu de données maître + sync future | **Hors périmètre** | Usage/Infra | Faible→Élevé | P1 |
| L5 | Stockage éphémère | Détection privée + installation PWA | **Implémenté** | Produit | Faible→Moyen | P1 |
| L6 | Pas de droits | Verrouillage PIN/biométrie | **Partiel** | Produit | Moyen | P2 |
| L3 | Fusion de sauvegardes | Résolution par horodatage | **Implémenté** | Produit | Moyen | P2 |
| L4 | Volumétrie | Pagination + archivage par exercice | **Partiel** | Produit | Moyen→Élevé | P2 |
| L9 | Pas de compta légale | Avertissement + export comptable | **Partiel** | Doc/Produit | Faible→Élevé | P2 |
| L11 | Rapports limités | Comparaisons et filtres avancés | **Partiel** | Produit | Moyen | P2 |
| L12 | Pas de corbeille | Corbeille + annulation du dernier mouvement | **Partiel** | Produit | Moyen | P2 |
| L14 | Coût figé | Explication + recalcul encadré | **Implémenté** | Doc/Produit | Faible→Élevé | P2 |
| L16 | Stock négatif bloqué | Mouvement d'ouverture à la volée | **Implémenté** | Produit | Faible→Moyen | P2 |
| L19 | Dépendance navigateur | Prérequis + messages de repli | **Implémenté** | Doc/Produit | Faible→Élevé | P2 |
| L23 | Formation | Fiches + visite guidée | **Implémenté** | Doc/Produit | Faible→Moyen | P2 |
| L7 | Pas de chiffrement | Chiffrement de la sauvegarde | **Partiel** | Produit | Élevé | P3 |
| L8 | Devise unique | Multi-devises | **Non implémenté** | Produit | Élevé | P3 |
| L10 | Pas de RH | Fiches employés | **Partiel** | Produit | Moyen | P3 |
| L13 | Documents peu personnalisables | Modèles de reçus | **Partiel** | Produit | Moyen | P3 |
| L15 | Arrondis affichés | Option décimales | **Implémenté** | Doc/Produit | Faible | P3 |
| L17 | Indicateurs distincts | Info-bulles « ? » | **Implémenté** | Doc/Produit | Faible | P3 |
| L18 | Calculs côté client | Génération progressive | **Implémenté** | Produit | Moyen | P3 |
| L20 | Hors ligne partiel | Pré-cache exhaustif | **Partiel** | Produit | Moyen→Élevé | P3 |
| L21 | Pas d'intégrations | Import relevés + QR paiement | **Partiel** | Produit/Infra | Élevé | P3 |
| L22 | Pas de collaboration | Profils locaux puis temps réel | **Hors périmètre** | Produit/Infra | Élevé | P3 |

## Solutions immédiates (sans développement)

Ces actions réduisent le risque de perte de données **dès maintenant** :

1. Exporter une sauvegarde JSON après chaque journée de saisie importante et la déposer hors de l'appareil (clé USB, e-mail, cloud). Activer le rappel de sauvegarde et, si les données sont sensibles, choisir un export chiffré par mot de passe.
2. Déclarer un appareil « maître » : ne saisir les données que sur un seul appareil.
3. Installer l'application (PWA) plutôt que l'utiliser en navigation privée.
4. Cliquer sur « Demander un stockage persistant » dans **Paramètres & sauvegardes**.
5. Activer le verrouillage PIN et laisser l'auto-verrouillage se déclencher en cas d'inactivité.
6. Garder le navigateur à jour et ne pas vider ses données de navigation sans export préalable.
7. Archiver les exercices anciens après export plutôt que de laisser croître indéfiniment l'historique actif.
8. Rappeler que les chiffres sont des estimations de pilotage, pas une comptabilité officielle.

---

_Document de suivi maintenu avec l'application. Les solutions encore partielles ou non
implémentées devront respecter les conventions de calcul décrites dans le README et,
pour celles qui nécessitent un serveur (L1, L21 agrégateurs, L22 temps réel), faire
l'objet d'une décision et d'un développement séparés._
