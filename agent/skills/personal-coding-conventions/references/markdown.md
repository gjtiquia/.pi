# Markdown

Write for the plain-text editor first.
Use [this skill’s source](../SKILL.md) as the primary example of where to break prose lines.

- **Punctuation:** Prefer a plain hyphen (`-`) over an em dash in prose.
- **Lists:** Prefer short labeled lists over tables so readers can scan without a preview.
- **Source lines:** Keep a sentence together by default.
  Two short sentences may share a line when they express one thought, such as a rule followed by a brief example.
  Start a new line when the thought changes, even if there is room left.
  Treat 132 characters as a cue to look for a break, not a limit or a width to fill.
  If you split a sentence, break after punctuation at a natural pause.
  If there is no such pause, keep the longer line. Uneven line lengths are fine.

## After editing Markdown

Run [the width check](../scripts/check-markdown-width.py) with Python 3 on the Markdown files you touched.
Pass each file path as a separate argument.
It reports lines over 132 as `path:line: length` for review, not as errors.
Read the changed prose in source form even if nothing was flagged.
Keep natural breaks and rejoin lines split just to fit a width.
