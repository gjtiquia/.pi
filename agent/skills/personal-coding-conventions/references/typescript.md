# TypeScript

For a TypeScript app with several distinct features, `src/features/<feature>/` is a good default. For example, a search route can stay in the framework’s routes directory while ranking logic lives in `src/features/search/`. Prefer an existing layout if it already makes feature ownership clear.

When a directory owns a multi-step operation, expose the operation from `index.ts`. Let that entry point show the order of its steps; callers should not need to import its helpers and reconstruct the sequence. A single-purpose file does not need a directory or a barrel of re-exports.
