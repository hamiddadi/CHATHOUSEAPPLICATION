# modules/users

Backend module for **users**.

```
backend/src/modules/users/
├── users.router.ts       Express router (mounted in app.ts)
├── users.controller.ts   HTTP handlers
├── users.service.ts      Business logic + Prisma access
├── users.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/users` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
