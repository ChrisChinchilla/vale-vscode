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
