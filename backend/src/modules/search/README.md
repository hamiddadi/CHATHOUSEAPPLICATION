# modules/search

Backend module for **search**.

```
backend/src/modules/search/
├── search.router.ts       Express router (mounted in app.ts)
├── search.controller.ts   HTTP handlers
├── search.service.ts      Business logic + Prisma access
├── search.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/search` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
