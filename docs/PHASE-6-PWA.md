# Phase 6 — PWA et interface

Date : 15 octobre 2026. Périmètre : application installable, ouverture hors ligne, mise à jour contrôlée et finitions responsive. Aucun déploiement distant à cette phase.

## Fonctionnement livré

Le build Vite produit un manifeste français, des icônes PNG 192/512, une icône maskable et une icône Apple. Leur générateur reproductible est conservé dans `scripts/generate-icons.mjs`. Le navigateur peut proposer l’installation ; des instructions manuelles restent disponibles si cette proposition est absente. Le stockage persistant est demandé uniquement sur action explicite et son refus est expliqué.

Le service worker personnalisé, compilé par `vite-plugin-pwa` en mode `injectManifest`, précache le HTML public et tous les fichiers statiques, y compris les modules chargés à la demande. Une installation incomplète échoue sans remplacer le worker actif. Le fallback de navigation ne concerne que les routes de l’application. Aucun résultat Auth, PostgREST ou RPC, aucun jeton dans une URL et aucune donnée de compte ne sont ajoutés à Cache Storage. Les données financières restent dans les bases IndexedDB par compte.

Une session expirée déjà conservée par le SDK permet de rouvrir le carnet hors ligne. Cette identité locale n’est jamais utilisée comme preuve d’autorisation distante : le moteur conserve sa validation Supabase avant toute synchronisation. Aucun nouveau stockage de jeton n’est créé. Une session effacée ou incohérente est refusée, et un événement de déconnexion ferme l’accès.

## Mise à jour sans perte de saisie

Le worker attend normalement la fermeture des anciennes fenêtres. Lorsqu’une version attend, le bouton « Mettre à jour maintenant » propose une activation explicite :

1. Refus si un formulaire est ouvert ou si une opération de compte est en cours.
2. Interface rendue inactive et barrière contre les nouvelles écritures métier.
3. Suspension et annulation des échanges du moteur, puis attente des transactions sur tous les stores.
4. Vérification par le worker qu’une seule fenêtre de l’application est ouverte.
5. Activation puis rechargement de la seule fenêtre demandeuse. En cas de refus ou d’erreur, reprise des écritures et de la synchronisation.

La version précédente du cache est conservée pour une fenêtre ouverte pendant la courte course d’activation. Les autres onglets ne subissent aucun rechargement automatique. Le schéma Dexie reste v2 ; les UUID et payloads de la file sont conservés. Une fermeture brutale d’un autre onglet peut laisser son bail de synchronisation actif jusqu’à 60 secondes : il expire normalement, sans suppression forcée.

## Interface et accessibilité

Les routes et les graphiques sont chargés à la demande tout en étant précachés. La navigation conserve la barre latérale sur bureau et la barre inférieure sur mobile. Les marges respectent les zones réservées de l’écran ; les champs mobiles utilisent une taille de texte de 16 px. Les textes longs peuvent revenir à la ligne. Les contours de focus sont visibles, le lien d’évitement reste utilisable, et une navigation replace le focus sur le contenu principal. Les préférences de réduction des animations sont respectées.

La revue React a vérifié les hooks, le nettoyage des abonnements, les frontières de chargement/erreur, les libellés et les états asynchrones. Aucun ajout de dépendance.

## Vérification de bout en bout

Parcours : ouverture du build → cache public → saisie IndexedDB → mise à jour du service worker → reprise de la file → RPC locale → confirmation visible.

Le test d’upgrade utilise un serveur exclusivement réservé aux tests : deux versions de HTML et de sa révision précachée sont servies à la même origine. Le code applicatif et le schéma sont identiques entre ces deux versions ; le test vérifie le vrai cycle d’installation/attente/activation des workers et la conservation du carnet, pas une future migration de schéma arbitraire.

Les contrôles couvrent le manifeste et les icônes, le contenu exclusivement public du cache, le chargement d’une route directe sans réseau, la fermeture complète puis réouverture d’un profil navigateur hors ligne avec expiration stockée forcée, les formats 320/768/1280 px, la navigation clavier et l’upgrade avec formulaire et onglet concurrent. Les scénarios existants continuent de couvrir les conflits, reçus perdus, sauvegardes et comptes séparés.

`pnpm check` : TypeScript, ESLint, 87 tests sur 10 fichiers et compilation réussis. Vitest est limité à deux workers après un échec de démarrage de ses processus sur la machine locale. Le bundle initial passe d’environ 655 ko à 496 ko (145 ko gzip) ; les graphiques restent dans un module séparé de 357 ko. Le précache représente environ 1 Mo non compressé.

Résultats navigateur sur le build final : 15 scénarios réussis lors du passage complet, puis les deux variantes du scénario de restauration réussies après correction de leurs attentes ; soit les 17 scénarios distincts validés. Le doublon mobile du test de fermeture complète est volontairement ignoré. Le test séparé de mise à jour PWA est également réussi, jusqu’à la confirmation serveur de la dépense conservée. Les captures 320/768 px et de la mise à jour protégée ont été inspectées. Les résultats proviennent de plusieurs exécutions ciblées ; aucune exécution CI distante n’est revendiquée ici.

Le scénario de restauration attend désormais la confirmation de sauvegarde avant de naviguer, puis importe sans réseau avant de réactiver la synchronisation. Cela supprime deux courses dans le test : navigation avant la fin de la sauvegarde et import pendant une lecture périodique. Les refus de concurrence de l’application restent inchangés.

Deux problèmes ont été identifiés pendant les essais : les requêtes de modules différaient du précache par leur en-tête `Origin` et provoquaient un échec offline ; la recherche dans le cache ignore désormais `Vary` uniquement pour ces fichiers publics. Les ports de Docker renvoyaient aussi des réponses HTTP vides après démarrage ; un redémarrage des conteneurs locaux a rétabli les services, sans effacer les données.

## Limites et phase suivante

L’installation dépend du navigateur, de HTTPS/localhost et de ses critères. Les essais mobiles sont des émulations Chromium/Edge ; aucune validation sur un téléphone physique ou Safari n’est annoncée. Une première connexion et la préparation complète du cache nécessitent Internet. La persistance ne protège pas d’un effacement volontaire du profil et ne chiffre pas IndexedDB. La synchronisation s’exécute pendant que l’application est ouverte.

Le plugin PWA émet encore un avertissement interne de dépréciation `inlineDynamicImports` avec Vite 8 ; la compilation réussit. Ne pas modifier les dépendances verrouillées pour masquer cet avertissement.

La phase 7 devra configurer les routes SPA et les en-têtes de cache/CSP sur Vercel, appliquer et contrôler les migrations sur le Supabase cible, régler Auth, vérifier la CI et inspecter le déploiement HTTPS. Les assets versionnés peuvent être immuables ; `sw.js`, le manifeste et le HTML doivent pouvoir être revalidés. Les retours arrière doivent respecter la version du schéma local et ne jamais purger la file.

Références : [Vite PWA injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest), [mises à jour proposées](https://vite-pwa-org.netlify.app/guide/prompt-for-update), [sessions Supabase](https://supabase.com/docs/guides/auth/sessions), [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist). Changelog Supabase consulté ; la dépréciation des anciens chiffrements TLS ne change pas ce flux navigateur moderne.
