# Tests de régression — Workflows (audit QA)

Ces suites encodent les scénarios de l'audit des **machines à états** de ChatHouse
(voir [docs/qa/RAPPORT-AUDIT-WORKFLOWS.md](../../../docs/qa/RAPPORT-AUDIT-WORKFLOWS.md)).
Elles sont **additives** : aucun test existant de `backend/tests/` n'est modifié.

## Statut : toutes les anomalies couvertes sont CORRIGÉES ✅

Ces suites ont été écrites avec la convention `it.failing(...)` (le test passe tant
que le bug existe, devient rouge quand il est corrigé). **Tous les correctifs ont
été livrés et vérifiés contre la stack docker (Postgres:5433 + Redis)**, donc tous
les `it.failing` ont été basculés en `it()` normal — ce sont désormais des
**tests de non-régression** verts (ROOM-01/PART-01, FOLL-01, FOLL-02, CLUB-01,
CLUB-03, AUTH-01, AUTH-05).

Les transitions correctes (chemin nominal, transitions invalides déjà bloquées,
RBAC déjà appliqué) sont écrites en `it()` normal — couverture positive.

## Prérequis (infra existante)

Comme toutes les suites d'intégration du dépôt, elles tapent la stack docker :

```bash
# 1. Postgres (host :5433) + Redis
docker compose -f backend/docker-compose.yml up -d
# 2. Schéma
cd backend && npx prisma db push
```

## Exécution (feature par feature, contrainte RAM)

```bash
cd backend
npx jest tests/workflows/follow.workflow --runInBand
npx jest tests/workflows/rooms-roles.workflow --runInBand
npx jest tests/workflows/club-membership.workflow --runInBand
npx jest tests/workflows/auth-session.workflow --runInBand
```

## Couverture

| Fichier                            | Anomalies (it.failing) | Couverture positive (it)                                     |
| ---------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `rooms-roles.workflow.test.ts`     | ROOM-01 / PART-01      | promotion SPEAKER, RBAC non-host (ROOM_003)                  |
| `follow.workflow.test.ts`          | FOLL-01, FOLL-02       | follow/unfollow, self-follow (USER_003)                      |
| `club-membership.workflow.test.ts` | CLUB-01, CLUB-03       | join OPEN, PRIVATE (CLUB_003), accept sans invite (CLUB_007) |
| `auth-session.workflow.test.ts`    | AUTH-01, AUTH-05       | rotation refresh + réutilisation bloquée (AUTH_004)          |

> Les bugs nécessitant LiveKit / Stripe / egress / concurrence réelle
> (RECO-02, PAYM-_, _-concurrence) sont documentés dans le rapport mais non
> automatisés ici (infra externe / non déterministe).
