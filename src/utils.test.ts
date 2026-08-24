import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  EXPECTED_CHECKSUMS,
  buildDockerRunArgs,
  buildDockerWrapperScript,
  buildDownloadAssetName,
  buildValeConfigArgs,
  buildValeFilterExpression,
  buildValeSpawnOptions,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  getSubstitutionReplacements,
  isUnsupportedLinuxLibc,
  isServerReplaceAction,
  isVersionAtLeast,
  MIN_VALE_FILTER_VERSION,
  parseValeVersion,
  resolveConfigPath,
  resolveValeExecutionSettings,
  resolveWindowsDockerProxyArch,
  sha256Hex,
  shellQuoteSingle,
  verifyChecksum,
} from "./utils";

describe("isUnsupportedLinuxLibc", () => {
  test("rejects Linux runtimes without glibc", () => {
    assert.equal(isUnsupportedLinuxLibc("linux", undefined), true);
  });

  test("accepts glibc Linux and non-Linux runtimes", () => {
    assert.equal(isUnsupportedLinuxLibc("linux", "2.36"), false);
    assert.equal(isUnsupportedLinuxLibc("darwin", undefined), false);
  });
});

describe("detectArch", () => {
  test("maps x64 to x86_64", () => {
    assert.equal(detectArch("x64"), "x86_64");
  });

  test("maps arm64 to aarch64", () => {
    assert.equal(detectArch("arm64"), "aarch64");
  });

  test("returns null for unsupported architectures", () => {
    assert.equal(detectArch("ia32"), null);
  });
});

describe("detectPlatform", () => {
  test("maps darwin regardless of arch", () => {
    assert.equal(detectPlatform("darwin", "x64"), "apple-darwin");
    assert.equal(detectPlatform("darwin", "arm64"), "apple-darwin");
  });

  test("maps win32+arm64 to pc-windows-msvc", () => {
    assert.equal(detectPlatform("win32", "arm64"), "pc-windows-msvc");
  });

  test("maps win32+x64 to pc-windows-gnu", () => {
    assert.equal(detectPlatform("win32", "x64"), "pc-windows-gnu");
  });

  test("maps linux regardless of arch", () => {
    assert.equal(detectPlatform("linux", "x64"), "unknown-linux-gnu");
  });

  test("returns null for unsupported platforms", () => {
    assert.equal(detectPlatform("sunos", "x64"), null);
  });
});

describe("getExecutableName", () => {
  test("appends .exe on win32", () => {
    assert.equal(getExecutableName("win32"), "vale-ls.exe");
  });

  test("has no extension elsewhere", () => {
    assert.equal(getExecutableName("darwin"), "vale-ls");
    assert.equal(getExecutableName("linux"), "vale-ls");
  });
});

describe("buildDownloadAssetName", () => {
  test("every supported platform/arch combination has a known checksum", () => {
    const combos: [string, string][] = [
      ["darwin", "x64"],
      ["darwin", "arm64"],
      ["win32", "x64"],
      ["win32", "arm64"],
      ["linux", "x64"],
      ["linux", "arm64"],
    ];

    for (const [platform, arch] of combos) {
      const assetName = buildDownloadAssetName(platform, arch);
      assert.ok(assetName, `expected an asset name for ${platform}/${arch}`);
      assert.ok(
        Object.prototype.hasOwnProperty.call(EXPECTED_CHECKSUMS, assetName as string),
        `no checksum recorded for ${assetName}`
      );
    }
  });

  test("returns null for unsupported combinations", () => {
    assert.equal(buildDownloadAssetName("sunos", "x64"), null);
    assert.equal(buildDownloadAssetName("darwin", "ia32"), null);
  });
});

describe("checksum verification", () => {
  test("verifyChecksum accepts a matching digest", () => {
    const buffer = Buffer.from("hello world");
    const expected = sha256Hex(buffer);
    assert.equal(verifyChecksum(buffer, expected), true);
  });

  test("verifyChecksum rejects a tampered buffer", () => {
    const buffer = Buffer.from("hello world");
    const expected = sha256Hex(buffer);
    const tampered = Buffer.from("hello world!");
    assert.equal(verifyChecksum(tampered, expected), false);
  });

  test("verifyChecksum is case-insensitive", () => {
    const buffer = Buffer.from("hello world");
    const expected = sha256Hex(buffer).toUpperCase();
    assert.equal(verifyChecksum(buffer, expected), true);
  });

  test("getExpectedChecksum returns null for unknown assets", () => {
    assert.equal(getExpectedChecksum("does-not-exist.zip"), null);
  });
});

describe("buildValeSpawnOptions", () => {
  test("sets cwd and never enables a shell", () => {
    const options = buildValeSpawnOptions("/some/workspace");
    assert.equal(options.cwd, "/some/workspace");
    assert.equal("shell" in options, false);
  });
});

describe("buildValeConfigArgs", () => {
  test("returns no args when no config path is configured", () => {
    assert.deepEqual(buildValeConfigArgs(""), []);
  });

  test("returns --config with the resolved path", () => {
    assert.deepEqual(
      buildValeConfigArgs("/workspace/src/config/.vale.ini"),
      ["--config", "/workspace/src/config/.vale.ini"]
    );
  });
});

describe("buildValeFilterExpression", () => {
  test("no filter when minAlertLevel is inherited and spellcheck is enabled", () => {
    assert.equal(buildValeFilterExpression("inherited", true), "");
  });

  test("filters by suggestion level and up", () => {
    assert.equal(
      buildValeFilterExpression("suggestion", true),
      `.Level in ["suggestion", "warning", "error"]`
    );
  });

  test("filters by warning level and up", () => {
    assert.equal(
      buildValeFilterExpression("warning", true),
      `.Level in ["warning", "error"]`
    );
  });

  test("filters by error level only", () => {
    assert.equal(
      buildValeFilterExpression("error", true),
      `.Level in ["error"]`
    );
  });

  test("excludes spelling when spellcheck is disabled", () => {
    assert.equal(
      buildValeFilterExpression("inherited", false),
      `.Extends != "spelling"`
    );
  });

  test("combines alert level and spellcheck filters", () => {
    assert.equal(
      buildValeFilterExpression("warning", false),
      `.Level in ["warning", "error"] and .Extends != "spelling"`
    );
  });
});

describe("resolveConfigPath", () => {
  const workspaceRoot = path.join("/", "workspace", "root");

  test("substitutes ${workspaceFolder}", () => {
    assert.equal(
      resolveConfigPath("${workspaceFolder}/.vale.ini", workspaceRoot),
      path.join(workspaceRoot, ".vale.ini")
    );
  });

  test("resolves a relative path against the workspace root", () => {
    assert.equal(
      resolveConfigPath("./config/.vale.ini", workspaceRoot),
      path.join(workspaceRoot, "config", ".vale.ini")
    );
  });

  test("leaves an absolute path untouched", () => {
    const absolute = path.join("/", "etc", "vale.ini");
    assert.equal(resolveConfigPath(absolute, workspaceRoot), absolute);
  });

  test("leaves an empty path untouched", () => {
    assert.equal(resolveConfigPath("", workspaceRoot), "");
  });
});

describe("shellQuoteSingle", () => {
  test("wraps a plain value in single quotes", () => {
    assert.equal(shellQuoteSingle("jdkato/vale"), "'jdkato/vale'");
  });

  test("preserves spaces without splitting into multiple words", () => {
    assert.equal(
      shellQuoteSingle("/path with spaces/root"),
      "'/path with spaces/root'"
    );
  });

  test("escapes embedded single quotes", () => {
    assert.equal(shellQuoteSingle("it's"), `'it'\\''s'`);
  });

  test("neutralizes command substitution and backticks", () => {
    assert.equal(shellQuoteSingle("$(rm -rf /)"), "'$(rm -rf /)'");
    assert.equal(shellQuoteSingle("`rm -rf /`"), "'`rm -rf /`'");
  });
});

describe("buildDockerRunArgs", () => {
  test("mounts the workspace root onto the identical container path", () => {
    const args = buildDockerRunArgs("jdkato/vale", "/workspace/root", [
      "ls-config",
    ]);
    assert.deepEqual(args, [
      "run",
      "--rm",
      "-i",
      "-v",
      "/workspace/root:/workspace/root",
      "-w",
      "/workspace/root",
      "jdkato/vale",
      "ls-config",
    ]);
  });

  test("splices extraArgs before the image name", () => {
    const args = buildDockerRunArgs(
      "jdkato/vale",
      "/workspace/root",
      ["sync"],
      ["-v", "/styles:/styles"]
    );
    assert.deepEqual(args, [
      "run",
      "--rm",
      "-i",
      "-v",
      "/workspace/root:/workspace/root",
      "-w",
      "/workspace/root",
      "-v",
      "/styles:/styles",
      "jdkato/vale",
      "sync",
    ]);
  });

  test("keeps stdin open (-i) for parity with the Windows proxy", () => {
    const args = buildDockerRunArgs("jdkato/vale", "/workspace/root", ["ls-config"]);
    assert.ok(args.includes("-i"));
  });
});

describe("resolveWindowsDockerProxyArch", () => {
  test("maps x64 and arm64 to their proxy binary suffixes", () => {
    assert.equal(resolveWindowsDockerProxyArch("x64"), "x64");
    assert.equal(resolveWindowsDockerProxyArch("arm64"), "arm64");
  });

  test("returns null for architectures with no shipped proxy", () => {
    assert.equal(resolveWindowsDockerProxyArch("ia32"), null);
    assert.equal(resolveWindowsDockerProxyArch("arm"), null);
  });
});

describe("resolveValeExecutionSettings", () => {
  test("uses the configured local binary for every non-Docker invocation", () => {
    assert.deepEqual(
      resolveValeExecutionSettings(
        "/opt/vale/bin/vale",
        false,
        "/workspace",
        "linux",
        undefined,
        undefined
      ),
      { binaryPath: "/opt/vale/bin/vale" }
    );
  });

  test("enables Docker only for a supported workspace", () => {
    assert.deepEqual(
      resolveValeExecutionSettings(
        undefined,
        true,
        "/workspace",
        "darwin",
        "custom/vale",
        ["--pull=always"]
      ),
      {
        binaryPath: "vale",
        docker: { image: "custom/vale", extraArgs: ["--pull=always"] },
      }
    );
  });

  test("falls back to the configured binary without a workspace", () => {
    const result = resolveValeExecutionSettings(
      "/custom/vale",
      true,
      undefined,
      "linux",
      undefined,
      undefined
    );
    assert.equal(result.binaryPath, "/custom/vale");
    assert.equal(result.docker, undefined);
    assert.match(result.dockerUnavailableReason ?? "", /workspace folder/);
  });

  test("falls back to the configured binary on Windows with a generic reason when none is given", () => {
    const result = resolveValeExecutionSettings(
      "C:\\Vale\\vale.exe",
      true,
      "C:\\workspace",
      "win32",
      undefined,
      undefined
    );
    assert.equal(result.binaryPath, "C:\\Vale\\vale.exe");
    assert.equal(result.docker, undefined);
    assert.match(result.dockerUnavailableReason ?? "", /isn't available/);
  });

  test("surfaces the caller-supplied reason the Windows proxy is unavailable", () => {
    const result = resolveValeExecutionSettings(
      "C:\\Vale\\vale.exe",
      true,
      "C:\\workspace",
      "win32",
      undefined,
      undefined,
      undefined,
      "Docker mode requires the Windows Docker proxy, which isn't built for this architecture (ia32). Using the configured local Vale binary instead."
    );
    assert.match(result.dockerUnavailableReason ?? "", /isn't built for this architecture \(ia32\)/);
  });

  test("enables Docker through the native proxy on Windows", () => {
    const result = resolveValeExecutionSettings(
      undefined,
      true,
      "C:\\workspace",
      "win32",
      "jdkato/vale",
      [],
      "C:\\extension\\vale-docker-proxy.exe"
    );
    assert.equal(
      result.docker?.proxyPath,
      "C:\\extension\\vale-docker-proxy.exe"
    );
    assert.equal(result.dockerUnavailableReason, undefined);
  });
});

describe("getSubstitutionReplacements", () => {
  // Regression coverage for https://github.com/ChrisChinchilla/vale-vscode/issues/25:
  // reading `alert.Action.Name` with no guard threw "Cannot read properties
  // of undefined (reading 'Action')" whenever an alert's `data` (or its
  // `Action`) was missing.
  test("returns no replacements when data is undefined", () => {
    assert.deepEqual(getSubstitutionReplacements(undefined), []);
  });

  test("returns no replacements when Action is missing", () => {
    assert.deepEqual(getSubstitutionReplacements({}), []);
  });

  test("returns no replacements for a non-replace action", () => {
    assert.deepEqual(
      getSubstitutionReplacements({ Action: { Name: "suggest" } }),
      []
    );
  });

  test("returns no replacements when Params is empty", () => {
    assert.deepEqual(
      getSubstitutionReplacements({ Action: { Name: "replace", Params: [] } }),
      []
    );
  });

  test("returns the params for a replace action", () => {
    assert.deepEqual(
      getSubstitutionReplacements({
        Action: { Name: "replace", Params: ["what if", "options"] },
      }),
      ["what if", "options"]
    );
  });
});

describe("isServerReplaceAction", () => {
  test("is false when data is undefined", () => {
    assert.equal(isServerReplaceAction(undefined), false);
  });

  test("is false when Action is missing", () => {
    assert.equal(isServerReplaceAction({}), false);
  });

  test("is false for a non-replace action", () => {
    assert.equal(isServerReplaceAction({ Action: { Name: "suggest" } }), false);
  });

  test("is true for a replace action", () => {
    assert.equal(
      isServerReplaceAction({ Action: { Name: "replace", Params: ["x"] } }),
      true
    );
  });
});

describe("parseValeVersion", () => {
  test("parses the standard 'vale version X.Y.Z' output", () => {
    assert.deepEqual(parseValeVersion("vale version 3.18.0"), [3, 18, 0]);
  });

  test("parses a bare version string", () => {
    assert.deepEqual(parseValeVersion("3.9.4"), [3, 9, 4]);
  });

  test("tolerates trailing whitespace/newlines", () => {
    assert.deepEqual(parseValeVersion("vale version 3.10.0\n"), [3, 10, 0]);
  });

  test("returns null for unparseable output", () => {
    assert.equal(parseValeVersion(""), null);
    assert.equal(parseValeVersion("command not found"), null);
  });
});

describe("isVersionAtLeast", () => {
  test("is true for an exact match", () => {
    assert.equal(isVersionAtLeast([3, 10, 0], MIN_VALE_FILTER_VERSION), true);
  });

  test("is true for a newer major/minor/patch", () => {
    assert.equal(isVersionAtLeast([3, 18, 0], MIN_VALE_FILTER_VERSION), true);
    assert.equal(isVersionAtLeast([4, 0, 0], MIN_VALE_FILTER_VERSION), true);
    assert.equal(isVersionAtLeast([3, 10, 1], MIN_VALE_FILTER_VERSION), true);
  });

  test("is false for an older minor version, regardless of patch", () => {
    assert.equal(isVersionAtLeast([3, 9, 99], MIN_VALE_FILTER_VERSION), false);
  });

  test("is false for an older major version", () => {
    assert.equal(isVersionAtLeast([2, 99, 99], MIN_VALE_FILTER_VERSION), false);
  });
});

describe("buildDockerWrapperScript", () => {
  test("darwin/linux script has a shebang and forwards args via \"$@\"", () => {
    const script = buildDockerWrapperScript(
      "jdkato/vale",
      "/workspace/root"
    );
    assert.ok(script.startsWith("#!/usr/bin/env bash\n"));
    assert.ok(script.includes("exec docker run --rm -i"));
    assert.ok(script.includes(`'/workspace/root:/workspace/root'`));
    assert.ok(script.includes(`'jdkato/vale'`));
    assert.ok(script.trim().endsWith(`"$@"`));
  });

  test("quotes a workspace root containing spaces on POSIX", () => {
    const script = buildDockerWrapperScript(
      "jdkato/vale",
      "/path with spaces/root"
    );
    assert.ok(script.includes(`'/path with spaces/root:/path with spaces/root'`));
  });

});
