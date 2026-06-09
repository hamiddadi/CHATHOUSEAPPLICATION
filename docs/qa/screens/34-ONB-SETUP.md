# 34 - Configuration du profil (`onboarding`)

## Contexte ecran

- **Route / navigation** : ecran enregistre sous le nom de route `Onboarding` dans `OnboardingNavigator` (`initialRouteName="Onboarding"`, composant `SetupProfileScreen`). C'est le **premier ecran** du parcours d'onboarding. Deep link : `onboarding` (cf. `linking.ts`). Ecran suivant : `InterestSelection`.
- **Acces / roles requis** : utilisateur **authentifie** dont `user.hasCompletedOnboarding === false` (cf. `RootNavigator.tsx` : `needsOnboarding = isAuthenticated && user !== null && user.hasCompletedOnboarding === false`). Concretement c'est un compte `standard` fraichement cree (pas encore d'onboarding fini). Un `guest` non authentifie ne voit jamais cet ecran ; un `admin` ayant deja onboarde non plus. Pas de gating par role admin.
- **Comportements temps-reel** : **AUCUN**. Cet ecran n'ouvre aucune connexion WebSocket, LiveKit ou push. Tous les boutons sont locaux ou declenchent un seul appel HTTP REST (`POST /upload/avatar`). Le profil n'est PAS envoye au backend ici : `setProfile(...)` ne fait qu'accumuler les valeurs dans le store Zustand ephemere `useOnboardingStore` ; le flush reseau (`completeOnboarding` / PATCH) a lieu plus tard a l'etape `SuggestedFollows`.
- **Pre-conditions globales** : reseau requis **uniquement** si une photo est selectionnee (upload base64 vers `/upload/avatar`, timeout etendu a 60 s). Sans photo, l'ecran fonctionne hors-ligne (le `setProfile` + navigation sont purement locaux). Permission **bibliotheque de photos** (`requestMediaLibraryPermissionsAsync`) requise pour le selecteur d'avatar.
- **Etats de donnees pertinents** :
  - **Etat initial** : avatar absent (icone `camera-alt`), `displayName` vide, `bio` vide, compteur bio `0 / 150`.
  - **Avatar choisi** : preview locale `file://` affichee dans le cercle ; base64 + mime memorises pour upload differe au tap Continuer.
  - **Validation** : `displayName` max 60 caracteres (cle erreur `onboarding.setupProfile.errors.displayNameTooLong`), `bio` max 150 caracteres (cle erreur `onboarding.setupProfile.errors.bioTooLong`). Les deux champs sont **optionnels** (transform trim + optional). `maxLength` natif coupe la saisie a 60/150 cote TextInput, donc l'erreur Zod est en pratique difficile a declencher manuellement (defense en profondeur).
  - **Hors-ligne** : pertinent surtout pour Continuer AVEC photo (l'upload echoue -> `Alert` erreur, pas de navigation). Sans photo, hors-ligne est sans effet.

## Matrice bouton

| #   | Bouton                            | Emplacement            | Type         | Locator reel                                                                                                                                                                                        | Pre-condition                                                               | Priorite |
| --- | --------------------------------- | ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| 1   | Selecteur d'avatar (icone camera) | Corps (cercle central) | icon         | `Pressable` contenant `MaterialIcons name="camera-alt"` ; label visible adjacent `t('onboarding.setupProfile.addPhoto')` = "Ajouter une photo" / "Add a photo"                                      | Compte authentifie en onboarding ; permission photos                        | P1       |
| 2   | Champ "Nom affiche"               | Corps (formulaire)     | input-submit | `Input` label `t('onboarding.setupProfile.displayNameLabel')` = "Nom affiche" ; placeholder `t('onboarding.setupProfile.displayNamePlaceholder')` = "Casey Echo"                                    | Compte authentifie en onboarding                                            | P1       |
| 3   | Champ "Bio"                       | Corps (formulaire)     | input-submit | `Input` label `t('onboarding.setupProfile.bioLabel')` = "Bio" ; placeholder `t('onboarding.setupProfile.bioPlaceholder')` = "Le jour je code, la nuit je raconte." ; helper compteur `${len} / 150` | Compte authentifie en onboarding                                            | P1       |
| 4   | Bouton "Continuer"                | Barre d'action (bas)   | submit       | `Button` label `t('onboarding.setupProfile.continue')` = "Continuer" / "Continue" ; `accessibilityRole="button"`                                                                                    | Compte authentifie en onboarding ; reseau requis seulement si avatar choisi | P1       |
| 5   | Bouton "Passer"                   | Barre d'action (bas)   | navigation   | `Pressable` `accessibilityRole="button"`, texte `t('onboarding.setupProfile.skip')` = "Passer" / "Skip"                                                                                             | Compte authentifie en onboarding                                            | P1       |

> Note : cet ecran ne possede ni bouton retour (premier ecran de stack, header masque), ni FAB, ni toggle, ni element de liste, ni action de swipe/long-press, ni pull-to-refresh, ni connexion temps-reel. Les 5 elements ci-dessus sont l'inventaire exhaustif. Aucun bouton P0 (rien de critique argent/securite/temps-reel sur cet ecran).

## Cas de test

### ONB-SETUP-001 - Avatar : selection et preview reussie

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding (`hasCompletedOnboarding=false`), Wi-Fi, permission photos non encore accordee (premiere demande), au moins 1 image dans la galerie.
- **Etapes** :
  1. Ouvrir l'ecran "Configuration du profil".
  2. Taper le cercle d'avatar (icone camera-alt, sous le libelle "Ajouter une photo").
  3. A l'invite OS, accorder la permission "Photos / Bibliotheque".
  4. Selectionner une image, puis valider le recadrage carre (aspect 1:1).
- **Resultat attendu** : la galerie s'ouvre apres l'octroi de permission ; apres validation, l'image recadree remplace l'icone camera dans le cercle (rendu `Image` contentFit="cover") ; un retour haptique leger est emis. Aucune navigation, aucun upload immediat (l'upload est differe au tap Continuer).
- **Critere d'acceptation (OK/KO)** : OK si la preview circulaire affiche l'image choisie et que l'ecran reste affiche ; KO si l'icone camera persiste ou si l'app crash/navigue.
- **Donnees de test** : image JPEG de la galerie, ~2 MB, ratio quelconque (sera recadre 1:1).
- **Duree estimee** : 3 min

### ONB-SETUP-002 - Avatar : permission refusee + double tap rapide

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, permission photos **refusee** (ou la refuser a l'invite), Wi-Fi.
- **Etapes** :
  1. Taper le cercle d'avatar.
  2. A l'invite OS, **refuser** l'acces aux photos.
  3. Immediatement, taper 3 fois rapidement le cercle d'avatar (multi-clic).
- **Resultat attendu** : une `Alert` s'affiche avec titre `t('common.permissionDenied')` ("Permission required") et message `t('onboarding.setupProfile.photoPermission')` = "Autorise l'acces aux photos pour choisir une image." ; la galerie ne s'ouvre PAS. Les taps rapides supplementaires re-demandent la permission / re-affichent l'Alert sans ouvrir le picker ni empiler plusieurs galeries ; aucun crash, aucune promesse non geree.
- **Critere d'acceptation (OK/KO)** : OK si l'Alert de permission s'affiche et qu'aucune galerie ne s'ouvre malgre les taps repetes ; KO si crash, double ouverture du picker, ou Alert generique inattendue.
- **Donnees de test** : N/A (interaction OS permission).
- **Duree estimee** : 3 min

### ONB-SETUP-003 - Avatar : accessibilite lecteur d'ecran + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme reglee au maximum ; contraste eleve active.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au cercle d'avatar et au libelle "Ajouter une photo".
  3. Double-taper pour activer.
  4. Verifier que le libelle "Ajouter une photo" reste lisible avec la plus grande police.
- **Resultat attendu** : le lecteur d'ecran annonce un element actionnable (le cercle est un Pressable focalisable) ; le libelle "Ajouter une photo" est vocalise et reste visible sans troncature ni chevauchement avec la police agrandie ; le contraste icone/cercle reste conforme.
- **Critere d'acceptation (OK/KO)** : OK si l'avatar est focalisable, activable au double-tap, et le libelle reste lisible/contraste ; KO si l'element est ignore par le lecteur d'ecran ou le texte est tronque/illisible. NOTE QA : le Pressable avatar n'expose pas de `accessibilityLabel` explicite -> recommander d'ajouter `accessibilityRole="button"` + `accessibilityLabel={t('onboarding.setupProfile.addPhoto')}` (a remonter en dette d'accessibilite).
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ONB-SETUP-004 - Nom affiche : saisie valide propagee au store

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, reseau indifferent (pas d'avatar).
- **Etapes** :
  1. Taper le champ dont le placeholder est "Casey Echo" (label "Nom affiche").
  2. Saisir `Casey Echo`.
  3. Taper "Continuer".
- **Resultat attendu** : la saisie s'affiche ; au tap Continuer, `setProfile` est appele avec `{ displayName: 'Casey Echo', bio: undefined, avatarUrl: null }` (la valeur est trimmee par le schema) ; navigation vers `InterestSelection` ; retour haptique succes.
- **Critere d'acceptation (OK/KO)** : OK si le store recoit `displayName: 'Casey Echo'` et l'app navigue vers la selection d'interets ; KO sinon. (Reference test unitaire : `submits the trimmed display name through to the store`.)
- **Donnees de test** : `displayName = "Casey Echo"`.
- **Duree estimee** : 2 min

### ONB-SETUP-005 - Nom affiche : limite 60 caracteres + espaces seuls

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding.
- **Etapes** :
  1. Coller un nom de 70 caracteres dans le champ "Nom affiche".
  2. Observer la longueur acceptee (le TextInput a `maxLength={60}`).
  3. Effacer, saisir uniquement des espaces `"     "`.
  4. Taper "Continuer".
- **Resultat attendu** : la saisie est tronquee a 60 caracteres par `maxLength` (l'erreur Zod `displayNameTooLong` = "Maximum 60 caracteres." n'apparait pas car le champ ne depasse jamais 60) ; pour la saisie d'espaces seuls, le trim du schema produit une chaine vide -> `displayName: undefined` envoye au store ; navigation vers `InterestSelection`.
- **Critere d'acceptation (OK/KO)** : OK si la saisie est plafonnee a 60 caracteres et que les espaces seuls donnent `displayName: undefined` ; KO si plus de 60 caracteres sont conserves ou si une chaine d'espaces est propagee telle quelle.
- **Donnees de test** : nom de 70 caracteres `"AAAAAAAAAA..."` ; puis `"     "` (5 espaces).
- **Duree estimee** : 3 min

### ONB-SETUP-006 - Nom affiche : accessibilite saisie (clavier + lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police systeme agrandie.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Naviguer jusqu'au champ "Nom affiche".
  3. Verifier que le label "Nom affiche" est associe au champ et vocalise.
  4. Saisir du texte via le clavier virtuel et verifier le retour vocal.
- **Resultat attendu** : le lecteur d'ecran annonce le label "Nom affiche" et le placeholder ; le champ est focalisable et editable ; avec la police agrandie le label et le texte saisi restent lisibles dans le conteneur `Input`.
- **Critere d'acceptation (OK/KO)** : OK si le label est annonce et la saisie possible/lisible ; KO si le champ n'est pas focalisable ou le label n'est pas associe.
- **Donnees de test** : `"Test A11y"`.
- **Duree estimee** : 3 min

### ONB-SETUP-007 - Bio : compteur de caracteres en temps reel

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding.
- **Etapes** :
  1. Verifier l'etat initial du compteur sous le champ Bio : `0 / 150`.
  2. Taper le champ dont le placeholder est "Le jour je code, la nuit je raconte." (label "Bio").
  3. Saisir `hello`.
- **Resultat attendu** : le compteur passe a `5 / 150` immediatement ; le texte multiligne s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si le compteur reflete exactement la longueur saisie (`5 / 150`) ; KO sinon. (Reference test unitaire : `reflects typed input in the bio character counter`.)
- **Donnees de test** : `bio = "hello"`.
- **Duree estimee** : 2 min

### ONB-SETUP-008 - Bio : limite 150 caracteres

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding.
- **Etapes** :
  1. Coller un texte de 170 caracteres dans le champ Bio.
  2. Observer le compteur et la longueur acceptee (`maxLength={150}`).
  3. Taper "Continuer".
- **Resultat attendu** : la saisie est plafonnee a 150 caracteres ; le compteur affiche au maximum `150 / 150` ; l'erreur Zod `bioTooLong` = "Maximum 150 caracteres." n'apparait pas (plafonnee par `maxLength`) ; au Continuer, `setProfile` recoit `bio` tronquee/trimmee et navigation vers `InterestSelection`.
- **Critere d'acceptation (OK/KO)** : OK si la bio est limitee a 150 caracteres et le compteur plafonne a `150 / 150` ; KO si plus de 150 caracteres sont saisis ou que le compteur depasse 150.
- **Donnees de test** : texte de 170 caracteres (Lorem ipsum tronque).
- **Duree estimee** : 3 min

### ONB-SETUP-009 - Bio : accessibilite multiligne + police agrandie

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police systeme au maximum.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Focaliser le champ Bio (`numberOfLines={4}`, multiligne).
  3. Saisir un texte sur plusieurs lignes.
  4. Verifier que le compteur `X / 150` est vocalise / lisible et que le contraste texte/danger reste correct.
- **Resultat attendu** : le label "Bio" et le compteur helper restent lisibles avec la police agrandie ; le champ multiligne s'agrandit sans masquer le compteur ; le lecteur d'ecran annonce le label.
- **Critere d'acceptation (OK/KO)** : OK si label + compteur restent lisibles/vocalises et le champ multiligne reste utilisable ; KO si le compteur est masque ou le texte tronque illisible.
- **Donnees de test** : `"Ligne 1\nLigne 2\nLigne 3"`.
- **Duree estimee** : 3 min

### ONB-SETUP-010 - Continuer : sans avatar, profil sauvegarde et navigation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, aucune photo choisie, reseau indifferent (aucun upload).
- **Etapes** :
  1. Laisser les champs vides (ou saisir un nom).
  2. Taper le bouton "Continuer".
- **Resultat attendu** : `mediaService.uploadAvatar` n'est **PAS** appele ; `setProfile` est appele avec `{ displayName: undefined, bio: undefined, avatarUrl: null }` (ou les valeurs saisies) ; retour haptique succes ; navigation vers `InterestSelection`.
- **Critere d'acceptation (OK/KO)** : OK si aucun upload n'est tente et l'app navigue vers `InterestSelection` avec `avatarUrl: null` dans le store ; KO si un upload est declenche ou la navigation echoue. (Reference test unitaire : `saves the profile and advances when Continue is pressed with no avatar`.)
- **Donnees de test** : champs vides.
- **Duree estimee** : 2 min

### ONB-SETUP-011 - Continuer : avatar + perte reseau pendant l'upload + multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, **une photo selectionnee** (cf. ONB-SETUP-001), reseau a couper.
- **Etapes** :
  1. Selectionner une photo (l'avatar s'affiche).
  2. Activer le mode avion / couper le Wi-Fi.
  3. Taper "Continuer".
  4. Pendant le spinner de chargement (le bouton passe en `loading`), taper le bouton 3 fois rapidement.
  5. Reactiver le reseau et re-taper "Continuer".
- **Resultat attendu** : etape 3-4 : `POST /upload/avatar` echoue (timeout 60 s ou erreur reseau) -> `Alert` avec titre `t('common.error')` ("Something went wrong") et message issu de `errorMessage(err)` ; **aucune navigation** ; le spinner disparait (`finally { setUploading(false) }`). Les multi-clics sont neutralises pendant le chargement (`disabled={isSubmitting || uploading}` -> `onPress=undefined`), donc un seul upload est tente. Etape 5 : avec le reseau retabli, l'upload reussit, `setProfile` recoit l'`avatarUrl` https renvoyee, navigation vers `InterestSelection`.
- **Critere d'acceptation (OK/KO)** : OK si l'echec affiche l'Alert sans naviguer, qu'aucun upload double n'est emis pendant le loading, et que le retry online aboutit a la navigation ; KO si crash, navigation malgre l'echec, ou uploads multiples.
- **Donnees de test** : image JPEG ~2 MB ; backend `POST /upload/avatar` renvoyant `{ success: true, data: { url: "https://cdn.example/a.jpg" } }` au retry.
- **Duree estimee** : 5 min

### ONB-SETUP-012 - Continuer : accessibilite bouton (etat busy/disabled)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police agrandie ; une photo choisie (pour declencher l'etat loading).
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Focaliser le bouton "Continuer".
  3. Verifier l'annonce du role et du libelle.
  4. Choisir une photo, taper Continuer, et verifier l'annonce de l'etat occupe pendant l'upload.
- **Resultat attendu** : le bouton est annonce comme "bouton" (`accessibilityRole="button"`) avec le libelle "Continuer" ; pendant l'upload l'`accessibilityState={{ disabled: true, busy: true }}` est expose (spinner) et le bouton n'est pas re-activable ; avec la police agrandie le libelle reste lisible (numberOfLines=1, plein largeur).
- **Critere d'acceptation (OK/KO)** : OK si role/libelle annonces et etat busy/disabled correctement expose pendant le loading ; KO si le bouton reste activable en loading ou le libelle est tronque/non annonce.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### ONB-SETUP-013 - Passer : saut direct vers la selection d'interets

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` en onboarding, reseau indifferent.
- **Etapes** :
  1. Taper le lien/bouton "Passer".
- **Resultat attendu** : navigation immediate vers `InterestSelection` sans appeler `setProfile` ni `uploadAvatar` (le profil reste vide dans le store) ; aucun appel reseau.
- **Critere d'acceptation (OK/KO)** : OK si l'app navigue vers `InterestSelection` sans aucun appel reseau ni mutation de profil ; KO sinon. (Reference test unitaire : `skips onboarding straight to interest selection`.)
- **Donnees de test** : N/A.
- **Duree estimee** : 1 min

### ONB-SETUP-014 - Passer : multi-clic rapide + photo deja choisie

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; une photo deja selectionnee dans le cercle ; reseau actif.
- **Etapes** :
  1. Selectionner une photo (l'avatar s'affiche).
  2. Taper "Passer" 3 fois tres rapidement.
- **Resultat attendu** : une seule navigation vers `InterestSelection` est effectuee (pas d'empilement de l'ecran InterestSelection) ; la photo choisie est **ignoree** (Passer n'upload rien, `avatarUrl` reste non flushe) ; aucun appel `/upload/avatar`.
- **Critere d'acceptation (OK/KO)** : OK si exactement un push d'`InterestSelection` se produit et qu'aucun upload n'est declenche ; KO si double-navigation, crash, ou upload de l'avatar.
- **Donnees de test** : image JPEG ~2 MB.
- **Duree estimee** : 2 min

### ONB-SETUP-015 - Passer : accessibilite lecteur d'ecran + contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard` en onboarding ; TalkBack/VoiceOver actif ; police agrandie ; mode contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'au texte "Passer".
  3. Verifier l'annonce du role bouton et activer au double-tap.
- **Resultat attendu** : "Passer" est annonce comme bouton (`accessibilityRole="button"` sur le `Pressable`) ; le double-tap navigue vers `InterestSelection` ; avec la police agrandie le texte "Passer" reste lisible ; verifier que la cible tactile (`py-sm` + centrage) reste >= 44 pt et le contraste du texte `text-ink-muted` suffisant.
- **Critere d'acceptation (OK/KO)** : OK si "Passer" est annonce/activable comme bouton, cible >= 44 pt, contraste lisible ; KO si non focalisable, cible trop petite, ou contraste insuffisant. NOTE QA : libelle gris attenue (`text-ink-muted`) sur fond sombre -> verifier ratio de contraste WCAG AA.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min
