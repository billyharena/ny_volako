# Phase 5 — Synchronisation, conflits et reprise

Validation locale : 13 octobre 2026.

## Résultat

Les écritures du carnet restent transactionnelles et locales. Elles sont désormais envoyées à Supabase lorsque le réseau et la session le permettent. Les réponses sont vérifiées avant acquittement ; une réponse perdue ne crée pas une seconde mutation. Les changements provenant d’un autre appareil sont récupérés par pages sans remplacer une intention locale en attente.

La page `/synchronisation` affiche la file, ses erreurs, les nouvelles tentatives, la dernière lecture complète et les conflits. Un choix local produit une nouvelle opération comparée à la version distante ; un choix serveur abandonne explicitement la chaîne locale de cet élément. Une dépense supprimée à distance ne peut pas être réactivée.

La page `/compte` permet de restaurer les opérations d’un export JSON. La restauration exige une file actuelle vide, une provenance confirmée et un compte correspondant. Les UUID d’origine sont conservés. Les exports v2 contrôlent aussi le serveur ; les exports v1 de phase 4 sont acceptés avec confirmation de provenance. Les données confirmées sont relues du serveur.

## Fichiers

| Fichiers | Rôle |
| --- | --- |
| `src/sync/engine.ts`, `engine.test.ts` | Ordonnanceur, bail, acquittements, fusion, conflits, reprise et tests |
| `src/sync/transport.ts`, `transport.test.ts` | Session vérifiée, jeton capturé, RPC annulables, classement des erreurs et délais |
| `src/sync/rows.ts` | Décodage, payloads métier et accès aux tables typées |
| `src/sync/recovery.ts` | Validation et restauration atomique des sauvegardes |
| `src/data/local/database.ts` | Migration Dexie v1 → v2, reçus, versions distantes et archives de résolution |
| `src/services/ledger.ts`, `src/domain/finance.ts` | Bases des opérations, état en attente, révision d’export et contrôle de déconnexion |
| `src/features/finance/Synchronization.tsx` | Suivi et résolution explicite des conflits |
| `src/features/finance/PrivateWorkspace.tsx`, `context.ts`, `Expenses.tsx` | Cycle de vie du moteur, statut et confirmation serveur |
| `src/features/auth/AccountPage.tsx`, `AuthPage.tsx` | Restauration, suspension à la déconnexion et renouvellement de connexion |
| `src/app/App.tsx` | Nouvelle route et textes de phase 5 |
| `tests/e2e/sync.spec.ts`, `ledger.spec.ts`, `playwright.config.ts` | Tests réels de synchronisation et limitation à deux processus navigateur |
| `README.md`, `docs/SYNCHRONISATION.md`, ce bilan | Utilisation, contrat et preuves de validation |

Aucune dépendance ni migration SQL supplémentaire. Les RPC et politiques de phase 3 sont réutilisées. Aucun changement sur Supabase hébergé ou Vercel.

## Vérifications effectuées

- `pnpm check` : TypeScript, ESLint, **84 tests dans 9 fichiers**, build de production réussis.
- `pnpm test:db` : **41 tests SQL réussis**, couvrant RLS, identités et RPC sur Supabase local.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e:local` : **13 parcours réussis**, un doublon mobile volontairement ignoré pour le test de fermeture complète du navigateur. Profils bureau et Pixel 7 émulé ; deux processus simultanés.
- Inspection des captures de l’écran de conflit sur bureau et mobile.

| Frontière vérifiée | Preuve |
| --- | --- |
| Interface → IndexedDB | CRUD sans réseau, réouverture, séparation de comptes et transactions annulées sur erreur |
| File → RPC | Catégorie avant dépense dépendante, chaîne création/édition/suppression et versions du prédécesseur |
| RPC → PostgreSQL | Tests SQL de reçus, concurrence et accès inter-comptes ; tests navigateur sur la vraie base locale |
| Commit serveur → reprise | Réponse HTTP volontairement perdue après `route.fetch()`, renvoi du même UUID et même requête |
| Réponse → commit local | Échec simulé de stockage du reçu puis reprise sans seconde mutation |
| Plusieurs appareils → interface | Modification concurrente, choix local puis récupération par l’autre contexte ; édition contre suppression et choix serveur |
| Export → autre appareil | Import d’une chaîne avec une création déjà confirmée à distance et une édition en attente ; deux onglets reprennent la file sans doubler la dépense |
| Fermeture → réouverture | Arrêt complet d’un navigateur avec profil persistant, conservation de la file et envoi après retour du réseau |
| Auth → isolation | Refus d’identité différente, jeton de A conservé si le SDK passe à B, réponse tardive ignorée après arrêt, expiration suspendant les échanges |
| Concurrence locale | Bail occupé/abandonné, opération `sending` reprise, saisie pendant envoi et choix de conflit devenu obsolète |
| Pagination et alertes | Plus de 500 lignes, reprise du balayage au début, absence non assimilée à suppression, alertes recalculées sans répétition |
| Migration et sauvegarde | Mise à niveau réelle d’une base Dexie v1 sans effacement de file ; export de déconnexion invalidé malgré un nombre d’opérations inchangé |

Un défaut détecté pendant les tests a été corrigé : une relance demandée pendant un cycle était différée, notamment lorsque l’onglet était masqué. Le moteur mémorise désormais cette demande ; un test de régression la couvre. Les erreurs de collecte de traces observées avec quatre processus navigateur ne se sont pas reproduites dans la validation finale à deux processus.

## Essai manuel

1. Suivre le README pour démarrer Supabase local et `pnpm dev`, puis se connecter.
2. Ajouter une dépense en ligne et vérifier que son état devient « Confirmée serveur » et la file revient à zéro.
3. Couper le réseau dans une page déjà chargée, créer/modifier une dépense, puis rétablir le réseau. Vérifier sa confirmation.
4. Ouvrir le même compte dans un second profil navigateur. Modifier la même dépense hors ligne dans le premier, puis en ligne dans le second. Reconnecter le premier et ouvrir Synchronisation : comparer base, intention locale et version serveur avant de confirmer un choix.
5. Pour tester une sauvegarde, exporter une file en attente depuis Mon compte. Sur un autre profil connecté au même compte et sans opération en attente, sélectionner le JSON, confirmer sa provenance et restaurer. Vérifier le résultat et les éventuels conflits.

Les tests automatiques sont préférables pour simuler précisément la coupure après commit serveur. Ne pas exécuter ces scénarios avec des données de production.

## Limites conservées pour les phases suivantes

- Le cache du shell et l’installation PWA restent en phase 6. La saisie hors ligne fonctionne dans une application chargée ; le test de réouverture complète rétablit le réseau pour charger le HTML.
- Les deux appareils sont représentés par deux contextes navigateur isolés sur cette machine. Aucun téléphone physique n’a été testé.
- Le navigateur peut suspendre les onglets masqués. Le moteur reprend au retour au premier plan ; aucune synchronisation application fermée n’est promise.
- Un bail abandonné peut retarder la reprise jusqu’à 60 secondes, hors suspension du navigateur. Les erreurs temporaires utilisent un backoff avec jitter, plafonné à cinq minutes sauf délai `Retry-After` supérieur.
- La lecture complète paginée privilégie la fiabilité ; son coût augmente avec le volume. Reçus, tombstones et archives locales ne sont pas purgés automatiquement.
- Les exports sont limités à 10 Mo ; leur restauration reprend les opérations en attente et ne remplace pas les paramètres du compte. IndexedDB et les exports ne sont pas chiffrés.
- Le build avertit que le fichier principal atteint environ 655 Ko minifiés (193 Ko gzip). L’optimisation du chargement reste prévue en phase 6.
- Le déploiement hébergé demeure prévu en phase 7. La phase 6 attend la validation de l’utilisateur.

## Références consultées

- [Session Supabase et renouvellement](https://supabase.com/docs/reference/javascript/auth-getsession)
- [Annulation des requêtes Supabase](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal)
- [Changelog Supabase](https://supabase.com/changelog)
- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Transactions Dexie](https://dexie.org/docs/Dexie/Dexie.transaction())

Le protocole de synchronisation est propre à Ny Volako. Les garanties annoncées reposent sur le contrat RPC, les transactions locales et les tests ci-dessus.
