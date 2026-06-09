# 28 - Infos du groupe (`messages`)

## Contexte ecran

- **Route** : `GroupInfo` dans le `MessageStack` (`MessageStackParamList`), params `{ conversationId: string }`. On y arrive depuis le fil de discussion de groupe (`GroupChat`) ou la liste de conversations.
- **Composant** : `src/features/messages/screens/GroupInfoScreen/GroupInfoScreen.tsx` (ecran monolithique, AUCUN partial — pas de dossier `partials/`).
- **Roles requis** : tout compte authentifie membre du groupe (`standard`, `admin`). `guest` n'a pas acces aux DM/groupes (pas de session). Le role applicatif `admin` n'influe PAS sur cet ecran : les actions de moderation (renommer, retirer un membre) sont gouvernees par la **propriete du groupe** (`group.ownerId === myId` → variable `isOwner`), pas par le role serveur.
- **Donnees** : chargees via `useGroup(conversationId)` (React Query, `GET /groups/:id`). Tant que `isLoading || !group`, l'ecran affiche un `Loader` plein ecran (`accessibilityLabel = t('common.loading')` = « Chargement… »).
- **Comportements temps-reel** : cet ecran N'OUVRE PAS de socket lui-meme. Les mutations passent par REST :
  - Renommer → `PATCH /groups/:id` (`useRenameGroup`).
  - Retirer un membre → `DELETE /groups/:id/members/:userId` (`useRemoveGroupMember`).
  - Quitter → `POST /groups/:id/leave` (`useLeaveGroup`).
    Apres succes, `invalidateGroup()` invalide `groupKeys.detail(id)` ET `groupKeys.list()`, ce qui re-fetch l'ecran info + la liste de conversations. La propagation aux AUTRES appareils (un membre voit son retrait, voit le nouveau nom) depend du refetch/realtime cote liste de conversations, pas de cet ecran. Effet « quasi temps-reel » a verifier en multi-utilisateur.
- **Pre-conditions globales** : utilisateur authentifie, token valide (sinon `apiClient` peut declencher refresh/redirection auth), reseau accessible vers l'API.
- **Etats de donnees pertinents** :
  - **Chargement** : `Loader` plein ecran.
  - **Owner** : `isOwner === true` → bouton de retrait visible sur chaque autre membre, le bouton « Enregistrer » du nom fonctionne (cote serveur, seul l'owner peut PATCH).
  - **Membre simple** : `isOwner === false` → pas de bouton retrait ; le champ nom reste editable cote UI mais le `PATCH` sera rejete serveur.
  - **Liste membres** : `group.members` (toujours ≥ 1, contient au moins soi-meme). Le compteur `memberCount` est pluralise par i18n.
  - **Hors-ligne / latence** : pas d'optimistic UI sur ces mutations ; l'ecran ne reflete le changement qu'apres succes + invalidation/refetch. Pas de toast d'erreur explicite cote ecran (a verifier — risque d'echec silencieux).

> Note locator importante : le bouton « Enregistrer le nom » utilise `accessibilityLabel={t('common.save', 'Save')}`. La cle `common.save` **n'existe pas** dans `fr.json`/`en.json` (seul `profile.edit.save` existe). Le label resolu est donc la valeur par defaut litterale **`Save`** (et non « Enregistrer »). Le test voisin confirme : `findByLabelText(i18n.t('common.save', 'Save'))` → `Save`.

---

## Matrice bouton

| #   | Bouton                           | Emplacement                       | Type         | Locator reel                                                                                                                                                                      | Pre-condition                                                                   | Priorite |
| --- | -------------------------------- | --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| 1   | Retour (fleche)                  | Header gauche                     | navigation   | `MaterialIcons name="arrow-back"` dans `Pressable` `accessibilityRole="button"` (1er bouton du DOM ; test : `getAllByRole('button')[0]`)                                          | Ecran charge                                                                    | P1       |
| 2   | Enregistrer le nom (check)       | Corps, a droite du champ nom      | submit       | `accessibilityLabel = t('common.save','Save')` → **`Save`**                                                                                                                       | Owner + titre modifie (`titleChanged`) + `!rename.isPending` (sinon `disabled`) | P0       |
| 3   | Ajouter des personnes            | Corps, en-tete section membres    | navigation   | `t('messages.addPeople','Add people')` → « Ajouter des personnes » (texte dans `Pressable`)                                                                                       | Ecran charge                                                                    | P1       |
| 4   | Retirer un membre (cercle moins) | Corps, cellule de membre (droite) | destructive  | `accessibilityLabel = \`Remove ${name}\``(ex :`Remove Sam Stone`) — chaine litterale NON traduite                                                                                 | `isOwner === true` ET membre ≠ moi                                              | P0       |
| 5   | Quitter le groupe                | Corps, bas (bandeau danger)       | destructive  | `t('messages.leaveGroup','Leave group')` → « Quitter le groupe »                                                                                                                  | Ecran charge                                                                    | P0       |
| 6   | Champ nom du groupe (input)      | Corps, sous l'avatar              | input-submit | placeholder `t('messages.groupNamePlaceholder','Name this group')` → « Nomme ce groupe » ; label `t('messages.groupNameLabel','Group name')` → « Nom du groupe » ; `maxLength=80` | Ecran charge                                                                    | P1       |

> Elements de confirmation (boutons d'`Alert` natif, hors arbre RN) reutilises dans les cas : pour le retrait → `t('messages.remove','Remove')` = « Retirer » / `t('common.cancel','Cancel')` = « Annuler » ; pour quitter → `t('messages.leave','Leave')` = « Quitter » / `t('common.cancel')` = « Annuler ».

---

## Cas de test

### MSG-GINFO-001 - Retour : navigation arriere fonctionnelle

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` membre, groupe charge, Wi-Fi, aucune permission speciale
- **Etapes** :
  1. Ouvrir l'ecran « Infos du groupe » depuis le fil de groupe.
  2. Attendre l'affichage du header « Infos du groupe ».
  3. Taper la fleche retour (1er bouton, icone `arrow-back`).
- **Resultat attendu** : `navigation.goBack()` est appele, retour a l'ecran precedent (fil de groupe), aucun appel reseau declenche.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran precedent reprend le focus sans perte d'etat ; KO si l'ecran reste affiche ou crash.
- **Donnees de test** : `conversationId = "conv-1"`
- **Duree estimee** : 2 min

### MSG-GINFO-002 - Retour : multi-clic rapide n'empile pas les pop

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, groupe charge, reseau avec latence simulee (Charles/Network Link Conditioner 1 Mbps)
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper 5 fois tres rapidement (< 1 s) sur la fleche retour.
- **Resultat attendu** : un seul retour effectif (un seul `goBack`), pas de double-pop ni d'ecran blanc/stack vide.
- **Critere d'acceptation (OK/KO)** : OK si on revient exactement a l'ecran parent unique ; KO si l'app pop au-dela (ecran noir) ou crash.
- **Donnees de test** : `conversationId = "conv-1"`
- **Duree estimee** : 3 min

### MSG-GINFO-003 - Retour : accessibilite lecteur d'ecran + police XXL

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack (Android) ou VoiceOver (iOS) actif ; taille de police systeme = max ; contraste eleve active
- **Etapes** :
  1. Activer le lecteur d'ecran et regler la police a la taille maximale.
  2. Ouvrir l'ecran.
  3. Balayer jusqu'au premier element focusable.
- **Resultat attendu** : le lecteur annonce un bouton (role `button`) ; l'activation par double-tap declenche le retour. Le header « Infos du groupe » reste lisible/non tronque a la police max.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est focusable, annonce comme bouton et activable ; KO si non atteignable ou non annonce.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

> Limite a11y connue : la fleche retour n'a PAS d'`accessibilityLabel` explicite (seulement role `button`). Le lecteur annonce « bouton » sans libelle — defaut a remonter.

### MSG-GINFO-004 - Enregistrer le nom : renommage owner reussi

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `owner` du groupe (`group.ownerId === myId`), groupe charge, Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; le champ nom affiche le titre actuel (« Weekend crew »).
  2. Effacer et saisir « Renamed crew » dans le champ (placeholder « Nomme ce groupe »).
  3. Verifier que le bouton check (label `Save`) passe en etat actif (fond `bg-primary`, opacite pleine).
  4. Taper le bouton `Save`.
- **Resultat attendu** : `rename.mutate({ conversationId: "conv-1", title: "Renamed crew" })` appele → `PATCH /groups/conv-1`. Apres succes, `groupKeys.detail` + `groupKeys.list` invalides, le titre persiste apres refetch.
- **Critere d'acceptation (OK/KO)** : OK si le serveur recoit `{title:"Renamed crew"}` (trim applique) et l'UI reflete le nouveau nom apres refetch ; KO si aucun appel ou titre non sauvegarde.
- **Donnees de test** : `conversationId="conv-1"`, payload `{ "title": "Renamed crew" }`
- **Duree estimee** : 3 min

### MSG-GINFO-005 - Enregistrer le nom : bouton desactive si non modifie / vide / multi-clic

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `owner`, groupe charge, reseau coupe puis retabli (mode avion ON pendant l'envoi)
- **Etapes** :
  1. Ouvrir l'ecran sans rien modifier → constater que `Save` est desactive (opacite 50 %, `disabled`).
  2. Vider entierement le champ (titre = « ») → `Save` reste desactive (`title.trim().length > 0` faux).
  3. Saisir « Equipe » puis remettre exactement le titre original → `Save` redevient desactive (`titleChanged` faux).
  4. Saisir « Nouveau nom », activer le mode avion, taper `Save` 5 fois de suite rapidement.
  5. Reactiver le reseau.
- **Resultat attendu** : etapes 1-3 → aucun appel possible (bouton inerte). Etape 4 → la mutation part (ou echoue reseau) ; pendant `rename.isPending`, le bouton est `disabled` (pas de double soumission). Pas plus d'UN `PATCH` reussi.
- **Critere d'acceptation (OK/KO)** : OK si jamais 2+ renommages dupliques et aucun appel sur titre inchange/vide ; KO si double-soumission ou appel avec titre vide.
- **Donnees de test** : titre original « Weekend crew » ; saisie « Nouveau nom »
- **Duree estimee** : 5 min

> Limite connue : en cas d'echec reseau du `PATCH`, l'ecran n'affiche AUCUN toast/erreur (pas de gestion `onError` dans le composant). A remonter : echec silencieux.

### MSG-GINFO-006 - Enregistrer le nom : accessibilite + police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `owner` ; VoiceOver/TalkBack actif ; police max ; contraste eleve
- **Etapes** :
  1. Activer lecteur d'ecran + police max.
  2. Ouvrir l'ecran, focus sur le champ nom, saisir « Crew A11y ».
  3. Naviguer jusqu'au bouton check.
- **Resultat attendu** : le lecteur annonce le bouton avec le libelle « Save » (role bouton). L'etat desactive/actif est percu (le bouton n'est focusable comme actionnable que lorsqu'actif, sinon `disabled`). Le check (20 px) reste contraste sur fond primary.
- **Critere d'acceptation (OK/KO)** : OK si le bouton est annonce « Save, bouton » et activable une fois le titre modifie ; KO si label vide ou bouton non distinguable.
- **Donnees de test** : saisie « Crew A11y »
- **Duree estimee** : 4 min

> Locator reel a corriger : label = `Save` (cle `common.save` absente des locales → fallback anglais litteral). Le QA et l'automatisation doivent cibler `getByLabelText('Save')`, PAS « Enregistrer ».

### MSG-GINFO-007 - Enregistrer le nom : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils. Appareil A = owner sur « Infos du groupe » ; Appareil B = membre `sam` sur la liste de conversations (ou fil de groupe). Wi-Fi des deux cotes.
- **Etapes** :
  1. Sur A, renommer le groupe en « Renamed crew » et taper `Save`.
  2. Attendre le succes sur A (titre refletant le nouveau nom apres invalidation).
  3. Sur B, declencher un refetch (pull-to-refresh sur la liste ou reouverture du fil) ou attendre le push/refetch.
- **Resultat attendu** : A affiche le nouveau nom apres refetch local. B voit « Renamed crew » des qu'il re-fetch la liste/detail. La coherence finale est atteinte sur les deux appareils.
- **Critere d'acceptation (OK/KO)** : OK si les deux appareils convergent sur « Renamed crew » sans incoherence persistante ; KO si B garde l'ancien nom apres refetch.
- **Donnees de test** : groupe « conv-1 », nouveau titre « Renamed crew », membres `me`, `sam`
- **Duree estimee** : 6 min

### MSG-GINFO-008 - Ajouter des personnes : navigation vers AddGroupMembers

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard` membre, groupe charge, Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper « Ajouter des personnes » (icone `person-add` + texte).
- **Resultat attendu** : `navigation.navigate('AddGroupMembers', { conversationId: "conv-1" })` ; l'ecran d'ajout de membres s'ouvre avec le bon `conversationId`.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran AddGroupMembers s'ouvre avec `conversationId="conv-1"` ; KO si mauvais param ou pas de navigation.
- **Donnees de test** : `conversationId="conv-1"`
- **Duree estimee** : 2 min

### MSG-GINFO-009 - Ajouter des personnes : multi-clic rapide / latence

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, groupe charge, reseau lent (latence 2 s simulee)
- **Etapes** :
  1. Ouvrir l'ecran.
  2. Taper 4 fois rapidement sur « Ajouter des personnes ».
- **Resultat attendu** : un seul push de l'ecran AddGroupMembers (la stack de navigation ne doit pas empiler 4 instances).
- **Critere d'acceptation (OK/KO)** : OK si une seule instance d'AddGroupMembers dans la stack ; KO si plusieurs ecrans empiles.
- **Donnees de test** : `conversationId="conv-1"`
- **Duree estimee** : 3 min

### MSG-GINFO-010 - Ajouter des personnes : accessibilite + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police max ; contraste eleve
- **Etapes** :
  1. Activer lecteur d'ecran + police max.
  2. Ouvrir l'ecran, balayer jusqu'a la section membres.
  3. Atteindre « Ajouter des personnes ».
- **Resultat attendu** : annonce « Ajouter des personnes, bouton » ; texte non tronque a police max ; double-tap ouvre AddGroupMembers.
- **Critere d'acceptation (OK/KO)** : OK si focusable, annonce correcte (role button + libelle) et activable ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 3 min

### MSG-GINFO-011 - Retirer un membre : owner retire un membre via confirmation

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `owner` ; groupe avec ≥ 2 membres (moi + `Sam Stone`) ; Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; verifier que le bouton cercle-moins (label `Remove Sam Stone`) apparait sur la cellule de `Sam Stone` (et PAS sur ma propre cellule).
  2. Taper « Remove Sam Stone ».
  3. Dans l'`Alert` « Retirer le membre » / « Retirer Sam Stone du groupe ? », taper « Retirer ».
- **Resultat attendu** : `removeMember.mutate({ conversationId:"conv-1", userId:"other-1" })` → `DELETE /groups/conv-1/members/other-1`. Apres succes, invalidation detail+list, `Sam Stone` disparait de la liste, compteur membres decremente.
- **Critere d'acceptation (OK/KO)** : OK si le membre disparait apres refetch et le bon `userId` est envoye ; KO si mauvais id ou membre toujours present.
- **Donnees de test** : `conversationId="conv-1"`, `userId="other-1"` (`Sam Stone` / `@sam`)
- **Duree estimee** : 3 min

### MSG-GINFO-012 - Retirer un membre : annulation + non-owner + multi-clic + perte reseau

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : (a) compte `owner` puis (b) compte `standard` non-owner ; groupe charge ; reseau coupable a la demande
- **Etapes** :
  1. (Owner) Taper « Remove Sam Stone », dans l'`Alert` taper « Annuler » → aucune mutation.
  2. (Owner) Taper « Remove Sam Stone » 5 fois rapidement → un seul `Alert` actif a la fois ; ne confirmer qu'une fois.
  3. (Owner) Activer le mode avion, confirmer « Retirer », observer l'echec ; reactiver le reseau.
  4. Se reconnecter en compte `standard` non-owner → verifier qu'AUCUN bouton de retrait n'est rendu (`isOwner` faux).
- **Resultat attendu** : etape 1 → 0 appel. Etape 2 → pas de mutations multiples (1 seul `DELETE`). Etape 3 → l'appel echoue sans toast (echec silencieux a documenter) et le membre reste affiche. Etape 4 → aucun bouton `Remove ...` present.
- **Critere d'acceptation (OK/KO)** : OK si pas de double-retrait, annulation sans effet, et aucun bouton retrait pour un non-owner ; KO si un non-owner voit/declenche un retrait ou double-suppression.
- **Donnees de test** : `userId="other-1"`
- **Duree estimee** : 6 min

### MSG-GINFO-013 - Retirer un membre : accessibilite + police agrandie

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `owner` ; TalkBack/VoiceOver actif ; police max ; contraste eleve
- **Etapes** :
  1. Activer lecteur d'ecran + police max.
  2. Ouvrir l'ecran, balayer jusqu'a la cellule de `Sam Stone`.
  3. Atteindre le bouton de retrait.
- **Resultat attendu** : le lecteur annonce « Remove Sam Stone, bouton » (label dynamique avec le nom). L'icone danger (cercle-moins, 22 px, couleur `danger`) reste contrastee. Le double-tap ouvre l'`Alert` natif, lui-meme accessible (boutons « Annuler »/« Retirer » annonces).
- **Critere d'acceptation (OK/KO)** : OK si le label inclut le nom du membre et l'action destructive est annoncee/confirmee via dialog accessible ; KO si label generique ou inaccessible.
- **Donnees de test** : membre `Sam Stone`
- **Duree estimee** : 4 min

> Note locator : le label de retrait est la chaine litterale `Remove ${name}` (NON i18n). En FR il s'annonce quand meme « Remove Sam Stone ». A remonter : libelle non traduit.

### MSG-GINFO-014 - Retirer un membre : synchro multi-utilisateur (le retire est ejecte)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils. A = owner sur « Infos du groupe » ; B = `sam` (le membre vise) sur le fil/liste. Wi-Fi.
- **Etapes** :
  1. Sur A, taper « Remove Sam Stone » puis confirmer « Retirer ».
  2. Attendre le succes sur A (Sam disparait apres refetch, compteur -1).
  3. Sur B, declencher un refetch (pull-to-refresh / reouverture) ou attendre la propagation.
- **Resultat attendu** : A retire Sam de la liste. B (Sam) perd l'acces : le groupe disparait de sa liste ou il est redirige hors du fil au prochain fetch (selon la garde serveur). Convergence finale coherente.
- **Critere d'acceptation (OK/KO)** : OK si A ne voit plus Sam et B perd l'acces apres refetch ; KO si Sam continue de voir/poster dans le groupe.
- **Donnees de test** : `conversationId="conv-1"`, membre retire `other-1` (`@sam`)
- **Duree estimee** : 6 min

### MSG-GINFO-015 - Quitter le groupe : depart confirme + retour a la racine

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard` membre (non-owner ou owner), groupe charge, Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran, defiler jusqu'au bandeau « Quitter le groupe » (icone `logout`, fond danger).
  2. Taper « Quitter le groupe ».
  3. Dans l'`Alert` « Quitter le groupe » / « Tu ne recevras plus les messages de ce groupe. », taper « Quitter ».
- **Resultat attendu** : `leave.mutate("conv-1", { onSettled: () => navigation.popToTop() })` → `POST /groups/conv-1/leave`. `groupKeys.list()` invalide ; `onSettled` declenche `navigation.popToTop()` → retour a la racine de la pile messages. Le groupe disparait de la liste.
- **Critere d'acceptation (OK/KO)** : OK si `POST .../leave` envoye et navigation `popToTop` effectuee meme en cas d'echec (car `onSettled`) ; KO si on reste bloque sur l'ecran info.
- **Donnees de test** : `conversationId="conv-1"`
- **Duree estimee** : 3 min

### MSG-GINFO-016 - Quitter le groupe : annulation + multi-clic + perte reseau (onSettled)

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, groupe charge, reseau coupable (mode avion a la demande)
- **Etapes** :
  1. Taper « Quitter le groupe », puis dans l'`Alert` taper « Annuler » → aucune mutation, reste sur l'ecran.
  2. Taper « Quitter le groupe » 5 fois rapidement → un seul `Alert` ; ne confirmer qu'une fois.
  3. Activer le mode avion, confirmer « Quitter ».
- **Resultat attendu** : etape 1 → 0 appel. Etape 2 → pas de mutations multiples. Etape 3 → le `POST /leave` echoue MAIS `onSettled` s'execute quand meme → `navigation.popToTop()` quitte l'ecran (le serveur peut ne pas avoir enregistre le depart → incoherence possible : l'app pense qu'on est parti). A documenter comme risque (depart « optimiste » via `onSettled`).
- **Critere d'acceptation (OK/KO)** : OK si annulation sans effet, pas de double-leave, et navigation `popToTop` declenchee ; KO si double appel ou ecran fige. Risque a tracer : divergence client/serveur si le `leave` echoue mais qu'on quitte l'ecran.
- **Donnees de test** : `conversationId="conv-1"`
- **Duree estimee** : 5 min

### MSG-GINFO-017 - Quitter le groupe : accessibilite + police agrandie + contraste

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard` ; TalkBack/VoiceOver actif ; police max ; contraste eleve
- **Etapes** :
  1. Activer lecteur d'ecran + police max.
  2. Ouvrir l'ecran, balayer jusqu'au bandeau bas.
  3. Atteindre « Quitter le groupe ».
- **Resultat attendu** : annonce « Quitter le groupe, bouton ». Le texte danger reste lisible/contraste (couleur `danger` sur fond `danger/10`). Double-tap ouvre l'`Alert` accessible (« Annuler » / « Quitter » annonces).
- **Critere d'acceptation (OK/KO)** : OK si focusable, annonce correcte et dialog de confirmation accessible ; KO sinon.
- **Donnees de test** : N/A
- **Duree estimee** : 4 min

### MSG-GINFO-018 - Quitter le groupe : synchro multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : 2 appareils. A = membre `sam` qui quitte ; B = owner sur « Infos du groupe ». Wi-Fi.
- **Etapes** :
  1. Sur A, taper « Quitter le groupe » puis confirmer « Quitter ».
  2. Attendre le succes A (retour racine, groupe disparu de la liste de A).
  3. Sur B, declencher un refetch (pull-to-refresh / reouverture de l'ecran info).
- **Resultat attendu** : A ne voit plus le groupe. B, apres refetch, voit la liste des membres reduite (`sam` retire) et compteur -1.
- **Critere d'acceptation (OK/KO)** : OK si A perd l'acces et B voit le membre disparaitre apres refetch ; KO si l'un des deux reste incoherent.
- **Donnees de test** : `conversationId="conv-1"`, membre partant `other-1` (`@sam`)
- **Duree estimee** : 6 min

### MSG-GINFO-019 - Champ nom : saisie, limite 80 caracteres, etat actif du bouton

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `owner`, groupe charge, Wi-Fi
- **Etapes** :
  1. Ouvrir l'ecran ; le champ (placeholder « Nomme ce groupe ») affiche le titre courant.
  2. Saisir un nouveau nom valide (ex : « Crew du vendredi »).
  3. Verifier que le bouton `Save` s'active des que le texte trim differe de l'original.
  4. Tenter de saisir 100 caracteres.
- **Resultat attendu** : la saisie est plafonnee a 80 caracteres (`maxLength=80`). Le bouton `Save` passe actif quand `titleChanged`. Aucun appel reseau a la frappe (uniquement au tap `Save`).
- **Critere d'acceptation (OK/KO)** : OK si la saisie est limitee a 80 et le bouton reflete `titleChanged` ; KO si > 80 caracteres acceptes ou bouton incoherent.
- **Donnees de test** : nom « Crew du vendredi » ; chaine de test 100 caracteres `"A".repeat(100)`
- **Duree estimee** : 3 min

### MSG-GINFO-020 - Champ nom : titre vide / espaces uniquement / latence

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `owner`, groupe charge, reseau lent
- **Etapes** :
  1. Vider entierement le champ → `Save` desactive (`title.trim().length > 0` faux).
  2. Saisir uniquement des espaces « » → `Save` reste desactive.
  3. Saisir un nom valide avec espaces de bord « Crew » et taper `Save`.
- **Resultat attendu** : etapes 1-2 → aucun envoi possible. Etape 3 → l'envoi part avec `title` **trim** (« Crew ») cote hook (`title.trim()`) et service (`title.trim()`).
- **Critere d'acceptation (OK/KO)** : OK si vide/espaces bloquent l'envoi et le titre est trimme a l'envoi ; KO si envoi d'un titre vide ou non trimme.
- **Donnees de test** : « », « », « Crew » → attendu serveur « Crew »
- **Duree estimee** : 4 min

### MSG-GINFO-021 - Champ nom : accessibilite (label/placeholder) + police agrandie

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `owner` ; TalkBack/VoiceOver actif ; police max ; contraste eleve
- **Etapes** :
  1. Activer lecteur d'ecran + police max.
  2. Ouvrir l'ecran, balayer jusqu'au champ nom.
  3. Saisir « A11y crew » via le clavier.
- **Resultat attendu** : le lecteur annonce le champ avec son label « Nom du groupe » (et/ou placeholder « Nomme ce groupe ») ; la saisie est possible ; le champ et son label ne sont pas tronques a police max.
- **Critere d'acceptation (OK/KO)** : OK si le champ est annonce avec son intitule et editable ; KO si champ non identifie ou inaccessible.
- **Donnees de test** : saisie « A11y crew »
- **Duree estimee** : 3 min

### MSG-GINFO-022 - Ecran en chargement / sans donnees : Loader accessible

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard` ; `useGroup` en `isLoading` (reseau lent au premier fetch) ou `group` indisponible
- **Etapes** :
  1. Ouvrir l'ecran avec un reseau tres lent (premier `GET /groups/:id` en attente).
  2. Observer l'etat de chargement.
  3. Activer le lecteur d'ecran pendant l'attente.
- **Resultat attendu** : un `Loader` plein ecran s'affiche avec `accessibilityLabel = t('common.loading')` = « Chargement… », annonce par TalkBack/VoiceOver. Aucun bouton de l'ecran (retour, save, leave) n'est rendu tant que `group` est nul.
- **Critere d'acceptation (OK/KO)** : OK si le Loader est affiche et annonce « Chargement… », et les controles n'apparaissent qu'apres chargement ; KO si ecran vide non annonce ou crash sur `group` nul.
- **Donnees de test** : `conversationId="conv-1"` avec latence reseau elevee
- **Duree estimee** : 3 min

---

_Total : 6 elements interactifs, 22 cas de test. Aucun comportement WebSocket/LiveKit emis directement par cet ecran ; les effets multi-utilisateur reposent sur l'invalidation React Query (`detail` + `list`) puis refetch cote autres surfaces._
