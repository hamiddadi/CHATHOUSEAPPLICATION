# modules/explore

Backend module for **explore**.

```
backend/src/modules/explore/
├── explore.router.ts       Express router (mounted in app.ts)
├── explore.controller.ts   HTTP handlers
├── explore.service.ts      Business logic + Prisma access
├── explore.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/explore` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
