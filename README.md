# Linusaurus Rex

A Linux desktop client for your existing [Rex](https://www.superlogical.com/rex) beta server. A graphite sidebar keeps hosts, sessions and terminal tabs together; the workspace displays your real terminals and server-managed splits.

This is an independent client, not an official Superlogical application. The interface is inspired by the supplied Rex desktop reference. [rex-rune](https://github.com/shuv1337/rex-rune) was consulted as an integration reference; this implementation uses Electron, React, xterm.js and the installed Rex CLI.

## Requirements

- Linux with a graphical desktop. Building from source also needs Node.js 22 or later; packaged builds include their runtime.
- The Superlogical `rex` executable on `PATH` and a running Rex beta server.
- Your existing permission to access that server. Local Unix sockets are verified. Saved remote endpoints are supported for discovery; the terminal control connection must also admit this client. Interactive remote login and credential provisioning are not implemented.

You already installed Rex? Keep that installation. This app does not install Rex, start a missing server, stop a server, or alter its configuration. Every CLI call includes `--autostart=false`. Closing the app detaches the graphical client and leaves sessions running. Explicitly closing a pane or tab does end the programs in that pane or tab; the interface asks for confirmation.

## Run

```bash
npm ci
npm run dev
```

For a production build from this checkout:

```bash
npm run build
npm start
```

The application initially connects to the local server and lists its sessions. Select a session and tab from the sidebar. Create a session if you want a separate workspace. Use Settings to add a remote endpoint or a saved Rex host alias, change the terminal font, or change its size.

The development command runs Vite, bundles the main process and preload, and launches Electron. React changes refresh automatically. Restart `npm run dev` after changing main-process or preload code.

## Controls

| Action | Shortcut |
| --- | --- |
| New session | `Ctrl Shift N` |
| New terminal tab | `Ctrl Shift T` |
| Split right | `Ctrl Shift D` |
| Split below | `Ctrl Shift Alt D` |
| Close tab, with confirmation | `Ctrl Shift W` |
| Show or hide sidebar | `Ctrl Shift B` |
| Command palette | `Ctrl Shift P` |
| Zoom focused pane | `Ctrl Shift Enter` |
| Settings | `Ctrl Shift ,` |
| Copy terminal selection | `Ctrl Shift C` |
| Paste | `Ctrl Shift V` |
| Full screen | `F11` |

Ordinary terminal control keys, including `Ctrl C`, go to the focused server terminal. Toolbar buttons offer the same layout actions. Tabs and sessions can be renamed from the interface.

## Package or install a launcher

```bash
npm run package
```

Electron Builder writes an AppImage and Debian package into `release/`. Packaging may download Electron and Linux packaging tools the first time. The resulting application still needs your installed Rex CLI on `PATH`; it does not bundle the proprietary server.

To add a desktop launcher for a built checkout:

```bash
npm run build
node scripts/install-desktop.mjs
```

Or point the installer at a packaged AppImage:

```bash
chmod +x release/*.AppImage
node scripts/install-desktop.mjs /absolute/path/to/Linusaurus.AppImage
```

The installer writes only to your user application and icon directories (`$XDG_DATA_HOME`, or `~/.local/share`). Keep the checkout or AppImage at that path. Remove `applications/linusaurus-rex.desktop` and `icons/hicolor/512x512/apps/linusaurus-rex.png` from that data directory to remove the launcher.

## Connection troubleshooting

Verify that your installation is reachable without starting a new server:

```bash
rex --autostart=false whoami --json
rex --autostart=false ls --json
```

For a remote host, test the same alias or endpoint you saved in Settings:

```bash
rex --autostart=false -S YOUR_HOST whoami --json
```

A disconnected host stays visible and can reconnect when the server returns. The app does not replay failed terminal input. If the CLI works in a shell but the desktop launcher cannot find it, ensure `rex` is in the desktop session's `PATH`, then reopen the app.

Settings are saved to `settings.json` in Electron's user configuration directory, normally `~/.config/Linusaurus Rex/`. They contain host labels/endpoints and appearance preferences, not server credentials. Invalid settings fall back to defaults.

## Current integration scope

The client uses the installed CLI for session discovery and management, plus a persistent Rex control connection (API revisions 7–8) for snapshots, input and terminal dimensions. Terminal panes refresh from VT snapshots, approximately every 150 milliseconds, and unchanged frames are skipped. This supports interactive shells, ANSI colors, keyboard input, paste, resizing, server sessions, tabs and splits. It is an early client: snapshot redraws have more latency than a native streaming transport, and high-volume output can cost more CPU. A snapshot is limited to 8 MiB of scrollback; exceeding it displays an actionable error. Terminal mouse reporting, remote server provisioning, non-terminal block plugins and Rex's native client action API are not implemented.

The server's layout is authoritative. Another client can change sessions or splits, and this app refreshes its view. Disconnects stop terminal updates; closing this application never closes the server's sessions.

## Development checks

```bash
npm run typecheck
npm test
npm run build
# Creates and removes one isolated test session on the running local server:
npm run test:integration
# Opens the actual desktop app; creates and removes its own test sessions:
npm run test:ui
```

- `src/` contains the React workspace and xterm.js terminal views.
- `src/shared/types.ts` defines the typed renderer bridge.
- `electron/rex/` adapts the installed Rex CLI and maintains the terminal control connection.
- `electron/ipc.ts` validates the small IPC surface and owns terminal subscriptions.
- `electron/settings.ts` validates and persists preferences with atomic writes.
- `electron/preload.ts` exposes that bridge with context isolation and sandboxing enabled.

The renderer has no direct process or filesystem API. Navigation, popups and embedded webviews are blocked. CLI arguments are passed as argument arrays, without a shell. Terminal input goes only to the selected Rex pane; credentials remain with Rex.

MIT license. Rex and Superlogical names belong to their respective owners.
