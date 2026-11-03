# Linux release procedure

The fixed update feed is the latest stable release in `MatiasGigena/Linusaurus-rex`. The workflow accepts a pushed `vX.Y.Z` tag or a manual dispatch for an existing tag; the tag must match `package.json` and the checked-out commit. A release is x86-64 only unless another architecture is explicitly added and tested.

The workflow tests and builds the AppImage and Debian package. Before generating `SHA256SUMS`, `scripts/release-assets.mjs` renames the AppImage to an ASCII filename such as `Linusaurus-Rex-0.4.0-x86_64.AppImage`. This avoids GitHub changing space-containing filenames after upload. Version 0.3.0 uses the earlier published name `Linusaurus.Rex-0.3.0.AppImage`; its corrected manifest uses that actual name.

Uploads remain in a draft until the helper verifies GitHub's actual asset names, sizes and SHA-256 digests, and downloads the uploaded checksum manifest to prove it matches both packages. Only then is the draft published as latest.

An interrupted job can resume its own draft, identified by an ownership marker bound to the exact tag and commit. It reuses already completed, digest-verified uploads, uploads missing files, and removes only failed empty `starter` uploads. It does not clobber completed assets. Published releases and drafts without the matching ownership marker are refused. If an unrelated draft or an inconsistent completed manifest exists, inspect it manually rather than replacing published downloads.

Local checks:

```bash
npx tsx --test tests/release-assets.test.ts
```

The optional `PUBLISHED_RELEASE_DIR` test reads public version 0.3.0 API metadata and verifies the corrected manifest against downloaded packages in that directory. Unit tests use an injected GitHub command runner, so they cannot publish anything. The workflow also requires `actionlint` and shell syntax validation when changed.

The GitHub Actions token is repository-scoped, checkout credentials are not persisted, and the workflow does not require a personal access token.
