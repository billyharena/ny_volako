# Importer les dépenses d’un tableur

Dans Google Sheets, ouvrir l’onglet **Depenses**, puis **Fichier → Télécharger → Valeurs séparées par des virgules (.csv)**. Dans Ny Volako, ouvrir **Dépenses → Importer des dépenses**.

1. Choisir le CSV (UTF-8, maximum 5 Mo et 5 000 dépenses).
2. Associer chaque catégorie du fichier à une catégorie active du carnet, ou conserver son nom pour la créer. Une catégorie archivée doit être réactivée ou remplacée.
3. Vérifier l’aperçu paginé, les montants, les erreurs et les doublons possibles. Décocher les dépenses à exclure.
4. Cocher la confirmation puis cliquer sur **Confirmer l’import**.

Les colonnes requises sont `Motif`, `Date`, `Category`, `PU`, `Frais`, `Quantity`. L’ordre est libre. Les dates acceptées sont `AAAA-MM-JJ` et `JJ/MM/AAAA`. Les nombres acceptent la virgule décimale et les espaces de milliers français. Les séparateurs CSV virgule et point-virgule sont acceptés, ainsi que les champs entre guillemets et les sauts de ligne dans un motif.

`Montant sans frais` et `Montant avec frais` sont facultatifs. Lorsqu’ils sont renseignés, ils doivent correspondre au calcul prix × quantité, arrondi à deux décimales, puis addition des frais. Les lignes invalides ne sont pas importées : corriger le fichier et le recharger. Les lignes vides sont ignorées. Aucun contenu de cellule n’est exécuté comme formule.

Les doublons possibles sont des dépenses ayant les mêmes date, motif, catégorie cible, prix, quantité et frais. Ils sont recherchés dans le fichier et les dépenses non supprimées du carnet local. Ils sont décochés par défaut ; les cocher explicitement permet de conserver deux achats distincts identiques. Une seconde vérification transactionnelle protège contre les imports simultanés depuis deux onglets du même navigateur. Synchroniser avant d’importer pour comparer avec les dépenses des autres appareils : ce contrôle ne constitue pas une contrainte d’unicité entre appareils hors ligne, ni une reconnaissance des dépenses modifiées depuis un ancien import.

Le lot sélectionné, ses catégories et ses opérations sont enregistrés dans une transaction IndexedDB unique. Une erreur de stockage annule tout ce lot. Les alertes de budget sont recalculées une fois par mois concerné. La file habituelle synchronise ensuite les catégories avant les dépenses. Les dépenses importées se modifient et se suppriment comme les autres.

L’import fonctionne hors ligne après l’ouverture du compte et la mise en cache de l’application. Le CSV est lu dans le navigateur ; seules les dépenses sélectionnées et les catégories nécessaires sont synchronisées. Le fichier Google Sheets reste inchangé. Cette fonction est distincte de la restauration des sauvegardes JSON de Ny Volako.
