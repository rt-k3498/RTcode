import { createRequire } from "node:module";
import { resolveRustEnvironment } from "./rust-toolchain.mjs";

const require = createRequire(import.meta.url);
try {
  const { env, source } = resolveRustEnvironment();
  Object.assign(process.env, env);
  if (source !== "PATH") {
    console.error(`[RTcode] Using Rust from ${source}.`);
  }
  const { run } = require("@tauri-apps/cli");
  process.env.RTCODE_DEV_LAUNCH_DIR = process.env.INIT_CWD || process.cwd();
  await run(process.argv.slice(2), "pnpm tauri");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
