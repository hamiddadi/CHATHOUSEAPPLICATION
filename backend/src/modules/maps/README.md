# modules/maps

Backend module for **maps**.

```
backend/src/modules/maps/
├── maps.router.ts       Express router (mounted in app.ts)
├── maps.controller.ts   HTTP handlers
├── maps.service.ts      Business logic + Prisma access
├── maps.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/maps` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
