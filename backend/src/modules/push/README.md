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

Development/test can keep `PUSH_DISPATCH_ENABLED=false`, which retains the
non-delivering local stub. Production is fail-closed:

- `PUSH_DISPATCH_ENABLED` must be `true`;
- configure exactly one of a complete `FIREBASE_SERVICE_ACCOUNT` JSON value or
  `FIREBASE_USE_ADC=true`;
- Firebase Admin initializes and obtains a real OAuth access token before the
  HTTP server accepts traffic (10-second fail-closed timeout);
- initialization and transport failures reject explicitly (the notification
  caller may keep its already-persisted in-app row, while logging the failed
  external delivery).

ADC must be supplied by the deployment runtime through workload identity,
instance metadata, or a mounted `GOOGLE_APPLICATION_CREDENTIALS` file. The boot
probe proves that the configured credential can mint a token without logging
the token or provider error details. It cannot prove APNs/FCM routing: validate
both Android and iOS on physical devices before release.

See [backend/src/modules/README.md](../README.md) for the global module catalogue
and [docs/api.md](../../../../docs/api.md) for the full endpoint surface.
