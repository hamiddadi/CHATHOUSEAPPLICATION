# features/houses

Feature folder for **houses**. See file structure:

```
src/features/houses/
├── screens/        UI screens
├── components/     Feature-local composite components
├── hooks/          Feature-local hooks
├── services/       HTTP / socket access for this domain
├── store/          (optional) feature-local state
├── types/          (optional) TypeScript types
└── index.ts        Public exports
```

Imports follow the alias `@features/houses/...`.

Refer to [docs/architecture.md](../../../docs/architecture.md) for the global picture and
[docs/conventions.md](../../../docs/conventions.md) for naming/structure rules.
