export interface PackageRecord {
  name: string;
  size: number;
  sha256: string;
}
export interface ReleaseAsset {
  name: string;
  size: number;
  digest?: string;
  state?: string;
  id?: number;
}
export interface ReleaseMetadata {
  tag_name: string;
  draft: boolean;
  body?: string;
  assets: ReleaseAsset[];
  html_url?: string;
}
export function digest(path: string): Promise<string>;
export function packages(directory: string): Promise<PackageRecord[]>;
export function writeChecksums(directory: string): Promise<PackageRecord[]>;
export function prepareRelease(
  directory: string,
  tag: string,
): Promise<PackageRecord[]>;
export function ownershipMarker(tag: string, sha: string): string;
export function assertOwnedDraft(
  release: ReleaseMetadata,
  tag: string,
  sha: string,
): void;
export function verifyReleaseAssets(
  release: ReleaseMetadata,
  manifest: string,
  records: PackageRecord[],
): true;
export function publishRelease(options: {
  directory: string;
  tag: string;
  sha: string;
  gh?: (args: string[]) => Promise<string>;
}): Promise<string | undefined>;
