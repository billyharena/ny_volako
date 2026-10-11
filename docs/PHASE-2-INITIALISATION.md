# Phase 2 — Initialisation

Date : 11 octobre 2026. Implémentation et vérifications locales terminées ; validation utilisateur attendue avant la phase 3.

## Résultat

Le projet React/TypeScript/Vite démarre et produit un build de production. L’écran d’accueil est en français, avec navigation responsive, page de configuration, traitement des routes inconnues et limite d’erreur de rendu. Il indique clairement que la saisie des dépenses n’est pas encore disponible.

Tailwind est intégré à Vite. Les dépendances métier imposées sont installées mais ne sont pas importées dans le bundle initial tant que leurs fonctionnalités ne sont pas implémentées. Le service worker sera activé en phase 6.

Le modèle de variables d’environnement et un fichier local vide ont été préparés. Le fichier local est ignoré par Git. Une garde Vite refuse les clés Supabase non publiques avant compilation ; le validateur d’interface distingue paramètres absents, invalides et présents, sans assimiler présence à connexion réussie.

## Versions retenues

| Outil | Version exacte |
| --- | --- |
| Node.js | 24.19.0 |
| pnpm | 11.25.0 |
| React / React DOM | 19.3.0 |
| React Router | 8.4.0 |
| TypeScript | 6.0.3 |
| Vite / plugin React | 8.3.4 / 6.1.2 |
| Tailwind CSS / plugin Vite | 4.3.3 |
| Dexie | 4.4.6 |
| Supabase JS | 2.117.3 |
| Recharts | 3.10.1 |
| Lucide React | 1.55.0 |
| vite-plugin-pwa | 2.0.0 |
| Vitest | 5.0.3 |
| Playwright | 1.64.0 |
| ESLint / typescript-eslint | 10.12.0 / 8.71.1 |

Les versions ont été consultées dans le registre npm. TypeScript 7.0.2, alors proposé comme dernière version, n’a pas été choisi : typescript-eslint exige TypeScript inférieur à 6.1.0. Les types Node sont de la branche 24, cohérente avec le runtime. Les versions directes sont exactes dans package.json et les dépendances transitives sont verrouillées dans pnpm-lock.yaml.

pnpm remplace le lockfile npm initialement envisagé : le runtime Codex dispose déjà de pnpm, alors que npm n’est pas dans le PATH. Aucun gestionnaire global n’a été installé. Une première installation interrompue par les délais réseau a été reprise avec le cache, un délai de téléchargement de 300 secondes et une concurrence réseau de 8.

## Vérifications réellement exécutées

| Vérification | Résultat |
| --- | --- |
| Installation des dépendances | Réussie, avec contrôle strict des peer dependencies |
| `pnpm install --offline --frozen-lockfile` | Réussie : « Already up to date », sans résolution réseau |
| `pnpm typecheck` | Réussi, TypeScript strict |
| `pnpm lint` | Réussi, zéro avertissement autorisé |
| `pnpm test` | 16 tests réussis, 3 fichiers |
| `pnpm build` | Réussi ; sortie `dist/` |
| `pnpm check` | Chaîne complète réussie : types, lint, tests, build |
| `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` | 4 tests réussis, profils bureau et mobile |
| Test réel de garde Vite | Une fausse clé `sb_secret_…` a provoqué le refus attendu avant compilation |
| `pnpm dev` | Serveur démarré sur `http://127.0.0.1:5173/` |
| Captures bureau/mobile | Générées par Playwright et inspectées visuellement |
| Exclusion de `.env.local` | Confirmée avec `git check-ignore` |

Build observé : JavaScript 269,90 kB (86,21 kB gzip), CSS 11,55 kB (3,60 kB gzip). Ce bundle ne contient pas encore le moteur métier ni la synchronisation.

Tests couverts : configuration manquante, clé publique et ancienne clé anon, refus de clés privilégiées ou malformées, refus d’URL non sûre, absence de valeurs sensibles dans les messages, garde avant compilation, navigation, retour depuis une route inconnue et récupération d’une erreur de rendu.

Les tests navigateur utilisent le vrai build servi par Vite preview : ouverture, navigation, rechargement d’une route directe, accès clavier au contenu, absence d’erreurs JavaScript/console et de débordement horizontal sur les pages testées. Edge est le navigateur réellement utilisé localement. Le profil mobile est une émulation Pixel 7, pas un test sur un appareil Android physique. La CI prévue utilise Chromium.

## Fichiers créés ou modifiés

- Initialisation : `package.json`, `pnpm-lock.yaml`, `.node-version`, `.npmrc`, `.gitignore`, `.gitattributes`, `.env.example`, `index.html`, `public/favicon.svg`.
- Configuration : `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`.
- Interface : `src/main.tsx`, `src/styles.css`, `src/app/App.tsx`, `src/components/ErrorBoundary.tsx`.
- Environnement : `src/config/environment.ts`, `src/vite-env.d.ts`.
- Tests : `src/test/setup.ts`, `src/config/environment.test.ts`, `src/app/App.test.tsx`, `src/components/ErrorBoundary.test.tsx`, `tests/e2e/smoke.spec.ts`.
- CI : `.github/workflows/ci.yml`.
- Documentation : `README.md`, ce bilan ; arborescence cible de `docs/PHASE-1-CONCEPTION.md` ajustée pour pnpm.
- Local uniquement : `.env.local`, `node_modules/`, `dist/`, `test-results/` et `playwright-report/`, tous exclus du versionnement.

Le code intégral est présent dans ces fichiers ; aucune étape de copie de fragments depuis le chat n’est nécessaire.

## Reproduire et vérifier

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm dev
```

Sur Windows avec Edge déjà installé, utiliser la variante PLAYWRIGHT_CHANNEL décrite dans le README, sans télécharger Chromium. Les commandes `pnpm.cmd` sont également utilisables sous PowerShell.

Vérifications manuelles proposées à l’utilisateur : ouvrir l’accueil, aller à Configuration, recharger cette page, visiter une URL inconnue et naviguer au clavier. Les dépenses, le compte utilisateur et le mode hors ligne complet ne sont pas encore testables.

## Limites et suite

- Aucune migration Supabase, aucun accès métier distant, aucune donnée financière ni authentification implémentée pendant cette phase.
- Pas encore de test RLS, de persistance IndexedDB, de synchronisation ou de service worker. Ces scénarios restent obligatoires aux phases prévues.
- La CI GitHub est écrite mais n’a pas encore été exécutée sur GitHub. Les modifications sont locales ; aucun commit/push ni déploiement effectué à cette phase.
- La liaison Vercel reste à effectuer à la phase de déploiement, conformément au séquencement demandé. Le démarrage local ne nécessite pas cette liaison.
- Pour la phase 3, il faudra vérifier/démarrer Docker Desktop afin d’exécuter les migrations et tests PostgreSQL sur une base locale séparée ; le moteur était inaccessible lors de l’audit. Supabase CLI reste à préparer.
- L’installation signale une dépendance transitive dépréciée (`glob@11.1.0`). Cela n’a pas empêché les contrôles ; aucune suppression forcée ni mise à jour transitive hasardeuse n’a été appliquée. Cela ne constitue pas un audit de vulnérabilités.

Prochaine phase soumise à validation : migrations, contraintes, RLS, protocole RPC et authentification Supabase.
