import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

function works(env) {
  return ["cargo", "rustc"].every(
    (program) =>
      spawnSync(program, ["--version"], {
        env,
        stdio: "ignore",
        timeout: 5000,
      }).status === 0,
  );
}

// Only the launched development command inherits these changes. Shell profiles
// and the application's own process-launch policy are not modified.
export function resolveRustEnvironment({
  env = process.env,
  home = homedir(),
  available = works,
} = {}) {
  const inherited = { ...env };
  if (available(inherited)) return { env: inherited, source: "PATH" };

  const pathKey =
    Object.keys(inherited).find((key) => key.toUpperCase() === "PATH") ||
    "PATH";
  const prepend = (base, directory) => ({
    ...base,
    [pathKey]: [directory, base[pathKey]].filter(Boolean).join(delimiter),
  });
  const user = prepend(
    inherited,
    join(inherited.CARGO_HOME || join(home, ".cargo"), "bin"),
  );
  if (available(user)) return { env: user, source: "user installation" };

  // Reuse the isolated installation created for this checkout when a regular
  // installation is absent. Never override explicitly selected Rust homes.
  if (!inherited.CARGO_HOME && !inherited.RUSTUP_HOME) {
    const cargoHome = "/private/tmp/r-console-cargo";
    const session = prepend(
      {
        ...inherited,
        CARGO_HOME: cargoHome,
        RUSTUP_HOME: "/private/tmp/r-console-rustup",
      },
      join(cargoHome, "bin"),
    );
    if (available(session))
      return { env: session, source: "session installation" };
  }

  throw new Error(
    "Cargo and rustc are unavailable. Install Rust stable with rustup from https://rustup.rs, then reopen your terminal and retry pnpm tauri dev. If Rust is already installed, check CARGO_HOME, RUSTUP_HOME, and PATH.",
  );
}
