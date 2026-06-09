# 39 - Conditions d'utilisation (`privacy`)

## Contexte ecran

- **Route(s)** : `Terms` — enregistree DEUX fois dans la nav :
  - `SettingsNavigator` (stack authentifie) : atteinte depuis `SettingsScreen` via la ligne `t('settings.termsOfService')` → `navigation.navigate('Terms')` (`goTerms`, `SettingsScreen.tsx:123` et `:467`).
  - `AuthNavigator` (flux pre-auth) : atteinte depuis l'ecran telephone via le lien `t('auth.phone.termsLinkA11y')` (= « Conditions d'utilisation »), `AuthNavigator.tsx:57`.
- **Composant** : `src/features/privacy/screens/TermsScreen.tsx`, qui rend `LegalDoc` + `LegalSection` + `LegalParagraph` (`src/features/privacy/components/LegalDoc.tsx`).
- **Roles requis** : aucun. Accessible **guest** (depuis l'ecran telephone du flux d'inscription, non connecte) ET **standard / admin** (depuis Reglages). C'est un document legal statique, identique pour tous les roles.
- **Comportements temps-reel** : AUCUN. Pas de WebSocket, pas de LiveKit, pas de push, pas d'appel reseau. Le document est embarque dans l'app (texte i18n local, fonctionne hors-ligne par conception — cf. commentaire `LegalDoc.tsx`). Aucun store consomme, aucune action declenchee.
- **Pre-conditions globales** : aucune (pas de compte, pas de permission micro/notif/localisation/stockage requise, pas de reseau requis).
- **Etats de donnees pertinents** : contenu 100% statique issu de l'i18n (`privacy.terms.*`). Pas de liste, pas d'etat vide, pas de « non lus ». Le seul etat variable est le contenu textuel selon la **langue active** (FR/EN) et la **taille de police systeme**. Le titre est « Conditions d'utilisation », sous-titre « Derniere mise a jour : 25 avril 2026 », puis 8 sections (s1→s8) avec leurs paragraphes.

> **NOTE IMPORTANTE — ecran en lecture seule** : cet ecran ne contient **litteralement aucun bouton, lien, toggle, champ ou cellule pressable**. Le seul code interactif est implicite : le **retour arriere** fourni par le navigateur (`@react-navigation/native-stack`). Comme les deux stacks sont configurees avec `headerShown: false`, il **n'y a pas de bouton retour visible (chevron) dans un header** : le retour se fait via le **geste de retour iOS (swipe depuis le bord gauche)** et le **bouton retour materiel/gestuel Android**. La matrice et les cas ci-dessous couvrent donc ce retour implicite, le scroll, et l'accessibilite du document, conformement a la regle « si l'ecran n'a aucun bouton, traiter au minimum retour/fermer et liens ».

## Matrice bouton

| #   | Bouton                                             | Emplacement                                         | Type                              | Locator reel                                                                                                                                                                                          | Pre-condition                                                       | Priorite |
| --- | -------------------------------------------------- | --------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 1   | Retour (geste swipe iOS / bouton materiel Android) | Hors-ecran (navigateur natif, `headerShown: false`) | navigation                        | Aucun locator dans cet ecran ; geste OS / `hardwareBackPress`. Le declencheur en amont a un locator : ligne Reglages `t('settings.termsOfService')` ou lien telephone `t('auth.phone.termsLinkA11y')` | Ecran ouvert au-dessus d'un ecran precedent (Reglages ou Telephone) | P2       |
| 2   | Document defilable (ScrollView)                    | Corps (plein ecran)                                 | list-item (scroll, non pressable) | Pas de `accessibilityLabel` ; `ScrollView` ; en-tetes via `accessibilityRole="header"` sur le titre `t('privacy.terms.title')` et chaque `t('privacy.terms.sN.title')`                                | Aucune                                                              | P2       |

> Aucun autre element actionnable n'existe dans le code (`grep` : zero `Pressable` / `TouchableOpacity` / `Button` / `onPress` / `accessibilityRole="link"` / `accessibilityRole="button"` dans `TermsScreen.tsx` et `LegalDoc.tsx`). Les seuls `accessibilityRole` presents sont `header`.

## Cas de test

### PRIV-TERMS-001 - Ouverture depuis Reglages et affichage complet

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard connecte ; reseau Wi-Fi (non requis mais nominal) ; aucune permission requise. Langue app = FR.
- **Etapes** :
  1. Ouvrir l'onglet/section **Reglages**.
  2. Taper la ligne « Conditions d'utilisation » (locator `t('settings.termsOfService')`, icone `description`).
  3. Attendre l'ouverture de l'ecran `Terms`.
  4. Observer le titre, la ligne « Derniere mise a jour », et faire defiler jusqu'en bas.
- **Resultat attendu** : l'ecran s'ouvre ; titre « Conditions d'utilisation » (header) ; sous-titre « Derniere mise a jour : 25 avril 2026 » ; les 8 sections s1→s8 sont presentes avec leurs titres en-tete et paragraphes ; le scroll atteint le bas (padding bottom respecte la safe area).
- **Critere d'acceptation (OK/KO)** : OK si le titre + les 8 titres de section (`privacy.terms.s1.title` … `privacy.terms.s8.title`) sont visibles apres scroll, sans troncature ni chevauchement. KO sinon.
- **Donnees de test** : compte standard `+33600000002` / OTP `000000` (compte de test) ; cle attendue `privacy.terms.title` = « Conditions d'utilisation ».
- **Duree estimee** : 3 min

### PRIV-TERMS-002 - Ouverture depuis le flux d'inscription (guest, hors-ligne)

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : non connecte (guest) ; appareil en **mode avion (hors-ligne)** ; langue FR.
- **Etapes** :
  1. Lancer l'app jusqu'a l'ecran de saisie du numero de telephone (flux `AuthNavigator`).
  2. Activer le mode avion.
  3. Taper le lien « Conditions d'utilisation » (locator `t('auth.phone.termsLinkA11y')`).
  4. Verifier l'affichage complet du document hors-ligne.
- **Resultat attendu** : le document s'affiche integralement **sans aucun appel reseau ni spinner** (contenu embarque) ; les 8 sections sont lisibles meme en mode avion.
- **Critere d'acceptation (OK/KO)** : OK si le contenu s'affiche identiquement en mode avion qu'en ligne (aucune zone vide, aucun message d'erreur reseau). KO si une section manque ou si un loader/erreur apparait.
- **Donnees de test** : aucun compte ; cle `auth.phone.termsLinkA11y` = « Conditions d'utilisation ».
- **Duree estimee** : 3 min

### PRIV-TERMS-003 - Retour : geste/bouton, multi-clic rapide et stabilite de navigation

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard connecte ; ecran `Terms` ouvert depuis Reglages ; reseau quelconque (Wi-Fi puis bascule 4G en cours de manip pour simuler instabilite).
- **Etapes** :
  1. Depuis l'ecran `Terms`, declencher le retour **3 fois tres rapidement** : bouton retour materiel/gestuel Android (ou swipe bord gauche iOS) en rafale (~3 taps en < 800 ms).
  2. Repeter le test : ouvrir `Terms`, basculer Wi-Fi→4G pendant l'affichage, puis revenir en arriere.
  3. Verifier la pile de navigation apres retour.
- **Resultat attendu** : l'app revient **une seule fois** sur l'ecran precedent (Reglages) sans empiler/depiler plusieurs ecrans, sans crash, sans ecran noir ; le changement de reseau n'a aucun effet (ecran statique, pas de requete). Pas de double-pop qui ferait quitter Reglages.
- **Critere d'acceptation (OK/KO)** : OK si apres les retours rapides l'utilisateur est exactement sur Reglages (un seul niveau remonte) et l'app reste stable. KO si crash, ecran blanc/noir, ou navigation a sauté plus d'un niveau.
- **Donnees de test** : compte standard `+33600000002` / OTP `000000`.
- **Duree estimee** : 4 min

### PRIV-TERMS-004 - Accessibilite : lecteur d'ecran, police agrandie, contraste

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte standard ou guest ; **TalkBack (Android) / VoiceOver (iOS) actif** ; taille de police systeme reglee au **maximum** ; mode contraste eleve active si disponible. Theme sombre (mono-dark assume par l'app).
- **Etapes** :
  1. Ouvrir l'ecran `Terms`.
  2. Balayer avec le lecteur d'ecran du haut vers le bas.
  3. Verifier l'annonce du titre et des titres de section comme **en-tetes**.
  4. Augmenter la police systeme au maximum et re-verifier la lisibilite/scroll.
  5. Verifier le contraste du texte muted (sous-titre « Derniere mise a jour » et paragraphes) sur le fond sombre.
- **Resultat attendu** : le titre `privacy.terms.title` et chaque `privacy.terms.sN.title` sont annonces avec le role **header** (navigation par en-tetes fonctionnelle) ; tous les paragraphes sont lus dans l'ordre ; en police max le texte reste entierement lisible et scrollable (pas de troncature, pas de texte coupe par le bas hors safe area) ; le contraste est suffisant (note : le sous-titre `lastUpdated` est en `textMuted` 11px — point de vigilance contraste/petite taille a verifier vs WCAG AA).
- **Critere d'acceptation (OK/KO)** : OK si tous les en-tetes sont annonces comme « titre/header », tout le texte est lu et reste lisible en police max. KO si un en-tete est annonce comme texte simple, si du texte est tronque/inaccessible, ou si le contraste du texte muted est insuffisant (< 4.5:1 pour le corps).
- **Donnees de test** : cles `privacy.terms.title`, `privacy.terms.s1.title` … `privacy.terms.s8.title` ; sous-titre `privacy.terms.lastUpdated` = « Derniere mise a jour : 25 avril 2026 ».
- **Duree estimee** : 6 min

### PRIV-TERMS-005 - Scroll complet et integrite du contenu (limites de defilement)

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte standard ou guest ; ecran `Terms` ouvert ; petit ecran (ex : appareil ~5.5") pour maximiser le besoin de scroll.
- **Etapes** :
  1. Ouvrir `Terms`.
  2. Scroller jusqu'en haut (rebond/over-scroll) puis jusqu'en bas (over-scroll).
  3. Verifier que le premier element (titre) et le dernier paragraphe de la section 8 sont entierement visibles.
  4. Faire pivoter l'appareil (portrait→paysage si autorise) et re-scroller.
- **Resultat attendu** : tout le contenu est atteignable ; le `paddingTop` respecte la safe area (titre non masque par l'encoche/status bar), le `paddingBottom` (safe area + giant) laisse le dernier paragraphe entierement lisible au-dessus de la barre de navigation systeme ; aucun contenu n'est definitivement coupe.
- **Critere d'acceptation (OK/KO)** : OK si le titre (haut) et le dernier paragraphe de la section 8 (`privacy.terms.s8.p1`) sont entierement visibles aux extremites du scroll. KO si une partie du texte reste inaccessible (sous l'encoche ou la barre systeme).
- **Donnees de test** : cle de fin de document `privacy.terms.s8.p1`.
- **Duree estimee** : 3 min

### PRIV-TERMS-006 - Bascule de langue FR/EN du document

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte standard connecte ; possibilite de changer la langue (Reglages ou langue systeme) ; reseau quelconque.
- **Etapes** :
  1. Mettre l'app en **FR**, ouvrir `Terms`, noter le titre « Conditions d'utilisation ».
  2. Revenir en arriere, basculer la langue en **EN**.
  3. Rouvrir `Terms`.
  4. Comparer titre et titres de section.
- **Resultat attendu** : en EN, le titre et les sections affichent les valeurs de `en.json` (cles `privacy.terms.*` cote anglais) ; le nombre de sections (8) reste identique ; aucun texte ne reste en FR ni n'affiche la cle brute (`privacy.terms.title`).
- **Critere d'acceptation (OK/KO)** : OK si tout le document est traduit en EN sans cle i18n brute visible et sans section manquante. KO si une cle brute apparait ou si du texte FR persiste en mode EN.
- **Donnees de test** : `fr.json` `privacy.terms.title` = « Conditions d'utilisation » ; verifier la contrepartie `en.json` `privacy.terms.title`.
- **Duree estimee** : 3 min
