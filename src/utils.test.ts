import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  EXPECTED_CHECKSUMS,
  buildDownloadAssetName,
  buildValeFilterExpression,
  buildValeSpawnOptions,
  detectArch,
  detectPlatform,
  getExecutableName,
  getExpectedChecksum,
  resolveConfigPath,
  sha256Hex,
  verifyChecksum,
} from "./utils";

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
