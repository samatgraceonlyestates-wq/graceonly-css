// Builds CSS and ASSEMBLES the standalone output into a folder that runs on its own:
//
//   npm run build:standalone
//
// `next build --webpack` with output: "standalone" writes .next/standalone/ (server.js, a traced
// node_modules, .next/server ...) but deliberately does NOT copy:
//   .next/static  -> .next/standalone/.next/static   the CSS, the JavaScript chunks and the
//                                                    self-hosted Inter font files. Without it
//                                                    every page loads unstyled and nothing
//                                                    on it works.
//   public/       -> .next/standalone/public         files served from the site root (empty
//                                                    today; copied anyway, so a file added
//                                                    later is not silently missing)
// and it knows nothing of the cPanel startup file:
//   deploy/app.js -> .next/standalone/app.js
// This script copies all three, then checks the result. The finished folder,
// .next/standalone/, is what goes to the server. It never contains an .env file: the
// environment comes from the host (docs/DEPLOY.md).
//
// assembleStandalone() is also used by scripts/screenshots.ts, so every visual check runs the
// same artifact that is deployed.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

// WEBPACK, NEVER TURBOPACK: a HOST CONSTRAINT, not a preference. The cPanel host's glibc is
// older than 2.29, so Next's native SWC (@next/swc-linux-x64-gnu) cannot load there; Next
// falls back to the WebAssembly SWC bindings, and Turbopack refuses to run without native
// bindings. Every build (this one, `npm run build`, and the screenshot runner's) uses these
// arguments, so what is checked locally is what ships. See docs/DEPLOY.md.
export const NEXT_BUILD_ARGS = ["build", "--webpack"];
const OUT = join(ROOT, ".next", "standalone");

export function assembleStandalone() {
  if (!existsSync(join(OUT, "server.js"))) throw new Error("No .next/standalone/server.js: run `next build` with output: \"standalone\" first.");

  const staticOut = join(OUT, ".next", "static");
  rmSync(staticOut, { recursive: true, force: true });
  cpSync(join(ROOT, ".next", "static"), staticOut, { recursive: true });

  const publicOut = join(OUT, "public");
  rmSync(publicOut, { recursive: true, force: true });
  if (existsSync(join(ROOT, "public"))) cpSync(join(ROOT, "public"), publicOut, { recursive: true });

  cpSync(join(ROOT, "deploy", "app.js"), join(OUT, "app.js"));

  // The checks: the startup file, the server, styles, fonts, and no environment file.
  const has = (...parts) => existsSync(join(OUT, ...parts));
  // Anywhere under .next/static: webpack writes CSS to static/css/, Turbopack wrote it to
  // static/chunks/; the check must not depend on one bundler's layout.
  const css = readdirSync(join(OUT, ".next", "static"), { recursive: true }).some((f) => String(f).endsWith(".css"));
  const fonts = has(".next", "static", "media") && readdirSync(join(OUT, ".next", "static", "media")).some((f) => f.endsWith(".woff2"));
  const envFiles = readdirSync(OUT).filter((f) => f.startsWith(".env"));
  const missing = [
    has("app.js") ? null : "app.js",
    has("server.js") ? null : "server.js",
    has("node_modules", "next") ? null : "node_modules/next",
    has("node_modules", "pg") ? null : "node_modules/pg",
    css ? null : "CSS in .next/static",
    fonts ? null : "font files in .next/static/media",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`The assembled standalone output is missing: ${missing.join(", ")}`);
  if (envFiles.length > 0) throw new Error(`An environment file is in the standalone output and must not be deployed: ${envFiles.join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const build = spawnSync(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), ...NEXT_BUILD_ARGS], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
  assembleStandalone();
  console.log("Standalone output assembled in .next/standalone/ (start it with: node app.js).");
}
