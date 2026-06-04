# modules/clubs

Backend module for **clubs**.

```
backend/src/modules/clubs/
├── clubs.router.ts       Express router (mounted in app.ts)
├── clubs.controller.ts   HTTP handlers
├── clubs.service.ts      Business logic + Prisma access
├── clubs.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/clubs` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
