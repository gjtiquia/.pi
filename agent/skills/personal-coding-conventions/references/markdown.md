# Markdown

Write for the plain-text editor first.
Use [this skill’s source](../SKILL.md) as the primary example of list structure and prose line breaks.

## Structure and emphasis

- Make the list easy to skim by reading just the parent bullets.
  - Where a brief title helps readers find a topic, use a plain phrase like “Framework defaults” and nest the guidance beneath it.
  - If the rule already makes a good title, use it directly: “Move code before rewriting it.”
  - Use an indented list for examples, reasons, or exceptions that belong under one main point.
  - Leave a blank line between groups so readers can scan the parent bullets.
  - Use a heading when a topic needs several groups of its own.

- Keep short lists of peers flat.
  - A list of reference links needs neither labels nor nested bullets.

- Prefer lists over tables so readers can scan without a preview.

- Use plain text by default. Let spacing and nesting show the hierarchy.
  - When a distinction needs emphasis, capitalize the key word or short phrase first.
  - Consider bold only if capitals would make the passage harder to read.

- Prefer a plain hyphen (`-`) over an em dash in prose.

## Source lines

- Keep a sentence together by default.
  - Two short sentences may share a line when they express one thought, such as a rule followed by a brief example.
  - Start a new line when the thought changes, even if there is room left.

- Treat 132 characters as a GUIDELINE, not a limit or a width to fill.
  - If you split a sentence, break after punctuation at a natural pause.
  - If there is no such pause, keep the longer line. Uneven line lengths are fine.

## Editing existing prose

- A formatting pass is not a rewrite.
  - Change spacing, line breaks, and nesting. Keep the author's wording, titles, examples, and order unless asked to change them.
  - When removing emphasis, remove the markup, not the words. `**Simplicity > Complexity**` becomes `Simplicity > Complexity`.

- When asked to restructure, reuse the author's language first.
  - Promote an existing title or phrase before inventing one.
  - If a wording change would improve the text but falls outside the request, suggest it separately.

- Check fidelity against the version before the pass.
  - For formatting alone, compare the prose after accounting for the intended whitespace and markup changes.
  - For an editorial pass, review additions and deletions side by side for lost details, changed scope, or shifts in tone.
  - Before replacing a guideline, identify each decision the original helps the reader make.
    After the edit, point to the wording that still supports each decision.
  - When new guidance adds a criterion, keep the existing criteria. If you intend to retire one, say which one and why.

## After editing Markdown

- Run [the width check](../scripts/check-markdown-width.py) with Python 3 on the Markdown files you touched.
  - Pass each file path as a separate argument.
  - It reports lines over 132 as `path:line: length` for review, not as errors.

- Read the changed prose in source form even if nothing was flagged.
  - Keep natural breaks and rejoin lines split just to fit a width.
