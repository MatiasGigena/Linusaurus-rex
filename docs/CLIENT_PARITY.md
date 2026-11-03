# Rex client parity inventory — 0.3 implementation

Reviewed against the downloaded official action/settings references and the example repository on 2026-11-03. This is an implementation inventory, not a claim of complete Mac feature parity or a substitute for the validation results below.

**Status:** Implemented = a working code path exists; Partial = the main behavior exists with the stated limitation; Remaining = no equivalent is shipped; Platform-specific = an upstream Mac/app-distribution feature with no direct Linux equivalent here. An implemented row is not necessarily exercised by an automated UI test.

## Sources and scope

- [Official Mac client actions](https://www.superlogical.com/rex/docs/reference/mac-actions). Names are preserved for `rex do`, Lua keymaps and remote client actions; Linux shortcuts use Ctrl/Super conventions rather than copying macOS shortcuts.
- [Official Mac client settings](https://www.superlogical.com/rex/docs/reference/mac-settings). The matrix distinguishes common client behavior from Mac materials, permissions and the upstream updater.
- [Linux installation and existing-server model](https://www.superlogical.com/rex/docs/linux/installation). The installed server is reused; opening this app does not replace or restart it.
- [Canonical Ghostty snapshot constraints](https://github.com/KooshaPari/Khostty/blob/main/src/terminal/snapshot/terminal.zig#L238): version 1 omits Kitty image/placement state; virtual placeholder cells alone cannot restore an image.
- [rex-rune README at 9817d404](https://github.com/shuv1337/rex-rune/blob/9817d40496a703d33aabcae208e71774d1709a5a/README.md). Its MIT license permits reference use. This app remains an independent client, not an official Superlogical release.

## Example repository feature coverage

| Example capability | Status | Implementation / limitation |
| --- | --- | --- |
| Saved hosts → sessions → tabs → server-defined split layout | Implemented | Grouped sidebar, searchable picker, persistent selection and normalized server layout. Session/window/pane mutations use persistent control WebSockets. |
| Unix sockets and HTTPS/WSS remote endpoints | Implemented | Explicit saved endpoint, then REX_SERVER, then XDG runtime socket discovery; explicit Unix/HTTP(S)/WS(S) endpoints; saved Rex aliases; bare host/account@host tries HTTPS 443, HTTPS 7297, then HTTP 7297. Explicit HTTPS is never downgraded; implicit plaintext is suppressed for gateway credentials. |
| Rex login-server accounts | Implemented | URL username selects the account through the `rex.as.<account>` WebSocket subprotocol on both control and data sockets, without HTTP Basic credentials. URL passwords are rejected. |
| Remote gateway authentication | Implemented | Optional gateway Basic/Bearer credentials are stored separately using Electron encrypted storage when available, are excluded from renderer preferences, and are invalidated on endpoint changes/removal. Rex itself uses Tailscale/peer identity, not passwords. |
| One toolbar; frameless drag/minimize/maximize/close; resize edges | Implemented | Electron native window controls, a drag region, platform edge resizing, and multiple client windows. |
| Tab close menu, middle click, close shortcut and confirmation | Implemented | Sidebar and top tabs offer close/context interactions. Destructive server pane/tab/session closing confirms by default; disabling confirmation is an explicit preference. |
| Optional sidebar and its startup state | Implemented | Visibility and width are persisted; drag or keyboard-resize the edge, with fixed-window-width or fixed-terminal-width behavior. This client restores saved visibility rather than forcing the example’s collapsed-on-every-launch default. |
| Searchable session switcher and command palette | Implemented | Ctrl+K session picker and Ctrl+Shift+P palette include sessions, tabs, client actions, and server/Lua actions. |
| Ghostty snapshot restore followed by live VT output | Implemented | Canonical libghostty-vt WASM decodes GHOSTSNP, including primary/alternate screen and unfinished UTF-8/escape continuation; incremental output follows the initial snapshot without fullscreen polling. |
| Input, bracketed paste, physical keys, IME/dead keys, mouse/wheel | Implemented | Typed `client.key` / block events retain physical position and layout text. Local Shift selection bypasses mouse reporting; right-click menu and Shift program clicks are supported. Parser-generated query responses are not sent twice. |
| Selection/copy and local scrollback | Implemented | Persistent xterm runtime cache, configurable local scrollback, copy/select-all/export, copy-on-selection, prompt markers and terminal search. |
| Reconnect without replaying input or resetting good output | Implemented | Resumable data offsets, retained parser state, paused input while disconnected, queue generation invalidation, bounded buffers, snapshot fallback only when resume is rejected, and viewport ownership restored after control reconnect. |
| OSC 7501 program activity, progress, attention labels | Implemented | Control block events and initial state track working, permission/question/auth/input blocking, errors and done; initial history does not generate desktop notifications. |
| Dynamic OSC 0/2 titles and per-program tab icons | Implemented | Unrenamed titles follow terminal metadata, or generated program/directory titles when selected. Sidebar and top tabs show program icons and activity with conditional coloring preferences. |
| Freedesktop notifications; OSC 9/777; click to navigate | Implemented | Electron native notifications, status preferences, terminal-program messages, focused-pane suppression, deduplication and selection on click. Real desktop delivery depends on the desktop notification service. |
| Agent integration preview/setup/update/removal | Implemented | Local `rex skill` subprocess only for the optional integration UI, always `--autostart=false`. Claude Code, Codex, OpenCode and Pi selection; dry-run preview precedes apply; session naming is passed explicitly. |
| 70–150% interface zoom; terminal font/size | Implemented | Independent Electron zoom and terminal typography settings with immediate preview/application. |
| Per-host default shell for every new session/tab/split | Implemented | Saved hosts can override the executable and arguments for newly created terminals. The general startup command is a fallback only for effective local Unix hosts, including when REX_SERVER changes the default endpoint. |
| Attach with no rex executable; leave server sessions running | Implemented | Transport/session mutations are direct WebSocket calls, not subprocesses. API 8 no-PATH integration test exercises new terminals and startup commands. Exiting the client disposes ownership/connections, not server programs. |
| API revisions 7–8, including newer compatible servers | Implemented | Negotiation supports revisions 7–10. Mock tests cover explicit API 7; installed-server integration covers API 10 and constrained API 8. |
| Example command-line launch flags | Implemented | Supports --endpoint, --session, --new, --block, --font, --font-size, --config and --window-size. Exact/ambiguous labels are checked; only explicit --new creates a session. REX_SERVER is the default endpoint override; launch flags are covered by focused tests. |
| Linux desktop installation/packages | Implemented | electron-builder configuration produces AppImage and Debian artifacts and desktop identity/icon metadata. Packaging verification is recorded separately from protocol tests. |
| Full terminal-protocol/graphics and accessibility parity | Partial | Live Sixel/iTerm2 images and bounded direct-transfer Kitty rendering supplement xterm text/Unicode output. Kitty supports raw gray/gray-alpha/RGB/RGBA/PNG, zlib/chunks, crop/place/delete, parent-relative chains, animation and Unicode virtual placeholders. File/shared-memory transports and complete image/text z-layer compositing are outside the supported subset. The upstream Ghostty snapshot format omits image data, so a new attachment cannot restore images emitted before it connected. Rex does not reserve Sixel cells; foreground/fullscreen emitters must manage cursor placement because shell redraws can overwrite those images. Accessibility evidence is recorded separately below. |

## Every documented client action

Registered actions are advertised in [`src/shared/actions.ts`](../src/shared/actions.ts), resolved by [`electron/features/client.ts`](../electron/features/client.ts), and dispatched by [`src/App.tsx`](../src/App.tsx) or native Electron handlers. Argumentless palette entries open forms/pickers where an action requires a target. Server-defined Lua actions are included from the negotiated keymap.

### Window

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.window.new` | Implemented | Creates a separate native client window. |
| `client.window.close` | Implemented | Closes the native window; tray preference can retain the client. |
| `client.window.fullscreen.toggle` | Implemented | Native fullscreen toggle. |
| `client.close` | Implemented | Closes focused pane, then tab, then native window when no tab exists. |

### App

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.palette.toggle` | Implemented | Search client/server actions and workspaces. |
| `client.settings` | Implemented | Appearance, terminal, notifications, hosts, agents, shortcuts and server preferences. |
| `client.diagnostics` | Implemented | Opens server/API/Tailscale diagnostics locally or through a remote client action. |
| `client.onboarding` | Implemented | Creates a persistent Rex tutorial block with a native Linux view, saved step/progress, appearance/shortcut/agent guidance and an explicit terminal-practice step. |
| `client.permissions` | Platform-specific | macOS system-permission onboarding is not applicable to this Linux client. |
| `client.visibility.toggle` | Implemented | Native show/hide, also available via a global shortcut. |
| `client.version.copy` | Implemented | Copies app/server version information. |
| `client.debug.copy` | Implemented | Copies client/system/connection report. |
| `client.pair_device` | Implemented | QR code contains the advertised HTTPS server address; the server’s existing identity/access checks apply. |
| `client.update.accept` | Implemented | Applies a verified Linux client package: atomically replaces/relaunches an AppImage, or opens a Debian package in the system installer. Source builds direct the user to packaged installation. |
| `client.update.accept_when_idle` | Implemented | Schedules the verified client update when local client activity becomes idle; cancelling clears the schedule. Rex server processes and sessions are not restarted by client updates. |
| `client.notice.dismiss` | Implemented | Dismisses current in-app notices. |
| `client.shortcuts.edit` | Implemented | Opens shortcut editor and Rex configuration access. |
| `client.agents.setup` | Implemented | Opens integration preview/setup/removal UI. |
| `client.server.restart` | Implemented | Reconstructs a local idle-process launch profile without rewriting its service unit. Stop/restart require Rex to atomically confirm zero sessions; existing sessions are refused. Remote or unidentifiable processes require their existing manager. This is not systemd-unit integration. |

### Session

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `session.new` | Implemented | Creates persistent session; optional label/cwd; configured startup command. |
| `session.switch` | Implemented | Cross-host searchable session picker. |
| `session.select` | Implemented | Exact ID or unambiguous label; rejects ambiguity. |
| `session.next` | Implemented | Cycles saved-host sessions. |
| `session.previous` | Implemented | Cycles saved-host sessions. |
| `session.rename` | Implemented | Shared server label. |
| `session.close` | Implemented | Confirmed destruction of that session only. |
| `session.refresh` | Implemented | Refreshes host/session/layout state. |
| `session.open_on_web` | Implemented | HTTP(S) web URL for selected session, including WS(S) endpoint conversion; local-only socket needs a remote web address. |
| `session.collapse` | Implemented | Collapses sidebar session tabs. |
| `session.expand` | Implemented | Expands sidebar session tabs. |
| `session.collapse_others` | Implemented | Collapses other sidebar sessions. |

### Host

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.host.switch` | Implemented | Saved-host selection or picker. |
| `client.host.add` | Implemented | Endpoint and optional gateway credential editor. |
| `client.host.remove` | Implemented | Forgets connection/credentials; leaves server programs intact. |

### Tab

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.tab.new` | Implemented | New server window within session. |
| `client.tab.close` | Implemented | Confirmed close of server window and its programs. |
| `client.tab.rename` | Implemented | Shared server label. |
| `client.tab.next` | Implemented | Navigates tabs in targeted session. |
| `client.tab.previous` | Implemented | Navigates tabs in targeted session. |
| `client.tab.goto` | Implemented | 1-based/negative index; palette asks for missing index. |
| `client.tab.move` | Implemented | Reorders within session by index; palette asks for index. |
| `client.tab.move.backward` | Implemented | Reorders one position. |
| `client.tab.move.forward` | Implemented | Reorders one position. |
| `client.tab.move_to_new_window` | Implemented | Opens the tab in a new native window, then selects another tab or an explicit empty host view in the original window. The server tab remains attachable. |

### Pane

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `pane.split` | Implemented | Creates shell in selected direction/ratio. |
| `pane.split.left` | Implemented | Left split. |
| `pane.split.right` | Implemented | Right split. |
| `pane.split.up` | Implemented | Upper split. |
| `pane.split.down` | Implemented | Lower split. |
| `pane.split.auto` | Implemented | Picks direction from pane aspect ratio. |
| `pane.focus` | Implemented | Block-ID target/picker. |
| `pane.focus.left` | Implemented | Nearest directional pane. |
| `pane.focus.right` | Implemented | Nearest directional pane. |
| `pane.focus.up` | Implemented | Nearest directional pane. |
| `pane.focus.down` | Implemented | Nearest directional pane. |
| `pane.focus_next` | Implemented | Cycles terminal panes. |
| `pane.focus_previous` | Implemented | Cycles terminal panes. |
| `pane.move` | Implemented | Destination block/direction form when absent. |
| `pane.move.left` | Implemented | Server layout move. |
| `pane.move.right` | Implemented | Server layout move. |
| `pane.move.up` | Implemented | Server layout move. |
| `pane.move.down` | Implemented | Server layout move. |
| `pane.float` | Implemented | Creates a draggable/resizable server floating layer. |
| `pane.minimize_floating` | Implemented | Minimizes selected floating layer; UI can restore it. |
| `pane.minimize_all_floating` | Implemented | Minimizes every floating layer in selected tab. |
| `pane.zoom` | Implemented | Server-backed zoom/restore. |
| `pane.close` | Implemented | Confirmed terminal destruction. |
| `pane.balance` | Implemented | Balances tiled splits. |
| `pane.resize` | Implemented | Drag any split divider, pass ratio/border arguments, or choose a border and percentage in the form. Borders nearest the targeted pane are offered first. |
| `pane.move_to_new_tab` | Implemented | Creates server tab containing the pane. |
| `pane.move_to_tab` | Implemented | Moves to selected tab ID in the same session. |
| `pane.go_to_directory` | Implemented | Server-side browser opens a new terminal tab in the chosen cwd. |
| `pane.insert_path` | Implemented | Server-side file browser inserts a shell-quoted path through paste. |
| `pane.copy_id` | Implemented | Copies block ID. |
| `pane.send_key` | Implemented | Physical key/modifier event; parameter form if omitted. |
| `client.key.forward` | Implemented | Forwards triggering physical key and sequence prefix through server key pipeline. |
| `client.prompt.previous` | Implemented | OSC 133 prompt-marker navigation in retained local scrollback. |
| `client.prompt.next` | Implemented | OSC 133 prompt-marker navigation in retained local scrollback. |

### Keys

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.mode.enter` | Implemented | Resolved keymap mode including blocked/exclusive/one-shot behavior. |
| `client.mode.exit` | Implemented | Leaves current mode. |
| `client.mode.exit_all` | Implemented | Clears all modes. |

### Find

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.find.open` | Implemented | Local terminal content search, regex/case options. |
| `client.find.next` | Implemented | Next search match. |
| `client.find.previous` | Implemented | Previous search match. |

### View

| Action name | Status | Behavior / limitation |
| --- | --- | --- |
| `client.font.increase` | Implemented | Increases terminal font, separate from interface zoom. |
| `client.font.decrease` | Implemented | Decreases terminal font. |
| `client.font.reset` | Implemented | Restores terminal font default. |
| `client.sidebar.toggle` | Implemented | Persisted collapse/restore. |
| `client.sidebar.activity.toggle` | Implemented | Activity filter/popup. |
| `client.sidebar.activity.by_session` | Implemented | Activity grouping by session. |
| `client.sidebar.activity.by_priority` | Implemented | Activity grouping by priority. |
| `client.sidebar.filter.focus` | Implemented | Shows sidebar if needed and focuses tab filter. |
| `client.tab_style.toggle` | Implemented | Cycles left/top/right placement. |
| `client.theme.change` | Implemented | Theme preference editor. |
| `client.theme.import` | Implemented | Ghostty or iTerm palette import. |
| `client.appearance.switch_mode` | Implemented | Switches light/dark palette. |
| `client.config.copy_path` | Implemented | Copies selected server config path. |
| `client.config.reload` | Implemented | Server reload plus keymap/layout refresh. |

Additional client commands include copy/paste, pane rename/swap, floating restore, terminal reset/clear, export, block creator discovery, and a non-terminal block inspector. Server actions and custom Lua commands remain available through the resolved palette/keymap.

## Every documented settings item

These rows describe observable behavior, not merely saved preference fields. Most preferences live in [`SettingsDialog`](../src/components/SettingsDialog.tsx) and [`types.ts`](../src/shared/types.ts); terminal consumers are in [`TerminalPane`](../src/terminal/TerminalPane.tsx) and [`themes.ts`](../src/terminal/themes.ts).

### Integrations / Coding Agents

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Integrate with available agents | Implemented | Preview/apply/remove for Claude Code, Codex, OpenCode and Pi; CLI optional outside this workflow. |

### Integrations / Agent Behavior

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Let agents name sessions | Implemented | Explicit naming choice included in every integration setup preview/apply. |

### Notifications / In-App Notifications

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Notification position | Implemented | Six positions: top/bottom aligned left, center or right. |

### Notifications / Program Activity

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Show activity in tabs | Implemented | Activity metadata and independent per-kind tab preferences apply to sidebar and top tabs. |
| Include idle processes in activity | Implemented | Activity popup and sidebar activity filter include idle entries when selected. |
| Show each process in tabs | Implemented | Activity list can show one row per process/pane rather than one row per tab. |
| Show system notifications | Implemented | Independent desktop notification switch; click selects the owning pane. |
| Badge Dock icon | Implemented | Linux app badge/title count where desktop supports it; native Dock behavior is platform-specific. |
| Play sounds | Implemented | Electron notification sound preference; subject to desktop notification service. |
| Working | Implemented | Whole-kind toggle plus independent tabs/desktop/badge/sound controls and consumers. |
| Blocked | Implemented | Whole-kind toggle plus independent tabs/desktop/badge/sound controls and consumers. |
| Error | Implemented | Whole-kind toggle plus independent tabs/desktop/badge/sound controls and consumers. |
| Done | Implemented | Whole-kind toggle plus independent tabs/desktop/badge/sound controls and consumers. |

### Notifications / System Notifications

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Terminal notifications | Implemented | OSC 9/777 program notification events. |
| Tailscale sign-in | Implemented | State-change observer, sign-in-needed notification and independent preference. |
| Tailscale device approval | Implemented | State-change observer, administrator-approval notification and independent preference. |
| Tailscale failures | Implemented | State/error observer, failure notification and independent preference. |

### Server / Rex Server

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Server status | Implemented | Diagnostics presents connection/version, start time, API range, session count, Tailscale and HTTPS state, plus copyable raw details. |
| Compatibility | Implemented | Negotiates APIs 7–10 and reports failures. Local runtime/profile/version/hash diagnostics and idle-only lifecycle controls are available; this app does not replace the externally installed server binary. |

### Server / Remote Address

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Remote Address | Implemented | HTTPS readiness/address display, manual refresh/copy and QR sharing; stale QR state is cleared before refresh. |

### Server / Tailscale

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Serve over Tailscale | Implemented | Confirmed local-Unix enable/disable calls; already-on enable applies access policy without restarting the node. |
| Preferred Hostname | Implemented | Enrollment hostname field and an explicit rename action; server validates the name. |
| Limit access to your Tailscale account | Implemented | Account-only versus allowed-tailnet-member policy maps to allow_tailnet_members. The installed API schema was checked read-only. |
| Tags | Implemented | Displays current device tags; optional advertised tags apply when enrollment starts. Tagged devices require tailnet-member policy. |
| Control Server | Implemented | Displays/edits the enrollment control URL, including Headscale; changing enrollment options follows server lifecycle rules. |
| Sign in to Tailscale | Implemented | Start/reopen sign-in, continue auth URL, cancel enrollment/sign out, and view account/state. Actions require local Unix transport; no account provisioning was exercised against the user’s existing server. |

### Server / Client Info

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Label | Implemented | Client label advertised to Rex for command-line targeting. |
| Remote Control | Implemented | Controls whether remote client.perform/call requests are accepted. |

### Interface / Appearance

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Color scheme | Implemented | System/light/dark appearance. |
| Interface style | Platform-specific | Native macOS Glass/Classic material choices are not reproduced by Electron Linux surfaces. |
| Tint with theme | Implemented | Independent interface-tint preference uses the active terminal palette for app surfaces and accents. |
| Use glass for panes | Platform-specific | No macOS Liquid Glass renderer. |

### Interface / Tabs

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Tab style | Implemented | Left/right sidebar and top tabs. |
| Fill available space | Implemented | Top tabs stretch to fill width. |
| Use color for tab icons | Implemented | Always, focused-pane, active-tab and never choices apply to sidebar/top icons. |
| Shell icon theme | Implemented | Default artwork, terminal-theme foreground/background and theme-accent shell artwork in sidebar and horizontal tabs. |
| Show tab icons | Implemented | Configurable 0–5 program icons in sidebar/top tabs. |

### Interface / Window

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Preserve width when resizing sidebar | Implemented | Preserve-window-width toggle keeps native width fixed; disabling it adjusts native window width to retain the terminal area. Width can be dragged or adjusted from Settings. |
| Use a gesture to toggle the sidebar | Implemented | Off/swipe/Alt-swipe choice. |

### Interface / Panes

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Pane style | Implemented | Comfortable/compact spacing. |
| Show pane headers | Implemented | Header visibility setting. |
| Match program backgrounds | Implemented | Samples terminal cell backgrounds and matches pane/header surfaces when a dominant full-screen program background is painted. |

### Interface / Pane Padding

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Padding X | Implemented | Horizontal terminal padding. |
| Padding Y | Implemented | Vertical terminal padding. |
| Padding color | Implemented | Choose pane background or extend terminal edge-cell backgrounds into padding. |

### Interface / Active Pane

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Highlight active pane edges | Implemented | Focused-pane border. |
| Highlight color | Implemented | Custom highlight color. |
| Highlight opacity | Implemented | Highlight strength. |
| Animate active pane highlight | Implemented | Fade, move and instant modes; the highlight follows pane geometry and respects reduced-motion preferences. |
| Fade inactive panes | Implemented | Independently select content, surfaces or both and set the fade amount; zero disables fading. |
| Fade panes for inactive windows | Implemented | Independent terminal-content opacity follows native window focus, alongside the inactive-pane preference. |

### Interface / Splits & Focus

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Autobalance splits | Implemented | Server balancing after this client creates/closes panes. |
| Focus follows mouse | Implemented | Pointer-driven focus. |

### Interface / Gestures

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Use trackpad gestures | Implemented | Directional pinch zoom/restore and sidebar swipe use an accumulated, single-action gesture latch rather than repeatedly toggling per wheel event. Physical device/compositor validation remains separate. |

### Interface / Animation

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Animation style | Implemented | Snappy/natural/off CSS timing; reduced motion respected. |

### Interface / App Icon

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| App Icon | Platform-specific | Uses this project’s Linux icon; no upstream Dynamic/Bright/Twilight artwork switching. |
| Show app icon | Platform-specific | Linux tray visibility follows launch/close preferences; macOS Dock/menu-bar visibility variants do not apply. |

### Interface / Launch

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Show window on launch | Implemented | Hidden launch with tray access when disabled. |

### Themes / Light Mode

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Light theme | Implemented | Built-in palette or a selected named Ghostty/iTerm theme for light appearance. The shared library supports import, save-current, rename and delete; legacy imports migrate without losing colors. |
| Use extended theme palette | Implemented | Independent light/dark preferences apply imported colors16–255 or restore the standard xterm cube; both renderer and server theme are synchronized. |

### Themes / Dark Mode

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Dark theme | Implemented | Built-in palette or a selected named Ghostty/iTerm theme for dark appearance, independently selected from up to 64 saved named themes. |
| Use extended theme palette | Implemented | Independent light/dark preferences apply imported colors16–255 or restore the standard xterm cube; both renderer and server theme are synchronized. |

### Themes / Import Theme

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Import Theme | Implemented | Ghostty key/value and iTerm plist import, including extended palette entries, into the named theme library. |

### Terminal / Typography

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Terminal font | Implemented | Installed-font/face browser through scoped browser local-font permission, editable ordered fallback stack, and preview. Manual family entry remains available when enumeration is unavailable. |
| Font size | Implemented | 8–48px preference and font actions. |
| Font style | Implemented | Select an installed face to derive its family, style and weight, or choose regular/italic/oblique and a numeric weight directly. |
| Font weight | Implemented | Normal/bold numeric weights applied to terminal. |

### Terminal / Advanced Font Settings

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Character spacing | Implemented | Pixel letter spacing. |
| Line height | Implemented | Terminal line height. |
| Ligatures | Implemented | xterm ligature addon; actual Chromium glyph-pixel on/off test passed using browser fallback ligatures without Node integration. Full font ligature tables use browser local-font access when available. |
| Bold and italic | Implemented | Separate always/only-real-font-face/never policies govern bold and italic rendering and synthetic-face use. |
| Font smoothing | Implemented | Renderer font smoothing preference. |
| Fallback fonts | Implemented | Ordered CSS font-family list. |

### Terminal / Colors

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Improve text contrast | Implemented | xterm minimum contrast ratio. |
| Force theme palette for text | Implemented | Renderer RGB colors map to the nearest theme colors with the selected contrast preference. Original terminal data is retained for reversible setting changes. |
| Use Display P3 color space | Implemented | Capability-gated CSS Display P3 text/cursor/selection rendering; unavailable displays/runtimes retain sRGB output. Inline-image canvases retain their decoder color space. |

### Terminal / Cursor

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Blink speed | Implemented | Blink on/off plus editable millisecond interval. |
| Blink interval | Implemented | 100–2000ms cursor animation interval. |
| Cursor style | Implemented | Block/bar/underline. |
| Force style | Implemented | Intercepts application DECSCUSR shape override. |

### Terminal / Keyboard

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Show key sequence hints | Implemented | Resolved prefix/mode next-key hint strip. |
| Option key | Platform-specific | Linux Alt/AltGr physical/layout input is supported; no macOS Option-as-Alt selector. |

### Terminal / Scrolling

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Smooth scrolling | Implemented | Configurable xterm smooth scroll duration. |

### Terminal / Resizing

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Smooth terminal resizing | Implemented | Optional smooth viewport fitting with bounded/debounced server size updates and foreground ownership. |

### Terminal / Selection

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Copy on selection | Implemented | Automatic selection copy. |
| Play animation on copy | Implemented | Optional copy-shine animation on the selected terminal content. |
| Selection foreground | Implemented | Custom selection text color. |
| Selection background | Implemented | Custom selection fill. |
| Rounded corners | Implemented | Optional rounded terminal selection geometry. |

### Terminal / Links

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Links that open apps | Implemented | Ask/always/never policy for allowlisted app protocols, enforced by native IPC. OSC 8 and plain application URI providers route through the same policy, independently of the web-link switch. |
| Trusted links | Implemented | Ask prompts offer a remembered app target; trusted targets can be reviewed and removed in Settings. Unsupported/file/script protocols are rejected. |

### Terminal / Integrated Path Browser

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Show recently used paths | Implemented | Per-host history shared by sessions in remote path browser. |

### Terminal / Titles

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Prefer generated titles | Implemented | Program and cwd title rather than OSC shell title; explicit tab labels take precedence. |

### Terminal / Shell

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Startup command | Implemented | Executable/argument parsing without unintended expansion. Each host explicitly chooses inherited local default, server login shell, or a custom command for new session/tab/split terminals. |

### Remote Hosts / Remote hosts

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Remote hosts | Implemented | Add/edit/remove saved endpoint and label, connection status/retry, encrypted optional gateway credentials. Forgetting a host does not alter its server sessions. |
### Developer / Developer Mode

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Developer Mode | Implemented | Reveals native developer tools in packaged builds. Upstream Mac server-installation/update/experiment panels remain outside this client’s scope. |

### Developer / Experimental

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Download new updates when available | Implemented | Opt-in Linux client release checks/downloads from this project's GitHub releases, with bounded package downloads and mandatory SHA-256 manifest verification. No release is published by the client. |
| Install updates automatically | Implemented | Opt-in idle application of a verified AppImage; Debian packages open the system installer, which retains its normal authorization/installation flow. |
| Cursor shaders | Implemented | Linux canvas cursor-effect presets Off/Warp/Comet/Blaze provide trails without executing arbitrary upstream Metal shader files. |
| Group Activity by priority | Implemented | Activity drawer/palette support session or priority grouping. |

### Developer / App Version

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Update Channel | Platform-specific | No Preview/Bleeding Edge upstream Mac release channel selector. |

### Developer / Rex Installation

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Location | Platform-specific | Client attaches to an externally installed Rex; it does not select a bundled/source server runtime. |
| Source Directory | Platform-specific | No managed server source checkout/build selector. |
| Installation status | Platform-specific | No bundled-server install manager; connection/compatibility status is shown instead. |
| Version | Implemented | Connected server version and installed client version appear in diagnostics; local runtime details show the discovered executable/profile. |
| Commit | Implemented | The connected Rex version identifies its source revision when supplied by the server. No separate bundled server is distributed. |
| Final SHA-256 | Implemented | Local runtime diagnostics compute the discovered Rex executable SHA-256. Unavailable/remote binaries are explicitly marked unavailable. |

### Developer / Local API

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Local API URL | Implemented | Discovered/connected endpoint in diagnostics. |

### Developer / Web Client Origins

| Documented setting | Status | Behavior / limitation |
| --- | --- | --- |
| Allowed origins | Implemented | Dedicated local-server controls list active/pending WebSocket origin patterns and let the user add/remove them. Changes wait for an idle restart; unrelated launch arguments are preserved. |
| Origin pattern | Implemented | Validated browser origin/host patterns are saved per host, can be discarded, and are applied only during an idle local restart. |

## Remaining platform and protocol distinctions

- **Server safety and distribution:** Linux controls reconstruct a local idle-process launch profile and refuse stop/restart while any sessions exist. They do not rewrite systemd units or create boot-time drop-ins. Pending origin changes apply when this client starts/restarts the endpoint, not to an external unit’s next boot. Remote or unidentifiable processes stay with their existing manager. This client does not bundle, download or build a separate Rex server distribution, and does not replicate upstream Mac Preview/Bleeding Edge release channels.
- **Terminal image protocol:** live Sixel/iTerm2 and direct Kitty transfers are supported within explicit memory limits. Kitty includes parent-relative placement chains (depth 32), animation (up to 64 frames within 64 MiB), and canonical Unicode virtual placeholders. File/shared-memory transports and full image/text z-layer composition remain outside the implemented subset. Copying protocol placeholder cells can include client placement metadata; ordinary terminal text is unchanged. Upstream Ghostty snapshots omit image data; a fresh client attachment cannot reconstruct older images from the snapshot alone. Rex does not reserve Sixel cells, so foreground/fullscreen emitters must manage their cursor placement; returning to a shell redraw can overwrite them.
- **Plugin extensibility:** the known onboarding creator has a native interactive Linux view. Unknown future block plugins retain a method inspector until a corresponding renderer is supplied.
- **Platform differences:** macOS system permissions, Glass materials, Dock artwork/visibility and Metal shader files are not Linux APIs. Linux tray/window integration and canvas cursor effects supply the applicable behavior.
- **Validation limits:** physical-device/compositor coverage and packaging/runtime evidence are stated below; passing automated tests is not a claim that every desktop environment has been manually tested.

## Validation boundary

Current 0.3 source verification passed **90/90 automated tests, zero failures and zero skips**, with installed-Rex integration and browser tests enabled. New native Electron fixtures passed for Linux services/persisted tutorial progress, actual installed-Rex live graphics, and accessibility. The accessibility fixture scanned **15 views with zero axe violations** and verified terminal input/output through both Chromium and native AT-SPI (**235 owned nodes**). Automated incomplete/manual-review results are retained in the accessibility report, including contrast indeterminacy for gradient-selected tabs and terminal text overlapped by image/cursor canvases. No accessibility rules are disabled. This is not a claim of universal WCAG or compositor conformance.

The updater's check/download/checksum/replacement/idle behavior is exercised with controlled release fixtures. This repository has no published stable update in the real feed yet; no workflow publication or live self-update is claimed. The actual 0.3 AppImage passed all five native fixtures: smoke, actions, Linux services/tutorial, installed-Rex graphics and accessibility. The accessibility fixture was repeated successfully against the final package after the last semantics-only window-control grouping fix. Debian package metadata was verified, and its extracted payload passed the real services/tutorial fixture with a foreign inherited APPIMAGE variable; no system-wide Debian installation is claimed.

Protocol evidence is separate from source-level feature inventory. The opt-in installed-Rex tests create isolated sessions, remember the returned IDs, and remove only those sessions. They do not restart/reconfigure the installed server or mutate the user’s four existing sessions. The final preservation check found all four original session/window/block identities intact, four total sessions and zero temporary sessions. Lifecycle tests use a separate server with their own temporary socket, configuration and state directory.

| Evidence | Coverage |
| --- | --- |
| `tests/rex.test.ts` and `tests/rex.stream.test.ts` | Mock negotiation/control requests; CRC/snapshot framing; metadata nonce boundaries; UTF-8 continuation; account subprotocol; aliases/fallback; gateway credential handling; explicit TLS behavior. |
| `REX_INTEGRATION=1 npx tsx --test tests/rex.integration.test.ts` | Passed against installed `0.0.1793645657-gd018d2`: terminal input/output, size/layout mutations, primary/alternate snapshot, ordered streaming and resume without reset; explicit API 8 and no `rex` on PATH. |
| Canonical WASM inside Electron ASAR | Imported and loaded decoder from a packed ASAR using Electron’s Node runtime; snapshot encode/decode succeeded. |
| Installed Rex palette probe | Setting only palette index 1 after a custom index 200 resets index 200 to its built-in color, as verified by program OSC 4 query responses. Extended-palette disable is verified against authoritative server state. |
| Installed Rex Unicode cursor probe | Isolated Python raw-mode DSR probe: `A🦕B` and `A🫠B` end at column 5; `A👩‍💻B` ends at column 7; `AéB` ends at column 4 on the tested server. Client Unicode-width selection is checked against server behavior, not assumed from ideal grapheme width. |
| Feature/keymap/activity/launch tests | See `tests/features*.test.ts`, `tests/workspace.test.ts`, `tests/terminal.*.test.ts` for focused behavior, validated launch arguments/selection, and optional real-server native-client action tests. |
| Source Electron fixtures | The Linux services/tutorial, installed-Rex graphics and native accessibility fixtures passed on the 0.3 source build. Standard smoke/action workflows are covered by the previous source run and repeated against the final package. |
| Native accessibility | `tests/electron.accessibility.ts`: 15 WCAG A/AA, WCAG 2.1 AA and best-practice axe scans with zero violations; keyboard trapping/restoration; directory Arrow/Home/End/Enter navigation; named-theme semantics; Chromium AX terminal input/output; native AT-SPI input/output on 235 owned nodes. Incomplete/manual-review checks are retained rather than disabled. |
| Linux lifecycle/origins | Isolated installed-Rex server verifies atomic idle shutdown/restart, profile preservation and actual allowed/denied WebSocket origins. Existing-session stop/restart refusal is tested; the user’s installed server is not stopped. |
| Linux updates/releases | Bounded fixed-repository release selection, SHA-256 validation, atomic AppImage replacement/backup and idle scheduling are tested with controlled fixtures. The publishing workflow passes actionlint/shell checks; no release or live update is claimed. |
| Packaged AppImage verification | All five fixtures passed against the actual 0.3.0 AppImage and installed Rex; accessibility was repeated after the final semantics-only grouping change: `electron.smoke.ts`, `electron.actions.ts`, `electron.services.ts`, `electron.graphics.ts`, and `electron.accessibility.ts`. This covers CLI/typing/search/layout/session persistence, reverse/multiwindow actions, services/tutorial/update classification, real image pixels/live-tab ownership, keyboard/contrast/AX/native-AT-SPI checks. |
| Debian package verification | The 0.3.0 amd64 package built successfully; `dpkg-deb` version, architecture and dependencies were verified. Its extracted payload passed the services/tutorial fixture while correctly ignoring a foreign inherited APPIMAGE variable. No system-wide installation is claimed. Physical trackpad/compositor combinations and a human screen-reader conformance review remain outside these checks. |

This inventory accounts for 98 action rows and 108 tabulated setting rows from the official references, plus the prose-only theme-import/remote-host entries and the example-specific features above.
