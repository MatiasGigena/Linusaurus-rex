# Linusaurus Rex

A Linux desktop client for an existing [Rex](https://www.superlogical.com/rex) server. Hosts contain sessions, session windows become tabs, and the server manages tiled and floating panes. Closing the client leaves the programs running.

This independent, unofficial application uses Electron, React, xterm.js and the canonical libghostty-vt WASM snapshot decoder. [rex-rune](https://github.com/shuv1337/rex-rune) was consulted as an MIT-licensed reference. See the [feature-by-feature parity inventory](docs/CLIENT_PARITY.md) for the documented actions, settings, validation and remaining differences.

## Features

- Saved local/remote hosts, searchable session switcher, command palette, session/tab/pane management, drag-resizable splits, floating panes, zoom and multiple native windows.
- Persistent control and data WebSockets, Ghostty snapshot restore, incremental VT output and resumable streams. Input pauses on failure and is never replayed. Visible panes claim viewport ownership while connected.
- Physical-layout keys, IME/dead keys, bracketed paste, mouse/wheel reporting, local selection/scrollback, terminal search, prompt navigation and text export. Ghostty-derived Unicode widths cover modern emoji and combining characters.
- Program activity, progress and attention labels; per-kind tab/desktop/badge/sound preferences; OSC 9/777 notifications; click-to-open the owning tab; Tailscale status notifications.
- Server-resolved Lua actions, configurable shortcuts, key sequences, modes and next-key hints. Remote client control can be disabled.
- Remote file/directory picker, non-terminal block discovery/inspector, separate light/dark theme imports, terminal typography and cursor preferences, interface zoom and left/right/top tabs.
- Connection/API/Tailscale diagnostics, remote-address QR codes, confirmed Tailscale enrollment/access controls, and previewed agent integration setup/removal.

## Requirements and run

Linux with a graphical desktop and a running Rex server. Building requires Node.js 22 or later; packages include the desktop runtime. The client negotiates API revisions **7–10**; advanced features depend on the server’s available methods. Tested against installed Rex `0.0.1793645657-gd018d2`, including constrained API 8.

A `rex` executable is **not required for attachment, terminal streaming or session/layout changes**. The optional Agents setup screen uses the local `rex skill` command with `--autostart=false`.

```bash
npm ci
npm run dev
```

For a production build from the checkout:

```bash
npm run build
npm start
```

Select an existing session or create your own in the sidebar. The app never automatically installs, starts, stops or replaces the Rex server. Saving server configuration or changing Tailscale access is an explicit UI action. Closing a pane, tab or session ends its programs and asks for confirmation by default.

`npm run dev` watches renderer, main-process and preload sources; restart it after changing main/preload code so Electron loads the new bundle.

## Connect and authenticate

An explicit saved endpoint takes precedence. An empty endpoint uses `REX_SERVER`, then `unix://$XDG_RUNTIME_DIR/rex/server.sock` (or `/run/user/<uid>/rex/server.sock`). Settings supports Unix sockets, HTTP(S), WS(S), saved Rex host aliases and bare hostnames.

A bare hostname first resolves saved Rex aliases, then tries HTTPS port 443, HTTPS port 7297 and HTTP port 7297. Explicit HTTPS/WSS URLs keep TLS verification and are never downgraded. Implicit plaintext fallback is disabled when gateway credentials are configured.

Rex login-server account selection uses a URL such as `https://root@host.example`; the account is sent as a Rex WebSocket subprotocol, not HTTP Basic authentication. Rex identity/access comes from its server and Tailscale/peer configuration. URL passwords are rejected.

For a separate reverse proxy that requires Basic or Bearer authentication, save gateway credentials in the host editor. They require an available encrypted desktop secret store and are stored separately from preferences; changing/removing the endpoint invalidates them. There is no plaintext credential fallback.

Settings → Terminal supplies the default command for effective local Unix hosts. Each host explicitly chooses an inherited local default, the server’s login shell or a custom startup executable and arguments for new sessions, tabs and splits. Quoted arguments are preserved; shell expansion is not implicit. Use an explicit shell command such as `sh -c '…'` when shell syntax is intended.

Diagnostics shows server/API status, start time, Tailscale account/tags/control server, HTTPS readiness and address. Tailscale access/enrollment changes require a local Unix connection, as enforced by Rex. QR codes share the advertised HTTPS address; the receiving device still needs network access and server permission.

## Launch options

After installation, use `linusaurus-rex --help`. From a built checkout, pass options after `npm start --`:

```bash
npm start -- --session work
npm start -- --endpoint https://host.example.ts.net --session work
npm start -- --new experiment --font 'JetBrains Mono' --font-size 15
```

| Option | Behavior |
| --- | --- |
| `--endpoint ADDRESS` | Select or save a server endpoint/alias. |
| `--session LABEL_OR_ID` | Select an exact ID or unambiguous exact label. |
| `--new LABEL` | Explicitly create a persistent session; conflicts with `--session`. |
| `--block BLOCK_ID` | Initially focus an existing pane, optionally within `--session`. |
| `--font FAMILY`, `--font-size PIXELS` | Set terminal typography; size 8–48. |
| `--config PATH` | Use a separate app preferences JSON file, not Rex `init.lua`. |
| `--window-size WxH` | Initial size, from 760×480 to 7680×4320. |

Endpoint/font overrides are saved in the selected preferences. A running app accepts new launch selections; quit it before choosing a different `--config` file. Only `--new` creates a session.

## Controls

Shortcuts can be edited in Settings → Keyboard; resolved Rex/Lua bindings and modes are also supported.

| Action | Default shortcut |
| --- | --- |
| Session switcher / command palette | `Ctrl K` / `Ctrl Shift P` |
| New session / terminal tab | `Ctrl Shift N` / `Ctrl Shift T` |
| Split right / below | `Ctrl Shift D` / `Ctrl Shift Alt D` |
| Close tab, with confirmation | `Ctrl Shift W` |
| Zoom pane / toggle sidebar | `Ctrl Shift Enter` / `Ctrl Shift B` |
| Previous / next tab | `Ctrl Shift Tab` / `Ctrl Tab` |
| Focus adjacent pane | `Ctrl Alt Arrow` |
| Find terminal text | `Ctrl Shift F` |
| Copy / paste | `Ctrl Shift C` / `Ctrl Shift V` |
| Settings / fullscreen | `Ctrl Shift ,` / `F11` |

Ordinary terminal keys such as `Ctrl C` reach the server program. Right-click tabs, sessions and panes for their actions. Shift-drag selects text in mouse-aware programs; Shift-right-click sends a program mouse click. Application links use an ask/always/never policy with removable trusted targets.

## Package and verify

```bash
npm run package       # AppImage + Debian package in release/
npm run package:dir   # Unpacked Linux application
```

Packaging may download Electron/build tools. Packages do not include the Rex server. A launcher for a built checkout can be installed with `node scripts/install-desktop.mjs`, or pass an absolute AppImage path. It writes to your user application/icon directories under `$XDG_DATA_HOME` or `~/.local/share`; keep the target at that path.

```bash
npm run typecheck
npm test
npm run build
npm run test:integration
npm run test:terminal
npm run test:ui
npm run test:actions
```

The final source run passed **63/63 tests with zero skips or failures**, plus the installed-Rex Electron smoke and native-action fixtures. Both fixtures also passed against the actual **0.2.0 AppImage**. AppImage and Debian builds succeeded; Debian version, amd64 architecture and dependency metadata were verified.

Browser tests use `/usr/bin/chromium`, or the executable selected with `CHROMIUM_PATH`. Electron checks require a graphical display. Installed-server tests create their own sessions and remove only the returned IDs. They cover ordered VT/resume, primary/alternate screens, input/resize, API 8 without a CLI, client actions, Lua sequences/modes, directory listing and advanced layouts. Browser tests exercise rendering, selection/search, theme/cursor preferences, Unicode widths, link handling and reconnect/tab state. Electron smoke tests open the desktop application.

## Current limits

This is not complete Mac feature parity. The app does not manage an included server installation, restart an externally installed server, or provide an upstream auto-updater. Mac permissions, Glass materials and Dock-specific controls are not Linux equivalents.

Remaining rendering/preferences include full Kitty graphics/sixel support, Display P3, RGB-to-theme color remapping, cursor shaders and some selection/background effects. Imported themes retain one light and one dark palette, each with its own extended-palette switch. Non-terminal blocks expose an inspector rather than bespoke plugin interfaces. Screen-reader mode is enabled, but comprehensive AT-SPI accessibility and physical-device/compositor testing remain outstanding. The [parity inventory](docs/CLIENT_PARITY.md) records each distinction.

Preferences normally live in Electron’s user configuration directory (`~/.config/Linusaurus Rex/settings.json`), or the selected `--config` file. Connection diagnostics and the saved host editor are the first places to investigate a disconnected host. Reconnection does not replay terminal input.

The renderer is sandboxed with context isolation and no direct process/filesystem API. Native actions use the validated preload bridge. `electron/rex/` owns transport/snapshot decoding; `electron/features/` owns keymaps, activity, integrations and native services; `src/terminal/` owns rendering/input. MIT license; Rex and Superlogical names belong to their owners.
