# Phase 3 — Base de données et authentification

11 octobre 2026. Périmètre : base et authentification locales. Le déploiement hébergé reste en phase 7.

## Livrables

- Deux migrations créées avec Supabase CLI 2.120.0 : schéma/contraintes/RLS puis RPC/permissions.
- Tables : catégories, dépenses, budgets mensuels, paramètres et reçus persistants. Propriété liée à Auth, relation catégorie/dépense composite, montants exacts, total généré, tombstones et versions serveur.
- Initialisation idempotente et atomique du compte, lectures paginées, mutations versionnées, reçus exacts et conflits explicites. Détails dans [SYNCHRONISATION.md](SYNCHRONISATION.md).
- Aucune écriture directe du navigateur. RLS forcée sur cinq tables, rôle interne non propriétaire sans BYPASSRLS, wrappers publics SECURITY INVOKER, schéma privé et search_path vide.
- Inscription, confirmation d’email, connexion, récupération/modification du mot de passe, route privée et déconnexion de l’appareil. Session PKCE persistante ; callbacks tardifs ignorés et composant de compte remonté lors d’un changement d’identité.
- Client typé depuis le schéma local. Formulaires français accessibles ; erreurs serveur brutes non exposées.
- Configuration Supabase locale et job CI base/Auth indépendant du contrôle frontend. Emails fictifs interceptés par Mailpit, sans envoi externe.

## Vérifications

Les migrations ont été appliquées sur PostgreSQL local puis rejouées avec `supabase db reset --local --yes`. Les 41 assertions pgTAP passent : deux comptes, anonyme, refus d’écriture directe, isolation des reçus, RLS du rôle interne, référence croisée impossible, identité absente, idempotence, payload forgé, précision monétaire, conflits, tombstones, devise avec historique et unicité mensuelle.

Le lint PostgreSQL passe sans avertissement après correction de la volatilité de la fonction de conversion JSON. L’advisor de sécurité ne remonte aucune alerte. Le premier essai a révélé que le rôle postgres de Supabase ne peut pas déléguer USAGE sur auth : l’identité interne lit désormais les mêmes claims vérifiés que auth.uid(), sans privilège sur les tables Auth. Les tests prouvent que cela conserve l’isolation RLS.

Les six tests Playwright passent sur Edge bureau et Pixel 7 émulé : navigation, rechargement, clavier, inscription avec confirmation reçue dans Mailpit, persistance de session, déconnexion, récupération puis connexion avec le nouveau mot de passe. Deux requêtes concurrentes identiques retournent le même reçu ; deux mises à jour concurrentes produisent exactement un succès et un conflit. Captures bureau/mobile inspectées.

`pnpm check` passe : TypeScript strict, lint, 20 tests applicatifs et compilation de production. Ces tests couvrent aussi les erreurs de configuration, la route privée, la confirmation du mot de passe, les erreurs de connexion et une restauration de session tardive après déconnexion. Un lancement en parallèle des suites a rencontré un délai de démarrage des workers Vitest ; le contrôle final exécuté séparément passe sans erreur.

## Limites et suite

Les comptes et données de test restent uniquement dans Supabase local. Le projet Supabase hébergé et Vercel ne sont pas modifiés à cette phase. La configuration Auth distante (URLs exactes, confirmation, politique de mot de passe, SMTP et limites) devra être vérifiée lors de la mise en ligne.

Pas encore de données financières dans IndexedDB ni de moteur de synchronisation client. La déconnexion ne purge aucune base métier locale ; la protection des opérations non envoyées devra être ajoutée avec Dexie avant d’activer les écritures locales. La conservation de session du SDK n’est pas une preuve de fonctionnement hors ligne.

Phase 4 après validation utilisateur : repositories locaux transactionnels, dépenses, historique, catégories, budgets et tableau de bord. Phase 5 : ordonnanceur, file durable et résolution des conflits.
