# Go

## Names at call sites

Prefer role-specific names over terse Go shorthand when the role requires inference:

- **Import:** Use `csvRows` or `validationErrors` rather than `data` or `result`.
- **Wire fields:** Map the wire field `"uid"` into a project-owned type.
  In application logic, use `account.UserID` rather than `payload.UID`.
- **Persistent writes:** Use `generateAndSaveReport(...)` rather than `getReport(...)` if the call creates a file.

Preserve external field names, JSON tags, headers, and cookie names when renaming internal identifiers.

## Returns and policy

- **Config-gated exceptions.** Return early for the exception so the normal path stays unindented.
  Check the named config field beside the condition it controls. Repeat a short check from validation
  if that makes the behavior easier to find by searching for the config field.

  ```go
  if config.AllowFixtureData && source == "fixture" {
      return loadFixture()
  }

  return loadFromDatabase()
  ```

- **Fallible work:** Return an `error`. Name additional boolean results
  so their meaning is visible in the declaration and at the call site:

  ```go
  page, hasNextPage, err := client.fetchOrdersPage(ctx, cursor)
  ```

- **Lookup and fallback:** Distinguish lookup failures from failures to save or cache a successful lookup.
  Let an explicit orchestration function own the fallback.
  Document which failures it handles and which errors it returns.
- **Error context:** Add operation context with `%w` when wrapping errors
  so `errors.Is` and `errors.As` still work.
  Preserve read and timeout errors rather than relabeling every failure as invalid data.
- **Response writes:** A helper that only reads or constructs data should not take `http.ResponseWriter`.
  If it writes headers or a body, name that effect and document whether it has written anything on error.
- **Library contracts:** Keep standard library and framework contracts intact.
  For example, `io.Reader.Read` may return both data and an error.
  Process the returned bytes before handling the error.
