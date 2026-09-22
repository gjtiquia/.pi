# Issues and pull requests

Set explicit shell variables once. `repo` is always `OWNER/REPO`; `ref` may be a number or URL.

```bash
repo='OWNER/REPO'
ref='123'
```

## Resolve a repository or reference

Inside a checkout:

```bash
gh repo view --json nameWithOwner,url
```

For a GitHub URL, prefer passing the URL directly to `gh issue view` or `gh pr view`, then use the returned URL to establish repository and kind. For a bare number:

```bash
if gh pr view "$ref" -R "$repo" --json number,url >/tmp/github-item.json 2>/dev/null; then
  kind=pr
else
  gh issue view "$ref" -R "$repo" --json number,url >/tmp/github-item.json
  kind=issue
fi
```

Do not retain `/tmp/github-item.json` after the operation.

## Read one item

Issue, including relationships used by planning workflows:

```bash
gh issue view "$ref" -R "$repo" --json \
  number,url,title,state,stateReason,author,body,labels,assignees,comments,createdAt,updatedAt,parent,subIssues,blockedBy,blocking
```

Pull request:

```bash
gh pr view "$ref" -R "$repo" --json \
  number,url,title,state,isDraft,author,body,labels,assignees,comments,reviews,reviewDecision,baseRefName,headRefName,headRepositoryOwner,isCrossRepository,mergeable,mergeStateStatus,statusCheckRollup,files,createdAt,updatedAt
```

Use `--jq` only to reduce a known JSON shape. Keep body and comment text when the task depends on requirements, prior decisions, or screenshots.

## List items

Use a bounded `--limit` deliberately; raise it when completeness is required.

```bash
gh issue list -R "$repo" --state open --limit 100 --json \
  number,url,title,state,author,labels,assignees,createdAt,updatedAt

gh pr list -R "$repo" --state open --limit 100 --json \
  number,url,title,state,isDraft,author,labels,createdAt,updatedAt
```

`gh pr list --json` does not expose author association. When contributor role matters, use the paginated REST collection, whose `author_association` values include `OWNER`, `MEMBER`, `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, and `NONE`:

```bash
gh api --paginate "repos/$repo/pulls?state=open&per_page=100" --jq '
  .[] | {
    number, url:.html_url, title, state, draft,
    author:.user.login, authorAssociation:.author_association,
    createdAt:.created_at, updatedAt:.updated_at
  }
'
```

Apply filters with supported flags such as `--label`, `--assignee`, `--author`, `--search`, `--base`, and `--head`. Do not fetch every body and comment for a discovery list; fetch full context only for selected items.

## Pull request code and verification

```bash
gh pr diff "$ref" -R "$repo"
gh pr checks "$ref" -R "$repo"
```

For structured check data:

```bash
gh pr view "$ref" -R "$repo" --json statusCheckRollup
```

Checkout mutates the local working tree. Inspect local changes first and follow the calling workflow's approval rules:

```bash
git status --short
gh pr checkout "$ref" -R "$repo"
```

Conversation comments and review summaries are available from `gh pr view`. Inline review comments require the REST collection. Resolve a URL or branch reference to its numeric PR number before constructing a REST path:

```bash
number="$(gh pr view "$ref" -R "$repo" --json number --jq '.number')"
gh api --paginate "repos/$repo/pulls/$number/comments?per_page=100"
```

## Create an issue

Write the body to a temporary file and preserve the returned URL:

```bash
body_file="$(mktemp)"
cat >"$body_file" <<'MARKDOWN'
## Summary

Issue body.
MARKDOWN

gh issue create -R "$repo" --title 'Title' --body-file "$body_file"
rm -f "$body_file"
```

Add labels with repeatable `--label` flags only when the calling workflow requests them.

## Comment

```bash
body_file="$(mktemp)"
cat >"$body_file" <<'MARKDOWN'
Comment body.
MARKDOWN

gh issue comment "$ref" -R "$repo" --body-file "$body_file"
# For a PR: gh pr comment "$ref" -R "$repo" --body-file "$body_file"
rm -f "$body_file"
```

## Replace a body safely

Fetch the latest body immediately before editing. Create the complete replacement in a temporary file; `--body-file` replaces the whole body.

```bash
gh issue view "$ref" -R "$repo" --json body,url
body_file="$(mktemp)"
# Write the complete replacement to "$body_file".
gh issue edit "$ref" -R "$repo" --body-file "$body_file"
rm -f "$body_file"
```

Use `gh pr edit` for a PR. If the body changed after it was fetched, stop and reconcile rather than overwriting another writer.

## Labels and assignment

```bash
gh issue edit "$ref" -R "$repo" --add-label 'label'
gh issue edit "$ref" -R "$repo" --remove-label 'label'
gh issue edit "$ref" -R "$repo" --add-assignee '@me'
gh issue edit "$ref" -R "$repo" --remove-assignee '@me'
```

Use `gh pr edit` for PR labels and assignees. When labels represent mutually exclusive roles, the calling workflow—not this recipe—decides which conflicts to remove.

## Close or reopen

```bash
gh issue close "$ref" -R "$repo"
gh issue reopen "$ref" -R "$repo"
gh pr close "$ref" -R "$repo"
gh pr reopen "$ref" -R "$repo"
```

Post any required explanation before closing, or use the command's comment option when appropriate. Closing is not deletion.

## Verify a write

Fetch only the affected state after mutation:

```bash
gh issue view "$ref" -R "$repo" --json number,url,state,labels,assignees,updatedAt
# or: gh pr view ...
```

Report the item kind, number, URL, and the fields that changed.
