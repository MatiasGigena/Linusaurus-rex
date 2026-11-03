# Linusaurus Rex

A Linux desktop client for an existing [Rex](https://www.superlogical.com/rex) server. Hosts contain sessions, session windows become tabs, and the server manages tiled and floating panes. Closing the client leaves the programs running.

This independent, unofficial application uses Electron, React, xterm.js and the canonical libghostty-vt WASM snapshot decoder. [rex-rune](https://github.com/shuv1337/rex-rune) was consulted as an MIT-licensed reference. See the [feature-by-feature parity inventory](docs/CLIENT_PARITY.md) for the documented actions, settings, validation and remaining differences.

## Features

- Saved local/remote hosts, searchable session switcher, command palette, session/tab/pane management, drag-resizable splits, floating panes, zoom and multiple native windows.
- Persistent control and data WebSockets, Ghostty snapshot restore, incremental VT output and resumable streams. Input pauses on failure and is never replayed. Visible panes claim viewport ownership while connected.
- Physical-layout keys, IME/dead keys, bracketed paste, mouse/wheel reporting, local selection/scrollback, terminal search, prompt navigation and text export. Ghostty-derived Unicode widths cover modern emoji and combining characters.
- Program activity, progress and attention labels; per-kind tab/desktop/badge/sound preferences; OSC 9/777 notifications; click-to-open the owning tab; Tailscale status notifications.
- Server-resolved Lua actions, configurable shortcuts, key sequences, modes and next-key hints. Remote client control can be disabled.
- Remote file/directory picker, a persistent interactive tutorial block, non-terminal block discovery/inspector, a named light/dark theme library, terminal typography/cursor/image preferences, interface zoom and left/right/top tabs.
- Bounded live Sixel/iTerm2 and direct Kitty images, RGB-to-theme mapping, capability-gated Display P3 text, cursor effects, program-matched pane backgrounds and padding, and granular selection/highlight/fade controls.
- Linux server launch-profile/status/integrity inspection, idle-only lifecycle controls, pending web-origin edits, and verified client update downloads/application.
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

Select an existing session or create your own in the sidebar. Opening the app does not automatically install, start, stop or replace the Rex server. Explicit local lifecycle controls can start a managed endpoint and stop/restart an identified idle server; existing sessions cause stop/restart to be refused. Saving server configuration or changing Tailscale access is an explicit UI action. Closing a pane, tab or session ends its programs and asks for confirmation by default.

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

The checked-in [Linux release workflow](.github/workflows/release.yml) accepts a pushed stable `vX.Y.Z` tag or a manual run for an existing matching tag. It verifies the tag against `package.json`, tests/builds the x86-64 AppImage and Debian package, computes/verifies `SHA256SUMS`, then uploads a draft release before publishing it. Existing published release assets are not overwritten. The public [v0.4.1 release](https://github.com/MatiasGigena/Linusaurus-rex/releases/tag/v0.4.1) contains both Linux packages. The release normalizes filenames before checksumming and verify actual remote draft assets before publishing.


```bash
npm run typecheck
npm test
npm run build
npm run test:integration
npm run test:terminal
npm run test:ui
npm run test:actions
npm run test:services
npm run test:graphics
npm run test:layers
npm run test:systemd
npm run test:accessibility
```

Native desktop tests require `Xvfb` and `xauth` (on Debian/Ubuntu: `sudo apt install xvfb xauth`). Every `test:ui`, `test:actions`, `test:services`, `test:graphics`, `test:layers`, `test:systemd`, `test:accessibility` and `test:update-live` run uses a private, authenticated X11 display and clipboard. They never open windows on your desktop. Set `XVFB=/absolute/path/to/Xvfb` to use a local executable; missing Xvfb is an error. After building once, run several fixtures in sequence with `node scripts/test-desktop.mjs smoke actions services graphics layers systemd accessibility`. The existing user D-Bus connection is retained for owned systemd and AT-SPI checks. Live update verification additionally requires `LIVE_UPDATE_FROM=/absolute/path/to/published.AppImage` and a newer published stable release; it updates only a temporary copy.

The 0.4.1 source run passed **113/113 tests with zero skips or failures**, with integration, browser pixel tests and public-release verification enabled. All seven native fixtures passed against the published 0.4.1 AppImage on private Xvfb displays: smoke, actions, services, graphics, layers, systemd and accessibility. Accessibility covered 15 views with zero axe violations and terminal input/output in Chromium and native AT-SPI (233 owned nodes); incomplete/manual-review checks remain in the report. The Debian metadata and extracted services/systemd runtime passed, including foreign-APPIMAGE handling; no system-wide Debian installation was performed. All four original sessions, windows and blocks and the original Rex process were preserved. A real update from a temporary copy of the published 0.3 AppImage to 0.4.1 verified the download, backup, replacement, relaunch and input in the same Rex session/pane without changing the Rex process. These checks do not claim universal WCAG or physical-device/compositor conformance.

Browser tests use `/usr/bin/chromium`, or the executable selected with `CHROMIUM_PATH`. Native accessibility checks also use the system Python `pyatspi` module and generate `test-results/accessibility-report.json`; the audit uses a single-frame Electron-compatible axe aggregation mode without disabling accessibility rules. Installed-server tests create their own sessions and remove only the returned IDs. They cover ordered VT/resume, primary/alternate screens, input/resize, API 8 without a CLI, client actions, Lua sequences/modes, directory listing and advanced layouts. Browser tests exercise rendering, selection/search, theme/cursor preferences, Unicode widths, link handling and reconnect/tab state. Electron smoke tests open the application only on their private virtual display.

## Linux services, updates and remaining distinctions

Settings → Server → Updates and Linux services exposes the connected executable/profile, version, process/config/state details and binary SHA-256 where available. Server stop/restart requires Rex to atomically confirm that **no sessions exist**. The installed server and existing programs are retained during normal attachment, client exit, client updates and refused lifecycle requests. Direct processes retain their launch profile. Supported same-user systemd services retain their existing unit and restart policy; an idle operation temporarily suppresses automatic restart while Rex performs its atomic shutdown. A reviewed, dedicated user service override can persist web-origin changes without restarting active sessions or changing unrelated service settings. System services, activated services and unidentifiable endpoints remain under their existing manager. Service configuration and running origins are shown separately.

Client updates use this repository's stable GitHub releases and require a compatible package plus a SHA-256 manifest. AppImages are replaced atomically with a previous-version backup and relaunched; Debian packages use the system installer. Automatic checking/downloading and idle application are opt-in. A release must actually be published before an update is offered. Development/source builds do not self-install packages. This app does not distribute or update the externally installed Rex server binary.

Live inline images cover Sixel/iTerm2 and bounded Kitty rendering, including parent-relative placement chains, up to 64 animation frames, canonical Unicode virtual placeholders, and image layers below cell backgrounds, below text and above text. Rex resolves file, temporary-file and shared-memory transfers on the server before relaying direct image bytes to the client; the GUI needs no filesystem access for these transfers. Copying protocol placeholder cells can include placement metadata; ordinary terminal text is unchanged. Ghostty snapshots omit image data, so a new attachment cannot restore images emitted before it connected. Rex does not reserve Sixel cells: foreground/fullscreen emitters must manage cursor placement, and returning to a shell redraw can overwrite the image. Known onboarding blocks have a native interactive view; unknown future plugins retain their API inspector. Display P3 text requires runtime/display support; image decoders retain their own color space.

Mac system permissions, Glass materials, Dock-specific artwork/visibility and upstream update channels are platform distinctions. Canvas cursor effects provide a Linux alternative to upstream Metal shader files. The [parity inventory](docs/CLIENT_PARITY.md) records each implemented behavior and remaining distinction; validation results distinguish automated coverage from physical-device/compositor checks.

Preferences normally live in Electron’s user configuration directory (`~/.config/Linusaurus Rex/settings.json`), or the selected `--config` file. Connection diagnostics and the saved host editor are the first places to investigate a disconnected host. Reconnection does not replay terminal input.

The renderer is sandboxed with context isolation and no direct process/filesystem API. Native actions use the validated preload bridge. `electron/rex/` owns transport/snapshot decoding; `electron/features/` owns keymaps, activity, integrations and native services; `src/terminal/` owns rendering/input. MIT license; Rex and Superlogical names belong to their owners.
