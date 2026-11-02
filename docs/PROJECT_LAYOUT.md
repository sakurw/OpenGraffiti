# Project layout and generated assets

The current application is `src/PVApp.tsx` with `src/pv-*`, served by `server/index.mjs`. Source, tests, generation scripts, adopted runtime assets and project skills belong in Git.

| Location | Purpose |
| --- | --- |
| `src/`, `server/`, `shared/` | Application and shared contracts |
| `scripts/build-pv-*`, `scripts/audit-pv-*` | Current model/ground pipeline and audits |
| `scripts/launchers/` | User launchers, including flat/constrained and fade sample |
| `tests/pv/` | Painting, navigation, terrain and demo regressions |
| `public/assets/pv-adopted-20261029/` | Published adopted model and both ground modes |
| `開発関連/skills/` | Canonical building and road/ground skills |
| `開発関連/設計/` | Adopted method and design authority |
| `開発関連/モック実装/` | Implementation decisions and verification reports |
| `data/`, `.tools/` | Local downloads, source processing, runtimes and reports; ignored |
| `_local-backups/` | Recoverable superseded experiments; ignored |
| `dist/`, `test-results/` | Rebuildable application and test evidence; ignored |

Historical reconstruction scripts retain their names and relative input paths for provenance/recovery. They are not the adopted pipeline. Untracked downloaded full-city tiles, archives, old candidate models and preview outputs are excluded from Git. Only the native tiles required by the adopted manifest and the own-only texture atlases are explicitly included as source evidence. Expanded scopes must explicitly add their new required inputs or record a reproducible download manifest.

2026-11-02 organization moved 135 untracked temporary/candidate files (9,215,629,227 bytes) into `_local-backups/project-organization-20261102-220404/`. Every moved file was SHA-256 checked; `manifest.json` lists original paths. Copy `files/<original path>` back to recover one file. Tracked files and inputs protected by the adopted provenance manifest were excluded. Earlier removal of obsolete texture experiments is recoverable through `_local-backups/tocho-adoption-20261029/` and Git history.

Do not use blanket `git add .` for new datasets. Check staged files for personal data, credentials, generated caches and files over GitHub's size limits. The source license and existing third-party notices remain applicable.

A second recovery archive, `_local-backups/project-organization-20261102-220622/`, holds 85 temporary scripts (261,824 bytes) with the same hash-checked original-path manifest.

The expanded native district is in `public/assets/pv-expanded-20261102/`; its selection and download/hash provenance are in `public/assets/pv-expanded-source-20261102/`. Runtime artwork operation recipes are in `public/artworks/`.
