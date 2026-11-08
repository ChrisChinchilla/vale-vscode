import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  formatProbeResult,
  isProbeSuccessful,
  EXPECTED_CHECKSUMS,
  SharedRegistry,
  buildDockerRunArgs,
  buildDockerWrapperScript,
  buildDownloadAssetName,
  buildValeConfigArgs,
  buildValeFilterExpression,
  buildValeSpawnOptions,
  capDiagnostics,
  computeFleschKincaidGrade,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  getSubstitutionReplacements,
  isUnsupportedLinuxLibc,
  isServerReplaceAction,
  isVersionAtLeast,
  MIN_VALE_CONFIG_DIR_VERSION,
  MIN_VALE_FILTER_VERSION,
  describeValeVersion,
  formatValeVersion,
  VALE_CONFIG_FILE_GLOB,
  DEFAULT_DEBOUNCE_MS,
  formatConfigOutput,
  isValeConfigErrorCode,
  summarizeLanguageStatus,
  toConfigSettingValue,
  resolveEditorBehaviorOptions,
  valeCommandName,
  resolveValeSource,
  shouldSyncViaLanguageServer,
  findExecutableOnPath,
  managedValeExePath,
  shouldStartForLanguages,
  buildDocumentSelectorPatterns,
  VALE_CONFIG_FILE_PATTERNS,
  parseValeVersion,
  resolveConfigPath,
  resolveValeBinaryPath,
  resolveValeExecutionSettings,
  resolveWindowsDockerProxyArch,
  sanitizeVocabularyWord,
  sha256Hex,
  shellQuoteSingle,
  shouldWarnBeforeLinting,
  verifyChecksum,
} from "./utils";

describe("isUnsupportedLinuxLibc", () => {
  test("rejects Linux runtimes confirmed as musl", () => {
    assert.equal(isUnsupportedLinuxLibc("linux", "musl"), true);
  });

  test("accepts glibc Linux and non-Linux runtimes", () => {
    assert.equal(isUnsupportedLinuxLibc("linux", "glibc"), false);
    assert.equal(isUnsupportedLinuxLibc("darwin", null), false);
    assert.equal(isUnsupportedLinuxLibc("darwin", "musl"), false);
  });

  // Regression test for https://github.com/ChrisChinchilla/vale-vscode/issues/123:
  // `process.report`, one of detect-libc's detection strategies, is unavailable
  // inside the VS Code extension host, so a real glibc Linux host can come back
  // with no determinable libc family. Treating that "unknown" the same as
  // "musl" broke activation for every affected glibc user - it must fail open.
  test("does not treat an undetermined Linux libc family as unsupported", () => {
    assert.equal(isUnsupportedLinuxLibc("linux", null), false);
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

  test("returns --no-global alone when noGlobal is set without a config path", () => {
    assert.deepEqual(buildValeConfigArgs("", true), ["--no-global"]);
  });

  test("returns --config and --no-global together", () => {
    assert.deepEqual(
      buildValeConfigArgs("/workspace/.vale.ini", true),
      ["--config", "/workspace/.vale.ini", "--no-global"]
    );
  });

  test("omits --no-global when noGlobal is false", () => {
    assert.deepEqual(buildValeConfigArgs("", false), []);
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

  test("appends a parenthesized custom filter", () => {
    assert.equal(
      buildValeFilterExpression("inherited", true, `.Line > 10`),
      `(.Line > 10)`
    );
  });

  test("combines alert level, spellcheck, and custom filters", () => {
    assert.equal(
      buildValeFilterExpression("warning", false, `.Line > 10 or .Match == "foo"`),
      `.Level in ["warning", "error"] and .Extends != "spelling" and (.Line > 10 or .Match == "foo")`
    );
  });

  test("ignores a blank custom filter", () => {
    assert.equal(buildValeFilterExpression("inherited", true, "   "), "");
  });
});

describe("sanitizeVocabularyWord", () => {
  test("trims surrounding whitespace", () => {
    assert.equal(sanitizeVocabularyWord("  colour  "), "colour");
  });

  test("collapses embedded newlines to a space", () => {
    assert.equal(
      sanitizeVocabularyWord("colour\nreject.txt\nmalicious"),
      "colour reject.txt malicious"
    );
  });

  test("strips carriage returns", () => {
    assert.equal(sanitizeVocabularyWord("colour\r\nfoo"), "colour foo");
  });

  test("returns an empty string for whitespace-only input", () => {
    assert.equal(sanitizeVocabularyWord("   \n  "), "");
  });
});

describe("computeFleschKincaidGrade", () => {
  test("computes the standard formula", () => {
    // words=26, sentences=4, syllables=36 (from a real `vale ls-metrics` sample)
    const grade = computeFleschKincaidGrade(26, 4, 36);
    assert.ok(grade !== null);
    assert.ok(Math.abs(grade - (0.39 * (26 / 4) + 11.8 * (36 / 26) - 15.59)) < 1e-9);
  });

  test("returns null with no words", () => {
    assert.equal(computeFleschKincaidGrade(0, 4, 36), null);
  });

  test("returns null with no sentences", () => {
    assert.equal(computeFleschKincaidGrade(26, 0, 36), null);
  });

  test("returns null with undefined counts", () => {
    assert.equal(computeFleschKincaidGrade(undefined, undefined, undefined), null);
  });
});

describe("shouldWarnBeforeLinting", () => {
  test("warns for a dirty document by default", () => {
    assert.equal(shouldWarnBeforeLinting(true, false), true);
  });

  test("doesn't warn for a saved document", () => {
    assert.equal(shouldWarnBeforeLinting(false, false), false);
  });

  test("doesn't warn when the user suppressed the warning", () => {
    assert.equal(shouldWarnBeforeLinting(true, true), false);
  });
});

describe("capDiagnostics", () => {
  test("leaves diagnostics under the cap untouched", () => {
    assert.deepEqual(capDiagnostics([1, 2, 3], 100), [1, 2, 3]);
  });

  test("truncates to the cap", () => {
    assert.deepEqual(capDiagnostics([1, 2, 3, 4, 5], 2), [1, 2]);
  });

  test("treats an undefined cap as unlimited", () => {
    assert.deepEqual(capDiagnostics([1, 2, 3], undefined), [1, 2, 3]);
  });

  test("treats a non-positive cap as unlimited", () => {
    assert.deepEqual(capDiagnostics([1, 2, 3], 0), [1, 2, 3]);
    assert.deepEqual(capDiagnostics([1, 2, 3], -1), [1, 2, 3]);
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

  test("expands a leading ~ to the home directory", () => {
    assert.equal(
      resolveConfigPath("~/.vale.ini", workspaceRoot),
      path.join(os.homedir(), ".vale.ini")
    );
  });

  test("substitutes ${userHome}", () => {
    assert.equal(
      resolveConfigPath("${userHome}/.vale.ini", workspaceRoot),
      path.join(os.homedir(), ".vale.ini")
    );
  });

  test("substitutes ${env:VAR}", () => {
    process.env.VALE_VSCODE_TEST_VAR = "/opt/vale-config";
    assert.equal(
      resolveConfigPath("${env:VALE_VSCODE_TEST_VAR}/.vale.ini", workspaceRoot),
      path.join("/opt/vale-config", ".vale.ini")
    );
    delete process.env.VALE_VSCODE_TEST_VAR;
  });

  test("resolves without a workspace root when only ~ is involved", () => {
    assert.equal(
      resolveConfigPath("~/.vale.ini", undefined),
      path.join(os.homedir(), ".vale.ini")
    );
  });
});

describe("resolveValeBinaryPath", () => {
  const workspaceRoot = path.join("/", "workspace", "root");

  test("preserves bare executable names for PATH lookup in either trust mode", () => {
    for (const trusted of [true, false]) {
      for (const name of ["vale", "vale.exe", "vale-custom"]) {
        assert.equal(resolveValeBinaryPath(name, workspaceRoot, trusted), name);
      }
    }
  });

  test("ignores workspace-relative binaries in Restricted Mode", () => {
    for (const root of [workspaceRoot, undefined]) {
      for (const binary of [
        "./vale", "bin/vale", "../vale", ".\\vale.exe",
        "${workspaceFolder}/bin/vale", "${workspaceFolder}",
      ]) {
        assert.equal(resolveValeBinaryPath(binary, root, false), "");
      }
    }
  });

  test("allows home and absolute binaries in Restricted Mode", () => {
    const absolute = path.join(os.homedir(), "bin", "vale");
    for (const binary of [absolute, "~/bin/vale", "${userHome}/bin/vale"]) {
      assert.equal(resolveValeBinaryPath(binary, workspaceRoot, false), absolute);
    }
  });

  test("checks trust after expanding environment variables", () => {
    const name = "VALE_VSCODE_TEST_BINARY";
    const previous = process.env[name];
    try {
      for (const value of ["bin/vale", "${workspaceFolder}/vale"]) {
        process.env[name] = value;
        assert.equal(resolveValeBinaryPath("${env:VALE_VSCODE_TEST_BINARY}", workspaceRoot, false), "");
      }
      for (const value of ["vale", path.join(os.homedir(), "bin", "vale")]) {
        process.env[name] = value;
        assert.equal(resolveValeBinaryPath("${env:VALE_VSCODE_TEST_BINARY}", workspaceRoot, false), value);
      }
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  test("resolves explicit relative binaries in trusted workspaces", () => {
    assert.equal(resolveValeBinaryPath("./bin/vale", workspaceRoot, true), path.join(workspaceRoot, "bin", "vale"));
  });

  test("expands a leading ~ to the home directory", () => {
    assert.equal(
      resolveValeBinaryPath("~/.local/share/mise/shims/vale", workspaceRoot),
      path.join(os.homedir(), ".local/share/mise/shims/vale")
    );
  });

  test("substitutes ${workspaceFolder}", () => {
    assert.equal(
      resolveValeBinaryPath(
        "${workspaceFolder}/.vscode/mise-tools/vale",
        workspaceRoot
      ),
      path.join(workspaceRoot, ".vscode/mise-tools/vale")
    );
  });

  test("resolves a bare relative path against the workspace root", () => {
    assert.equal(
      resolveValeBinaryPath(".vscode/mise-tools/vale", workspaceRoot),
      path.join(workspaceRoot, ".vscode/mise-tools/vale")
    );
  });

  test("leaves an absolute path untouched", () => {
    const absolute = path.join("/", "usr", "local", "bin", "vale");
    assert.equal(resolveValeBinaryPath(absolute, workspaceRoot), absolute);
  });

  test("leaves an empty path untouched", () => {
    assert.equal(resolveValeBinaryPath("", workspaceRoot), "");
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

describe("SharedRegistry", () => {
  // Regression coverage for the multi-root startup failure: every folder's
  // vale-ls advertises the same command names (`cli.sync`, ...), and
  // registering a name twice with VS Code throws, killing the second
  // folder's client. The registry gives each name one registration shared
  // by every client, disposed only when the last client releases it.
  test("creates each name once across owners", () => {
    const created: string[] = [];
    const registry = new SharedRegistry<string>(
      (name) => {
        created.push(name);
        return name;
      },
      () => {}
    );

    registry.acquire("vale", ["cli.sync", "cli.compile"]);
    registry.acquire("harper", ["cli.sync", "cli.compile"]);

    assert.deepEqual(created, ["cli.sync", "cli.compile"]);
    assert.ok(registry.has("cli.sync"));
  });

  test("disposes a name only when its last owner releases it", () => {
    const destroyed: string[] = [];
    const registry = new SharedRegistry<string>(
      (name) => name,
      (value) => destroyed.push(value)
    );

    registry.acquire("vale", ["cli.sync"]);
    registry.acquire("harper", ["cli.sync"]);

    registry.release("vale");
    assert.deepEqual(destroyed, []);
    assert.ok(registry.has("cli.sync"));

    registry.release("harper");
    assert.deepEqual(destroyed, ["cli.sync"]);
    assert.equal(registry.has("cli.sync"), false);
  });

  test("tolerates releasing an unknown owner", () => {
    const registry = new SharedRegistry<string>(
      (name) => name,
      () => {}
    );
    registry.release("never-acquired");
    registry.acquire("vale", ["cli.sync"]);
    registry.release("vale");
    registry.release("vale");
    assert.equal(registry.has("cli.sync"), false);
  });
});

describe("formatProbeResult / isProbeSuccessful", () => {
  test("reports spawn errors", () => {
    const result = { exitCode: null, stdout: "", stderr: "", spawnError: "spawn docker ENOENT" };
    assert.deepEqual(formatProbeResult("probe", result), [
      "probe: could not start (spawn docker ENOENT)",
    ]);
    assert.equal(isProbeSuccessful(result), false);
  });

  test("includes stderr for a failing run", () => {
    const result = { exitCode: 125, stdout: "", stderr: "Error: short-name resolution\n" };
    assert.deepEqual(formatProbeResult("probe", result), [
      "probe: exit code 125",
      "probe stderr: Error: short-name resolution",
    ]);
    assert.equal(isProbeSuccessful(result), false);
  });

  test("flags an exit-0 run with no output", () => {
    const result = { exitCode: 0, stdout: "", stderr: "" };
    assert.ok(formatProbeResult("probe", result).some((l) => l.includes("no output")));
    assert.equal(isProbeSuccessful(result), false);
  });

  test("accepts a normal run", () => {
    const result = { exitCode: 0, stdout: "vale version 3.0.0\n", stderr: "" };
    assert.equal(isProbeSuccessful(result), true);
  });
});

describe("VALE_CONFIG_FILE_GLOB", () => {
  test("covers every config location Vale discovers, including .config/vale.ini (3.25.1+)", () => {
    assert.deepEqual(VALE_CONFIG_FILE_PATTERNS, [
      ".vale.ini",
      "_vale.ini",
      ".config/vale.ini",
    ]);
  });

  test("is a single brace-alternation glob over all patterns", () => {
    assert.equal(
      VALE_CONFIG_FILE_GLOB,
      "**/{.vale.ini,_vale.ini,.config/vale.ini}"
    );
  });
});

describe("resolveEditorBehaviorOptions", () => {
  test("defaults to the documented values when nothing is set", () => {
    assert.deepEqual(resolveEditorBehaviorOptions({}), {
      lintOnChange: true,
      debounceMs: DEFAULT_DEBOUNCE_MS,
      showMetrics: false,
    });
  });

  test("passes explicit values through", () => {
    assert.deepEqual(
      resolveEditorBehaviorOptions({
        lintOnChange: true,
        debounceMs: 750,
        showMetrics: true,
      }),
      { lintOnChange: true, debounceMs: 750, showMetrics: true }
    );
  });

  test("rounds fractional debounce and allows zero", () => {
    assert.equal(resolveEditorBehaviorOptions({ debounceMs: 0 }).debounceMs, 0);
    assert.equal(resolveEditorBehaviorOptions({ debounceMs: 250.6 }).debounceMs, 251);
  });

  test("falls back to the default for negative or non-finite debounce", () => {
    for (const bad of [-1, NaN, Infinity]) {
      assert.equal(
        resolveEditorBehaviorOptions({ debounceMs: bad }).debounceMs,
        DEFAULT_DEBOUNCE_MS
      );
    }
  });
});

describe("describeValeVersion", () => {
  test("summarises a normal --version line", () => {
    assert.equal(describeValeVersion("vale version 3.18.0\n"), "Vale 3.18.0");
  });

  test("reports an undetermined version for a failed probe", () => {
    assert.equal(describeValeVersion(null), "Vale version could not be determined");
  });

  test("reports unparseable output and includes it", () => {
    assert.equal(
      describeValeVersion("nonsense\n"),
      'Vale version could not be parsed from "nonsense"'
    );
  });
});

describe("Vale version thresholds", () => {
  test("formatValeVersion joins the tuple", () => {
    assert.equal(formatValeVersion([3, 25, 1]), "3.25.1");
  });

  test(".config/vale.ini needs 3.25.1 exactly or later", () => {
    assert.equal(isVersionAtLeast([3, 25, 0], MIN_VALE_CONFIG_DIR_VERSION), false);
    assert.equal(isVersionAtLeast([3, 25, 1], MIN_VALE_CONFIG_DIR_VERSION), true);
    assert.equal(isVersionAtLeast([3, 26, 0], MIN_VALE_CONFIG_DIR_VERSION), true);
  });
});

describe("summarizeLanguageStatus", () => {
  test("reports not running with no clients", () => {
    const s = summarizeLanguageStatus([], 0);
    assert.equal(s.text, "Vale: Not running");
    assert.equal(s.severity, "information");
  });

  test("reports ready when every client is ready", () => {
    const s = summarizeLanguageStatus(
      [{ name: "a", state: "ready" }, { name: "b", state: "ready" }],
      0
    );
    assert.equal(s.text, "Vale: Ready");
    assert.equal(s.busy, false);
  });

  test("starting is busy and outranks ready", () => {
    const s = summarizeLanguageStatus(
      [{ name: "a", state: "ready" }, { name: "b", state: "starting" }],
      0
    );
    assert.equal(s.text, "Vale: Starting");
    assert.equal(s.busy, true);
  });

  test("a failed client outranks configuration errors and names the folder", () => {
    const s = summarizeLanguageStatus(
      [{ name: "docs", state: "error", detail: "spawn ENOENT" }],
      3
    );
    assert.equal(s.text, "Vale: Error");
    assert.equal(s.severity, "error");
    assert.equal(s.detail, "docs: spawn ENOENT");
  });

  test("configuration errors are pluralised and outrank starting", () => {
    const one = summarizeLanguageStatus([{ name: "a", state: "starting" }], 1);
    assert.equal(one.text, "Vale: Configuration error");
    assert.match(one.detail, /^1 configuration problem - /);
    const many = summarizeLanguageStatus([{ name: "a", state: "ready" }], 2);
    assert.match(many.detail, /^2 configuration problems - /);
  });
});

describe("isValeConfigErrorCode", () => {
  test("matches E-codes only", () => {
    assert.equal(isValeConfigErrorCode("E201"), true);
    assert.equal(isValeConfigErrorCode({ value: "E100" }), true);
    assert.equal(isValeConfigErrorCode("Vale.Spelling"), false);
    assert.equal(isValeConfigErrorCode("E"), false);
    assert.equal(isValeConfigErrorCode(201), false);
    assert.equal(isValeConfigErrorCode(undefined), false);
  });
});

describe("toConfigSettingValue", () => {
  test("uses a forward-slash relative path inside the workspace", () => {
    assert.equal(
      toConfigSettingValue("/w/proj/.config/vale.ini", "/w/proj"),
      ".config/vale.ini"
    );
  });

  test("keeps an absolute path outside the workspace", () => {
    assert.equal(toConfigSettingValue("/elsewhere/vale.ini", "/w/proj"), "/elsewhere/vale.ini");
  });

  test("does not treat a sibling with a shared prefix as inside", () => {
    assert.equal(toConfigSettingValue("/w/proj-other/v.ini", "/w/proj"), "/w/proj-other/v.ini");
  });

  test("keeps the path absolute with no workspace", () => {
    assert.equal(toConfigSettingValue("/a/vale.ini", undefined), "/a/vale.ini");
  });
});

describe("formatConfigOutput", () => {
  test("pretty-prints JSON", () => {
    const out = formatConfigOutput('{"RootINI":"/p/.vale.ini","Paths":["/s"]}');
    assert.equal(out.language, "json");
    assert.match(out.content, /^\{\n  "RootINI": "\/p\/\.vale\.ini",/);
  });

  test("skips warning text printed before the JSON object", () => {
    const out = formatConfigOutput('warning: something\n{"a":1}');
    assert.equal(out.language, "json");
    assert.equal(out.content, '{\n  "a": 1\n}\n');
  });

  test("falls back to plain text when it is not JSON", () => {
    const out = formatConfigOutput("not json at all");
    assert.equal(out.language, "plaintext");
    assert.equal(out.content, "not json at all\n");
  });
});

describe("valeCommandName", () => {
  test("skips leading flags", () => {
    assert.equal(valeCommandName(["--config=/a/.vale.ini", "--no-global", "sync"]), "sync");
    assert.equal(valeCommandName(["ls-metrics", "/a/b.md"]), "ls-metrics");
  });

  test("falls back when every argument is a flag or there are none", () => {
    assert.equal(valeCommandName(["--version"]), "--version");
    assert.equal(valeCommandName([]), "vale");
  });
});

describe("package.json manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")
  );

  test("editor setting defaults match what is sent to vale-ls", () => {
    const properties = Object.assign(
      {},
      ...manifest.contributes.configuration.map(
        (section: { properties: object }) => section.properties
      )
    );
    const sent = resolveEditorBehaviorOptions({});
    for (const key of ["lintOnChange", "debounceMs", "showMetrics"] as const) {
      assert.equal(properties[`vale.valeCLI.${key}`].default, sent[key], key);
    }
  });
});

describe("resolveValeSource", () => {
  const managedExe = "/ls/vale_bin/vale";

  test("an explicit path always wins", () => {
    const choice = resolveValeSource({
      customPath: "/opt/vale",
      alwaysManaged: true,
      pathVale: "/usr/bin/vale",
      managedExe,
    });
    assert.deepEqual(choice, {
      source: "custom",
      binaryPath: "/opt/vale",
      languageServerPath: "/opt/vale",
      installVale: false,
    });
  });

  test("uses the Vale on PATH by default and pins it for vale-ls", () => {
    const choice = resolveValeSource({
      alwaysManaged: false,
      pathVale: "/usr/bin/vale",
      managedExe,
    });
    assert.equal(choice.source, "path");
    assert.equal(choice.binaryPath, "/usr/bin/vale");
    assert.equal(choice.languageServerPath, "/usr/bin/vale");
    assert.equal(choice.installVale, false);
  });

  test("falls back to the managed copy when there is no Vale on PATH", () => {
    const choice = resolveValeSource({ alwaysManaged: false, managedExe });
    assert.deepEqual(choice, {
      source: "managed",
      binaryPath: managedExe,
      languageServerPath: undefined,
      installVale: true,
    });
  });

  test("always-managed ignores the Vale on PATH", () => {
    const choice = resolveValeSource({
      alwaysManaged: true,
      pathVale: "/usr/bin/vale",
      managedExe,
    });
    assert.equal(choice.source, "managed");
    assert.equal(choice.binaryPath, managedExe);
    assert.equal(choice.installVale, true);
  });
});

describe("findExecutableOnPath", () => {
  test("returns the first directory that has the file", () => {
    const found = findExecutableOnPath(
      "vale",
      "/a:/b:/c",
      "linux",
      (candidate) => candidate === "/b/vale" || candidate === "/c/vale"
    );
    assert.equal(found, "/b/vale");
  });

  test("looks for vale.exe on Windows", () => {
    const found = findExecutableOnPath(
      "vale",
      "C:\\tools;C:\\bin",
      "win32",
      (candidate) => candidate === "C:\\bin\\vale.exe"
    );
    assert.equal(found, "C:\\bin\\vale.exe");
  });

  test("returns undefined for an empty or unmatched PATH", () => {
    assert.equal(findExecutableOnPath("vale", undefined, "linux", () => true), undefined);
    assert.equal(findExecutableOnPath("vale", "/a::/b", "linux", () => false), undefined);
  });
});

describe("managedValeExePath", () => {
  test("is vale_bin next to the language server", () => {
    assert.equal(managedValeExePath("/ls", "darwin"), "/ls/vale_bin/vale");
    assert.equal(managedValeExePath("C:\\ls", "win32"), "C:\\ls\\vale_bin\\vale.exe");
  });
});

describe("shouldStartForLanguages", () => {
  const configured = ["markdown", "plaintext"];

  test("starts when an open document has a listed language", () => {
    assert.equal(shouldStartForLanguages(configured, ["go", "markdown"]), true);
  });

  test("does not start for unlisted languages or no documents", () => {
    assert.equal(shouldStartForLanguages(configured, ["go", "json"]), false);
    assert.equal(shouldStartForLanguages(configured, []), false);
  });

  test("a * entry always starts", () => {
    assert.equal(shouldStartForLanguages(["*"], []), true);
  });
});

describe("buildDocumentSelectorPatterns", () => {
  test("builds patterns from section globs, anchored to the folder", () => {
    assert.deepEqual(
      buildDocumentSelectorPatterns("/work/proj", {
        SBaseStyles: { "*.{md,txt}": ["Vale"], "docs/**/*.rst": ["Vale"] },
      }),
      ["/work/proj/**/*.{md,txt}", "/work/proj/docs/**/*.rst"]
    );
  });

  test("includes sections with individual checks and deduplicates shared globs", () => {
    assert.deepEqual(
      buildDocumentSelectorPatterns("/work/proj", {
        SBaseStyles: { "*.md": ["Vale"] },
        SChecks: { "*.md": {}, "*.txt": { "Vale.Spelling": true } },
      }),
      ["/work/proj/**/*.md", "/work/proj/**/*.txt"]
    );
    assert.deepEqual(
      buildDocumentSelectorPatterns("/work/proj", {
        SChecks: { "*.txt": { "Vale.Spelling": true } },
      }),
      ["/work/proj/**/*.txt"]
    );
  });

  test("global checks and wildcard check sections keep every file", () => {
    for (const config of [
      { SBaseStyles: { "*.md": ["Vale"] }, GChecks: { "Vale.Spelling": true } },
      { SBaseStyles: { "*.md": ["Vale"] }, SChecks: { "*": { "Vale.Spelling": true } } },
    ]) {
      assert.equal(buildDocumentSelectorPatterns("/work/proj", config), undefined);
    }
  });

  test("adds extensions mapped with [formats]", () => {
    assert.deepEqual(
      buildDocumentSelectorPatterns("/work/proj", {
        SBaseStyles: { "*.md": ["Vale"] },
        Formats: { mdx: "md" },
      }),
      ["/work/proj/**/*.md", "/work/proj/**/*.mdx"]
    );
  });

  test("covers every file when the config cannot narrow it", () => {
    assert.equal(buildDocumentSelectorPatterns("/p", null), undefined);
    assert.equal(buildDocumentSelectorPatterns("/p", { SBaseStyles: {} }), undefined);
    assert.equal(
      buildDocumentSelectorPatterns("/p", { SBaseStyles: { "*": ["Vale"] } }),
      undefined
    );
    assert.equal(
      buildDocumentSelectorPatterns("/p", {
        SBaseStyles: { "*.md": ["Vale"] },
        GBaseStyles: { Vale: true },
      }),
      undefined
    );
  });

  test("uses forward slashes and works with no folder", () => {
    assert.deepEqual(
      buildDocumentSelectorPatterns("C:\\work\\proj\\", {
        SBaseStyles: { "*.md": ["Vale"] },
      }),
      ["C:/work/proj/**/*.md"]
    );
    assert.deepEqual(
      buildDocumentSelectorPatterns(undefined, { SBaseStyles: { "*.md": ["Vale"] } }),
      ["**/*.md"]
    );
  });
});

describe("shouldSyncViaLanguageServer", () => {
  const base = {
    explicit: false,
    dockerActive: false,
    source: "path" as const,
    alwaysManaged: false,
  };

  test("direct by default, with a Vale on PATH or a custom path", () => {
    assert.equal(shouldSyncViaLanguageServer(base), false);
    assert.equal(shouldSyncViaLanguageServer({ ...base, source: "custom" }), false);
  });

  test("goes through the server when there is no Vale on PATH", () => {
    assert.equal(shouldSyncViaLanguageServer({ ...base, source: "managed" }), true);
  });

  test("an explicitly chosen managed copy still syncs directly", () => {
    assert.equal(
      shouldSyncViaLanguageServer({ ...base, source: "managed", alwaysManaged: true }),
      false
    );
  });

  test("Docker syncs directly unless the setting asks otherwise", () => {
    assert.equal(
      shouldSyncViaLanguageServer({ ...base, source: "managed", dockerActive: true }),
      false
    );
    assert.equal(
      shouldSyncViaLanguageServer({ ...base, dockerActive: true, explicit: true }),
      true
    );
  });

  test("the setting forces the server route", () => {
    assert.equal(shouldSyncViaLanguageServer({ ...base, explicit: true }), true);
    assert.equal(
      shouldSyncViaLanguageServer({ ...base, source: "custom", explicit: true }),
      true
    );
  });
});
