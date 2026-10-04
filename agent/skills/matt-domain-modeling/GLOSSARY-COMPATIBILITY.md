# Glossary discovery during migration

Use this policy wherever a skill reads or updates project domain language. It is a temporary compatibility bridge for repositories not yet migrated by `/skill:matt-setup-skills`.

## Resolve the existing source

1. Follow the project's domain-doc pointer, if configured. Inspect the relevant root or context directory for `GLOSSARY.md` / `GLOSSARY-MAP.md` and their legacy counterparts, `CONTEXT.md` / `CONTEXT-MAP.md`.
2. Prefer `GLOSSARY-MAP.md` for an indexed repository; when it is absent, follow an existing `CONTEXT-MAP.md`. Read the map and select the contexts relevant to the work. A map may be partly migrated: resolve each referenced glossary independently, preferring its `GLOSSARY.md` counterpart and falling back to its existing `CONTEXT.md` only when the new file is absent. Preserve context boundaries; ask if the relevant context or competing root/index layouts are ambiguous.
3. For a single context, read `GLOSSARY.md`. Fall back to `CONTEXT.md` only when `GLOSSARY.md` is absent.
4. When a new and legacy counterpart both exist, report the collision. Read the new file for vocabulary, but pause edits to the affected glossary/map until the user identifies the authoritative source. Never merge or overwrite either automatically.
5. On legacy fallback, mention once per session that `/skill:matt-setup-skills` can migrate the project. Continue the requested work using the resolved source; a legacy filename alone is not a blocker.

## Writes

Update the resolved existing glossary in place, including a legacy file when fallback selected it. Interpret a skill's instruction to update `GLOSSARY.md` as updating this resolved source, not creating a second glossary beside it.

When neither name exists in the relevant context and there is no unresolved layout/collision, create `GLOSSARY.md` lazily only when the invoking workflow resolves a term. Readers do not create files. Renaming files, rewriting map links, and changing project consumer instructions belong to the separately confirmed setup migration, not to fallback.
