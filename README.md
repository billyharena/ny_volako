# Ny Volako

Application personnelle de suivi des dépenses en français, conçue pour une future utilisation hors ligne sur ordinateur et mobile.

**État : phase 3 — base et authentification.** Inscription avec confirmation, connexion, récupération du mot de passe et déconnexion. Migrations PostgreSQL, RLS, initialisation du compte et protocole RPC transactionnel. Les écrans de dépenses, IndexedDB, la synchronisation cliente et le service worker viendront aux phases suivantes. Aucune donnée financière de démonstration.

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

Les tests SQL vérifient RLS et les RPC avec deux comptes et le rôle anonyme. Les tests Auth locaux vérifient les emails, la récupération, la session persistante et les mutations concurrentes. Le vrai stockage IndexedDB, les interruptions de synchronisation et le mode avion seront testés aux phases 4 à 6 ; le fonctionnement hors ligne n’est pas encore implémenté.

## Structure actuelle

- `src/app/` : shell responsive, routes et tests de navigation.
- `src/components/` : limite d’erreur de rendu.
- `src/config/` : validation des variables publiques.
- `src/features/auth/` : session, formulaires et route privée.
- `src/data/remote/` : client Supabase et types générés.
- `supabase/` : configuration locale, migrations et tests SQL.
- `scripts/test-local-auth.mjs` : vérification navigateur avec Supabase local.
- `src/test/` : préparation de Testing Library.
- `tests/e2e/` : parcours navigateur.
- `docs/` : conception et bilan de phase.
- `.github/workflows/ci.yml` : installation verrouillée, contrôles et tests navigateur à chaque push/PR.

Dexie, Recharts et les outils PWA sont installés pour les étapes prévues. Le client Supabase est désormais actif lorsque les paramètres publics sont renseignés.

## Déploiement prévu

Vercel hébergera le frontend Vite : commande `pnpm build`, sortie `dist`. La configuration SPA, la liaison GitHub/Vercel, les variables distantes et la publication seront réalisées en phase 7. Le démarrage local de phase 2 ne dépend pas d’une liaison Vercel ; cela respecte le séquencement du prompt validé.

Supabase hébergé existant : projet `ny_volako`. Les migrations de phase 3 sont validées sur l’instance locale ; leur application à la cible hébergée et ses réglages Auth seront réalisés avec le déploiement de phase 7. Ne jamais exécuter de réinitialisation sur le projet hébergé.

## Documents

- [Conception validée](docs/PHASE-1-CONCEPTION.md)
- [Bilan de phase 2](docs/PHASE-2-INITIALISATION.md)
- [Base et authentification](docs/PHASE-3-BASE-AUTH.md)
- [Contrat RPC](docs/SYNCHRONISATION.md)
