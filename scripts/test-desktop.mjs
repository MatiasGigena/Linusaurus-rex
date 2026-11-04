import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = [
  "smoke",
  "boundary",
  "actions",
  "services",
  "graphics",
  "layers",
  "systemd",
  "accessibility",
  "update-live",
];
const arguments_ = process.argv.slice(2);
const isolatedRex = arguments_[0] === "--isolated-rex";
const names = arguments_.slice(isolatedRex ? 1 : 0);
const usage = `Usage: node scripts/test-desktop.mjs [--isolated-rex] ${fixtures.join("|")} [fixture ...]`;
if (names.length === 1 && names[0] === "--help") {
  console.log(usage);
  process.exit(0);
}
if (!names.length || names.some((name) => !fixtures.includes(name))) {
  console.error(`${usage}\nChoose one or more named desktop fixtures.`);
  process.exit(1);
}
if (
  process.platform !== "linux" ||
  (process.env.XVFB && !isAbsolute(process.env.XVFB))
) {
  console.error(
    "Desktop tests require Linux; XVFB, when set, must be an absolute executable path.",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const owned = new Map();
let interrupted = false;
let directory;
let server;
let rexServer;
let active;

// Playwright can create a separate process group for Electron. Record only
// descendants of our children, including their start times to reject reused PIDs.
async function remember(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const identity = { group: Number(fields[2]), started: fields[19] };
    owned.set(pid, identity);
    const children = await readFile(
      `/proc/${pid}/task/${pid}/children`,
      "utf8",
    );
    await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((child) => remember(Number(child))),
    );
  } catch {
    /* A child may have exited between proc reads. */
  }
}

async function signalOwned(signal) {
  const groups = new Set();
  for (const [pid, identity] of owned) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (
        fields[19] === identity.started &&
        Number(fields[2]) === identity.group
      )
        groups.add(identity.group);
    } catch {
      /* Already gone. */
    }
  }
  for (const group of groups) {
    // Children start detached; an inherited unrelated group is never signalled.
    if (group !== process.pid && owned.has(group)) {
      try {
        process.kill(-group, signal);
      } catch {
        /* Already gone. */
      }
    }
  }
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = true;
    process.exitCode =
      signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
    void Promise.all([
      active && remember(active.pid),
      server && remember(server.pid),
      rexServer && remember(rexServer.pid),
    ]).then(() => signalOwned("SIGTERM"));
  });
}

function exited(child, label) {
  return new Promise((resolveExit, reject) => {
    child.once("error", (error) =>
      reject(
        new Error(`${label} could not start: ${error.code || error.message}`),
      ),
    );
    child.once("exit", (code, signal) =>
      code === 0
        ? resolveExit()
        : reject(new Error(`${label} failed (${signal || `exit ${code}`}).`)),
    );
  });
}

async function authorize(auth, display, cookie) {
  const child = spawn(
    "xauth",
    ["-f", auth, "add", display, "MIT-MAGIC-COOKIE-1", cookie],
    { stdio: "ignore", detached: true },
  );
  const completion = exited(child, "xauth (install xauth alongside Xvfb)");
  void completion.catch(() => {});
  await remember(child.pid);
  await completion;
}

let watcher;
try {
  directory = await mkdtemp(join(tmpdir(), "linusaurus-desktop-"));
  const auth = join(directory, "Xauthority");
  await writeFile(auth, "", { mode: 0o600 });
  const cookie = randomBytes(16).toString("hex");
  // The server reads the protocol/cookie independently of its chosen display.
  await authorize(auth, ":65535", cookie);
  server = spawn(
    process.env.XVFB || "Xvfb",
    [
      "-displayfd",
      "3",
      "-screen",
      "0",
      "1600x1000x24",
      "-nolisten",
      "tcp",
      "-auth",
      auth,
    ],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let serverLog = "";
  server.stderr.on("data", (bytes) => {
    serverLog = (serverLog + bytes).slice(-8000);
  });
  const ready = new Promise((resolveDisplay, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Private Xvfb display did not become ready within 10 seconds.",
          ),
        ),
      10000,
    );
    const fail = (message) => {
      clearTimeout(timer);
      reject(new Error(message));
    };
    let output = "";
    server.once("error", (error) =>
      fail(
        `Xvfb is required for desktop tests (${error.code || error.message}). Install xvfb or set XVFB to its absolute executable path; tests never fall back to your desktop.`,
      ),
    );
    server.once("exit", () =>
      fail(`Private Xvfb stopped. ${serverLog.trim()}`),
    );
    server.stdio[3].on("data", (bytes) => {
      output += bytes;
      if (/^\d+\n$/.test(output)) {
        clearTimeout(timer);
        resolveDisplay(`:${output.trim()}`);
      }
    });
  });
  void ready.catch(() => {});
  await remember(server.pid);
  const display = await ready;
  const stopped = new Promise((_, reject) => {
    server.once("exit", () =>
      reject(
        new Error("The private Xvfb server stopped during a desktop fixture."),
      ),
    );
  });
  void stopped.catch(() => {});
  await authorize(auth, display, cookie);
  const environment = {
    ...process.env,
    DISPLAY: display,
    XAUTHORITY: auth,
    XDG_SESSION_TYPE: "x11",
    GDK_BACKEND: "x11",
    QT_QPA_PLATFORM: "xcb",
    SDL_VIDEODRIVER: "x11",
    ELECTRON_OZONE_PLATFORM_HINT: "x11",
  };
  delete environment.WAYLAND_DISPLAY;
  delete environment.WAYLAND_SOCKET;
  let rexStopped;
  if (isolatedRex) {
    const runtime = join(directory, "runtime");
    await mkdir(join(runtime, "rex"), { recursive: true, mode: 0o700 });
    environment.XDG_RUNTIME_DIR = runtime;
    const socket = join(runtime, "rex", "server.sock");
    environment.REX_SERVER = `unix://${socket}`;
    const config = join(directory, "rex.lua");
    await writeFile(config, "", { mode: 0o600 });
    rexServer = spawn(
      process.env.REX_EXECUTABLE || "rex",
      [
        "server",
        "run",
        "--listen",
        environment.REX_SERVER,
        "--restore=false",
        "--state-dir",
        join(directory, "rex-state"),
        "--config",
        config,
      ],
      { env: environment, stdio: ["ignore", "ignore", "pipe"], detached: true },
    );
    let rexLog = "",
      rexFailure;
    rexServer.stderr.on("data", (bytes) => {
      rexLog = (rexLog + bytes).slice(-8000);
    });
    rexStopped = new Promise((_, reject) => {
      rexServer.once("error", (error) => {
        rexFailure = new Error(`Private Rex could not start: ${error.message}`);
        reject(rexFailure);
      });
      rexServer.once("exit", (code, signal) => {
        rexFailure = new Error(
          `Private Rex stopped (${signal || code}). ${rexLog.trim()}`,
        );
        reject(rexFailure);
      });
    });
    void rexStopped.catch(() => {});
    await remember(rexServer.pid);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (rexFailure) throw rexFailure;
      if (
        await stat(socket).then(
          (value) => value.isSocket(),
          () => false,
        )
      ) {
        ready = true;
        break;
      }
      await delay(50);
    }
    if (!ready)
      throw new Error(`Private Rex did not become ready. ${rexLog.trim()}`);
    console.log(
      "Desktop fixtures use a temporary Rex server with persistence disabled.",
    );
  }
  // D-Bus remains the user's bus for owned systemd and AT-SPI verification.
  console.log(
    `Desktop fixtures use an authenticated private display ${display}.`,
  );
  watcher = setInterval(() => {
    if (active?.pid) void remember(active.pid);
  }, 100);
  for (const name of names) {
    if (interrupted) break;
    console.log(`RUN desktop:${name}`);
    active = spawn(
      process.execPath,
      [tsx, join(root, `tests/electron.${name}.ts`)],
      { cwd: root, env: environment, stdio: "inherit", detached: true },
    );
    const completion = exited(active, `desktop:${name}`);
    void completion.catch(() => {});
    await remember(active.pid);
    await Promise.race([
      completion,
      stopped,
      ...(rexStopped ? [rexStopped] : []),
    ]);
    active = undefined;
    console.log(`PASS desktop:${name}`);
  }
} catch (error) {
  console.error(error.message);
  if (!process.exitCode) process.exitCode = 1;
} finally {
  clearInterval(watcher);
  if (active?.pid) await remember(active.pid);
  if (server?.pid) await remember(server.pid);
  if (rexServer?.pid) await remember(rexServer.pid);
  await signalOwned("SIGTERM");
  await delay(250);
  await signalOwned("SIGKILL");
  if (directory) await rm(directory, { recursive: true, force: true });
}
