# modules/social

Backend module for **social**.

```
backend/src/modules/social/
├── social.router.ts       Express router (mounted in app.ts)
├── social.controller.ts   HTTP handlers
├── social.service.ts      Business logic + Prisma access
├── social.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/social` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
