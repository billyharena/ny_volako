# Phase 4 — Fonctionnalités principales

Date : 12 octobre 2026.

## Fonctionnalités livrées

- Dépenses : création, modification, suppression confirmée, date et catégorie, prix unitaire, quantité et frais. Total calculé immédiatement ; quantité initiale 1 et frais 0.
- Historique : recherche par motif, filtres de dates et catégorie, total filtré, accès au détail et indication des changements locaux.
- Catégories : création, renommage et désactivation. Les anciennes dépenses conservent leur catégorie désactivée.
- Budgets : plafond par mois et seuils configurables, dépenses cumulées, solde et pourcentage. Les franchissements simultanés sont regroupés ; masquer une alerte est persistant. Redescendre sous un seuil permet un nouveau signalement au prochain franchissement.
- Tableau de bord : dépenses du jour et du mois, budget, restant/dépassement, graphiques quotidiens et par catégorie, détail textuel accessible et dernières dépenses.
- Compte : export JSON cohérent du carnet et de sa file. Les opérations en attente imposent un export à jour et une confirmation avant déconnexion. Les données ne sont pas effacées et restent accessibles après reconnexion au même compte.

## Stockage et intégrité

Conformément à l’architecture retenue, les écrans utilisent dès maintenant le socle Dexie nécessaire aux écritures durables. La synchronisation réseau reste en phase 5.

La base IndexedDB est distincte par projet Supabase et compte. Au premier accès, les RPC authentifiées initialisent le compte et importent ses données par pages ; les réponses sont validées avant insertion transactionnelle. Une base déjà initialisée conserve son contenu sans remplacement à la reconnexion.

Les écritures métier, la file d’opérations et les transitions d’alertes partagent une transaction. Un échec d’écriture annule l’ensemble. Les versions locales empêchent l’écrasement silencieux depuis un formulaire ouvert dans un autre onglet. Le verrou de déconnexion utilise l’identifiant stable de la session Auth et sérialise sa vérification avec les mutations des autres onglets.

Les montants et quantités restent des chaînes décimales. Les calculs utilisent BigInt avec un arrondi identique au contrat SQL ; la conversion en Number est réservée aux dimensions des graphiques. Les totaux et infobulles restent exacts.

## Fichiers concernés

- `src/domain/finance.ts` et son test : modèles, validation, calculs et budgets.
- `src/data/local/database.ts` : schéma Dexie et file persistante.
- `src/data/remote/bootstrap.ts` et son test : import initial et validation des réponses.
- `src/services/ledger.ts` et son test : transactions, révisions, alertes, export et déconnexion.
- `src/features/finance/` : contexte, espace privé, écrans de dépenses/catégories/budgets/tableau de bord, graphiques, alertes, formulaires et styles.
- `src/features/auth/AccountPage.tsx` : compte, sauvegarde et déconnexion protégée.
- `src/app/App.tsx`, `src/app/App.test.tsx`, `src/styles.css` : routes, navigation et intégration.
- `tests/e2e/ledger.spec.ts`, `tests/helpers/local-auth.ts`, `tests/e2e/smoke.spec.ts` : parcours navigateur et inscription locale.
- `README.md`, `docs/SYNCHRONISATION.md` et ce bilan : utilisation et contrat local.

Aucune migration SQL ni dépendance supplémentaire dans cette phase.

## Vérifications

`pnpm check` réussit : TypeScript, ESLint, 60 tests dans 7 fichiers et build de production. Les tests couvrent notamment les décimales et bornes, annulations transactionnelles, conflits locaux, chaînes d’opérations, séparation des comptes, seuils et verrou de déconnexion.

`pnpm test:e2e:local` réussit : **8 tests navigateur** sur bureau et mobile émulé (Edge). Le parcours du carnet utilise le vrai IndexedDB : création d’un budget et d’une catégorie, création/modification/suppression sans réseau, alertes, filtres, fermeture/réouverture de page, export, déconnexion et reconnexion entre deux comptes. Les parcours d’authentification de phase 3 et de navigation sont également vérifiés.

## Essai manuel

1. Démarrer Docker et Supabase local selon le README, puis `pnpm dev` avec les variables publiques locales configurées.
2. Créer un compte ; ouvrir le lien de confirmation reçu dans Mailpit avec le même navigateur.
3. Dans Budget, définir 100 Ar pour le mois courant et conserver les seuils 70, 85 et 100.
4. Ajouter une dépense de 37,50 Ar avec une quantité de 2 : vérifier 75 Ar et l’alerte à 70 %. Passer la quantité à 3 : vérifier 112,50 Ar et les deux seuils suivants.
5. Tester les filtres de l’historique, la suppression confirmée et les graphiques du tableau de bord.
6. Couper le réseau dans une page déjà ouverte ; vérifier une nouvelle saisie, puis rétablir le réseau avant de rouvrir la page.
7. Dans Mon compte, exporter les données, confirmer le téléchargement puis se déconnecter. Se reconnecter au même compte pour retrouver le carnet.

## Limites et suite

- Aucun envoi automatique ou manuel de la file au serveur à ce stade. La phase 5 doit livrer la synchronisation, les conflits distants, les réessais, la reprise et la restauration d’export.
- Le premier accès et le chargement HTML nécessitent le réseau. Le service worker et le démarrage à froid hors ligne sont prévus en phase 6. La réouverture testée concerne une page dans le même contexte navigateur, pas un redémarrage complet du navigateur ou du système.
- IndexedDB n’est pas chiffré ; l’effacement du stockage du navigateur supprime les données locales. L’export contient des données personnelles et doit être conservé dans un emplacement privé.
- Les graphiques sont chargés séparément avec un repli textuel en cas d’échec. Le build avertit que le fichier principal atteint environ 627 Ko minifiés (186 Ko gzip) ; l’optimisation du chargement reste à traiter en phase 6.
- Le mobile est émulé dans Edge/Chromium ; aucun téléphone physique n’a été utilisé. Aucun déploiement Supabase hébergé ou Vercel n’est effectué avant la phase 7.

La phase 5 attend la validation de l’utilisateur, conformément au séquencement du prompt initial.
