# 37 - Suppression de compte (`privacy`)

## Contexte ecran

- **Route** : `DeleteAccount` dans `SettingsNavigator` (pile `Settings`). Acces depuis Reglages → cellule « Supprimer mon compte » (`SettingsScreen.tsx`, `goDeleteAccount` → `navigation.navigate('DeleteAccount')`).
- **Fichier** : `src/features/privacy/screens/DeleteAccountScreen.tsx`. Aucun partial (`partials/` inexistant).
- **Roles requis** : tout utilisateur authentifie (`guest` apres upgrade, `standard`, `admin`). C'est une action RGPD ouverte a tout compte connecte — pas d'admin requis. Un compte non authentifie ne peut pas atteindre la pile Settings.
- **En-tete / bouton retour** : la pile est configuree avec `headerShown: false` (`SettingsNavigator.tsx`). **Il n'y a donc PAS de header ni de bouton retour rendu par cet ecran.** Le retour se fait par le geste systeme (swipe-back iOS / bouton materiel Android). Aucun element « retour/fermer » n'est present dans le JSX — c'est signale ici comme exige.
- **Comportements temps-reel** : AUCUN. L'ecran n'emet/recoit rien via WebSocket, LiveKit ni push. Le bouton declenche un POST REST (`privacyService.requestDeletion()` → `POST /users/me/request-deletion`) suivi d'un `signOut()` cote auth store. (Effet de bord temps-reel indirect : la session/socket est fermee par `signOut`.) `isRealtime = false` pour tous les elements.
- **Pre-conditions globales** : compte connecte, reseau pour valider la suppression (la saisie et l'activation du bouton fonctionnent hors-ligne ; seul l'appel reseau au moment de la confirmation requiert la connectivite).
- **Etats de donnees pertinents** :
  - Etat initial : champ de confirmation vide → bouton **desactive** (`disabled`, opacite 45 %).
  - Phrase correcte saisie (FR « SUPPRIMER », EN « DELETE », comparaison `trim().toUpperCase()`) → bouton **active**.
  - `busy = true` pendant l'appel reseau → label « ... », spinner, `accessibilityState.busy = true`, bouton inactif.
  - Echec reseau → Alert d'erreur (`errorTitle` / `errorBody` via `errorMessage`), `busy` repasse a `false`, l'utilisateur reste sur l'ecran et toujours connecte.
  - Pas d'etat « liste vide / non lus » : ecran purement formulaire.

## Matrice bouton

| #   | Bouton                                                                         | Emplacement                                  | Type         | Locator reel                                                                                                                                                | Pre-condition                             | Priorite |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------- |
| 1   | Saisie de confirmation (TextInput « SUPPRIMER »/« DELETE »)                    | Corps (sous la carte « Avant de supprimer ») | input-submit | `accessibilityLabel` = `t('privacy.delete.a11yInput')` → FR « Saisie de confirmation de suppression » / EN « Deletion confirmation input »                  | Compte connecte                           | P0       |
| 2   | « Supprimer mon compte definitivement » (Button danger, fullWidth)             | Corps (bas de l'ecran)                       | destructive  | `accessibilityRole='button'`, name = `t('privacy.delete.buttonDelete')` → FR « Supprimer mon compte definitivement » / EN « Delete my account permanently » | Phrase de confirmation saisie ET `!busy`  | P0       |
| 3   | « Supprimer mon compte definitivement » — action destructive de l'Alert native | Modale (Alert systeme)                       | destructive  | Bouton natif `style:'destructive'`, texte = `t('privacy.delete.buttonDelete')`                                                                              | Alert ouverte (bouton #2 presse) + reseau | P0       |
| 4   | « Annuler » — action d'annulation de l'Alert native                            | Modale (Alert systeme)                       | navigation   | Bouton natif `style:'cancel'`, texte = `t('privacy.delete.buttonCancel')` → FR « Annuler » / EN « Cancel »                                                  | Alert ouverte                             | P1       |

> Note : il n'existe aucun bouton retour/fermer ni lien dans le JSX de l'ecran (header masque par la pile). Le geste de retour systeme est couvert via le contexte ; il n'apparait pas dans la matrice car non rendu par l'ecran.

## Cas de test

### PRIV-DELETE-001 - Saisie de la phrase active le bouton de suppression

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi ; aucune permission speciale requise.
- **Etapes** :
  1. Naviguer Reglages → « Supprimer mon compte ».
  2. Verifier que le bouton « Supprimer mon compte definitivement » est grise/desactive.
  3. Taper sur le champ « Saisie de confirmation de suppression ».
  4. Saisir exactement `SUPPRIMER` (FR) / `DELETE` (EN).
  5. Observer l'etat du bouton.
- **Resultat attendu** : le champ affiche `SUPPRIMER` (auto-majuscules `autoCapitalize="characters"`, lettres espacees `letterSpacing:1`). Le bouton passe d'inactif a actif (opacite pleine, `accessibilityState.disabled = false`). Aucun appel reseau a ce stade.
- **Critere d'acceptation (OK/KO)** : OK si le bouton devient interactif uniquement apres saisie de la phrase exacte (a la casse/espaces pres) ; KO s'il reste desactive ou s'active prematurement.
- **Donnees de test** : saisie = `SUPPRIMER` (FR) / `DELETE` (EN). Variantes valides acceptees : `supprimer` (espaces + minuscules, car `trim().toUpperCase()`).
- **Duree estimee** : 2 min

### PRIV-DELETE-002 - Phrase incorrecte / multi-clic rapide / hors-ligne sur le bouton (bouton #2)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; tester en hors-ligne (mode avion) puis 4G degradee.
- **Etapes** :
  1. Ouvrir l'ecran de suppression.
  2. Saisir une phrase erronee : `SUPPRIME` (sans le R) → verifier que le bouton reste desactive.
  3. Tenter de presser le bouton desactive plusieurs fois rapidement → aucune Alert ne s'ouvre (onPress `undefined` quand inactif).
  4. Corriger en `SUPPRIMER` → bouton actif.
  5. Activer le mode avion (hors-ligne).
  6. Presser le bouton actif, puis dans l'Alert presser la destructive ; observer.
  7. Repeter en 4G a forte latence : presser la destructive de l'Alert puis re-presser le bouton #2 rapidement avant la fin de l'appel.
- **Resultat attendu** : avec phrase fausse, bouton inerte (pas d'Alert). Hors-ligne : l'appel `requestDeletion` echoue → Alert d'erreur (titre `Erreur` / body `Echec de la suppression` ou message serveur via `errorMessage`), `busy` repasse a `false`, l'utilisateur reste connecte et sur l'ecran. En latence : pendant l'appel le bouton est en etat `busy` (label « ... », spinner, inactif) → un re-tap rapide est ignore (un seul `requestDeletion` part). Pas de double suppression.
- **Critere d'acceptation (OK/KO)** : OK si aucune Alert sur bouton desactive, si l'echec reseau garde la session active avec message d'erreur, et si un seul appel `/users/me/request-deletion` est emis malgre le multi-clic ; KO si double appel, deconnexion sur erreur, ou crash.
- **Donnees de test** : phrase fausse = `SUPPRIME` ; phrase valide = `SUPPRIMER` ; endpoint `POST /users/me/request-deletion` ; reponse simulee 500 / timeout. Compte de test : `qa.delete.std@chathouse.test`.
- **Duree estimee** : 6 min

### PRIV-DELETE-003 - Accessibilite du bouton et du champ (lecteur d'ecran + police agrandie + contraste)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme au max ; verifier le contraste de la « danger zone ».
- **Etapes** :
  1. Activer TalkBack/VoiceOver et regler la police systeme au maximum.
  2. Ouvrir l'ecran ; balayer les elements au doigt.
  3. Verifier l'annonce de l'en-tete `accessibilityRole="header"` (« Supprimer mon compte »).
  4. Atteindre le champ : doit etre annonce « Saisie de confirmation de suppression, champ de saisie ».
  5. Atteindre le bouton : doit etre annonce « Supprimer mon compte definitivement, bouton, desactive » tant que la phrase n'est pas saisie.
  6. Saisir la phrase ; re-focaliser le bouton : l'annonce ne doit plus contenir « desactive ».
  7. Verifier que les textes de la carte rouge (warningTitle `colors.danger` #ffb4ab sur fond rgba(239,68,68,0.1)) et les puces restent lisibles a police agrandie sans troncature (le ScrollView doit permettre de scroller).
- **Resultat attendu** : tous les elements sont focalisables et correctement etiquetes ; l'etat desactive/actif du bouton est vocalise via `accessibilityState.disabled` ; le contenu reste lisible et scrollable a la taille de police maximale ; le contraste de la zone d'avertissement respecte WCAG AA pour le texte.
- **Critere d'acceptation (OK/KO)** : OK si chaque element interactif est annonce avec libelle + role + etat, et qu'aucun texte n'est coupe a 200 % de police ; KO si le bouton n'annonce pas son etat desactive, si le champ n'a pas de label, ou si du texte est tronque/illisible.
- **Donnees de test** : langue FR puis EN (verifier que les annonces suivent la locale) ; police systeme « Tres grande ».
- **Duree estimee** : 7 min

### PRIV-DELETE-004 - Confirmation de l'Alert : suppression effective + deconnexion (bouton #3)

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi stable ; backend joignable.
- **Etapes** :
  1. Ouvrir l'ecran, saisir `SUPPRIMER`, presser « Supprimer mon compte definitivement » (bouton #2).
  2. Verifier l'ouverture de l'Alert native : titre `Supprimer mon compte`, corps = `description` + saut de ligne + `grace` (periode de grace 30 jours), boutons « Annuler » et « Supprimer mon compte definitivement » (destructif).
  3. Presser le bouton destructif de l'Alert.
  4. Observer l'etat de chargement puis la navigation.
- **Resultat attendu** : pendant l'appel le bouton #2 passe en `busy` (label « ... », spinner). `POST /users/me/request-deletion` est appele exactement une fois (reponse `{ deletedAt, permanentDeletionAt }`). A succes, `signOut()` est invoque : la session est purgee, la socket/temps-reel fermee, l'app revient vers le flux d'authentification (Landing/Login). Aucun retour sur l'ecran de suppression.
- **Critere d'acceptation (OK/KO)** : OK si exactement un appel `request-deletion` reussit ET `signOut` deconnecte l'utilisateur (redirige vers l'auth) ; KO si pas de deconnexion, double appel, ou ecran fige.
- **Donnees de test** : compte `qa.delete.victim@chathouse.test` ; payload reponse `{ "deletedAt":"2026-06-09T00:00:00.000Z", "permanentDeletionAt":"2026-07-09T00:00:00.000Z" }`.
- **Duree estimee** : 4 min

### PRIV-DELETE-005 - Alert : multi-clic destructif + perte reseau pendant l'appel (bouton #3)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` connecte ; reseau 4G a forte latence, puis coupure reseau pendant l'appel.
- **Etapes** :
  1. Saisir la phrase, presser bouton #2 pour ouvrir l'Alert.
  2. Sous latence elevee, presser tres rapidement plusieurs fois le bouton destructif de l'Alert (l'Alert se ferme au premier tap).
  3. Pendant que `busy = true` (label « ... »), tenter de re-presser le bouton #2 sous-jacent.
  4. Couper le reseau juste apres l'envoi pour simuler une coupure en cours d'appel ; observer.
  5. Restaurer le reseau et reessayer proprement.
- **Resultat attendu** : l'Alert native se ferme au premier tap (un seul `onPress` destructif). Un seul `POST /users/me/request-deletion` est emis ; le bouton #2 en etat `busy` ignore les taps. Si l'appel echoue (coupure), une Alert d'erreur s'affiche, `busy` repasse a `false`, l'utilisateur reste connecte et peut reessayer ; aucune deconnexion partielle ni double suppression.
- **Critere d'acceptation (OK/KO)** : OK si au plus un appel reseau part malgre le multi-clic et si l'echec laisse la session intacte avec message d'erreur ; KO si plusieurs appels, deconnexion sans succes serveur, ou etat `busy` bloque definitivement.
- **Donnees de test** : endpoint `POST /users/me/request-deletion` ; scenario reseau : latence 5 s puis `ECONNRESET` ; compte `qa.delete.retry@chathouse.test`.
- **Duree estimee** : 6 min

### PRIV-DELETE-006 - Annulation de l'Alert : aucune suppression (bouton #4)

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` connecte ; Wi-Fi.
- **Etapes** :
  1. Saisir `SUPPRIMER`, presser bouton #2 pour ouvrir l'Alert.
  2. Presser « Annuler » (`style:'cancel'`).
  3. Observer l'ecran.
- **Resultat attendu** : l'Alert se ferme, aucun appel `/users/me/request-deletion` n'est emis, aucun `signOut`. L'utilisateur reste sur l'ecran avec le champ rempli (`SUPPRIMER`) et le bouton toujours actif.
- **Critere d'acceptation (OK/KO)** : OK si zero appel reseau et session intacte apres « Annuler » ; KO si une suppression est lancee ou si l'utilisateur est deconnecte.
- **Donnees de test** : phrase = `SUPPRIMER` ; compte `qa.delete.cancel@chathouse.test`.
- **Duree estimee** : 2 min

### PRIV-DELETE-007 - Accessibilite de l'Alert de confirmation (lecteur d'ecran, boutons #3/#4)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police agrandie.
- **Etapes** :
  1. Activer le lecteur d'ecran ; ouvrir l'Alert (saisir phrase + bouton #2).
  2. Laisser le lecteur lire le titre et le corps de l'Alert (description + periode de grace).
  3. Balayer entre les deux boutons natifs « Annuler » et « Supprimer mon compte definitivement ».
- **Resultat attendu** : l'Alert native est intercepte par TalkBack/VoiceOver (annonce titre + corps mentionnant la periode de grace de 30 jours) ; les deux boutons sont annonces avec leur libelle, le destructif identifiable. La police systeme agrandie ne tronque pas le corps de l'Alert (defilement natif si necessaire).
- **Critere d'acceptation (OK/KO)** : OK si le contenu et les deux actions sont entierement vocalises et activables au lecteur d'ecran a police max ; KO si un bouton est inaccessible ou si le corps est illisible/tronque.
- **Donnees de test** : langue FR et EN ; police « Tres grande ».
- **Duree estimee** : 5 min

### PRIV-DELETE-008 - Retour systeme depuis l'ecran (contexte, header masque)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard` connecte ; ecran ouvert depuis Reglages.
- **Etapes** :
  1. Ouvrir l'ecran de suppression (header masque, aucun bouton retour visible).
  2. Sur iOS : geste swipe-back depuis le bord gauche. Sur Android : bouton retour materiel/gesture.
  3. Verifier la pile de navigation.
- **Resultat attendu** : le geste systeme ramene a l'ecran Reglages sans declencher aucune suppression ni deconnexion. La saisie eventuelle dans le champ est abandonnee sans appel reseau. (Confirme qu'aucun bouton retour n'est rendu dans l'ecran : seul le geste systeme assure le retour.)
- **Critere d'acceptation (OK/KO)** : OK si le retour ramene a Reglages sans effet de bord ; KO si l'app reste bloquee, declenche une suppression, ou crash.
- **Donnees de test** : compte `qa.delete.nav@chathouse.test`.
- **Duree estimee** : 2 min
