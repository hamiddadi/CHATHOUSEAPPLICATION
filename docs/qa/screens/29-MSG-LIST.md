# 29 - Messages (liste) (`messages`)

## Contexte ecran

- **Route** : `MessagesList` dans la stack `MessageStackParamList`. Composant : `src/features/messages/screens/MessagesScreen/MessagesScreen.tsx`.
- **Roles requis** : `standard` et `admin` (compte authentifie). Le `guest` n'atteint pas cet onglet (la stack Messages est derriere l'auth ; `useChatSocket`/`useGroupSocket` ne s'abonnent que si `status === 'authenticated'`). Aucune action specifique admin sur cet ecran.
- **Comportements temps-reel** :
  - `useChatSocket()` ecoute `chat:message` et `chat:read` sur le socket singleton. A chaque message entrant/sortant, il invalide `messageKeys.conversations()` + `messageKeys.unread()` (+ le thread `messages(peerId)`), donc la **liste 1:1 se reordonne et le badge non-lu se met a jour sans pull-to-refresh**.
  - `useGroupSocket()` ecoute `group:message` et invalide `groupKeys.list()` (+ thread du groupe), donc la **section Groupes du header se met a jour live**.
  - Les abonnements se nettoient (`socket.off`) au demontage ; flag `cancelled` pour eviter une fuite d'ecouteurs si `logout` survient pendant l'`await getSocket()`.
- **Pre-conditions globales** : utilisateur connecte (token valide) ; backend joignable sur l'IP LAN du `.env` racine ; socket realtime connecte pour les MAJ live. `myId = useAuthStore(s => s.user?.id ?? null)` sert a calculer le titre des groupes sans titre.
- **Etats de donnees pertinents** :
  - **Chargement** : `isLoading` -> `Loader` plein ecran (`accessibilityLabel` = `common.loading` = "Chargement…").
  - **Erreur** : `isError` -> `EmptyState` titre `messages.couldNotLoad` ("Impossible de charger les messages") + description `messages.pullToRetry` ("Tire vers le bas pour reessayer.").
  - **Liste vide** : aucune conversation ET aucun groupe -> `EmptyState` titre `messages.empty` ("Pas encore de conversations") + `messages.startHint`. Si des groupes existent mais aucune conversation 1:1, **pas** d'empty-state (le `ListEmptyComponent` ne s'affiche que si `groups.length === 0`).
  - **Non lus** : `convo.unreadCount > 0` -> pastille primaire avec le compteur + apercu en gras ; idem pour `group.unreadCount`.
  - **Hors-ligne** : `useConversations`/`useGroups` (React Query) servent le cache si dispo ; le pull-to-refresh relance `refetch` (echec -> reste sur le cache ou bascule en `isError` si aucun cache). Les MAJ socket ne remontent pas tant que le socket n'est pas reconnecte.
  - **Note bande "Online"** : `OnlineUsersList` est monte dans le header SANS prop `users`, donc il **retourne `null` actuellement** (aucune source de presence cablee, cf. TODO audit). L'item utilisateur en ligne (`Open chat with {name}`) n'est rendu QUE si `users` est fourni — documente ici comme element conditionnel (P2, non actif en l'etat).

## Matrice bouton

| #   | Bouton                          | Emplacement                                   | Type                        | Locator reel                                                                       | Pre-condition                                                   | Priorite |
| --- | ------------------------------- | --------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| 1   | Compose / nouvelle conversation | Header (icone `edit`)                         | navigation                  | `accessibilityLabel` = `t('messages.newChatA11y')` = "Nouvelle conversation"       | Authentifie                                                     | P1       |
| 2   | Ligne conversation 1:1          | Corps (cellule de liste pressable)            | list-item / realtime-action | `accessibilityLabel` = `` `Open chat with ${other.displayName}` ``                 | >=1 conversation chargee                                        | P0       |
| 3   | Ligne groupe                    | Header (section "Groupes", cellule pressable) | list-item / realtime-action | `accessibilityLabel` = `` `Open group ${title}` ``                                 | >=1 groupe charge                                               | P1       |
| 4   | Pull-to-refresh                 | Corps (FlatList `onRefresh`)                  | realtime-action             | `refreshing={isFetching}` / `onRefresh={refetch}` (pas de label — geste de tirage) | Liste rendue (pas en `isLoading`/`isError`)                     | P1       |
| 5   | Item utilisateur en ligne       | Header (bande "Online", horizontale)          | navigation                  | `accessibilityLabel` = `` `Open chat with ${user.name}` ``                         | Prop `users` fournie a `OnlineUsersList` (non cablee en l'etat) | P2       |

> Aucun toggle/switch, checkbox, FAB, lien legal, swipe ni long-press sur cet ecran. Pas de bouton "retour" (ecran racine d'onglet). Le bouton compose (1) et les cellules (2, 3) sont les seuls actionnables systematiquement rendus ; le pull-to-refresh (4) est un geste ; l'item online (5) est conditionnel.

## Cas de test

### MSG-LIST-001 - Ouvrir le composer de nouvelle conversation

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, authentifie, aucune permission speciale.
- **Etapes** :
  1. Ouvrir l'onglet Messages.
  2. Reperer l'icone crayon en haut a droite (label "Nouvelle conversation").
  3. Taper dessus une fois.
- **Resultat attendu** : navigation vers l'ecran `NewMessage` (`navigation.navigate('NewMessage')`). L'ecran de selection de personnes s'affiche.
- **Critere d'acceptation (OK/KO)** : OK si l'ecran `NewMessage` est pousse ; KO si rien ne se passe ou si une autre route est ouverte.
- **Donnees de test** : compte test `standard@chathouse.test`.
- **Duree estimee** : 2 min

### MSG-LIST-002 - Multi-clic rapide sur le bouton compose (anti double-navigation)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, reseau avec latence simulee (~1 s), authentifie.
- **Etapes** :
  1. Ouvrir l'onglet Messages.
  2. Taper 5 fois tres rapidement (<300 ms) sur l'icone "Nouvelle conversation".
  3. Couper le Wi-Fi juste apres le 1er tap puis observer.
- **Resultat attendu** : un seul ecran `NewMessage` empile (pas 5 instances superposees). Le bouton reste reactif apres retour. Aucun crash.
- **Critere d'acceptation (OK/KO)** : OK si la pile contient une seule occurrence de `NewMessage` ; KO si plusieurs ecrans empiles ou freeze.
- **Donnees de test** : N/A.
- **Duree estimee** : 3 min

### MSG-LIST-003 - Accessibilite du bouton compose (TalkBack/VoiceOver + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack (Android) ou VoiceOver (iOS) actif, taille de police systeme au max, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'a l'icone crayon du header.
  3. Ecouter l'annonce, puis double-taper pour activer.
- **Resultat attendu** : le lecteur annonce "Nouvelle conversation, bouton". Le double-tap ouvre `NewMessage`. La cible reste tapable (>=44x44 pt, `hitSlop=8`) meme avec police agrandie ; le titre "Messages" ne chevauche pas l'icone.
- **Critere d'acceptation (OK/KO)** : OK si le label est lu et l'action declenchee ; KO si l'icone est annoncee "bouton" sans nom ou non focalisable.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### MSG-LIST-004 - Ouvrir une conversation 1:1

- **Type** : Fonctionnel positif
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins une conversation existante (ex. avec "Alex Rivers").
- **Etapes** :
  1. Ouvrir l'onglet Messages.
  2. Reperer la cellule "Alex Rivers" (label "Open chat with Alex Rivers").
  3. Taper dessus.
- **Resultat attendu** : navigation vers `ChatDetail` avec `{ conversationId: 'c1' }` (id de la conversation tapee). L'apercu du dernier message s'affiche dans l'ecran de detail.
- **Critere d'acceptation (OK/KO)** : OK si `ChatDetail` ouvre la bonne conversation (id correspondant) ; KO si mauvais thread ou aucune navigation.
- **Donnees de test** : conversation `c1`, pair `Alex Rivers` (`u1`).
- **Duree estimee** : 2 min

### MSG-LIST-005 - Ligne 1:1 : multi-clic + perte reseau pendant l'ouverture

- **Type** : Erreur/Limite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, reseau bascule en hors-ligne juste apres le tap, une conversation avec dernier message vocal (apercu "🎤 Message vocal").
- **Etapes** :
  1. Ouvrir Messages avec une conversation dont `lastMessage.kind === 'voice'`.
  2. Verifier que l'apercu affiche "🎤 Message vocal" (`t('voice.preview')`).
  3. Taper 3 fois rapidement sur la cellule puis couper le reseau.
- **Resultat attendu** : une seule navigation vers `ChatDetail` (pas d'empilement). L'apercu vocal est bien affiche au lieu d'une ligne vide. Hors-ligne, `ChatDetail` montre le cache ou un etat de chargement, pas de crash.
- **Critere d'acceptation (OK/KO)** : OK si une seule instance `ChatDetail` et apercu vocal correct ; KO si apercu vide, double-empilement ou crash.
- **Donnees de test** : conversation avec `lastMessage: { kind: 'voice' }`.
- **Duree estimee** : 4 min

### MSG-LIST-006 - Accessibilite d'une ligne 1:1 (lecteur d'ecran + non-lus + police agrandie)

- **Type** : Accessibilite
- **Priorite** : P0
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, conversation avec `unreadCount = 3`, police systeme agrandie, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'a la cellule "Alex Rivers" (`unreadCount > 0`).
  3. Ecouter l'annonce ; observer la pastille de compteur.
- **Resultat attendu** : annonce "Open chat with Alex Rivers, bouton". La pastille "3" et l'apercu en gras restent lisibles a police max (texte `numberOfLines={1}` non tronque jusqu'a illisibilite, pastille `min-w 20px`). Double-tap ouvre `ChatDetail`.
- **Critere d'acceptation (OK/KO)** : OK si label lu et compteur visible/contraste ; KO si compteur masque, label muet ou cellule non focalisable.
- **Donnees de test** : conversation `c1`, `unreadCount: 3`.
- **Duree estimee** : 4 min

### MSG-LIST-007 - Ligne 1:1 : synchro temps-reel multi-utilisateur (reordonnancement live)

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P0
- **Pre-conditions** : deux comptes (`A` = testeur sur l'ecran Messages, `B` = pair sur un autre device), socket connecte des deux cotes, Wi-Fi.
- **Etapes** :
  1. `A` ouvre l'onglet Messages ; noter la position de la conversation avec `B` et son `unreadCount`.
  2. Depuis `B`, envoyer un message texte a `A` (emet `chat:message`).
  3. Sans pull-to-refresh, observer la liste de `A`.
  4. `A` ouvre la conversation puis revient (declenche `chat:read`) ; verifier la MAJ.
- **Resultat attendu** : a l'evenement `chat:message`, la liste de `A` se reordonne (conversation remonte), l'apercu = dernier message, le badge non-lu s'incremente — le tout sans geste manuel (invalidation `messageKeys.conversations()` + `unread()`). Apres lecture, le badge retombe.
- **Critere d'acceptation (OK/KO)** : OK si la liste/badge se mettent a jour <2 s apres l'event sans refresh manuel ; KO si la MAJ exige un pull-to-refresh ou n'arrive pas.
- **Donnees de test** : compte A `standard-a@chathouse.test`, compte B `standard-b@chathouse.test`, payload `{ senderId: 'B', receiverId: 'A', text: 'Hello' }`.
- **Duree estimee** : 6 min

### MSG-LIST-008 - Ouvrir un groupe

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, au moins un groupe (ex. "Launch crew") -> section "Groupes" visible.
- **Etapes** :
  1. Ouvrir l'onglet Messages.
  2. Verifier l'en-tete de section `messages.groups` ("Groupes").
  3. Taper la cellule "Launch crew" (label "Open group Launch crew").
- **Resultat attendu** : navigation vers `GroupChat` avec `{ conversationId: 'g1' }`. Pour un groupe sans titre, le titre affiche les `displayName`/`username` des membres (hors `myId`) joints par ", ".
- **Critere d'acceptation (OK/KO)** : OK si `GroupChat` ouvre le bon groupe (id correspondant) ; KO si mauvais groupe ou aucune navigation.
- **Donnees de test** : groupe `g1` "Launch crew", `myId = user-me`.
- **Duree estimee** : 2 min

### MSG-LIST-009 - Ligne groupe : titre derive + multi-clic + latence

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, groupe SANS `title` (titre derive des membres), reseau latence ~1 s.
- **Etapes** :
  1. Ouvrir Messages avec un groupe `{ title: null, members: [moi, 'Sarah Chen'] }`.
  2. Verifier que la cellule affiche "Sarah Chen" (membres hors `myId`, sinon fallback "Group").
  3. Taper 4 fois rapidement sur la cellule.
- **Resultat attendu** : titre derive correct ("Sarah Chen"). Une seule navigation `GroupChat`. Aucun crash si la liste des membres ne contient que `myId` (fallback "Group").
- **Critere d'acceptation (OK/KO)** : OK si titre derive juste et une seule navigation ; KO si titre vide, "Group" alors que des membres existent, ou double-empilement.
- **Donnees de test** : groupe `{ id: 'g1', title: null, members: [{id:'user-me'},{id:'u2',displayName:'Sarah Chen'}] }`.
- **Duree estimee** : 3 min

### MSG-LIST-010 - Accessibilite d'une ligne groupe (lecteur d'ecran + icone groupe)

- **Type** : Accessibilite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, un groupe avec `unreadCount > 0`, police agrandie, contraste eleve.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Balayer jusqu'a la cellule "Launch crew" (label "Open group Launch crew").
  3. Ecouter l'annonce ; verifier la pastille non-lu et l'icone `groups`.
- **Resultat attendu** : annonce "Open group Launch crew, bouton". L'icone `groups` (decorative) n'est pas annoncee separement. Pastille de compteur lisible et contrastee a police max. Double-tap ouvre `GroupChat`.
- **Critere d'acceptation (OK/KO)** : OK si label lu et action declenchee ; KO si icone annoncee parasitement ou cellule non focalisable.
- **Donnees de test** : groupe `g1`, `unreadCount: 2`.
- **Duree estimee** : 4 min

### MSG-LIST-011 - Groupe : synchro temps-reel multi-utilisateur

- **Type** : Temps-reel multi-utilisateur
- **Priorite** : P1
- **Pre-conditions** : deux comptes membres du meme groupe (`A` sur Messages, `B` sur un autre device), socket connecte, Wi-Fi.
- **Etapes** :
  1. `A` ouvre l'onglet Messages ; noter l'apercu et le badge du groupe partage.
  2. `B` envoie un message dans le groupe (emet `group:message` avec `conversationId`).
  3. Sans refresh, observer la section "Groupes" de `A`.
- **Resultat attendu** : `useGroupSocket` invalide `groupKeys.list()` -> l'apercu et le badge non-lu du groupe se mettent a jour live cote `A` sans pull-to-refresh.
- **Critere d'acceptation (OK/KO)** : OK si la cellule groupe se met a jour <2 s apres l'event sans geste ; KO si refresh manuel requis.
- **Donnees de test** : groupe `g1`, payload `{ conversationId: 'g1', content: 'ping' }`.
- **Duree estimee** : 5 min

### MSG-LIST-012 - Pull-to-refresh recharge la liste

- **Type** : Fonctionnel positif
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, Wi-Fi, liste rendue (au moins 1 conversation), pas en `isLoading`/`isError`.
- **Etapes** :
  1. Ouvrir Messages.
  2. Tirer la liste vers le bas jusqu'au declenchement du spinner.
  3. Relacher et attendre.
- **Resultat attendu** : `refetch()` est appele, `refreshing` suit `isFetching` (spinner visible pendant le fetch puis disparait). La liste se met a jour avec les donnees fraiches du backend.
- **Critere d'acceptation (OK/KO)** : OK si le spinner apparait puis disparait et la liste reflete le backend ; KO si pas de refetch ou spinner bloque.
- **Donnees de test** : N/A.
- **Duree estimee** : 2 min

### MSG-LIST-013 - Pull-to-refresh hors-ligne + reconnexion + multi-tirage

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, mode Avion active (hors-ligne), liste deja en cache.
- **Etapes** :
  1. Ouvrir Messages (liste servie depuis le cache).
  2. Passer en mode Avion.
  3. Tirer pour rafraichir 3 fois de suite rapidement.
  4. Reactiver le reseau puis tirer une derniere fois.
- **Resultat attendu** : hors-ligne, le refetch echoue silencieusement, la liste cache reste affichee (pas d'empty-state d'erreur si du cache existe), pas de spinner bloque indefiniment ni de crash. Au retour reseau, le dernier tirage recharge les donnees fraiches.
- **Critere d'acceptation (OK/KO)** : OK si cache conserve hors-ligne et MAJ correcte au retour reseau ; KO si liste videe a tort, spinner infini ou crash.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### MSG-LIST-014 - Accessibilite du pull-to-refresh (lecteur d'ecran)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, TalkBack/VoiceOver actif, liste rendue.
- **Etapes** :
  1. Activer le lecteur d'ecran.
  2. Sur la liste, utiliser le geste d'actualisation accessible (TalkBack : geste a 3 doigts vers le haut / action contextuelle ; VoiceOver : focus liste puis geste de defilement).
  3. Observer l'annonce d'etat.
- **Resultat attendu** : l'actualisation se declenche et le changement d'etat (chargement -> liste mise a jour) est perceptible au lecteur d'ecran ; le contenu mis a jour est annonce/refocalisable. Aucune zone tactile orpheline.
- **Critere d'acceptation (OK/KO)** : OK si l'actualisation est declenchable au lecteur d'ecran et l'etat communique ; KO si geste inaccessible.
- **Donnees de test** : N/A.
- **Duree estimee** : 4 min

### MSG-LIST-015 - Item utilisateur en ligne (bande "Online") — etat actuel non cable

- **Type** : Fonctionnel positif
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, Wi-Fi. ATTENTION : en l'etat, `MessagesScreen` monte `OnlineUsersList` SANS prop `users`, donc la bande retourne `null` et aucun item n'est rendu.
- **Etapes** :
  1. Ouvrir Messages avec la build courante.
  2. Chercher une bande horizontale "Online" en haut de liste.
  3. (Pre-requis dev pour activer le cas : alimenter `OnlineUsersList` avec `users=[{ id, name, avatar }]` portant de vrais ids backend.)
  4. Si la bande est rendue, taper un item (label "Open chat with {name}").
- **Resultat attendu** : etat courant -> aucune bande affichee (comportement attendu, evite de naviguer vers une conversation inexistante). Une fois `users` cable -> tap navigue vers `ChatDetail` avec `conversationId = resolveConversationId(user.id)` ou `user.id` par defaut.
- **Critere d'acceptation (OK/KO)** : OK si la bande est absente sans prop `users` (pas de mock fantome) et, si cablee, ouvre `ChatDetail` avec le bon id ; KO si une bande mock apparait ou navigue vers un id `conv-{id}` fabrique.
- **Donnees de test** : `users = [{ id: 'u9', name: 'Jordan', avatar: 'https://…' }]`.
- **Duree estimee** : 3 min

### MSG-LIST-016 - Item utilisateur en ligne : multi-clic + image avatar en echec

- **Type** : Erreur/Limite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, `OnlineUsersList` cable avec un `users` dont une `avatar` URL est cassee, reseau latence.
- **Etapes** :
  1. Activer la bande "Online" (prop `users` fournie, voir MSG-LIST-015).
  2. Observer un avatar dont l'URL echoue.
  3. Taper 4 fois rapidement sur l'item.
- **Resultat attendu** : l'avatar bascule sur l'image par defaut (`DEFAULTS.avatar` via `onError` de `PulsingAvatar`), le halo vert pulse sans bloquer le tap. Une seule navigation `ChatDetail`. Nom tronque a 8 caracteres avec ellipse si trop long.
- **Critere d'acceptation (OK/KO)** : OK si fallback avatar applique et une seule navigation ; KO si image cassee persistante, crash ou double-empilement.
- **Donnees de test** : `users = [{ id: 'u9', name: 'Jonathan-le-long', avatar: 'https://invalid.example/x.png' }]`.
- **Duree estimee** : 4 min

### MSG-LIST-017 - Accessibilite item utilisateur en ligne (lecteur d'ecran + halo anime)

- **Type** : Accessibilite
- **Priorite** : P2
- **Pre-conditions** : compte `standard`, `OnlineUsersList` cable, TalkBack/VoiceOver actif, reduction des animations activee dans le systeme, police agrandie.
- **Etapes** :
  1. Activer la bande "Online".
  2. Balayer jusqu'a un item utilisateur.
  3. Ecouter l'annonce ; double-taper.
- **Resultat attendu** : annonce "Open chat with {name}, bouton". L'avatar pulsant (decoratif, `pointerEvents="none"` sur le ring) n'interfere pas avec le focus ; le pictogramme de presence n'est pas annonce parasitement. Double-tap ouvre `ChatDetail`.
- **Critere d'acceptation (OK/KO)** : OK si label lu et action declenchee ; KO si halo capte le focus ou nom non annonce.
- **Donnees de test** : `users = [{ id: 'u9', name: 'Jordan', avatar: 'https://…' }]`.
- **Duree estimee** : 4 min

### MSG-LIST-018 - Etats vides / erreur / chargement (couverture transverse de l'ecran)

- **Type** : Erreur/Limite
- **Priorite** : P1
- **Pre-conditions** : compte `standard`, capacite a forcer les etats (compte neuf sans conversation ; backend indisponible ; reseau lent).
- **Etapes** :
  1. Connexion avec un compte neuf (0 conversation, 0 groupe) -> verifier l'empty-state.
  2. Couper le backend puis recharger -> verifier l'etat d'erreur.
  3. Ajouter UNIQUEMENT un groupe (0 conversation 1:1) -> verifier qu'aucun empty-state ne s'affiche.
  4. Reseau lent au premier chargement -> verifier le loader.
- **Resultat attendu** :
  - Etape 1 : `EmptyState` "Pas encore de conversations" + "Touche l'icone de redaction pour demarrer une conversation." (`messages.empty` / `startHint`).
  - Etape 2 : `EmptyState` "Impossible de charger les messages" + "Tire vers le bas pour reessayer." (`messages.couldNotLoad` / `pullToRetry`).
  - Etape 3 : pas d'empty-state (section "Groupes" rendue, `ListEmptyComponent` non affiche car `groups.length !== 0`).
  - Etape 4 : `Loader` plein ecran avec label "Chargement…".
- **Critere d'acceptation (OK/KO)** : OK si chaque etat affiche le bon texte i18n et le bon composant ; KO si empty-state errone (ex. affiche alors que des groupes existent) ou textes manquants.
- **Donnees de test** : compte neuf `fresh@chathouse.test` ; backend coupe ; throttling reseau "Slow 3G".
- **Duree estimee** : 6 min

```

```
