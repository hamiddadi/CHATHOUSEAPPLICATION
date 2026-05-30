# Extensions

Ce dossier accueille tout nouveau code additif (Clubhouse parity v3.0) sans
toucher au code existant. Règle d'or : **lecture seule sur tout ce qui est hors
de `backend/src/extensions/` et `backend/prisma/migrations/2026*ext*`**.

## Architecture

```
extensions/
├── server.ts          # Nouveau point d'entrée — réutilise createApp()
├── mount.ts           # Branche toutes les nouvelles routes sur l'Express app
├── README.md
└── modules/
    ├── suggestions/   # 1.5 — Suggested follows
    ├── contacts/      # 1.6 — Contacts sync
    ├── presence/      # 3.7 — People available to chat
    ├── topics/        # 11/13.5 — 150+ topics taxonomy
    └── …              # Vagues suivantes
```

## Lancement

```bash
# Mode legacy (inchangé)
pnpm dev

# Mode étendu (recommandé pour la parité Clubhouse)
pnpm dev:ext
```

`pnpm dev:ext` lance `src/extensions/server.ts` qui :

1. Importe `createApp()` du code existant (zéro modification)
2. Monte toutes les extensions par-dessus via `mountExtensions(app)`
3. Démarre le serveur HTTP + Socket.IO comme l'original

## Règles d'extension

- ✅ Créer de nouveaux fichiers
- ✅ Ajouter de nouvelles tables Prisma (migration additive)
- ✅ Réutiliser `prisma`, `requireAuth`, services existants en lecture seule
- ❌ Modifier un fichier existant
- ❌ Renommer ou déplacer un export
- ❌ Modifier un schema/champ existant

## Conventions

- Tous les nouveaux routes sont préfixés `/api/ext/<feature>`
- Toutes les nouvelles tables Prisma sont préfixées `Ext`
- Tous les sockets events sont préfixés `ext:<feature>:<event>`
