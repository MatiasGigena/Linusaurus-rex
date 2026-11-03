import { basename, isAbsolute, join, relative, resolve } from "node:path";

export interface AppImageIdentity {
  appImage?: string;
  appDir?: string;
  execPath: string;
  appPath?: string;
  development?: boolean;
}
const contained = (directory: string, path: string) => {
  const child = relative(directory, path);
  return (
    child !== "" &&
    !isAbsolute(child) &&
    child !== ".." &&
    !child.startsWith("../")
  );
};

/** Pure identity check. Callers canonicalize filesystem paths before passing them. */
export function resolveCurrentAppImage(
  identity: AppImageIdentity,
): string | undefined {
  if (identity.development || !identity.appImage || !identity.appDir) return;
  const values = [
    identity.appImage,
    identity.appDir,
    identity.execPath,
    ...(identity.appPath ? [identity.appPath] : []),
  ];
  if (values.some((value) => !isAbsolute(value))) return;
  const directory = resolve(identity.appDir),
    executable = resolve(identity.execPath),
    image = resolve(identity.appImage);
  if (
    basename(executable) !== "linusaurus-rex" ||
    !contained(directory, executable)
  )
    return;
  if (
    identity.appPath &&
    resolve(identity.appPath) !== join(directory, "resources", "app.asar")
  )
    return;
  // APPIMAGE is the persistent outer file, never a file in the temporary mount.
  if (image === directory || contained(directory, image)) return;
  return image;
}
