# Issue relationships

GitHub distinguishes three identifiers:

- **Issue number**: repository-local display number such as `#42`; used in endpoint paths.
- **Database ID**: numeric REST `id`; used as `issue_id` or `sub_issue_id` in relationship payloads.
- **Node ID**: opaque GraphQL `node_id` or CLI `id`; do not use it where the REST endpoint asks for a numeric issue ID.

Set the repository for each role explicitly: `parent_repo`, `child_repo`, `blocked_repo`, and `blocker_repo`, each in `OWNER/REPO` form. They may be equal, but do not assume that for cross-repository relationships. Relationship mutations are externally visible writes; follow the calling workflow's approval requirements.

## Read relationships

For reads, set `repo` to the repository containing the issue being inspected. Current GitHub CLI versions expose relationships directly:

```bash
gh issue view "$number" -R "$repo" --json \
  number,url,parent,subIssues,subIssuesSummary,blockedBy,blocking
```

For complete REST collections or compatibility checks:

```bash
gh api --paginate "repos/$repo/issues/$number/sub_issues"
gh api --paginate "repos/$repo/issues/$number/dependencies/blocked_by"
gh api --paginate "repos/$repo/issues/$number/dependencies/blocking"
```

An issue is currently unblocked only when it has no open blockers. Do not infer that from body text when native dependency data is available.

## Obtain the numeric database ID

```bash
database_id="$(gh api "repos/$other_repo/issues/$other_number" --jq '.id')"
```

Validate that the result is numeric before using it. Resolve `other_repo` from the referenced issue rather than assuming it is the repository of the parent or blocked issue.

## Add an existing issue as a sub-issue

The endpoint issue number is the parent. The payload ID belongs to the child:

```bash
child_id="$(gh api "repos/$child_repo/issues/$child_number" --jq '.id')"
gh api --method POST "repos/$parent_repo/issues/$parent_number/sub_issues" \
  -F "sub_issue_id=$child_id"
```

To create a new child directly under a parent, GitHub's create-issue REST endpoint accepts the parent's numeric database ID as `parent_issue_id`. Prefer the two-pass flow—create all issues, then relate them—when later relationships refer to identifiers that do not yet exist.

## Remove a sub-issue

The endpoint issue number is the parent and the payload ID is the child database ID:

```bash
child_id="$(gh api "repos/$child_repo/issues/$child_number" --jq '.id')"
gh api --method DELETE "repos/$parent_repo/issues/$parent_number/sub_issue" \
  -F "sub_issue_id=$child_id"
```

## Add a blocker

The endpoint issue number is the blocked issue. The payload ID belongs to the blocker:

```bash
blocker_id="$(gh api "repos/$blocker_repo/issues/$blocker_number" --jq '.id')"
gh api --method POST "repos/$blocked_repo/issues/$blocked_number/dependencies/blocked_by" \
  -F "issue_id=$blocker_id"
```

## Remove a blocker

The final path value is the blocker's database ID, not its issue number:

```bash
blocker_id="$(gh api "repos/$blocker_repo/issues/$blocker_number" --jq '.id')"
gh api --method DELETE \
  "repos/$blocked_repo/issues/$blocked_number/dependencies/blocked_by/$blocker_id"
```

## Verify after mutation

Set `repo` to the repository containing the affected parent or blocked issue, then read it through the same public relationship interface:

```bash
gh issue view "$number" -R "$repo" --json url,parent,subIssues,blockedBy,blocking
```

Confirm that the expected item URL appears. Record enough identifiers to recover from partial multi-issue publication.

## Unsupported-feature fallback

If GitHub rejects native sub-issues or dependencies because the feature is unavailable, report the API failure before falling back. The calling workflow owns the fallback format. Common representations are:

- Child body: `Part of #<parent>`
- Blocked issue body: `Blocked by: #<number>, #<number>`
- Parent body: a task list linking child issues

Never maintain both native and textual relationships unless the calling workflow explicitly requires both; duplicated sources drift.
