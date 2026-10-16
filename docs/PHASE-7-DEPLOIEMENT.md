# Phase 7 — Validation et déploiement

Mise à jour : 16 octobre 2026. Phase terminée : application déployée, tests locaux et CI réussis, inscription réelle confirmée par le propriétaire.

## Infrastructure livrée

- Production : https://ny-volako-gamma.vercel.app
- Vercel : projet `ny-volako`, `prj_ErOYGqaGggFOCsxHhmYfwRrHOEZA`, espace `billy-harenas-projects`.
- Supabase : projet `ny_volako`, `yeesrgvjelezjwryxvka`, PostgreSQL 17, région `eu-west-1`.
- Dépôt : https://github.com/billyharena/ny_volako, branche `main`.

Le frontend Vite utilise Node 24.x, le lockfile pnpm et la sortie `dist`. Les routes directes sont réécrites vers le shell SPA. Les en-têtes distinguent le HTML revalidé, les assets immuables et le service worker sans cache HTTP. Les anciennes mentions de phase de développement ont été remplacées par des textes destinés aux utilisateurs.

Les variables publiques de production sont présentes dans Vercel. Aucun secret serveur n'est exposé au navigateur. Les aperçus n'ont pas reçu les variables de la base de production. Deux déploiements automatiques depuis `main` ont été observés ; le déploiement `dpl_22ivC22423F5jaRjokHcGf4y8HAQ`, commit `90d5fcb`, est `READY`.

## Base et sécurité

Les deux migrations du dépôt sont appliquées et leur historique distant correspond aux versions locales. RLS est activé et forcé sur les cinq tables métier. Le rôle interne d'écriture ne peut ni se connecter ni contourner RLS. Les RPC publiques restent des wrappers invoker ; les fonctions privilégiées sont dans le schéma privé avec droits restreints et contrôle de propriété.

Les 41 tests pgTAP passent sur la base locale. Ils ont également été exécutés sur la base hébergée dans une transaction annulée, avec collecte des résultats et exception obligatoire si le nombre d'assertions réussies diffère de 41 ou si une assertion échoue. Le contrôle après rollback confirme l'absence des deux comptes de test et de leurs dépenses/reçus. Aucun jeu de démonstration n'a été conservé.

L'audit de sécurité Supabase ne retourne aucune alerte, y compris après relecture le 16 octobre. Les requêtes REST anonymes sont refusées sur les cinq tables ; la RPC d'initialisation est également refusée sans session. Seul `.env.example` est suivi par Git ; les fichiers locaux, rapports et réglages `.vercel` sont ignorés.

## Vérifications

`pnpm check` a validé TypeScript, ESLint, 87 tests applicatifs et le build. Les tests navigateur complets du 15 octobre ont validé 17 scénarios, puis le scénario de mise à jour PWA ; un doublon mobile du test de profil persistant est volontairement ignoré.

Le script `scripts/verify-deployment.mjs` a vérifié le vrai site en HTTPS : cinq routes directes, manifeste, PNG, en-têtes, accès anonyme refusé, formulaire de connexion actif, précache de 24 ressources et navigation hors ligne sur mobile. Aucune erreur navigateur n'a été observée. Les captures mobile et bureau ont été inspectées. Ces vérifications publiques ne créent aucun compte et ne prouvent pas la livraison d'un email.

La première CI distante a révélé deux courses dans les tests : saisie dans le champ email de la page précédente avant navigation vers la récupération, et reconnexion d'un appareil avant confirmation de la suppression distante. Les tests attendent maintenant le titre de la bonne page, la confirmation locale de suppression et la réponse RPC `applied` avant de poursuivre. Les règles de synchronisation et de sécurité de l'application n'ont pas été assouplies. La relance locale du 16 octobre a validé les 17 scénarios du carnet et d'authentification ainsi que le test de mise à jour PWA. Les deux jobs de [GitHub Actions sur le commit 90d5fcb](https://github.com/billyharena/ny_volako/actions/runs/38837998012), `validate` et `database-auth`, sont réussis.

## Configuration Auth et limites

Le propriétaire a confirmé le 16 octobre l'enregistrement du Site URL de production et des deux redirections `/connexion` et `/recuperation`. Cette confirmation vient du propriétaire ; la configuration n'a pas été relue par une API d'administration. L'API publique confirme que l'authentification email et la confirmation des adresses sont activées.

Le propriétaire a confirmé le 16 octobre avoir reçu l'email, confirmé son compte et réussi sa connexion. Ce parcours est une validation humaine en production ; les tests automatisés connectés ont utilisé Supabase local. La récupération par email a été vérifiée localement, pas par un changement du mot de passe réel du propriétaire. Le fournisseur SMTP personnalisé et la longueur minimale serveur restent à vérifier dans le tableau de bord. Le service email intégré de Supabase est limité ; le guide d'exploitation explique comment ouvrir les inscriptions à d'autres adresses sans désactiver la confirmation.

Tests mobile en émulation Chromium/Edge, pas sur téléphone physique ni Safari iOS. IndexedDB n'est pas chiffré ; la persistance dépend du navigateur et ne résiste pas à l'effacement volontaire. Pas de synchronisation garantie application fermée. Aucun monitoring continu ni blocage automatique des déploiements sur CI rouge n'est configuré. Les journaux de build Vercel sont restés inaccessibles via le connecteur (403) ; l'état `READY` et les contrôles du site sont, eux, vérifiés.

## Fichiers livrés et reprise

- `vercel.json` : build, SPA et en-têtes.
- `src/app/App.tsx`, `src/app/App.test.tsx` : textes finaux de navigation.
- `tests/e2e/auth.spec.ts`, `tests/e2e/sync.spec.ts` : attentes déterministes.
- `scripts/verify-deployment.mjs` : contrôle reproductible en lecture seule.
- `README.md`, `docs/EXPLOITATION.md`, ce bilan : installation, déploiement, sauvegardes, migrations et limites.

Voir [Exploitation](EXPLOITATION.md) pour les commandes, les champs Auth exacts, le test manuel connecté et le retour arrière. Références : [Vite sur Vercel](https://vercel.com/docs/frameworks/frontend/vite), [environnements Supabase](https://supabase.com/docs/guides/deployment/managing-environments), [emails Auth](https://supabase.com/docs/guides/auth/auth-smtp).
