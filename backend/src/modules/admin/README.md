# modules/admin

Backend module for **admin**.

```
backend/src/modules/admin/
├── admin.router.ts       Express router (mounted in app.ts)
├── admin.controller.ts   HTTP handlers
├── admin.service.ts      Business logic + Prisma access
├── admin.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/admin` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
