# Ny Volako

Application personnelle de suivi des dépenses en français, conçue pour une future utilisation hors ligne sur ordinateur et mobile.

**État : phase 2 — initialisation.** Le socle React démarre, présente l’avancement et permet de naviguer vers la configuration. L’authentification, IndexedDB, les dépenses, les budgets, la synchronisation et le service worker ne sont pas encore implémentés. Aucune donnée financière de démonstration.

## Prérequis

- Node.js **24.19.0** (version fixée dans `.node-version`).
- pnpm **11.25.0** (version fixée dans `package.json`).
- Pour la future phase 3 : Docker Desktop avec moteur Linux actif et Supabase CLI.
- Aucun compte ni secret nécessaire pour lancer le socle de phase 2.

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

Renseigner lors de la phase d’authentification :

- `VITE_SUPABASE_URL` : URL racine HTTPS du projet (HTTP autorisé pour localhost).
- `VITE_SUPABASE_PUBLISHABLE_KEY` : clé publique publishable.
- `VITE_SUPABASE_ANON_KEY` : alternative pour une ancienne clé publique anon.

Les valeurs sont facultatives **uniquement pour le socle de phase 2**. Si elles sont absentes ou si l’URL est invalide, l’interface le signale sans écran blanc. Leur présence ne prouve pas la connectivité. Vite bloque les clés Supabase non publiques avant compilation, y compris une ancienne clé masquée par une autre valeur ; ce contrôle ne remplace pas RLS. Toute variable préfixée `VITE_` peut être exposée au navigateur : ne jamais y placer de secret, même si un validateur est présent. Les fichiers `.env.local` et `.env.*` sont ignorés, à l’exception du modèle.

Aucun client Supabase ni appel réseau métier n’est activé dans cette phase. Ne pas utiliser de données réelles avant l’implémentation et les tests de sécurité de la phase 3.

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

Le test du vrai stockage persistant, les interruptions de synchronisation, RLS et le mode avion seront ajoutés aux phases 3 à 6. Les tests actuels ne démontrent pas encore le fonctionnement hors ligne.

## Structure actuelle

- `src/app/` : shell responsive, routes et tests de navigation.
- `src/components/` : limite d’erreur de rendu.
- `src/config/` : validation des variables publiques.
- `src/test/` : préparation de Testing Library.
- `tests/e2e/` : parcours navigateur.
- `docs/` : conception et bilan de phase.
- `.github/workflows/ci.yml` : installation verrouillée, contrôles et tests navigateur à chaque push/PR.

Les dépendances métier (Dexie, Supabase, Recharts) et PWA sont installées pour les étapes prévues ; elles ne sont pas importées tant que les fonctionnalités correspondantes n’existent pas, pour ne pas alourdir le bundle initial.

## Déploiement prévu

Vercel hébergera le frontend Vite : commande `pnpm build`, sortie `dist`. La configuration SPA, la liaison GitHub/Vercel, les variables distantes et la publication seront réalisées en phase 7. Le démarrage local de phase 2 ne dépend pas d’une liaison Vercel ; cela respecte le séquencement du prompt validé.

Supabase existant : projet `ny_volako`. Aucune migration n’a été exécutée. Les tests SQL devront utiliser un environnement séparé. Ne pas exécuter de réinitialisation sur le projet hébergé.

## Documents

- [Conception validée](docs/PHASE-1-CONCEPTION.md)
- [Bilan de phase 2](docs/PHASE-2-INITIALISATION.md)
