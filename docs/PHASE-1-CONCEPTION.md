# Ny Volako — Phase 1 : audit et conception

Date : 11 octobre 2026. Statut : proposition soumise à validation. Aucune application, migration ou infrastructure créée à cette phase.

## 1. Audit vérifié

| Élément | Constat |
| --- | --- |
| Dépôt | https://github.com/billyharena/ny_volako ; public ; droits de lecture et écriture disponibles via le connecteur |
| Dossier local | Seulement `.git` avant cet audit ; aucun commit, code, AGENTS.md ou manifeste de dépendances |
| Branche | `main`, sans commit ; aucun historique à préserver |
| Supabase | Projet `ny_volako`, référence `yeesrgvjelezjwryxvka`, région `eu-west-1`, état `ACTIVE_HEALTHY` |
| PostgreSQL | Version retournée : `17.11.0.003` ; aucune table dans `public`, aucune migration enregistrée |
| Vercel | Recherche de projets contenant `ny` : aucun résultat ; liste des équipes : vide avec la connexion actuelle. Cela ne prouve pas l'absence de projets sous un autre compte |
| Node | `24.19.0`, fourni par le runtime Codex |
| Outillage | `npm`, `vercel` et `supabase` non trouvés dans le PATH ; Docker CLI présent, moteur Linux inaccessible |
| Git local | Avertissement de propriétaire différent ; inspection avec `git -c safe.directory=...`, sans changer la configuration globale |

Aucune version de bibliothèque existante à conserver. Les versions stables exactes et leurs peer dependencies seront résolues en phase 2, puis verrouillées avec un lockfile. Ne pas annoncer aujourd'hui une compatibilité de versions non installées. La configuration Auth, les clés publiques, les limites de forfait et les droits de déploiement restent à vérifier lors des phases correspondantes.

## 2. Architecture retenue

SPA React + TypeScript strict + Vite ; Tailwind CSS, React Router, Lucide, Recharts et vite-plugin-pwa. Supabase Auth et PostgreSQL, sans serveur applicatif supplémentaire. Dexie est la source de lecture de l'interface ; aucune écriture utilisateur ne dépend d'une réponse réseau.

Flux : **interface → service métier → transaction IndexedDB (entité + opération) → moteur de synchronisation → RPC PostgreSQL → accusé de réception → IndexedDB**.

Les calculs, validations et règles de budget restent indépendants de React. Les repositories encapsulent Dexie et le SDK officiel Supabase. Les composants affichent les données locales et invoquent les services. Les appels réseau ne sont jamais exécutés au milieu d'une transaction Dexie.

Outils de validation proposés : Vitest, Testing Library, fake-indexeddb pour les intégrations locales, Playwright pour le navigateur réel, pgTAP pour PostgreSQL/RLS. Ajouter une bibliothèque de validation uniquement si elle simplifie réellement les formulaires ; calcul décimal à échelle fixe avec BigInt, sans dépendance financière supplémentaire.

Nom affiché : **Ny Volako**. Français, MGA par défaut, fuseau budgétaire `Indian/Antananarivo`. Date du formulaire issue du calendrier local de l'appareil ; `expense_date` reste une date civile, sans conversion UTC. Une seule devise comptable par compte en V1 ; changer la devise avec des écritures existantes sera bloqué pour ne pas additionner des monnaies différentes. Les préférences visuelles restent modifiables.

### Arborescence cible (non encore créée)

```text
ny_volako/
  src/
    app/                 # routes, providers, shell responsive
    components/          # primitives accessibles et états partagés
    features/
      auth/
      dashboard/
      expenses/
      categories/
      budgets/
      settings/
      sync/              # statut, erreurs, résolution des conflits
    domain/              # types, validation, monnaie, dates, seuils
    services/            # cas d'usage et transactions métier
    data/
      local/             # schéma Dexie, migrations, repositories
      remote/            # client Supabase, types générés, RPC
    sync/                # ordonnanceur, transport, reprise, conflits
    pwa/                 # installation et mise à jour
    test/
  public/icons/
  supabase/
    config.toml
    migrations/
    tests/
  tests/e2e/
  docs/
    PHASE-1-CONCEPTION.md
    SYNCHRONISATION.md
    EXPLOITATION.md
  .github/workflows/ci.yml
  .env.example
  .gitignore
  package.json
  pnpm-lock.yaml         # choix de phase 2 : pnpm disponible dans le runtime
  vite.config.ts
  vercel.ts
  README.md
```

## 3. Modèle PostgreSQL

Sauf `user_settings`, chaque entité possède un UUID client `id`, `user_id` lié à `auth.users`, `created_at`, `updated_at` et une `version bigint` gérée exclusivement par le serveur. Horodatages serveur en `timestamptz`. La version décide des conflits, jamais l'horloge du téléphone.

| Table | Champs spécifiques et contraintes |
| --- | --- |
| `categories` | `name` non vide et longueur bornée, `icon` optionnel issu d'une liste autorisée, `is_active`; `UNIQUE(user_id,id)` pour la relation composite |
| `expenses` | `expense_date date`, `motif` non vide et borné, `category_id`, `unit_price numeric(14,2) >= 0`, `quantity numeric(10,3) > 0`, `extra_fee numeric(14,2) >= 0`, `total numeric` généré, `deleted_at timestamptz NULL` |
| `monthly_budgets` | `month_start date` contraint au premier jour, `budget_limit numeric(14,2) > 0`, `warning_thresholds integer[]` non vide, valeurs distinctes entre 1 et 100 ; `UNIQUE(user_id,month_start)` |
| `user_settings` | `user_id` clé primaire, `currency` MGA par défaut, `timezone`, `theme`, `locale`, version et horodatages ; pas de données sensibles supplémentaires |
| `sync_receipts` | `(user_id,operation_id)` unique, type d'entité, identifiant, empreinte de la requête, résultat canonique/version, horodatage ; reçus d'idempotence persistants |

Relations : `auth.users` → toutes les données du compte ; `categories(user_id,id)` ← `expenses(user_id,category_id)`. La clé étrangère composite interdit de sélectionner la catégorie d'un autre compte, même si son UUID est connu. Pas de suppression physique des catégories : leur désactivation conserve l'historique. Les dépenses sont supprimées logiquement ; les tombstones restent synchronisables.

Le total serveur sera `round(unit_price * quantity + extra_fee, 2)`. Le client reproduira exactement cet arrondi (au plus proche, moitié supérieure pour les valeurs non négatives), en utilisant des chaînes décimales et des entiers à échelle fixe. Prix/frais : deux décimales maximum ; quantité : trois. Rejeter les valeurs non finies, négatives, hors bornes ou excessivement précises. Les flux RPC transmettront les décimaux sous forme de chaînes pour éviter une conversion JSON flottante ; même règle pour les versions bigint. Les graphiques pourront convertir des valeurs bornées en nombres uniquement pour le rendu.

Index : dépenses `(user_id,expense_date,id)`, catégories `(user_id,is_active)`, unicité des budgets, reçus `(user_id,operation_id)`. Limites de longueur et bornes financières identiques côté client/serveur. Pas de purge automatique des tombstones ni reçus en V1 : simplicité et sécurité des longues périodes hors ligne, contre une croissance du stockage à surveiller.

Configuration initiale transactionnelle et idempotente après la première connexion : paramètres et catégories par défaut (Alimentation, Transport, Logement, Santé, Loisirs, Autres). Deux connexions concurrentes ne doivent pas dupliquer ces catégories. Aucun budget artificiel ; l'utilisateur définit le sien. Budget propre à chaque mois, jamais de modification rétroactive implicite.

## 4. Synchronisation détaillée

### Stockage local

Base Dexie séparée par compte. Stores : `expenses`, `categories`, `monthly_budgets`, `user_settings`, `sync_queue`, `remote_shadows`, `conflicts`, `sync_meta`, `budget_alert_state`.

Une opération contient `operation_id`, `user_id`, `entity_type`, `entity_id`, `kind`, `payload`, `base_version`, `predecessor_id`, `created_at`, `attempt_count`, `status`, `next_retry_at`, `last_error` et version de format. Statuts : pending, sending, retry, blocked, conflict, acknowledged. Pas de secret ni de jeton dans les erreurs.

1. Valider puis enregistrer l'entité, l'opération et les changements d'état des alertes dans une transaction locale unique.
2. Confirmer « enregistré sur cet appareil » seulement après validation de la transaction IndexedDB.
3. Tenter la synchronisation à l'ouverture, au retour au premier plan, à l'événement online, après mutation, sur échéance de retry et sur demande manuelle. Interroger périodiquement le serveur lorsque l'application est visible pour récupérer les changements d'un autre appareil.
4. Vérifier l'identité distante, rafraîchir la session si nécessaire, puis traiter catégories avant dépenses dépendantes et conserver l'ordre par entité.
5. Les opérations successives sur une même entité forment une chaîne. À l'acquittement du prédécesseur, attribuer sa version retournée au successeur encore non envoyé. Dès le premier envoi, le contenu de la requête est immuable. Les nouvelles modifications deviennent de nouvelles opérations.

### Protocole serveur atomique

Une RPC applique chaque mutation dans une transaction PostgreSQL : authentifier, sérialiser les appels concurrents du même identifiant d'opération, chercher le reçu, comparer son empreinte, vérifier la propriété et la version, appliquer la mutation, incrémenter la version, enregistrer le reçu et retourner le résultat canonique.

- Même opération et même contenu : retourner le même reçu, sans réappliquer.
- Même identifiant avec un contenu différent : erreur explicite.
- Version attendue différente : conflit, aucune écriture écrasée.
- Création avec identifiant existant : conflit sauf reçu correspondant.
- Modification contre une suppression concurrente : conflit, jamais de résurrection automatique.
- Deux créations de budget pour le même mois : l'unicité bloque le doublon, puis la résolution présente les deux intentions.

Les écritures directes depuis le rôle navigateur seront interdites afin de ne pas contourner versions et reçus. La procédure interne sera dans un schéma non exposé, détenue par un rôle dédié sans BYPASSRLS et sans propriété des tables ; elle pourra utiliser SECURITY DEFINER avec un search_path figé et les droits minimaux. Un wrapper exposé SECURITY INVOKER l'appellera. Révoquer EXECUTE à PUBLIC/anon, autoriser uniquement authenticated, vérifier `auth.uid()` dans le traitement et conserver les politiques RLS pour le rôle interne. Aucune SQL dynamique fondée sur un nom de table fourni par le client. Cette exception de privilège sera testée contre les accès directs et les appels forgés.

### Accusé, reprise et conflits

Le client vérifie le reçu avant une transaction locale d'acquittement. Il ne remplace pas la version locale visible si une modification plus récente y est déjà en attente. Une coupure après commit serveur mais avant réception se résout en renvoyant le même identifiant ; une fermeture après réception mais avant commit local suit le même mécanisme.

Reprise des opérations `sending` abandonnées après expiration d'un bail local ; exclusion multi-onglets avec Web Locks lorsque disponible et bail Dexie en secours. L'idempotence serveur reste nécessaire même avec ces verrous. Backoff exponentiel avec jitter et plafond, respect de Retry-After. Erreur d'authentification : mettre en pause et demander reconnexion ; réseau/5xx : réessayer ; validation/permissions : bloquer l'opération avec message et possibilité de correction ; les autres entités indépendantes continuent.

Un conflit conserve trois valeurs : base connue, intention locale et version distante. L'utilisateur choisit la version distante ou prépare une nouvelle opération sur la version distante pour conserver ses changements. Si la version distante change entre-temps, nouvelle comparaison et nouveau conflit. Le choix local n'autorise jamais un écrasement inconditionnel. Les opérations successeures restent bloquées jusqu'à résolution explicite et réconciliation de leur intention.

### Récupération distante

Pour la V1 personnelle, privilégier un balayage complet paginé par identifiant immuable de chaque table du compte, tombstones compris, à chaque cycle. Cela évite les pertes liées aux timestamps égaux ou aux séquences attribuées avant commit. Le coût est supérieur à un flux incrémental ; réévaluer avec les mesures de volume.

Chaque page est fusionnée localement par version. Ne jamais écraser une entité portant des opérations en attente : conserver la version distante dans `remote_shadows` et signaler le conflit. Une ligne absente d'une page ne signifie jamais une suppression. Une écriture concurrente située derrière le curseur sera récupérée au cycle suivant, qui repart du début. Après interruption, recommencer le balayage est sûr. Afficher la date du dernier cycle réussi, sans prétendre à un instantané global atomique multi-table.

## 5. Authentification et sécurité

Email/mot de passe, confirmation d'email et récupération de mot de passe via Supabase Auth. Première connexion et récupération de compte nécessitent Internet. L'application conserve l'identité du dernier compte authentifié pour l'usage local hors ligne ; un jeton expiré suspend les échanges distants sans supprimer les écritures locales. Une déconnexion explicite désactive cet accès local et exige une reconnexion.

RLS sur toutes les tables concernées : identité propriétaire dans USING et WITH CHECK, privilèges minimaux, lecture des tombstones par leur propriétaire. La clé publique publishable (ou anon compatible) n'accorde aucun droit métier à elle seule. Variables prévues : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`, avec alias de compatibilité `VITE_SUPABASE_ANON_KEY`. Jamais de service_role dans le frontend.

Déconnexion : suspendre le moteur, annuler les requêtes, invalider les callbacks par un numéro de génération de session et vider les états React. S'il reste des opérations, ne pas permettre une déconnexion ordinaire silencieuse : proposer d'abord synchronisation, ou export de récupération téléchargé avec confirmation explicite avant effacement local. Un échec réseau ne justifie pas une purge. En cas de perte inattendue de session, conserver la base inaccessible via l'interface jusqu'à reconnexion au même compte. Le compte B utilise une autre base et ne reçoit aucune opération de A.

Limite explicite : séparation par compte et garde d'interface ne chiffrent pas IndexedDB. Une personne contrôlant le profil navigateur ou le système peut inspecter le stockage. Pour un appareil réellement partagé, utiliser des profils navigateur distincts et effacer les données après synchronisation ou export ; un coffre local chiffré serait une évolution distincte.

Éviter HTML arbitraire, ajouter une CSP adaptée, limiter les journaux et protéger les exports contenant les dépenses. Les pages privées n'ont aucun accès métier anonyme. Aucun cache service worker des réponses Auth/PostgREST/RPC.

## 6. Budgets, interface et PWA

Dashboard calculé sur les dépenses locales non supprimées : aujourd'hui, mois, budget, reste, pourcentage, évolution, catégories et dernières dépenses. Historique : recherche, période, catégorie, édition et suppression logique. Catégories éditables/désactivables. Formulaire : quantité 1, frais 0, date locale, total dynamique, clavier numérique et erreurs associées aux champs.

Alertes configurables, valeurs initiales 70/85/100 %. Conserver par compte/mois/seuil l'état au-dessus/en-dessous. Déclencher sur transition sous → au-dessus, réarmer après retour sous le seuil et traiter plusieurs seuils franchis en un message groupé. Recalculer sur ajout, édition, suppression et fusion distante. Pas de toast répété au simple rechargement ; nouveau mois indépendant. Sans budget : état explicite sans division par zéro. Un dépassement peut produire un reste négatif, même si une dépense ne peut pas l'être. Anti-doublon local par appareil ; pas de garantie d'unicité mondiale des notifications entre appareils hors ligne.

Navigation latérale bureau et barre inférieure mobile ; ajout toujours accessible. États visibles : hors ligne, enregistré localement, en attente, en cours, confirmé serveur, bloqué/conflit. Écrans vides et erreurs de stockage explicites. Les notifications système restent facultatives ; aucune promesse application fermée.

PWA : manifeste, icônes 192/512 et maskable, précache du shell et ressources statiques, fallback SPA. Mise à jour proposée à l'utilisateur après sauvegarde du formulaire et arrêt cohérent des transactions ; pas de rechargement forcé. Migrations Dexie versionnées et compatibles avec les opérations déjà en file. En cas de schéma local trop récent pour un ancien onglet : bloquer les écritures et demander son rechargement. Demander la persistance du stockage si disponible, sans la présenter comme une garantie contre l'effacement du navigateur.

## 7. Risques et réponses

| Risque | Réponse et vérification |
| --- | --- |
| Réponse perdue après commit | Reçu transactionnel ; renvoi exact et tests d'interruption |
| Modifications concurrentes | Versions optimistes, conservation des deux intentions et écran de résolution |
| Suppression ressuscitée | Tombstone permanent et comparaison de version |
| Mauvais compte / ancien callback | Base par compte, génération de session, filtre propriétaire et tests A/B |
| Disque plein ou IndexedDB refusé | Aucune fausse confirmation ; garder le formulaire et expliquer la récupération |
| Effacement/éviction du stockage | Persistance demandée, synchronisation, export ; les écritures jamais envoyées ne peuvent pas être récupérées depuis le serveur |
| Mise à jour PWA incompatible | Test upgrade de schéma et reprise de queue ; contrôle des anciens onglets |
| Horloge incorrecte | Versions serveur pour conflits, date civile pour dépenses |
| Croissance des données | Pagination, index, mesure ; journal incrémental ultérieur si nécessaire |
| Déploiement de test touchant la production | Supabase local pour tests ; environnement distant séparé pour previews avant tout test destructif |

## 8. Phases et critères de validation

| Phase | Livrable | Critère pour passer à la suite |
| --- | --- | --- |
| 1 — Audit/conception | Ce document et choix explicites | Validation utilisateur de l'architecture |
| 2 — Initialisation | Vite/React/TS strict, dépendances verrouillées, outils qualité, CI, env d'exemple | Installation reproductible, lint/typecheck/build, test initial et démarrage vérifiés ; outillage local rétabli |
| 3 — Base/Auth | Migrations, RPC, reçus, contraintes, RLS, initialisation compte, connexion/récupération/déconnexion | Tests SQL avec deux utilisateurs et anon ; relations croisées refusées ; migration reproductible ; accès direct contournant RPC refusé |
| 4 — Fonctionnalités | Dépenses, catégories, historique, budgets, dashboard, repositories locaux | Calculs exacts, formulaires accessibles, CRUD local et transactions cohérentes testés |
| 5 — Offline/sync | Ordonnanceur, réessais, conflits, reprise et changement de compte | Toute la matrice critique ci-dessous passe avant les fonctionnalités secondaires |
| 6 — PWA/interface | Shell responsive, installation, cache, mise à jour | Démarrage offline après premier chargement ; mise à jour avec opérations en attente ; clavier et formats mobile/tablette/bureau |
| 7 — Validation/déploiement | CI complète, README, exploitation, Supabase cible et Vercel relié à GitHub | Tests réels sur deux contextes/appareils ; RLS vérifiée ; build déployé inspecté ; URL et limites documentées |

La couche locale et les transactions sont posées avant les écrans métier, même si la synchronisation complète reste en phase 5. Cela évite de réécrire une application initialement dépendante du réseau.

Matrice obligatoire : calculs (1 unité, plusieurs unités, frais nuls, fractions et arrondis, invalides) ; création/édition/suppression hors ligne ; fermeture complète puis réouverture persistante ; reconnexion ; doublons ; panne avant/après commit serveur ; erreurs réseau et permanentes ; opérations dépendantes ; deux appareils concurrents ; modification contre suppression ; compte A → B et réponse tardive ; seuils/réarmement/mois suivant/absence/dépassement ; RLS SELECT/INSERT/UPDATE/DELETE et RPC ; catégories d'un autre compte ; migration IndexedDB et upgrade service worker.

Tests unitaires et IndexedDB simulée ne suffisent pas à prouver la persistance réelle : exécuter les scénarios navigateur avec profil conservé et réseau coupé. Tester SQL sur une base locale jetable ; ne pas injecter de données de tests destructifs dans le projet hébergé.

## 9. Exécution et points ouverts

À cette phase, aucun code exécutable : pas de build ni de test applicatif possible. Vérifications réalisées : inspection locale/Git, métadonnées GitHub, inventaire Supabase/migrations, projets/équipes Vercel et sondage de l'outillage.

Fichier créé : `docs/PHASE-1-CONCEPTION.md` uniquement. Rien poussé sur GitHub, aucune mutation Supabase, aucun déploiement. À la phase 2, prévoir les scripts `dev`, `build`, `typecheck`, `lint`, `test` et `test:e2e`, avec leurs instructions exactes dans le README.

L'accès au dépôt et au projet Supabase est déjà disponible : aucun secret à fournir dans le chat. Le compte/espace Vercel cible devra être identifié avant liaison et déploiement. Docker devra être opérationnel pour la validation locale PostgreSQL ; npm/CLI seront recherchés puis préparés sans réinitialiser le dépôt. Un environnement Supabase de preview séparé sera nécessaire si les previews doivent écrire à distance ; aucun projet payant créé implicitement.

L'import du Google Sheets historique n'est pas inclus dans la première version demandée. Il pourra être spécifié ensuite sans bloquer les phases présentes.

## Références consultées

- Supabase RLS : https://supabase.com/docs/guides/database/postgres/row-level-security
- Changements Supabase : https://supabase.com/changelog (index Markdown non lisible par l'outil web ; page HTML consultée en remplacement)
- Transactions Dexie : https://dexie.org/docs/Dexie/Dexie.transaction()
- Mise à jour PWA : https://vite-pwa-org.netlify.app/guide/prompt-for-update

Ces références étayent l'usage des politiques/privilèges, des transactions locales et de la mise à jour proposée. Le protocole de synchronisation décrit ici est une conception propre au projet, à implémenter et tester, pas une fonctionnalité automatique de Supabase.
