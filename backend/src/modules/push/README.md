# modules/push

Backend module for **push**.

```
backend/src/modules/push/
├── push.router.ts       Express router (mounted in app.ts)
├── push.controller.ts   HTTP handlers
├── push.service.ts      Business logic + Prisma access
├── push.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/push` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
