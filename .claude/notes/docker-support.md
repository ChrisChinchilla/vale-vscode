# Running Vale via Docker

Fixes [issue #72](https://github.com/ChrisChinchilla/vale-vscode/issues/72):
support using this extension against a Vale Docker image instead of a local
`vale` install (`src/docker.ts`, `vale.docker.*` settings).

## Why containerize only `vale`, not `vale-ls`

vale-ls itself keeps running locally - it's a small Go binary the extension
already auto-downloads and verifies (see `vale-ls-releases.md`), so there's
no user-facing install step for it either way. Two things ruled out running
`vale-ls` itself inside a container (`docker run -i <image>` as the LSP
server's spawned command):

- There's no known official `vale-ls` Docker image to base that on.
- The LSP protocol carries host-absolute file paths in every request/
  response. Running the whole server in a container means translating every
  one of those paths across the host/container boundary. Running only
  `vale` in a container means only *its* invocation needs a path strategy.

Instead, this uses a mechanism vale-ls already has: its `valeBinaryPath`
initialization option, documented at `docs.vale.sh/guides/lsp` as of
vale-ls v0.5.0 (the version this extension bundles per `LSP_TAG` in
`src/utils.ts`), lets you point it at any executable instead of a
managed/`$PATH` copy. Docker mode generates a small wrapper script and
points `valeBinaryPath` at that.

This is also what exposed a pre-existing bug: the `vale.valeCLI.path`
setting (for manually pointing at your own non-Docker `vale` install) was
already documented and present in `package.json`, but `src/config.ts`'s
`buildValeConfig` never actually sent `valeBinaryPath` in
`initializationOptions` at all, and `vale.valeCLI.path` was missing from
`VALE_CONFIG_SETTINGS` in `src/languageServer.ts` (so even editing it
wouldn't have restarted the client). Both are fixed as part of this work,
independent of Docker mode - `vale.valeCLI.path` now works.

## Mount strategy: identical host/container path

The wrapper script mounts the workspace folder onto the *identical* path
inside the container (`-v <root>:<root> -w <root>`), rather than a fixed
container path like `/docs`. This means no path-translation logic is needed
anywhere else in the extension: vale-ls and the rest of the codebase
already pass host-absolute paths around end-to-end (see
`resolveConfigPath` in `src/utils.ts`, and the `cwd: workspaceRoot` fix in
`src/languageServer.ts` for `.vale.ini` glob sections) - this mount
strategy keeps that assumption true for Docker too.

`vale.docker.extraArgs` exists mainly so a `StylesPath` that lives outside
the workspace can still be mounted in (e.g. `-v /some/styles:/some/styles`),
or so a custom image's entrypoint can be overridden (`--entrypoint=vale`) -
see the note below on image entrypoints.

## No `vale` command is added to the container's argv

`buildDockerRunArgs`/`buildDockerWrapperScript` pass vale's own arguments
(`ls-config`, `sync`, a filename, ...) directly after the image name, with
no literal `"vale"` prepended. This was verified against a real pull of the
default `jdkato/vale` image: `docker inspect jdkato/vale` shows
`ENTRYPOINT ["/bin/vale"]`, so the image already *is* vale - `docker run
jdkato/vale vale ls-config` makes Vale see the extra `"vale"` as an
unwanted first positional argument and misparse the actual subcommand
after it (confirmed live: this produced `argument 'ls-config' does not
exist` before the fix). A custom image without that entrypoint convention
needs `--entrypoint=vale` (or equivalent) added via `vale.docker.extraArgs`.

## Why the wrapper script is per-workspace-folder, not shared

Each workspace folder runs its own `LanguageClient`/`vale-ls` process
(`clientKeyFor` in `src/workspaceFolders.ts`, one client per folder - see
`multi-root-workspaces.md`). If every folder's Docker mode pointed at one
shared wrapper-script filename, whichever folder's client last
started/restarted would silently overwrite the file the *other* folder's
already-running vale-ls invokes on every lint - a live cross-folder
correctness bug, in the same class of problem `multi-root-workspaces.md`
already had to fix once for settings resolution.

`src/docker.ts`'s `ensureDockerWrapperScript` names the script
`vale-docker-wrapper-<sha256Hex(folder.uri.toString()).slice(0, 16)>`
on macOS and Linux, stored alongside the vale-ls binary in
`getInstallDir(context)` (`src/languageServer.ts`). Windows uses the native
proxy below and isolates per-folder configuration through each vale-ls
process's environment instead of per-folder executables.

## Windows proxy

vale-ls spawns `valeBinaryPath` directly, without a shell, so Windows can't
use the POSIX wrapper or a `.cmd`/`.bat` equivalent. The extension instead
ships native x64 and ARM64 `vale-docker-proxy.exe` binaries built from
`native/vale-docker-proxy`. Each per-folder vale-ls process receives its
image, root, and extra arguments through `VALE_DOCKER_PROXY_CONFIG`; direct
commands launch the same proxy with the same environment.

The default image is Linux-based, so the proxy mounts the Windows workspace
at `/workspace`. It translates Windows paths in Vale arguments to container
paths, mounts absolute arguments outside the workspace separately (including
vale-ls temporary files), and recursively translates paths in JSON output
back to their Windows form. The proxy uses `os/exec` directly and never
passes settings or filenames through a command shell.
