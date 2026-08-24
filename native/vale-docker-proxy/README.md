# Vale Docker proxy for Windows

This native helper lets `vale-ls` treat a Docker container as a normal Vale
executable on Windows. Source is kept beside the committed x64 and ARM64
binaries so the shipped artifacts are reproducible and auditable.

Build both binaries from this directory with Go 1.22 or later:

```powershell
$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -trimpath -ldflags "-s -w -buildid=" -o bin/vale-docker-proxy-windows-x64.exe .
$env:GOARCH = "arm64"
go build -trimpath -ldflags "-s -w -buildid=" -o bin/vale-docker-proxy-windows-arm64.exe .
```

You don't need to run this yourself before pushing, though: the
`windows-docker-proxy` CI job (`.github/workflows/build.yaml`) rebuilds both
binaries from source on every push/PR to a branch in this repo and, if they
don't byte-match what's committed, opens a PR with the refreshed binaries
and fails that run so it's obvious a fix is waiting - merge the PR, then
re-run or push again. It opens a PR rather than pushing directly because
`main` is a protected branch. It can't open a PR for a fork PR or a tag (see
the job for why); rebuild locally with the commands above in those cases.

The extension passes configuration as JSON in `VALE_DOCKER_PROXY_CONFIG`.
The proxy executes `docker.exe` directly, translates Windows host paths to
Linux container paths, and translates paths in Vale's JSON response back to
Windows paths.

## Testing

Most of `main_test.go` exercises Windows path semantics (`C:\...`,
backslash separators) via Go's `path/filepath`, which resolves those
semantics based on the *build/test host's* OS, not a target flag - so
`go test ./...` only passes on an actual Windows machine or CI runner (this
repo's `windows-docker-proxy` GitHub Actions job uses `windows-latest`).
Running it on macOS or Linux fails with wrong-separator errors even though
nothing is broken; there's no way to cross-run these specific tests without
Windows, Wine, or similar, since `go test -run` still has to execute the
compiled test binary on the host. `TestBindMountReadonly` and anything else
that doesn't touch `path/filepath` semantics is host-independent and can be
run anywhere.
