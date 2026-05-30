# scripts/

Operational scripts for local dev and CI. Purely additive — none of these
shadow or replace existing npm scripts.

| Script    | Purpose                                                               |
| --------- | --------------------------------------------------------------------- |
| `dev.sh`  | One-shot bring-up: Docker (Postgres+Redis) + extended backend + Metro |
| `stop.sh` | Clean teardown of Metro, backend, Docker services                     |

## Usage

```bash
bash scripts/dev.sh    # start the whole stack
bash scripts/stop.sh   # stop it
```

On Windows, run them through Git Bash or WSL. Native PowerShell equivalents
can be added later — see `docs/RESTRUCTURE-PLAN.md` Phase 2.
