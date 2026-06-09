# 40 - Edition du profil (`profile`)

## Contexte ecran

- **Fichier** : `src/features/profile/screens/EditProfileScreen/EditProfileScreen.tsx` (pas de partials ; tout est rendu dans ce fichier unique).
- **Route** : `EditProfile` dans `SettingsNavigator` (`src/core/navigation/stacks/SettingsNavigator.tsx`, ligne 37). Atteint par `navigation.navigate('EditProfile')` depuis `SettingsScreen` (bouton "Modifier le profil"), ou par `navigation.navigate('SettingsTab', { screen: 'EditProfile' })` depuis `ProfileScreen`.
- **Roles requis** : **standard** ou **admin** (tout compte authentifie possedant un profil). PAS accessible en **guest** : l'ecran appelle `useMe()` (`GET /users/me`) qui requiert un token, et la pile `SettingsTab` n'est montee qu'apres authentification. Aucun privilege admin specifique n'est requis : un utilisateur edite uniquement SON propre profil.
- **Comportements temps-reel** : **AUCUN canal temps-reel direct**. Cet ecran n'ouvre ni WebSocket, ni LiveKit, ni push. Les actions passent par des requetes **REST** :
  - `mediaService.uploadAvatar()` → `POST /upload/avatar` (timeout 60 s, payload base64) — uniquement si une nouvelle photo a ete choisie.
  - `useUpdateProfile()` → `profileService.update()` → `PATCH /users/me` (displayName/firstName/lastName/bio/avatarUrl) puis, si le pseudo a change, `PATCH /users/me/username`.
  - Effet de synchro asynchrone : `onSuccess` ecrit le `User` retourne dans le cache React Query `profileKeys.me()`, ce qui rafraichit `ProfileScreen` / `SettingsScreen` au retour (effet observable mais non "temps-reel" au sens WebSocket).
- **Pre-conditions globales** : utilisateur authentifie (token valide), reseau requis pour charger (`useMe`) et pour sauvegarder ; i18n charge (FR/EN). Pour changer la photo : **permission d'acces a la photothèque** (declenchee par `ImagePicker.launchImageLibraryAsync`). Haptique disponible (best-effort, `void`).
- **Etats de donnees pertinents** :
  - **Chargement** (`isLoading` vrai ou `me` absent) : l'ecran entier est remplace par `<Loader fullscreen>` ; aucun champ n'est rendu.
  - **Charge** : les 5 champs sont prefiles depuis `me` via `useEffect` (`displayName`, `firstName ?? ''`, `lastName ?? ''`, `username`, `bio ?? ''`). L'avatar affiche `avatarUri || me.avatarUrl || undefined` (sinon initiales).
  - **Champs vides** : `firstName`/`lastName`/`bio` peuvent etre vides (non bloquants). `displayName` < 2 caracteres apres trim → Save desactive. `username` invalide (regex `[a-z0-9_]`, 3-24 car.) → Save desactive.
  - **Etat occupe** (`busy = uploading || updateProfile.isPending`) : les deux controles Save sont desactives ; le bouton "Enregistrer les modifications" affiche un spinner (`loading`).
  - **Hors-ligne / erreur** : la sauvegarde echoue → `Alert.alert(profile.edit.error, profile.edit.failedToUpdate)` ; on reste sur l'ecran, les champs sont conserves. Si `useMe` echoue au chargement (hors-ligne au montage), `me` reste indefini → le Loader reste affiche indefiniment (pas de bouton retour visible dans cet etat).
- **Structure UI** :
  - **Header** (haut) : bouton-icone **fermer** (gauche, `close`), titre "Modifier le profil" (centre, non interactif), bouton texte **Enregistrer** (droite).
  - **Corps** (`ScrollView`) : bloc avatar avec bouton-icone **changer la photo** (`photo-camera`) + libelle "Appuyez pour changer de photo" (texte non interactif) ; rangee **Prenom** / **Nom** ; **Nom affiché** (compteur 40) ; **Pseudo** (adornment `@`) ; **Bio** (multiline, compteur 150).
  - **Barre d'action** (bas) : bouton primaire pleine largeur **Enregistrer les modifications**.

## Matrice bouton

| #   | Bouton                        | Emplacement                          | Type          | Locator reel                                                                                                                                                | Pre-condition                                                                 | Priorite |
| --- | ----------------------------- | ------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| 1   | Fermer (croix)                | Header (haut gauche)                 | navigation    | `accessibilityLabel` = `t('profile.edit.cancelA11y')` = "Annuler" (EN "Cancel"), `Pressable` `accessibilityRole="button"`, icone MaterialIcons `close`      | Ecran charge (`me` defini)                                                    | P1       |
| 2   | Enregistrer (header)          | Header (haut droite)                 | submit        | `accessibilityLabel` = `t('profile.edit.saveA11y')` = "Enregistrer le profil" (EN "Save profile"), texte visible `t('profile.edit.save')` = "Enregistrer"   | `canSave` vrai : `displayName.trim().length >= 2` ET pseudo valide ET `!busy` | P0       |
| 3   | Changer la photo (camera)     | Corps (badge avatar)                 | submit / icon | `accessibilityLabel` = `t('profile.edit.changePhotoA11y')` = "Modifier la photo de profil" (EN "Change profile photo"), icone MaterialIcons `photo-camera`  | Permission photothèque (sera demandee)                                        | P1       |
| 4   | Champ Prenom                  | Corps                                | input-submit  | Label `t('profile.edit.firstName')` = "Prénom" (composant `Input`, `maxLength=50`, `autoCapitalize="words"`)                                                | Ecran charge                                                                  | P2       |
| 5   | Champ Nom                     | Corps                                | input-submit  | Label `t('profile.edit.lastName')` = "Nom" (`Input`, `maxLength=50`, `autoCapitalize="words"`)                                                              | Ecran charge                                                                  | P2       |
| 6   | Champ Nom affiché             | Corps                                | input-submit  | Label `t('profile.edit.displayName')` = "Nom affiché" (`Input`, `maxLength=40`, helper `len / 40`) ; valeur prefilee reperable via `getByDisplayValue`      | Ecran charge                                                                  | P1       |
| 7   | Champ Pseudo                  | Corps                                | input-submit  | Label `t('profile.edit.username')` = "Pseudo" (`Input`, `autoCapitalize="none"`, `autoCorrect=false`, adornment `@`)                                        | Ecran charge                                                                  | P1       |
| 8   | Champ Bio                     | Corps                                | input-submit  | Label `t('profile.edit.bio')` = "Bio" (`Input`, `multiline`, `numberOfLines=4`, `maxLength=150`, helper `len / 150`)                                        | Ecran charge                                                                  | P2       |
| 9   | Enregistrer les modifications | Barre d'action (bas, pleine largeur) | submit        | Label `Button` = `t('profile.edit.saveChanges')` = "Enregistrer les modifications", `accessibilityRole="button"`, `accessibilityState={{ disabled, busy }}` | `canSave` vrai                                                                | P0       |

> Note : le titre "Modifier le profil", le libelle "Appuyez pour changer de photo" et le compteur de caracteres sont des `Text` non interactifs (hors matrice). L'avatar lui-meme n'a pas d'`onPress` ici (seul le badge camera #3 declenche le picker). Aucun pull-to-refresh, aucun swipe, aucun long-press sur cet ecran.

## Cas de test

### PROF-EDIT-001 - Fermer revient a l'ecran precedent sans sauvegarder

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard authentifie, profil charge (`me` defini), reseau Wi-Fi, aucune permission supplementaire requise
- **Etapes** :
  1. Depuis Reglages, taper "Modifier le profil" pour ouvrir l'ecran ; verifier que les champs sont prefiles (ex. Nom affiché = "Jane Doe").
  2. Modifier le Nom affiché en "Jane TEMP" (sans sauvegarder).
  3. Taper sur le bouton croix (locator `t('profile.edit.cancelA11y')` = "Annuler") en haut a gauche.
- **Resultat attendu** : `navigation.goBack()` est appele ; retour a l'ecran precedent (Reglages/Profil). Aucun appel reseau de sauvegarde (`PATCH /users/me` non emis). Le profil reste "Jane Doe" cote serveur et cache.
- **Critere d'acceptation (OK/KO)** : OK si l'on quitte l'ecran sans aucune requete `PATCH` ni modification cote serveur ; KO si la modif "Jane TEMP" est persistee ou si l'ecran ne se ferme pas.
- **Donnees de test** : compte `+33600000001` / OTP `000000`, profil `{ displayName: "Jane Doe", username: "janedoe" }`
- **Duree estimee** : 2 min

### PROF-EDIT-002 - Multi-clic rapide sur Fermer + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil charge, reseau passant a hors-ligne pendant le test
- **Etapes** :
  1. Ouvrir l'ecran (champs prefiles).
  2. Activer le mode Avion (hors-ligne).
  3. Taper 5 fois tres rapidement sur le bouton croix "Annuler".
- **Resultat attendu** : un seul retour effectif (la pile ne contient pas 5 retours empiles) ; aucune erreur, aucun crash. `goBack()` est idempotent vis-a-vis de l'utilisateur (l'ecran disparait au premier tap, les taps suivants tombent dans le vide). Aucun appel reseau (Fermer n'en declenche pas), donc le hors-ligne n'a aucun impact ici.
- **Critere d'acceptation (OK/KO)** : OK si l'app ne retourne qu'a l'ecran parent (pas de double-pop incoherent) et ne plante pas ; KO si crash, ecran blanc, ou pop multiple traversant la pile.
- **Donnees de test** : memes que 001
- **Duree estimee** : 3 min

### PROF-EDIT-003 - Accessibilite du bouton Fermer (TalkBack/VoiceOver + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme reglee sur le maximum, contraste eleve active
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Avec le lecteur d'ecran, balayer jusqu'au premier element du header.
  3. Ecouter l'annonce ; double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Annuler, bouton" (FR) / "Cancel, button" (EN) — issu de `accessibilityLabel` + `accessibilityRole="button"`. Le `hitSlop={8}` garantit une cible >= 44 pt malgre l'icone 24 px. Double-tap declenche `goBack()`. L'icone reste visible en contraste eleve (couleur `colors.text`).
- **Critere d'acceptation (OK/KO)** : OK si l'annonce inclut un libelle non vide ("Annuler") et le role "bouton", et si l'activation ferme l'ecran ; KO si l'element est annonce "sans libelle" / "image" ou non focusable.
- **Donnees de test** : compte standard, langue FR puis EN
- **Duree estimee** : 4 min

### PROF-EDIT-004 - Enregistrer (header) sauvegarde les modifications et revient

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; reperer le champ Nom affiché prefile a "Jane Doe" (`getByDisplayValue('Jane Doe')`).
  2. Remplacer le Nom affiché par "Jane Updated".
  3. Taper sur le bouton texte "Enregistrer" (locator `t('profile.edit.saveA11y')` = "Enregistrer le profil") en haut a droite.
- **Resultat attendu** : `updateProfile.mutateAsync` est appele **une fois** avec `{ displayName: "Jane Updated", username: "janedoe", avatarUrl: undefined, ... }` ; aucun upload avatar (`uploadAvatar` non appele car pas de nouvelle photo) ; `PATCH /users/me` emis avec `displayName` trimme ; pas de `PATCH /users/me/username` (pseudo inchange) ; haptique succes ; `navigation.goBack()`. Le cache `profileKeys.me()` est mis a jour.
- **Critere d'acceptation (OK/KO)** : OK si une seule mutation est emise avec le bon payload et l'ecran se ferme ; KO si appel multiple, payload errone, ou pas de retour.
- **Donnees de test** : displayName cible "Jane Updated" ; payload attendu `{"displayName":"Jane Updated","firstName":"Jane","lastName":"Doe","username":"janedoe","bio":"Building things","avatarUrl":undefined}`
- **Duree estimee** : 3 min

### PROF-EDIT-005 - Enregistrer desactive si Nom affiché trop court / pseudo invalide + multi-clic + echec reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge ; second sous-cas en hors-ligne
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Sous-cas A : vider le Nom affiché et saisir "A" (1 caractere). Verifier l'opacite reduite du bouton "Enregistrer" (classe `opacity-40`) ; taper dessus 5 fois rapidement.
  3. Sous-cas B : remettre "Jane Doe", puis remplacer le Pseudo par "ab" (2 car., < min 3) puis par "Jane Doe!" (espace + symbole, regex KO) ; taper sur Enregistrer.
  4. Sous-cas C : remettre des valeurs valides (displayName "Jane Q", pseudo "jane_q"), passer en mode Avion, taper une fois sur Enregistrer.
- **Resultat attendu** : A et B → `mutateAsync` **jamais** appele (`canSave=false` car `displayName.trim().length < 2` ou `usernameFormSchema` echoue) ; les multi-clics restent sans effet. C → l'appel part puis echoue ; `Alert.alert("Erreur", "Impossible de mettre à jour le profil. Réessayez.")` s'affiche, on reste sur l'ecran, les champs sont conserves, `busy` repasse a false (le bouton redevient actif).
- **Critere d'acceptation (OK/KO)** : OK si aucune mutation pour A/B, et pour C une seule tentative suivie d'une Alert d'erreur sans fermeture d'ecran ; KO si une sauvegarde invalide passe, si multi-clic declenche plusieurs PATCH, ou si l'echec reseau ferme l'ecran / perd la saisie.
- **Donnees de test** : displayName "A" ; pseudos KO "ab", "Jane Doe!" ; valeurs OK `{ displayName: "Jane Q", username: "jane_q" }`
- **Duree estimee** : 6 min

### PROF-EDIT-006 - Accessibilite du bouton Enregistrer header (etat desactive annonce)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran avec un Nom affiché valide.
  2. Lecteur d'ecran : focus sur le bouton "Enregistrer le profil" (header droite) ; ecouter.
  3. Vider le Nom affiché ("A"), re-focus sur le bouton, ecouter de nouveau.
- **Resultat attendu** : etat valide → annonce "Enregistrer le profil, bouton" ; etat invalide → le bouton est visuellement attenue (`opacity-40`) et `disabled`, le lecteur ne l'active pas (tap sans effet). Le libelle vient de `accessibilityLabel` (independant du texte "Enregistrer" visible). Police agrandie : le texte "Enregistrer" ne doit pas tronquer le header.
- **Critere d'acceptation (OK/KO)** : OK si le libelle est annonce et l'etat desactive est respecte (pas d'activation) ; KO si annonce vide, ou si le bouton declenche une sauvegarde alors qu'il est cense etre desactive.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 4 min

### PROF-EDIT-007 - Changer la photo : selection d'une image et upload a la sauvegarde

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi, **permission photothèque accordee**, au moins une image dans la galerie
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper sur le badge camera (locator `t('profile.edit.changePhotoA11y')` = "Modifier la photo de profil").
  3. Dans le picker systeme, recadrer en carre (1:1) et confirmer une image.
  4. Verifier que l'avatar affiche immediatement la preview locale (`avatarUri` = `file://...`).
  5. Taper sur "Enregistrer".
- **Resultat attendu** : apres selection, haptique legere ; l'avatar montre la preview locale. A la sauvegarde, `uploading=true`, `mediaService.uploadAvatar(base64, mime)` → `POST /upload/avatar` retourne une URL https ; puis `mutateAsync` recoit `avatarUrl = "https://.../...jpg"` ; `PATCH /users/me` envoie ce `avatarUrl` (passe le filtre regex `^https?://`) ; haptique succes ; `goBack()`.
- **Critere d'acceptation (OK/KO)** : OK si l'upload precede le PATCH et l'URL https est transmise dans le payload ; KO si le `file://` local part dans le PATCH (rejet schema), si aucun upload n'a lieu, ou si l'avatar ne se met pas a jour.
- **Donnees de test** : image JPEG carree ; URL upload simulee `https://cdn.test/a.jpg`
- **Duree estimee** : 4 min

### PROF-EDIT-008 - Changer la photo : annulation du picker + echec upload (timeout/hors-ligne) + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil charge, permission photothèque ; reseau degrade pour le sous-cas upload
- **Etapes** :
  1. Sous-cas A : taper sur le badge camera 4 fois rapidement, puis **annuler** le picker (sans choisir d'image).
  2. Sous-cas B : selectionner une image valide, basculer le reseau en latence forte / mode Avion, taper "Enregistrer" et attendre > 60 s (timeout upload).
- **Resultat attendu** : A → `result.canceled` vrai → aucun changement d'avatar (`avatarUri` reste null/inchange), aucun base64 stocke ; les multi-clics rouvrent au plus une instance du picker systeme (pas de pile de pickers). B → `uploadAvatar` rejette (timeout 60 s ou reseau) ; `catch` → `Alert.alert("Erreur", "Impossible de mettre à jour le profil. Réessayez.")` ; `uploading` repasse a false ; aucun `PATCH` n'est emis (l'upload echoue avant) ; on reste sur l'ecran avec la preview conservee.
- **Critere d'acceptation (OK/KO)** : OK si l'annulation ne modifie rien et si l'echec upload affiche l'Alert sans planter ni partir de PATCH avec une mauvaise URL ; KO si crash, double-PATCH, ou preview perdue.
- **Donnees de test** : image JPEG valide ; reseau force a < 10 kbit/s ou Avion
- **Duree estimee** : 6 min

### PROF-EDIT-009 - Accessibilite du badge "Changer la photo"

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Lecteur d'ecran : naviguer jusqu'a l'avatar puis au badge camera ; ecouter.
  3. Double-taper pour activer.
- **Resultat attendu** : annonce "Modifier la photo de profil, bouton" (`accessibilityLabel` + `accessibilityRole="button"`). Le badge (40x40, bordure 2 px sur fond primary) reste distinct en contraste eleve. Double-tap ouvre le picker systeme. Le libelle texte "Appuyez pour changer de photo" est annonce a part comme simple texte (non focusable comme bouton).
- **Critere d'acceptation (OK/KO)** : OK si le badge est annonce comme bouton avec libelle non vide et ouvre le picker ; KO si annonce "image"/"sans libelle" ou non focusable.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 3 min

### PROF-EDIT-010 - Champs Prenom / Nom : saisie et persistance (avec limite maxLength)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; reperer le champ "Prénom" (label `t('profile.edit.firstName')`) et "Nom" (`t('profile.edit.lastName')`).
  2. Vider et saisir Prenom "Jean-Pierre", Nom "De La Tour".
  3. Tenter de coller un texte de 60 caracteres dans Prenom (au-dela de `maxLength=50`).
  4. Taper "Enregistrer".
- **Resultat attendu** : la saisie est acceptee avec capitalisation des mots (`autoCapitalize="words"`) ; le champ tronque a 50 caracteres (impossible de depasser). A la sauvegarde, le payload PATCH contient `firstName: "Jean-Pierre"` et `lastName: "De La Tour"` trimmes. Retour a l'ecran precedent.
- **Critere d'acceptation (OK/KO)** : OK si les deux valeurs (trimmees, <= 50 car.) partent dans le PATCH ; KO si depassement de 50 car. ou valeurs non persistees.
- **Donnees de test** : firstName "Jean-Pierre", lastName "De La Tour", chaine longue de 60 car. pour le test de limite
- **Duree estimee** : 3 min

### PROF-EDIT-011 - Champs Prenom / Nom : vidage complet + multi-clic Enregistrer (champs non bloquants)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran (Prenom "Jane", Nom "Doe").
  2. Vider entierement Prenom et Nom.
  3. Garder un Nom affiché valide (>= 2 car.) et un pseudo valide.
  4. Taper "Enregistrer les modifications" 4 fois tres rapidement.
- **Resultat attendu** : Prenom/Nom vides ne bloquent pas la sauvegarde (`canSave` ne depend que de displayName + pseudo). Une **seule** mutation part (le bouton passe `disabled` pendant `busy`, neutralisant les clics suivants) avec `firstName: ""` et `lastName: ""` (trimmes a chaine vide cote service). Retour a l'ecran.
- **Critere d'acceptation (OK/KO)** : OK si une seule requete PATCH est emise malgre les 4 taps et que les champs vides sont acceptes ; KO si plusieurs PATCH partent ou si le vidage bloque la sauvegarde a tort.
- **Donnees de test** : Prenom/Nom = "" ; displayName "Jane Doe" ; pseudo "janedoe"
- **Duree estimee** : 3 min

### PROF-EDIT-012 - Accessibilite des champs Prenom / Nom (label associe + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Lecteur d'ecran : focus successif sur le champ "Prénom" puis "Nom" ; ecouter.
  3. Saisir une valeur dans chacun via le clavier ecran.
- **Resultat attendu** : chaque champ annonce son label ("Prénom" / "Nom") suivi du contenu et du role champ de saisie. Avec la police au maximum, la rangee a deux colonnes (`flex-1`) reste lisible (les labels ne se chevauchent pas, le clavier reste accessible via `keyboardShouldPersistTaps="handled"`).
- **Critere d'acceptation (OK/KO)** : OK si chaque input est annonce avec son label et editable ; KO si label manquant ou champ illisible/tronque a la police max.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 3 min

### PROF-EDIT-013 - Champ Nom affiché : compteur et limite a 40 caracteres

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; reperer le champ "Nom affiché" (`getByDisplayValue('Jane Doe')`, helper "8 / 40").
  2. Saisir progressivement jusqu'a 40 caracteres ; observer le helper passer a "40 / 40".
  3. Tenter de saisir un 41e caractere.
  4. Taper "Enregistrer".
- **Resultat attendu** : le helper reflete en direct la longueur (`${displayName.length} / 40`). Le 41e caractere est refuse (`maxLength=40`). La sauvegarde envoie le displayName (trimme) dans `PATCH /users/me`.
- **Critere d'acceptation (OK/KO)** : OK si le compteur est exact et la saisie plafonne a 40 ; KO si depassement possible ou compteur fige.
- **Donnees de test** : chaine de 40 car. "Jane Doe The Forty Char Display Name Xyz" (a calibrer a exactement 40)
- **Duree estimee** : 3 min

### PROF-EDIT-014 - Champ Nom affiché : valeur uniquement espaces / 1 caractere bloque la sauvegarde

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Remplacer le Nom affiché par " " (deux espaces).
  3. Observer l'etat des deux boutons Enregistrer ; taper dessus.
  4. Remplacer par "A" (1 car. non-espace) ; retaper.
- **Resultat attendu** : `displayName.trim().length` vaut 0 puis 1 → `canSave=false` ; les deux controles Save sont attenues (`opacity-40` header, `opacity-45`/disabled bouton bas) et ne declenchent aucune mutation. Aucun `PATCH` emis.
- **Critere d'acceptation (OK/KO)** : OK si aucune sauvegarde n'est possible tant que `trim().length < 2` ; KO si une valeur d'espaces seule ou 1 caractere est sauvegardee.
- **Donnees de test** : " " (espaces), "A"
- **Duree estimee** : 3 min

### PROF-EDIT-015 - Accessibilite du champ Nom affiché (compteur + erreur annonces)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran ; focus lecteur d'ecran sur "Nom affiché".
  2. Ecouter le label et le texte helper ("8 / 40").
  3. Saisir au clavier et verifier que le compteur reannonce a la mise a jour si re-focus.
- **Resultat attendu** : le champ est annonce avec son label "Nom affiché", sa valeur, et le helper de compteur est lisible. En contraste eleve, le helper `text-ink-muted` reste perceptible. La police au maximum n'ecrase pas le compteur sous le champ.
- **Critere d'acceptation (OK/KO)** : OK si label + valeur + compteur sont accessibles et lisibles ; KO si helper invisible/illisible ou label non annonce.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 3 min

### PROF-EDIT-016 - Champ Pseudo : modification valide route vers l'endpoint dedie

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi, le nouveau pseudo est disponible cote serveur
- **Etapes** :
  1. Ouvrir l'ecran ; reperer le champ "Pseudo" (label `t('profile.edit.username')`, adornment `@` a gauche, valeur "janedoe").
  2. Remplacer par "jane_doe2" (valide : minuscules/chiffres/underscore, 3-24 car.).
  3. Taper "Enregistrer".
- **Resultat attendu** : `canSave` reste vrai (`usernameFormSchema` valide). A la sauvegarde : `PATCH /users/me` (sans username), puis comme `nextUsername ("jane_doe2") !== res.username ("janedoe")`, appel supplementaire `PATCH /users/me/username` avec `{ username: "jane_doe2" }` ; le User retourne par cet endpoint est mappe et mis en cache. Retour a l'ecran.
- **Critere d'acceptation (OK/KO)** : OK si le pseudo change declenche bien l'appel `/users/me/username` avec la valeur trimmee ; KO si le pseudo voyage par erreur dans `PATCH /users/me` (rejet `.strict()`) ou n'est pas persiste.
- **Donnees de test** : pseudo cible "jane_doe2"
- **Duree estimee** : 3 min

### PROF-EDIT-017 - Champ Pseudo : format invalide / conflit d'unicite (USER_002) + multi-clic + reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge ; un pseudo "taken_user" deja pris existe cote serveur ; reseau passant a degrade
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Saisir des pseudos invalides successifs : "ab" (trop court), "JaneDoe" (majuscules acceptees par regex i ? — verifier : regex `[a-z0-9_]/i` donc majuscules OK ; tester plutot "jane doe" avec espace et "jane-doe" avec tiret → KO). Observer le bouton Save desactive.
  3. Saisir un pseudo valide mais deja pris "taken_user" ; passer le reseau en latence forte ; taper "Enregistrer" 3 fois rapidement.
  4. Retablir le reseau et retaper avec un pseudo libre.
- **Resultat attendu** : pseudos a espace/tiret → `canSave=false`, aucune mutation. Pour "taken_user" : `canSave=true` (format valide) ; une seule mutation part malgre les 3 taps (`busy` desactive le bouton) ; le `PATCH /users/me/username` renvoie une erreur d'unicite (USER_002) ; `catch` → `Alert.alert("Erreur", "Impossible de mettre à jour le profil. Réessayez.")` ; on reste sur l'ecran. Note : `PATCH /users/me` a pu reussir avant l'echec username — le displayName/bio sont alors deja persistes, mais l'ecran ne ferme pas et l'utilisateur peut corriger le pseudo et resauvegarder. Etape 4 → sauvegarde reussit et l'ecran se ferme.
- **Critere d'acceptation (OK/KO)** : OK si format invalide bloque, conflit affiche l'Alter sans fermer, et une seule tentative username part par clic-burst ; KO si multi-PATCH username, crash, ou fermeture sur conflit.
- **Donnees de test** : pseudos KO "ab", "jane doe", "jane-doe" ; conflit "taken_user" ; libre "jane_q9"
- **Duree estimee** : 7 min

### PROF-EDIT-018 - Accessibilite du champ Pseudo (adornment @ + minuscules)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran ; focus lecteur d'ecran sur "Pseudo".
  2. Ecouter l'annonce ; saisir au clavier.
- **Resultat attendu** : annonce du label "Pseudo" et de la valeur. L'adornment "@" (Text) est decoratif et ne perturbe pas la saisie. `autoCapitalize="none"` evite les majuscules auto. En police maximum, le champ avec le "@" reste aligne et editable.
- **Critere d'acceptation (OK/KO)** : OK si le champ est annonce avec son label et editable sans capitalisation auto ; KO si "@" est saisi dans la valeur ou label manquant.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 3 min

### PROF-EDIT-019 - Champ Bio : saisie multiligne + compteur 150

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; reperer le champ "Bio" (label `t('profile.edit.bio')`, multiline, helper "15 / 150").
  2. Saisir un texte sur plusieurs lignes (retours a la ligne) jusqu'a ~150 car.
  3. Tenter de depasser 150 ; taper "Enregistrer".
- **Resultat attendu** : la bio accepte le multiligne (`numberOfLines=4`), le helper suit `${bio.length} / 150`, la saisie plafonne a 150 (`maxLength`). Le PATCH envoie la bio trimmee.
- **Critere d'acceptation (OK/KO)** : OK si multiligne accepte, compteur exact, plafond 150, bio persistee ; KO si depassement ou perte de saut de ligne non voulu.
- **Donnees de test** : bio "Ligne 1\nLigne 2\nLigne 3 ... " jusqu'a 150 car.
- **Duree estimee** : 3 min

### PROF-EDIT-020 - Champ Bio : tres long collage + emojis + reseau qui coupe a la sauvegarde

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard, profil charge, reseau passant a hors-ligne
- **Etapes** :
  1. Ouvrir l'ecran ; coller 300 caracteres + emojis dans Bio.
  2. Verifier le plafonnement a 150 ; passer en mode Avion.
  3. Taper "Enregistrer".
- **Resultat attendu** : le collage est tronque a 150 (les emojis comptent selon les unites RN). Hors-ligne, la sauvegarde echoue → `Alert` d'erreur ; la bio saisie est conservee dans le champ. Retablir le reseau et resauvegarder fonctionne.
- **Critere d'acceptation (OK/KO)** : OK si troncature a 150 et echec gere par Alert sans perte de saisie ; KO si depassement de 150, crash sur emojis, ou perte de la bio apres echec.
- **Donnees de test** : 300 car. avec emojis ; idem tronque attendu a 150
- **Duree estimee** : 4 min

### PROF-EDIT-021 - Accessibilite du champ Bio (multiline + compteur)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran ; focus lecteur d'ecran sur "Bio".
  2. Ecouter le label, la valeur, et le compteur "15 / 150".
  3. Saisir du texte multiligne.
- **Resultat attendu** : le champ multiligne est annonce avec son label "Bio", sa valeur et le compteur lisible. En police maximum, la zone multiligne (numberOfLines 4) s'agrandit sans masquer le bouton "Enregistrer les modifications" (scroll disponible).
- **Critere d'acceptation (OK/KO)** : OK si label + valeur + compteur accessibles et zone scrollable ; KO si champ inaccessible ou compteur illisible.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 3 min

### PROF-EDIT-022 - Enregistrer les modifications (bouton bas) sauvegarde et affiche le spinner

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge, reseau Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; modifier le Nom affiché en "Jane B." (valide).
  2. Faire defiler jusqu'au bouton primaire pleine largeur "Enregistrer les modifications" (label `t('profile.edit.saveChanges')`).
  3. Taper dessus ; observer l'etat pendant l'appel.
- **Resultat attendu** : pendant `busy` (`updateProfile.isPending`), le bouton affiche un `ActivityIndicator` (prop `loading`) et passe `disabled` (`accessibilityState.busy=true`). `mutateAsync` est appele une fois ; haptique succes ; `navigation.goBack()`. Resultat identique au bouton "Enregistrer" du header (meme handler `handleSave`).
- **Critere d'acceptation (OK/KO)** : OK si une seule mutation, spinner pendant l'appel, puis retour ; KO si pas de spinner, appel multiple, ou pas de retour.
- **Donnees de test** : displayName "Jane B."
- **Duree estimee** : 3 min

### PROF-EDIT-023 - Enregistrer les modifications : multi-clic pendant l'upload + reconnexion

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte standard, profil charge, nouvelle photo choisie, reseau lent puis retabli
- **Etapes** :
  1. Ouvrir l'ecran ; choisir une nouvelle photo (PROF-EDIT-007).
  2. Reseau en latence forte ; taper "Enregistrer les modifications" 5 fois tres vite pendant que l'upload est en cours.
  3. Laisser l'upload + PATCH se terminer (ou couper puis retablir le reseau).
- **Resultat attendu** : `busy` devient vrai des le 1er tap (uploading), neutralisant les 4 taps suivants → un seul cycle upload+PATCH. Si le reseau coupe au milieu : `catch` → Alert d'erreur, `busy` repasse a false, on reste sur l'ecran avec la preview locale conservee ; un nouveau tap apres reconnexion relance proprement un cycle complet.
- **Critere d'acceptation (OK/KO)** : OK si un seul upload + un seul PATCH par cycle malgre les clics, et reprise propre apres reconnexion ; KO si uploads/PATCH multiples, double-avatar, ou ecran fige.
- **Donnees de test** : image JPEG ; reseau force lent (~20 kbit/s) puis retabli
- **Duree estimee** : 5 min

### PROF-EDIT-024 - Accessibilite du bouton "Enregistrer les modifications" (etat busy/disabled)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte standard, TalkBack/VoiceOver actif, police au maximum, contraste eleve
- **Etapes** :
  1. Ouvrir l'ecran avec des valeurs valides ; focus lecteur d'ecran sur le bouton primaire bas.
  2. Ecouter l'annonce (role + etat).
  3. Declencher la sauvegarde et re-ecouter pendant `busy`.
- **Resultat attendu** : annonce "Enregistrer les modifications, bouton" ; etat valide → activable. Pendant `busy` → `accessibilityState={{ disabled: true, busy: true }}` : le lecteur annonce "occupe/desactive" et le double-tap n'a aucun effet (evite le double-envoi via lecteur d'ecran). En police maximum, le label tient sur une ligne (`numberOfLines={1}`) sans deborder. Contraste : le `variant="primary"` reste lisible.
- **Critere d'acceptation (OK/KO)** : OK si le role/libelle sont annonces et l'etat busy bloque la reactivation ; KO si reactivation possible pendant l'upload via lecteur d'ecran ou libelle absent.
- **Donnees de test** : compte standard, FR
- **Duree estimee** : 4 min

### PROF-EDIT-025 - Etat de chargement : Loader plein ecran avant l'arrivee du profil

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte standard, reseau lent au montage (profil pas encore charge)
- **Etapes** :
  1. Avec un reseau lent, naviguer vers l'ecran "Modifier le profil".
  2. Observer l'ecran avant la reponse de `GET /users/me`.
- **Resultat attendu** : tant que `isLoading` est vrai ou `me` indefini, l'ecran entier est un `<Loader fullscreen accessibilityLabel="Chargement du profil">` ; aucun champ ni bouton header n'est rendu. Des l'arrivee de `me`, les champs apparaissent prefiles.
- **Critere d'acceptation (OK/KO)** : OK si le Loader (locator `t('profile.edit.loading')` = "Chargement du profil") s'affiche puis cede la place aux champs prefiles ; KO si champs vides affiches avant les donnees ou si le Loader reste apres reception.
- **Donnees de test** : compte standard ; throttling reseau au montage
- **Duree estimee** : 3 min

### PROF-EDIT-026 - Synchro cache : le profil mis a jour se reflete sur l'ecran parent au retour

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : DEUX sessions du meme compte (appareil A = edition, appareil B = vue profil) OU une seule session avec retour sur ProfileScreen ; reseau Wi-Fi
- **Etapes** :
  1. Appareil A : ouvrir "Modifier le profil", changer le Nom affiché en "Jane Synced" et le pseudo en "jane_sync".
  2. Appareil A : taper "Enregistrer" ; revenir sur ProfileScreen.
  3. Appareil B (autre session du meme compte) : ouvrir/rafraichir le profil.
- **Resultat attendu** : Appareil A → `onSuccess` ecrit le `User` dans le cache `profileKeys.me()`, donc ProfileScreen/SettingsScreen affichent immediatement "Jane Synced" / "@jane_sync" sans refetch. Appareil B → apres un refetch (pull-to-refresh ou navigation), le serveur renvoie les nouvelles valeurs (la mise a jour n'est PAS poussee en temps reel : pas de WebSocket sur cet ecran — la propagation depend d'un re-fetch). Aucune divergence de donnees une fois B rafraichi.
- **Critere d'acceptation (OK/KO)** : OK si A reflete instantanement le changement via le cache et B le voit apres refetch ; KO si A reste sur l'ancienne valeur ou si B ne converge jamais.
- **Donnees de test** : displayName "Jane Synced", pseudo "jane_sync"
- **Duree estimee** : 5 min
