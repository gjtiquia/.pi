# TypeScript

- Feature layout
  - For an app with several distinct features, start with `src/features/<feature>/`.
  - A search route can stay in the framework's routes directory while ranking logic lives in `src/features/search/`.
  - Prefer the existing layout if it already makes feature ownership clear.

- Entry points
  - When a directory owns a multi-step operation, expose the operation from `index.ts`.
  - Show the order of steps there so callers need not import helpers and reconstruct the sequence.
  - A single-purpose file does not need a directory or a barrel of re-exports.

- Value defaults
  - Use `??` for defaults such as `options.timeout ?? 5000`.
  - Prefer `if` when the right-hand side performs another workflow step, such as checking access or calling `next()`.
