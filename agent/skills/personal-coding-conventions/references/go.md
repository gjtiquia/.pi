# Go

## Names at call sites

Prefer role-specific names over terse Go shorthand when the role requires inference:

| Obscure | Clearer in this context |
| --- | --- |
| `data`, `result` during an import | `csvRows`, `validationErrors` |
| `payload.UID` in application logic | `account.UserID` — map the wire field `"uid"` into a project-owned type |
| `getReport(...)` that creates a file | `generateAndSaveReport(...)` |

Preserve external field names, JSON tags, headers, and cookie names when renaming internal identifiers.

## Returns and policy

- Use an `error` result for fallible work. Name additional boolean results so their meaning is visible in the declaration and at the call site:

  ```go
  page, hasNextPage, err := client.fetchOrdersPage(ctx, cursor)
  ```

- Keep lookup failure distinct from failure to save/cache a successful lookup. Let an explicit orchestration function own the fallback; document handled failures versus returned errors.
- Add operation context with `%w` when wrapping errors, preserving `errors.Is` / `errors.As`. Preserve read/timeout errors rather than relabeling every failure as invalid data.
- A helper that only reads or constructs data should not take `http.ResponseWriter`. If it writes headers or a body, make that effect explicit in its name and document whether it has written anything when returning an error.

Keep standard library and framework contracts intact. For example, `io.Reader.Read` may return both data and an error; process the returned bytes before handling the error.
