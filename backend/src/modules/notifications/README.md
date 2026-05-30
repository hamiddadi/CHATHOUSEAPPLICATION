# modules/notifications

Backend module for **notifications**.

```
backend/src/modules/notifications/
├── notifications.router.ts       Express router (mounted in app.ts)
├── notifications.controller.ts   HTTP handlers
├── notifications.service.ts      Business logic + Prisma access
├── notifications.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/notifications` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
