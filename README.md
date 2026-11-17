# Affichage du hall – EAFC Andenne

Écran d'information pour le téléviseur du hall d'entrée, avec son espace d'administration.
Hébergé gratuitement sur **GitHub Pages**, **sans serveur ni base de données** : tout le contenu est dans le fichier `data.json` du dépôt.

| Adresse | Rôle |
|---|---|
| `https://<compte>.github.io/<dépôt>/` | L'écran à afficher sur la TV |
| `https://<compte>.github.io/<dépôt>/admin/` | L'administration (À la une, planning, bandeau, textes) |

---

## 1. Mise en ligne (une seule fois, ±10 minutes)

1. Créez un compte sur [github.com](https://github.com) si vous n'en avez pas.
2. **New repository** → nom par ex. `affichage-hall` → **Public** → *Create repository*.
3. Sur la page du dépôt : **Add file → Upload files** → glissez **tout le contenu** de ce dossier (pas le dossier lui-même : `index.html` doit être à la racine) → *Commit changes*.
4. **Settings → Pages** → *Source* : « Deploy from a branch » → *Branch* : `main` / `/ (root)` → *Save*.
5. Après 1 à 2 minutes, l'adresse du site s'affiche en haut de cette page.

> GitHub Pages gratuit exige un dépôt **public**. Le code et `data.json` sont donc lisibles par tous ; n'y mettez rien de confidentiel (c'est de toute façon ce qui est affiché dans le hall).

## 2. Sécuriser l'administration (une seule fois, par l'administrateur)

L'admin enregistre les modifications directement dans le dépôt grâce à un **jeton GitHub**, puis chaque personne s'y connecte avec un simple **code d'accès** (mot de passe).

**a) Créer le jeton GitHub**
1. GitHub → photo de profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access* : **Only select repositories** → votre dépôt d'affichage.
3. *Permissions → Repository permissions → **Contents*** : **Read and write**.
4. Expiration : 1 an par exemple → **Generate token** → copiez-le.

**b) Le coller dans l'admin**
Ouvrez `…/admin/` → onglet **Accès & connexion** → *Connexion au dépôt GitHub* → collez le jeton → **Enregistrer et tester**.

**c) Créer les codes d'accès**
Même onglet → *Codes d'accès* → un nom (ex. « Secrétariat ») + un mot de passe d'au moins 10 caractères → **Créer ce code**. Créez-en un par personne si vous le souhaitez. Chaque mot de passe peut ensuite être changé avec le bouton **Changer le mot de passe**.

Dès le premier code créé, `…/admin/` affiche un **écran de connexion** : on entre son mot de passe et c'est tout, sur n'importe quel ordinateur.

**Sécurité**
- Le jeton n'est jamais visible en clair : il est chiffré (AES-256) dans `admin/acces.json`, et seul un bon mot de passe permet de l'ouvrir. Choisissez des mots de passe longs (une petite phrase, par exemple).
- Sans code, une personne peut voir la page de connexion mais ne peut rien modifier.
- Supprimer un code bloque cette personne. Si vous pensez qu'un code a fuité, supprimez-le **et** générez un nouveau jeton GitHub (supprimez l'ancien sur GitHub, collez le nouveau dans l'admin : les autres codes restent valables).
- **Mot de passe oublié ?** Un autre code peut le changer (onglet Accès & connexion → « Changer le mot de passe »). Si plus personne ne peut se connecter : sur GitHub, supprimez le fichier `admin/acces.json`, puis recommencez les étapes b) et c).
- Quand le jeton expire, la publication échoue : créez-en un nouveau et collez-le au même endroit.

## 3. Utilisation au quotidien

1. Ouvrez `…/admin/`, modifiez ; l'**aperçu en direct** montre le résultat.
2. Cliquez **Publier**. L'écran du hall se met à jour tout seul en **1 à 3 minutes**.

- **À la une** : annonces qui défilent. 4 mises en page (Classique, Texte + photo, Affiche, Annonce), 3 jeux de couleurs, option « Plein écran », QR code automatique, durée, dates de début et de fin.
  Entourez un mot d'`*astérisques*` pour le mettre en couleur.
- **Planning des cours** : la semaine type. Un cours peut avoir lieu plusieurs jours. L'écran retire les cours terminés, signale le cours « en cours » et, en fin de journée, annonce les cours du prochain jour. Statuts « Annulé » / « Modifié » + message (ex. « Déplacé au local B3 »). Période de validité optionnelle (icône calendrier).
- **Bandeau défilant** : messages en bas de l'écran.
- **Textes & réglages** : panneau d'orientation en haut de l'écran (ex. « Secrétariat → », jusqu'à 3, flèche dans 8 directions), titres, phrases, thème clair/sombre, durées.
- **Accès & connexion** : codes d'accès, jeton GitHub, sauvegarde/restauration de `data.json`.

Si vous fermez l'admin sans publier, vos modifications sont retrouvées à la prochaine ouverture sur le même ordinateur.

## 4. Réglage du téléviseur

- Ouvrez l'adresse de l'écran dans le navigateur de la TV (ou d'un mini-PC / clé type Chromecast, Fire TV…) et passez en **plein écran** (touche F11 sur PC).
- La page s'adapte à toute résolution 16:9 (HD, Full HD, 4K).
- Désactivez la mise en veille de l'écran.
- La page se recharge seule chaque nuit à 4 h ; elle garde le dernier contenu si Internet coupe.

## Contenu du dossier

```
index.html        écran TV
css/tv.css        style de l'écran
js/tv.js          fonctionnement de l'écran
js/qrcode.js      génération des QR codes (bibliothèque MIT, Kazuhiko Arase)
data.json         TOUT le contenu (modifié par l'admin)
assets/           logos
uploads/          images envoyées depuis l'admin
admin/            administration
```

Les images retirées d'une annonce restent dans `uploads/` ; vous pouvez les supprimer depuis GitHub si besoin.
