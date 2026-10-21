// Visual check: ONE bounded run that builds the app, starts the PRODUCTION build on
// a spare port, signs in, captures pages at desktop and phone width, and shuts the
// server down before it returns. Nothing is left running, on any exit path.
//
//   npm run shots:account                      (once: the local-only account)
//   npm run shots                              (every signed-in page)
//   npm run shots -- /attendance /dashboard    (just these)
//   npm run shots -- --scenario=scripts/shots-arrivals.ts
//                                              (drive a page: a module whose default
//                                               export gets { open, shot, problem })
//
// SHOTS_DATABASE_URL (optional) points the SERVER at another database, for a
// scenario that WRITES (it must not write to the owner's local data). It must
// point at this machine (assertLocalDatabaseUrl); a throwaway schema is chosen with
// "?options=-c%20search_path%3Dshot_e2e" on the URL. The screenshot account must
// exist in it. Nothing here ever touches the cPanel server.
//
// Pictures go to screenshots/ (git-ignored, never committed): <page>-desktop.png
// and <page>-phone.png. The run FAILS (exit 1) on a console error, a page error,
// a request that failed or answered 4xx/5xx, or a page that scrolls sideways.
// Pictures are still taken first, so a failing run can be looked at.
//
// The owner's dev server owns port 3000. This uses PORT below and refuses to
// start if it is taken, so the two cannot collide. The build writes to .next
// (dev writes to .next/dev), the same as running `npm run build` by hand.
//
// It signs in as the local-only account from scripts/screenshot-account.ts
// (CSS_SHOT_EMAIL / CSS_SHOT_PASSWORD in .env.local). It never reads a real
// person's credentials and never prints these.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { assertLocalDatabaseUrl } from "../src/lib/localDatabase.ts";

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = "screenshots";
const DEFAULT_PAGES = [
  "/dashboard",
  "/visits",
  "/visits/new",
  "/complaints",
  "/attendance",
  "/attendance/register",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
] as const;
const STARTUP_MS = 60_000;
const WHOLE_RUN_MS = 10 * 60_000;

let server: ChildProcess | null = null;

/** Kills the server and everything it started. Safe to call twice, and from an exit handler. */
function stopServer(): void {
  const child = server;
  server = null;
  if (child === null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopServer();
    process.exit(130);
  });
}
const watchdog = setTimeout(() => {
  console.error("Whole-run time limit reached. Stopping.");
  stopServer();
  process.exit(1);
}, WHOLE_RUN_MS);
watchdog.unref();

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

const NEXT_BIN = join("node_modules", "next", "dist", "bin", "next");

/** The server must not see the screenshot account's credentials. */
function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CSS_SHOT_EMAIL;
  delete env.CSS_SHOT_PASSWORD;
  if (process.env.SHOTS_DATABASE_URL) {
    assertLocalDatabaseUrl(process.env.SHOTS_DATABASE_URL);
    env.DATABASE_URL = process.env.SHOTS_DATABASE_URL;
  }
  return env;
}

function build(): void {
  console.log("Building (production)...");
  const result = spawnSync(process.execPath, [NEXT_BIN, "build"], { env: serverEnv(), encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stdout?.split("\n").slice(-40).join("\n"));
    console.error(result.stderr?.split("\n").slice(-40).join("\n"));
    throw new Error("The production build failed.");
  }
  console.log("Build passed.");
}

async function start(): Promise<void> {
  if (!(await portIsFree(PORT))) throw new Error(`Port ${PORT} is already in use. Not starting a second server.`);
  const log: string[] = [];
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { env: serverEnv(), stdio: ["ignore", "pipe", "pipe"] });
  server = child;
  const keep = (chunk: Buffer) => {
    log.push(chunk.toString());
    if (log.length > 200) log.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The server exited while starting:\n${log.join("").slice(-2000)}`);
    try {
      const response = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The server did not answer within ${STARTUP_MS / 1000}s:\n${log.join("").slice(-2000)}`);
}

function slug(path: string): string {
  return path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "") || "home";
}

const problems: string[] = [];

function watch(context: BrowserContext, label: string): void {
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`[${label}] console error on ${page.url()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`[${label}] page error on ${page.url()}: ${error.message}`));
    page.on("requestfailed", (request) => {
      // A navigation superseded by a redirect or a new navigation is not a failure.
      const reason = request.failure()?.errorText ?? "failed";
      if (reason.includes("ERR_ABORTED")) return;
      problems.push(`[${label}] request failed: ${request.method()} ${request.url()} (${reason})`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) problems.push(`[${label}] ${response.status()} for ${response.request().method()} ${response.url()}`);
    });
  });
}

async function signIn(browser: Browser): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const email = process.env.CSS_SHOT_EMAIL;
  const password = process.env.CSS_SHOT_PASSWORD;
  if (!email || !password) throw new Error("No screenshot account in .env.local. Run: npm run shots:account");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }), page.click('button[type="submit"]')]);
  if (page.url().includes("/change-password")) throw new Error("The screenshot account still has must_change_password set. Run: npm run shots:account");
  const state = await context.storageState();
  await context.close();
  return state;
}

/** What a scenario module gets: pages already signed in, with the same failure watching as the sweep. */
export interface ScenarioHelpers {
  base: string;
  open(viewport: (typeof VIEWPORTS)[number]["name"]): Promise<Page>;
  /** Grows the viewport to the page's height (so a fixed bar sits at the bottom) and saves a picture. */
  shot(page: Page, name: string): Promise<void>;
  /** Records a failed expectation; the run then exits 1. */
  problem(message: string): void;
}

async function fitAndShoot(page: Page, viewport: { width: number; height: number }, file: string): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(height, viewport.height), 6000) });
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioPath = args.find((arg) => arg.startsWith("--scenario="))?.slice("--scenario=".length);
  const named = args.filter((arg) => !arg.startsWith("--"));
  const pages = named.length > 0 ? named : scenarioPath ? [] : DEFAULT_PAGES;
  for (const path of pages) if (!path.startsWith("/")) throw new Error(`Pages are paths starting with "/": ${path}`);

  build();
  await start();
  console.log(`Production server up on ${BASE}.`);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const state = await signIn(browser);
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
        deviceScaleFactor: 1,
      });
      watch(context, viewport.name);
      for (const path of pages) {
        const page = await context.newPage();
        const response = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
        const landed = new URL(page.url()).pathname;
        if (landed !== path.split("?")[0]) problems.push(`[${viewport.name}] ${path} ended up at ${landed} (status ${response?.status()})`);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sideways > 0) problems.push(`[${viewport.name}] ${path} scrolls sideways by ${sideways}px`);
        const file = join(OUT_DIR, `${slug(path)}-${viewport.name}.png`);
        // A fullPage capture draws a fixed bar (the phone tab bar) wherever the
        // first screenful ends, in the middle of the page. Grow the viewport to the
        // page's height instead, so a fixed bar sits at the bottom as it would on a
        // phone scrolled to the end.
        await fitAndShoot(page, viewport, file);
        await page.close();
      }
      await context.close();
    }

    if (scenarioPath) {
      const opened: BrowserContext[] = [];
      const scenario = (await import(pathToFileURL(resolve(scenarioPath)).href)).default as (helpers: ScenarioHelpers) => Promise<void>;
      await scenario({
        base: BASE,
        problem: (message) => problems.push(`[scenario] ${message}`),
        async open(name) {
          const viewport = VIEWPORTS.find((candidate) => candidate.name === name)!;
          const context = await browser.newContext({
            storageState: state,
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: viewport.mobile,
            hasTouch: viewport.mobile,
            deviceScaleFactor: 1,
          });
          opened.push(context);
          watch(context, `scenario ${name}`);
          return context.newPage();
        },
        async shot(page, name) {
          const size = page.viewportSize() ?? { width: 1280, height: 900 };
          const viewport = size.width < 768 ? VIEWPORTS[1] : VIEWPORTS[0];
          await fitAndShoot(page, viewport, join(OUT_DIR, `${name}.png`));
        },
      });
      for (const context of opened) await context.close();
    }
  } finally {
    await browser.close();
  }
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : "The run failed.");
} finally {
  stopServer();
}

if (problems.length > 0) {
  failed = true;
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of [...new Set(problems)]) console.error(`  - ${problem}`);
}
const stillUp = !(await portIsFree(PORT));
if (stillUp) {
  failed = true;
  console.error(`DEFECT: something is still listening on port ${PORT} after shutdown.`);
}
console.log(failed ? "\nFAILED" : "\nOK: no console errors, failed requests or sideways scroll.");
process.exit(failed ? 1 : 0);
