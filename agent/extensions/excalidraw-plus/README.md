# Excalidraw+ reader

A small, read-only Pi extension for loading Excalidraw+ scenes as an image, extracted text, and complete raw scene JSON.

## Configuration

1. In Excalidraw+, create a **personal** API key with only the read permissions needed for scenes, scene content, and the MCP screenshot tool. A personal key can access your private collection; a workspace key cannot.
2. Copy `.env.example` to `.env` in this directory.
3. Put the key in `.env`:

```env
EXCALIDRAW_API_KEY=your-key-here
```

The extension reads this file directly for each tool call, so key changes take effect immediately without exporting credentials to child processes. Do not commit or share `.env`.

## Tools

`list_excalidraw_scenes` lists every read-accessible scene, optionally filtered by title, scene ID, or collection. It returns compact metadata including title, ID, updated date, and private/shared status. If the result exceeds Pi's output limit, it saves the complete metadata as a secure temporary JSON file.

`read_excalidraw` accepts a scene ID, Excalidraw+ URL, or exact/partial scene title. It:

- retrieves the complete scene through the read-only REST API;
- extracts non-deleted text in top-to-bottom order;
- asks the hosted Excalidraw+ MCP renderer for a PNG;
- returns the text and PNG to the model; and
- saves the complete `.excalidraw`, extracted `.txt`, and rendered image under the system temporary directory (`pi-excalidraw-plus`).

Text sent directly to the model is capped at Pi's standard 50KB/2000-line limit; the complete text remains in the saved `.txt` file.

## Dark mode

The extension inspects the live `take_screenshot` tool schema and requests dark mode when the hosted API exposes a compatible `darkMode`, `theme`, or `exportWithDarkMode` parameter. At present, Excalidraw+'s documented screenshot schema has no theme parameter. When that remains true, the renderer chooses the theme and the tool reports a warning instead of claiming the image is dark. Even when requested, the hosted API does not currently return enough metadata to verify the rendered theme.

No scene writes, updates, or deletions are performed.
