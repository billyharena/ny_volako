# Ny Volako

Application personnelle de suivi des dépenses en français, utilisable hors ligne sur ordinateur et mobile après une première connexion.

**État : phase 6 — PWA et interface.** Dépenses, historique, catégories, budgets et tableau de bord utilisent IndexedDB. La file persistante se synchronise avec Supabase, avec reçus idempotents, réessais, protection entre onglets et résolution explicite des conflits. Le build comprend maintenant le cache hors ligne, le manifeste et les commandes d’installation et de mise à jour. Export et restauration des opérations sont disponibles. Aucune donnée financière de démonstration.

## Prérequis

- Node.js **24.19.0** (version fixée dans `.node-version`).
- pnpm **11.25.0** (version fixée dans `package.json`).
- Docker Desktop avec moteur Linux actif pour tester la base ; Supabase CLI est une dépendance verrouillée.
- Aucun compte hébergé ni secret nécessaire pour les tests locaux.

pnpm a été retenu car il est déjà fourni par l’environnement Codex. Utiliser uniquement `pnpm-lock.yaml` ; ne pas créer de lockfile npm/yarn concurrent.

## Installation et lancement

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir http://127.0.0.1:5173. Le serveur écoute seulement sur la machine locale. Sous PowerShell, `pnpm.cmd` peut remplacer `pnpm` si la politique d’exécution bloque les scripts.

Si pnpm n’est disponible que dans le runtime Codex de cette machine :

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" dev
```

Le port est strict : si 5173 est occupé, arrêter le serveur précédent ou utiliser `pnpm dev --port 5174`.

## Environnement

Copier `.env.example` en `.env.local` :

```powershell
Copy-Item .env.example .env.local
```

Renseigner pour activer l’authentification :

- `VITE_SUPABASE_URL` : URL racine HTTPS du projet (HTTP autorisé pour localhost).
- `VITE_SUPABASE_PUBLISHABLE_KEY` : clé publique publishable.
- `VITE_SUPABASE_ANON_KEY` : alternative pour une ancienne clé publique anon.

Si les valeurs sont absentes ou si l’URL est invalide, l’interface le signale et désactive la connexion. Leur présence ne prouve pas la connectivité. Vite bloque les clés Supabase non publiques avant compilation, y compris une ancienne clé masquée par une autre valeur ; ce contrôle ne remplace pas RLS. Toute variable préfixée `VITE_` peut être exposée au navigateur : ne jamais y placer de secret. Les fichiers `.env.local` et `.env.*` sont ignorés, à l’exception du modèle.

Le client utilise PKCE et une session persistante. Les liens de confirmation et de récupération doivent être ouverts dans le navigateur qui a initié la demande. Les redirections locales autorisées sont `/connexion` et `/recuperation` sur les ports 5173 et 4173.

## Supabase local et tests d’authentification

```sh
pnpm exec supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
pnpm test:db
pnpm test:e2e:local
```

Le dernier script lit uniquement l’URL et la clé publique locales pour compiler le frontend puis exécuter les tests navigateur. Il refuse une URL distante. Les emails fictifs sont capturés dans Mailpit : http://127.0.0.1:54324. Les comptes de test restent dans la base locale. Sous Windows, utiliser `$env:PLAYWRIGHT_CHANNEL = 'msedge'` si les navigateurs Playwright ne sont pas installés.

Pour le développement interactif, récupérer `API_URL` et `PUBLISHABLE_KEY` avec `pnpm exec supabase status -o json` et les reporter dans les deux variables publiques de `.env.local`. Ne jamais copier `SECRET_KEY` ou `SERVICE_ROLE_KEY` dans Vite. Redémarrer `pnpm dev` après configuration.

Pour vérifier la reproductibilité, **sur la base locale jetable uniquement**, `pnpm exec supabase db reset --local --yes` réapplique les migrations et efface les données locales. Les tests SQL s’exécutent dans une transaction annulée. `pnpm exec supabase db lint --local --fail-on warning` et `pnpm exec supabase db advisors --local --type security --level warn --fail-on warn` contrôlent la base.

## Contrôles

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check
```

`pnpm check` enchaîne typecheck, lint, tests et build. `pnpm test:watch` lance les tests en observation. Le build produit `dist/`.

### Tests navigateur du build

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

Playwright démarre automatiquement `pnpm preview` sur http://127.0.0.1:4173. Deux profils : bureau Chromium et viewport mobile Pixel 7. Le profil mobile est une émulation, pas un test sur téléphone physique.

Alternative avec Edge déjà installé sur Windows :

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
pnpm test:e2e
Remove-Item Env:PLAYWRIGHT_CHANNEL
```

Tests présents : navigation, route directe après rechargement, page inconnue, accès clavier au contenu, absence d’erreurs JavaScript et de débordement horizontal sur la configuration ; variables absentes/invalides, URL non sûre, clé anon et refus des clés privilégiées.

Les tests SQL vérifient RLS et les RPC avec deux comptes et le rôle anonyme. Les tests Auth locaux vérifient les emails, la récupération et la session persistante. Les tests du carnet et de synchronisation couvrent calculs exacts, transactions, alertes, conflits, reçus perdus, réessais, migration Dexie, restauration et isolation des comptes. Les parcours navigateur utilisent le vrai IndexedDB et Supabase local, y compris deux contextes concurrents et un profil conservé après fermeture complète du navigateur, rouvert sans réseau avec une session stockée expirée. `test:e2e:local` exécute ensuite `test:pwa`, avec un serveur de test qui change le HTML et sa révision précachée pour vérifier la transition entre deux service workers. Ce serveur n’est pas livré dans `dist`.

## Utiliser le carnet

Après connexion, ouvrir `/tableau-de-bord`. `/depenses/nouvelle` permet la saisie, `/depenses` la recherche et la modification/suppression, `/categories` la gestion des catégories et `/budgets` les plafonds et seuils mensuels. `/synchronisation` affiche les opérations, erreurs et conflits, et permet une relance manuelle. `/compte` propose export, restauration JSON et déconnexion.

La première ouverture exige le réseau. Après préparation complète du cache, l’application peut redémarrer sans réseau. Une session stockée expirée permet seulement de rouvrir le carnet local ; toute synchronisation exige une identité vérifiée par Supabase. En présence d’opérations en attente, terminer leur synchronisation ou télécharger une sauvegarde à jour et confirmer sa réception avant déconnexion. Les données restent sur l’appareil pour la reconnexion au même compte ; IndexedDB n’est pas chiffré et l’effacement des données du navigateur peut le supprimer.

## Installer et mettre à jour

Compiler avec `pnpm build`, puis ouvrir `pnpm preview` : le service worker est activé uniquement dans le build, sur HTTPS ou localhost. La section « Installer et utiliser hors ligne » indique quand le cache est prêt, propose l’installation si le navigateur le permet, et permet de demander un stockage persistant. Sur Safari iOS : Partager → Sur l’écran d’accueil. La persistance reste une décision du navigateur et ne protège pas d’un effacement volontaire.

Une nouvelle version affiche « Mettre à jour maintenant ». Enregistrer ou fermer les formulaires, attendre les opérations de sauvegarde/restauration et fermer les autres fenêtres de l’application. Le bouton suspend la synchronisation, bloque les nouvelles écritures et attend les transactions avant de recharger. Les données et UUID en attente restent dans IndexedDB. Aucun rechargement n’est imposé aux autres onglets. Les fichiers publics sont précachés ; aucune réponse Auth, REST ou RPC ne l’est. Les opérations ne sont pas envoyées quand l’application est fermée.

Les icônes PNG sont reproductibles avec `node scripts/generate-icons.mjs`. Le schéma Dexie reste en version 2 ; les futures migrations doivent conserver les opérations et être testées avant publication.

Une restauration exige une file actuelle vide et un fichier du même compte/serveur (10 Mo maximum). Elle reprend les UUID des opérations pour éviter les doublons ; les données déjà confirmées sont relues du serveur. Les conflits restent soumis à votre choix. Après fermeture brutale d’un onglet, la reprise peut attendre l’expiration de son bail, au maximum une minute hors throttling du navigateur. Les réessais respectent aussi le délai demandé par le serveur.

## Structure actuelle

- `src/app/` : shell responsive, routes et tests de navigation.
- `src/components/` : limite d’erreur de rendu.
- `src/config/` : validation des variables publiques.
- `src/features/auth/` : session, formulaires et route privée.
- `src/data/remote/` : client Supabase et types générés.
- `src/data/local/` : base Dexie par compte et file d’opérations.
- `src/domain/` : validation et calculs décimaux exacts.
- `src/services/` : écritures transactionnelles, alertes et sauvegarde.
- `src/sync/` : transport authentifié, ordonnancement, reçus, conflits et restauration.
- `src/features/finance/` : écrans du carnet et graphiques.
- `src/pwa/` : précache public, installation, barrière d’écriture et mise à jour explicite.
- `supabase/` : configuration locale, migrations et tests SQL.
- `scripts/test-local-auth.mjs` : vérification navigateur avec Supabase local.
- `src/test/` : préparation de Testing Library.
- `tests/e2e/` : parcours navigateur.
- `docs/` : conception et bilan de phase.
- `.github/workflows/ci.yml` : installation verrouillée, contrôles et tests navigateur à chaque push/PR.

Dexie et Recharts sont utilisés par le carnet. Les écrans et graphiques sont chargés à la demande et restent précachés pour le mode hors ligne. Le client Supabase est actif lorsque les paramètres publics sont renseignés.

## Déploiement prévu

Vercel hébergera le frontend Vite : commande `pnpm build`, sortie `dist`. La configuration SPA, la liaison GitHub/Vercel, les variables distantes et la publication seront réalisées en phase 7. Le démarrage local de phase 2 ne dépend pas d’une liaison Vercel ; cela respecte le séquencement du prompt validé.

Supabase hébergé existant : projet `ny_volako`. Les migrations de phase 3 sont validées sur l’instance locale ; leur application à la cible hébergée et ses réglages Auth seront réalisés avec le déploiement de phase 7. Ne jamais exécuter de réinitialisation sur le projet hébergé.

## Documents

- [Conception validée](docs/PHASE-1-CONCEPTION.md)
- [Bilan de phase 2](docs/PHASE-2-INITIALISATION.md)
- [Base et authentification](docs/PHASE-3-BASE-AUTH.md)
- [Fonctionnalités principales et vérifications](docs/PHASE-4-FONCTIONNALITES.md)
- [Synchronisation et reprise](docs/PHASE-5-SYNCHRONISATION.md)
- [PWA et interface](docs/PHASE-6-PWA.md)
- [Contrat RPC](docs/SYNCHRONISATION.md)
