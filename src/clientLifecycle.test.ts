import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { ClientLifecycleQueue, usesConfigFile } from "./clientLifecycle";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("restarts wait for an active start and coalesce queued changes", async () => {
  const queue = new ClientLifecycleQueue();
  const blocked = gate();
  const calls: string[] = [];
  const first = queue.run("folder", "start", async () => {
    calls.push("starting");
    await blocked.promise;
    calls.push("started");
  });
  const second = queue.run("folder", "start", async () => { calls.push("obsolete"); });
  const third = queue.run("folder", "start", async () => { calls.push("latest"); });
  assert.deepEqual(calls, ["starting"]);
  blocked.release();
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, ["starting", "started", "latest"]);
  assert.deepEqual(queue.keys(), []);
});

test("stops preserve order, failures do not block cleanup, and folders run independently", async () => {
  const queue = new ClientLifecycleQueue();
  const blocked = gate();
  const calls: string[] = [];
  const first = queue.run("a", "start", async () => {
    await blocked.promise;
    throw new Error("startup failed");
  });
  const rejected = assert.rejects(first, /startup failed/);
  const restart = queue.run("a", "start", async () => { calls.push("restart"); });
  const stop = queue.run("a", "stop", async () => { calls.push("stop"); });
  const after = queue.run("a", "start", async () => { calls.push("after stop"); });
  await queue.run("b", "start", async () => { calls.push("other folder"); });
  assert.deepEqual(calls, ["other folder"]);
  blocked.release();
  await Promise.all([rejected, restart, stop, after]);
  assert.deepEqual(calls, ["other folder", "restart", "stop", "after stop"]);
});

test("shared configurations match absolute and workspace-relative paths", () => {
  const root = path.resolve("fixtures");
  const changed = path.join(root, "a", ".vale.ini");
  assert.equal(usesConfigFile(changed, path.join(root, "b"), changed), true);
  assert.equal(usesConfigFile("../a/.vale.ini", path.join(root, "b"), changed), true);
  assert.equal(usesConfigFile(".vale.ini", path.join(root, "b"), changed), false);
  assert.equal(usesConfigFile("", root, changed), false);
});
