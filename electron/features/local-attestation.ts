import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

export interface LocalRexIdentity {
  pid: number;
  uid: number;
  executable: string;
  socketPath: string;
  socketInode: string;
}

/** A reported PID alone is insufficient: a Unix SSH proxy can forward server.status. */
export async function attestLocalRex(
  endpoint: string,
  pid: number,
  procRoot = "/proc",
): Promise<LocalRexIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error("Rex did not report a valid local process.");
  let socketPath: string;
  try {
    socketPath = endpoint.startsWith("unix://")
      ? decodeURIComponent(endpoint.slice(7))
      : endpoint;
  } catch {
    throw new Error("Invalid local Unix socket path.");
  }
  if (!isAbsolute(socketPath) || /[\x00-\x1f\x7f]/.test(socketPath))
    throw new Error(
      "This operation requires a direct local filesystem Unix socket.",
    );
  socketPath = await realpath(socketPath);
  const socket = await stat(socketPath),
    uid = process.getuid?.();
  if (uid === undefined || !socket.isSocket() || socket.uid !== uid)
    throw new Error("The local Rex socket must belong to your desktop user.");
  const processDirectory = join(procRoot, String(pid));
  if ((await stat(processDirectory)).uid !== uid)
    throw new Error("The Rex process belongs to another user.");
  const executable = await readlink(join(processDirectory, "exe"));
  if (
    !/^rex(?:[-.].*)?$/.test(basename(executable.replace(/ \(deleted\)$/, "")))
  )
    throw new Error("The connected process is not Rex.");
  const command = (
    await readFile(join(processDirectory, "cmdline"), "utf8")
  ).split("\0");
  if (command[1] !== "server" || command[2] !== "run")
    throw new Error("The socket is not served by a Rex server process.");
  const [serverNamespace, desktopNamespace] = await Promise.all([
    readlink(join(processDirectory, "ns/mnt")),
    readlink(join(procRoot, "self/ns/mnt")),
  ]);
  if (serverNamespace !== desktopNamespace)
    throw new Error(
      "Rex uses another filesystem namespace; manage it within that environment.",
    );
  const table = await readFile(join(procRoot, "net/unix"), "utf8");
  const candidates = new Set<string>();
  for (const line of table.split("\n")) {
    const fields =
      /^\S+:\s+\S+\s+\S+\s+(\S+)\s+(\S+)\s+\S+\s+(\d+)(?:\s+(.*))?$/.exec(
        line.trim(),
      );
    if (
      !fields ||
      fields[1] !== "00010000" ||
      fields[2] !== "0001" ||
      !fields[4]
    )
      continue;
    const path = await realpath(fields[4]).catch(() => fields[4]);
    if (path === socketPath) candidates.add(fields[3]);
  }
  if (!candidates.size)
    throw new Error("The local Rex listening socket could not be attested.");
  for (const fd of await readdir(join(processDirectory, "fd"))) {
    const target = await readlink(join(processDirectory, "fd", fd)).catch(
      () => undefined,
    );
    const match = target && /^socket:\[(\d+)\]$/.exec(target);
    if (match && candidates.has(match[1]))
      return { pid, uid, executable, socketPath, socketInode: match[1] };
  }
  throw new Error(
    "The endpoint is a proxy or is not owned by the reported Rex process. Manage the server at its actual local endpoint.",
  );
}
