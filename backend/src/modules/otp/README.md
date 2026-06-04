# modules/otp

Backend module for **otp**.

```
backend/src/modules/otp/
├── otp.router.ts       Express router (mounted in app.ts)
├── otp.controller.ts   HTTP handlers
├── otp.service.ts      Business logic + Prisma access
├── otp.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/otp` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
