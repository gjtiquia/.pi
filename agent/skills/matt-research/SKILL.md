---
name: matt-research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated.
license: MIT (see LICENSE)
metadata:
  upstream-repository: https://github.com/mattpocock/skills
  upstream-commit: c55ee46073ed923f86ce59a5eb3b6d895095d1b7
  upstream-path: skills/engineering/research
  adaptation: Pi-compatible matt-* naming
---

For a direct invocation, delegate the research to one Pi `subagent` and await its completed result. Tell it to follow the steps below in its own session and not to delegate again. When this skill is loaded by an already-delegated researcher (for example, from a Wayfinder research ticket), do the research in that session instead of creating a nested subagent. Run independent research assignments in parallel at the caller level and await all results before reporting them.

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source. If a parent explicitly asks for report content for batch persistence, return the complete Markdown body and a suggested path instead of writing files.
3. For file output, save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
