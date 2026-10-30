import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { resolveRustEnvironment } from "./rust-toolchain.mjs";

test("keeps a working inherited toolchain and its environment", () => {
  const env = { PATH: "/tools", CARGO_HOME: "/custom" };
  const result = resolveRustEnvironment({ env, available: () => true });
  assert.deepEqual(result.env, env);
  assert.equal(result.source, "PATH");
});

test("finds the conventional user installation without editing input", () => {
  const env = { PATH: "/tools" };
  const result = resolveRustEnvironment({
    env,
    home: "/user",
    available: (candidate) => candidate.PATH.startsWith("/user/.cargo/bin"),
  });
  assert.equal(result.source, "user installation");
  assert.equal(env.PATH, "/tools");
});

test("supplies both Rust homes for the isolated session installation", () => {
  const result = resolveRustEnvironment({
    env: { PATH: "/tools" },
    available: (candidate) =>
      candidate.CARGO_HOME === "/private/tmp/r-console-cargo",
  });
  assert.equal(result.env.RUSTUP_HOME, "/private/tmp/r-console-rustup");
  assert.equal(
    result.env.PATH,
    `/private/tmp/r-console-cargo/bin${delimiter}/tools`,
  );
});

test("does not replace explicit broken Rust homes with a different installation", () => {
  const attempts = [];
  assert.throws(
    () =>
      resolveRustEnvironment({
        env: { PATH: "/tools", CARGO_HOME: "/chosen" },
        available: (candidate) => {
          attempts.push(candidate);
          return false;
        },
      }),
    /Install Rust stable/,
  );
  assert.ok(attempts.every((env) => env.CARGO_HOME === "/chosen"));
});
