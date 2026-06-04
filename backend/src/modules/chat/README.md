# modules/chat

Backend module for **chat**.

```
backend/src/modules/chat/
├── chat.router.ts       Express router (mounted in app.ts)
├── chat.controller.ts   HTTP handlers
├── chat.service.ts      Business logic + Prisma access
├── chat.schema.ts       Zod input validation
└── (optional types)
```

Mounted at `/api/chat` from [app.ts](../../app.ts).

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
