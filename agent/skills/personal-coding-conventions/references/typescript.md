# TypeScript

When a directory owns a multi-step operation, expose the operation from `index.ts`. Let that entry point show the order of its steps; callers should not need to import its helpers and reconstruct the sequence. A single-purpose file does not need a directory or a barrel of re-exports.
