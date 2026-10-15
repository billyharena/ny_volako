# Contrat serveur — version 1

Les routes PostgreSQL sont authentifiées. `initialize_account()` crée transactionnellement les paramètres et six catégories une seule fois ; aucun budget initial. `read_account_page(p_entity, p_after?, p_limit?)` retourne au maximum 500 lignes ordonnées par UUID, tombstones compris. Repartir du début à chaque cycle ; l’absence d’une ligne ne constitue pas une suppression.

`apply_change(p_operation_id, p_entity, p_entity_id, p_kind, p_base_version, p_payload)` applique une opération atomique. Entités : `categories`, `expenses`, `monthly_budgets`, `user_settings`. Types : `create`, `update`, `delete` ; la suppression concerne uniquement les dépenses, les paramètres acceptent uniquement `update`. L’ID des paramètres est l’ID du compte. La version initiale attendue est la chaîne `"0"`, puis la version serveur positive connue. Les UUID sont attribués par le client.

Les prix, frais, budgets, quantités et versions sont des **chaînes JSON**. Prix/frais/budgets : au plus douze chiffres entiers et deux décimales ; quantité : au plus sept chiffres entiers et trois décimales. Zéro autorisé uniquement pour prix/frais. Dates ISO civiles entre 1900 et 9999. Total calculé côté PostgreSQL et arrondi à deux décimales. Ne pas utiliser les lectures REST directes pour les montants : les types générés de ces tables représentent les valeurs numériques en `number`.

Payloads complets :

| Entité | Champs |
| --- | --- |
| Catégorie | `name` obligatoire (1–80 caractères), `icon` optionnelle/null parmi shopping-basket, bus, house, heart-pulse, coffee, ellipsis ; `is_active` booléen optionnel |
| Dépense | `expense_date`, `motif` (1–240), `category_id`, `unit_price`, `quantity`, `extra_fee` |
| Budget | `month_start` (premier du mois), `budget_limit`, `warning_thresholds` (tableau d’entiers distincts 1–100, non vide) |
| Paramètres | `currency` (code de trois majuscules), `timezone` (nom PostgreSQL valide), `theme` (system/light/dark), `locale` (fr) |
| Suppression | Objet vide `{}` |

Une catégorie désactivée ne peut pas être affectée à une nouvelle dépense. Une dépense déjà liée à cette catégorie reste modifiable. Changer la devise est refusé dès qu’un historique existe, y compris supprimé.

Succès : `{status: "applied", operation_id, row}`. Le reçu conserve la requête canonique complète et le résultat. Le même UUID avec le même contenu retourne exactement ce résultat ; avec un contenu différent, erreur `operation_id_reused`. Le verrou transactionnel par compte sérialise initialisation et écritures. Aucun reçu n’est créé lors d’un refus ou conflit ; ces opérations n’ont pas modifié la base.

Conflit : `{status: "conflict", operation_id, remote}`. `remote` peut être null lorsque la ligne n’existe pas pour ce compte. Pour un budget mensuel déjà existant, `reason: "month_already_exists"` et la ligne concurrente. Conserver l’intention locale et présenter un choix explicite ; réessayer sur une nouvelle version nécessite un nouvel UUID d’opération. Une dépense supprimée n’est jamais réactivée.

Erreurs SQL : `22023` validation/protocole, `42501` permission/identité absente, `23514` contrainte, `23503` relation, `23505` UUID déjà utilisé, erreurs de conversion `22xxx`. Ces erreurs ne sont pas des erreurs réseau à réessayer sans correction. L’authentification HTTP expirée doit suspendre les envois. Ne jamais afficher des erreurs serveur brutes contenant une ligne ou un payload.

Le navigateur dispose uniquement de SELECT sur les tables et EXECUTE sur les RPC. Les fonctions internes sont dans `private`, non exposé, avec search_path vide, détenues par `ny_volako_writer`, rôle NOLOGIN/NOINHERIT/NOBYPASSRLS non propriétaire des tables. Les politiques RLS filtrent par `auth.uid()`. Comme Supabase ne permet pas de déléguer USAGE sur son schéma Auth, l’identité interne utilise exactement la lecture de claims vérifiés employée par `auth.uid()` ; aucune identité n’est acceptée dans les arguments métier. Le rôle authenticated n’est pas membre du rôle interne.

Tombstones et reçus sont conservés sans purge en V1.

## Carnet local livré en phase 4

La base Dexie est isolée par URL de projet et UUID de compte. L’import initial valide les réponses paginées et écrit l’ensemble dans une transaction après les lectures réseau. Un carnet déjà initialisé n’est pas remplacé lors d’une reconnexion.

Chaque écriture métier, opération en attente et transition d’alerte appartient à la même transaction IndexedDB. La file contient `format_version: 1`, `operation_id`, `user_id`, `entity`, `entity_id`, `kind`, `payload`, `base_version`, `predecessor_id`, `created_at`, `attempt_count: 0`, `status: pending` et un numéro local `sequence`. Le payload conserve des chaînes pour les décimales. La première opération utilise la version serveur connue (ou `"0"` à la création). Une opération dépendante référence l’UUID de la précédente avec `base_version: null` : le moteur de phase 5 devra fixer cette version à partir du reçu précédent avant le premier envoi, puis conserver la requête exacte pour les réessais. Ne jamais envoyer une version null à la RPC.

`local_revision` protège les formulaires contre une écriture concurrente dans un autre onglet. Les suppressions de dépenses restent des tombstones. La déconnexion vérifie la fraîcheur de l’export puis verrouille les écritures des onglets de la même session Auth, dans une transaction commune aux mutations métier. Une nouvelle session peut rouvrir le carnet conservé.

## Moteur livré en phase 5

Dexie passe en version 2 sans effacer les stores de version 1. Les stores supplémentaires `shadows`, `receipts` et `resolutions` conservent les versions distantes, confirmations locales et opérations remplacées par un choix explicite. Les opérations prennent les états `pending`, `sending`, `retry`, `blocked` ou `conflict`. Un acquittement retire l’opération de la file dans la même transaction que son reçu, la version de son successeur et les données visibles. Les révisions locales ne servent jamais de version serveur.

Le moteur vérifie la session via le SDK puis l’identité distante, et capture le jeton pour les RPC du cycle : une requête de A ne peut pas être envoyée avec la session de B. Les requêtes métier sont limitées à 15 secondes, annulables, avec uniquement la clé publique. Une expiration Auth suspend les échanges ; une action explicite ou un renouvellement de session permet la reprise. Les messages affichés n’exposent pas les corps d’erreur serveur.

Web Locks évite plusieurs cycles simultanés dans un même navigateur. Un bail Dexie de 60 secondes fournit une seconde protection et sert de repli. Chaque transaction de retour vérifie le propriétaire du bail et la session locale avant d’écrire. Après une fermeture brutale, une opération `sending` est renvoyée à l’identique lorsque le bail est disponible. Les acquittements sont idempotents même si deux appareils reprennent le même export.

L’ouverture, les changements de file, le retour du réseau, la visibilité, les échéances de retry et la commande manuelle déclenchent les cycles. Une demande pendant un cycle est mémorisée. Les lectures périodiques complètes ont lieu environ toutes les 30 secondes lorsque l’interface est visible ; les opérations en attente continuent d’être tentées dans un onglet masqué, sous réserve des restrictions du navigateur. Les erreurs réseau, 408, 429 et 5xx utilisent un délai exponentiel avec jitter, plafonné à cinq minutes sauf `Retry-After` plus long. Les refus permanents bloquent l’opération, sans bloquer les autres entités indépendantes.

Une réponse de conflit conserve la base connue, l’intention locale actuelle et la version serveur. Les anciennes opérations issues de la phase 4 peuvent ne pas disposer de copie de base : l’interface le signale. Le choix local consolide la chaîne dans un nouvel UUID comparé à la version distante, jamais dans une écriture forcée. Une suppression distante ne peut pas être réactivée. Le choix serveur remplace l’intention locale pour l’élément concerné. Les opérations abandonnées sont archivées localement.

Les lectures paginées repartent du début à chaque cycle. Une ligne avec des opérations en attente reste visible localement ; sa version distante est conservée séparément. Seule la RPC tranche le conflit, car un reçu perdu peut déjà confirmer cette opération. Aucune absence de ligne n’est interprétée comme une suppression. Les alertes sont recalculées dans les transactions de fusion.

Les exports de version 2 indiquent le compte, le serveur et une révision des intentions locales. Cette révision invalide une sauvegarde de déconnexion devenue obsolète même si la taille de la file est identique. La restauration accepte les exports v1/v2, contrôle les données et chaînes, exige une file vide et ne modifie pas les paramètres Auth. Les versions v1 sans serveur exigent la confirmation explicite de provenance affichée à l’utilisateur. Les reçus déjà connus sont ignorés ; les autres opérations conservent UUID, payload et version fixée. Les données confirmées sont relues du serveur, plutôt que remplacées par un ancien export.

## PWA — phase 6

Le cache du service worker contient uniquement le shell public et ses ressources statiques, jamais les réponses des API. Le schéma Dexie reste v2. Une mise à jour explicite refuse les formulaires ouverts et les actions de compte en cours, rend la fenêtre inactive, bloque les nouvelles écritures métier, suspend le moteur et attend une transaction sur tous les stores. Le worker n’accepte l’activation immédiate que si cette fenêtre est seule dans sa portée. Sinon les écritures et la synchronisation reprennent, sans rechargement. La version précédente du cache reste disponible pour la course où une fenêtre s’ouvre pendant l’activation.

Une réouverture hors ligne peut lire l’identité déjà stockée par le SDK, même expirée, pour accéder à IndexedDB. Cette identité ne donne aucun droit distant : le transport conserve ses contrôles de session et d’utilisateur. Une déconnexion explicite ne bénéficie pas de ce repli. L’expiration d’un bail abandonné peut retarder la reprise jusqu’à une minute ; une mise à jour ne doit jamais l’effacer arbitrairement.
