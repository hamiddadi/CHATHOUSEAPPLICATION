# modules/follow

Backend module for **follow**.

```
backend/src/modules/follow/
├── follow.router.ts       Express router (mounted in app.ts)
├── follow.controller.ts   HTTP handlers
├── follow.service.ts      Business logic + Prisma access
├── follow.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/follow` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
