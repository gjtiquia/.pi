# Screenshots and image evidence

Treat screenshots as evidence attached to a particular body, comment, review, or diff. Preserve that provenance and distinguish visible facts from the author's interpretation.

Set `repo=OWNER/REPO`, `ref=<number-or-url>`, and use a temporary directory:

```bash
workdir="$(mktemp -d)"
```

Remove it after inspection. Before constructing any REST path, resolve the reference to a numeric item number.

## 1. Collect every text surface

For an issue, collect the body and all pages of conversation comments:

```bash
number="$(gh issue view "$ref" -R "$repo" --json number --jq '.number')"
gh issue view "$number" -R "$repo" --json \
  number,url,title,author,body,createdAt,updatedAt >"$workdir/item.json"
gh api --paginate --slurp \
  "repos/$repo/issues/$number/comments?per_page=100" >"$workdir/comment-pages.json"
```

For a pull request, collect the body plus all pages of conversation comments, review summaries, and inline review comments:

```bash
number="$(gh pr view "$ref" -R "$repo" --json number --jq '.number')"
gh pr view "$number" -R "$repo" --json \
  number,url,title,author,body,createdAt,updatedAt >"$workdir/item.json"
gh api --paginate --slurp \
  "repos/$repo/issues/$number/comments?per_page=100" >"$workdir/comment-pages.json"
gh api --paginate --slurp \
  "repos/$repo/pulls/$number/reviews?per_page=100" >"$workdir/review-pages.json"
gh api --paginate --slurp \
  "repos/$repo/pulls/$number/comments?per_page=100" >"$workdir/inline-review-comment-pages.json"
```

Do not assume `gh issue view --json comments` or `gh pr view --comments` collected more than the first 100 entries. `--paginate --slurp` preserves all REST pages in the audit files above.

## 2. Find image references with provenance

GitHub-hosted uploads normally use `https://github.com/user-attachments/assets/...`. List them without discarding their source. These commands use `gh`'s built-in jq-compatible query support; no standalone `jq` is required.

Issue or PR body (select the corresponding command):

```bash
gh issue view "$number" -R "$repo" --json author,body,createdAt --jq '
  . as $source
  | (($source.body // "") | scan("https://github\\.com/user-attachments/assets/[A-Za-z0-9-]+")) as $url
  | ["body", ($source.author.login // ""), ($source.createdAt // ""), $url] | @tsv
'
# For a PR, replace `gh issue view` with `gh pr view`.
```

All conversation comments for either kind:

```bash
gh api --paginate "repos/$repo/issues/$number/comments?per_page=100" --jq '
  .[]
  | . as $source
  | (($source.body // "") | scan("https://github\\.com/user-attachments/assets/[A-Za-z0-9-]+")) as $url
  | ["comment", ($source.user.login // ""), ($source.created_at // ""), $url] | @tsv
'
```

For a PR, also inspect every review summary and inline review comment:

```bash
gh api --paginate "repos/$repo/pulls/$number/reviews?per_page=100" --jq '
  .[]
  | . as $source
  | (($source.body // "") | scan("https://github\\.com/user-attachments/assets/[A-Za-z0-9-]+")) as $url
  | ["review", ($source.user.login // ""), ($source.submitted_at // ""), $url] | @tsv
'

gh api --paginate "repos/$repo/pulls/$number/comments?per_page=100" --jq '
  .[]
  | . as $source
  | (($source.body // "") | scan("https://github\\.com/user-attachments/assets/[A-Za-z0-9-]+")) as $url
  | ["inline-review-comment", ($source.user.login // ""), ($source.created_at // ""), $url] | @tsv
'
```

Also inspect the collected Markdown for:

- Markdown images: `![alt](URL)`
- HTML images: `<img src="URL">`
- Ordinary image URLs hosted outside `github.com/user-attachments`
- Links whose surrounding text says they are screenshots

Resolve relative URLs against the item page. Deduplicate identical URLs while retaining every source location.

## 3. Fetch and inspect

For each direct image URL:

1. Prefer a direct image fetch tool such as `fetch_content`; direct image URLs should return an image attachment.
2. If a local file is produced, inspect it with the image-capable `read` tool.
3. If access is denied or the response is HTML rather than an image, open the exact issue or PR in an authenticated native `agent_browser` session, navigate to the attachment, and inspect or screenshot it there. Do not extract or print an authentication token for `curl`.
4. Re-snapshot after navigation and verify that the displayed image belongs to the expected item and source.

Never infer image contents from alt text, filename, or surrounding prose. Actually inspect the image.

## 4. Report evidence carefully

For each screenshot, report:

- Its source: item body, conversation comment, review, or inline review comment
- Author and timestamp when available
- What is visibly established
- Relevant surrounding text as a separate claim
- Anything unreadable, cropped, ambiguous, or inaccessible

When several screenshots appear to be before/after states, verify their labels or chronology from source metadata. Do not infer order from attachment URLs.

## Images changed by a pull request

A binary image in the PR's file list is different from a screenshot embedded in discussion. Obtain base and head versions by object ID without checking out the PR:

```bash
number="$(gh pr view "$ref" -R "$repo" --json number --jq '.number')"
gh api --paginate "repos/$repo/pulls/$number/files?per_page=100" --jq \
  '.[] | [.filename, .status, .additions, .deletions] | @tsv'
base_oid="$(gh pr view "$number" -R "$repo" --json baseRefOid --jq '.baseRefOid')"
head_oid="$(gh pr view "$number" -R "$repo" --json headRefOid --jq '.headRefOid')"
path='path/from-files-output'

gh api -H 'Accept: application/vnd.github.raw' \
  "repos/$repo/contents/$path?ref=$base_oid" >"$workdir/base-image"
gh api -H 'Accept: application/vnd.github.raw' \
  "repos/$repo/contents/$path?ref=$head_oid" >"$workdir/head-image"
```

A newly added image has no base version; a deleted image has no head version. Inspect both available files with the image-capable `read` tool and report the comparison.

## Cleanup

```bash
rm -rf "$workdir"
```
