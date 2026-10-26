// A scenario for scripts/screenshots.ts: CSS BEHIND A PROXY THAT TERMINATES TLS AND FORWARDS
// PLAIN HTTP, which is what LiteSpeed does on the cPanel host. The browser speaks https to the
// proxy; the app (the assembled standalone output, started by the runner) only ever sees http.
//
//   npm run shots -- --scenario=scripts/shots-tls.ts            (from PowerShell)
//
// It READS ONLY (it signs the screenshot account in and out, as every run does). It makes a
// throwaway self-signed certificate with openssl in a temporary folder, runs an https proxy on
// 127.0.0.1:443 for the length of the scenario, and removes both in `finally`: nothing is left.
// The browser reaches it as https://frontdesk.graceonlyestates.com, the REAL public name,
// mapped to 127.0.0.1 inside this Chromium only (--host-resolver-rules; no hosts file is
// touched), so the Origin it sends is exactly the production one.
//
// It does not know which headers LiteSpeed sends, so it tries the three shapes a proxy can
// take, each from a clean browser:
//   keep-host    Host passed through, X-Forwarded-For added, NO X-Forwarded-Proto (the least)
//   fwd-host     Host rewritten to the app's address, X-Forwarded-Host and -Proto set
//   bare         Host rewritten, nothing forwarded at all (the worst)
// and in each checks: a signed-out visit is sent to the https sign-in page (not http), signing
// in sticks (the Secure cookie is kept), the board and the register come with their CSS and
// fonts, and a server action (signing out) is accepted.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const PUBLIC_HOST = "frontdesk.graceonlyestates.com";
const PROXY_PORT = 443;
const OPENSSL = process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl";

type Mode = "keep-host" | "fwd-host" | "bare";

function startProxy(mode: Mode, appBase: string, cert: { key: Buffer; cert: Buffer }): Promise<Server> {
  const app = new URL(appBase);
  const server = createHttpsServer(cert, (incoming, outgoing) => {
    const headers = { ...incoming.headers };
    const originalHost = incoming.headers.host ?? "";
    headers["x-forwarded-for"] = "203.0.113.9";
    if (mode !== "keep-host") headers.host = app.host;
    if (mode === "fwd-host") {
      headers["x-forwarded-host"] = originalHost;
      headers["x-forwarded-proto"] = "https";
    }
    const upstream = httpRequest({ host: app.hostname, port: app.port, method: incoming.method, path: incoming.url, headers }, (reply) => {
      outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(outgoing);
    });
    upstream.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROXY_PORT, "127.0.0.1", () => resolve(server));
  });
}

export default async function scenario({ base, shot, problem }: ScenarioHelpers): Promise<void> {
  const email = process.env.CSS_SHOT_EMAIL;
  const password = process.env.CSS_SHOT_PASSWORD;
  if (!email || !password) throw new Error("No screenshot account in .env.local.");

  const dir = mkdtempSync(join(tmpdir(), "css-tls-"));
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${PUBLIC_HOST} 127.0.0.1`] });
  let proxy: Server | null = null;
  try {
    const made = spawnSync(OPENSSL, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${PUBLIC_HOST}`, "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], {
      stdio: "ignore",
    });
    if (made.status !== 0) throw new Error("openssl could not make the throwaway certificate.");
    const cert = { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
    const https = `https://${PUBLIC_HOST}`;

    for (const mode of ["keep-host", "fwd-host", "bare"] as const) {
      proxy = await startProxy(mode, base, cert);
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      const fail = (message: string) => problem(`[tls ${mode}] ${message}`);
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("response", (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });

      // 1. Signed out: sent to the https sign-in page, never to http.
      await page.goto(`${https}/attendance`, { waitUntil: "networkidle" }).catch((error: Error) => fail(`the first visit failed: ${error.message}`));
      if (!page.url().startsWith(`${https}/login`)) fail(`a signed-out visit should land on ${https}/login, landed on ${page.url()}`);

      // 2. Sign in through the proxy: the Secure cookie must be kept, and the server action accepted.
      await page.goto(`${https}/login?next=%2Fattendance`, { waitUntil: "networkidle" });
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => fail(`signing in did not leave the sign-in page (still on ${page.url()})`));
      const cookie = (await context.cookies(https)).find((entry) => entry.name === "css_session");
      if (cookie === undefined) fail("no session cookie was kept");
      else if (!cookie.secure || !cookie.httpOnly) fail("the session cookie should be Secure and httpOnly");

      // 3. The board and the register, styled and with their fonts.
      for (const path of ["/attendance", "/attendance/register"]) {
        await page.goto(`${https}${path}`, { waitUntil: "networkidle" });
        if (new URL(page.url()).pathname !== path) {
          fail(`${path} ended up at ${page.url()}`);
          continue;
        }
        const look = await styled(page);
        if (!look.css) fail(`${path} has no stylesheet applied (body background ${look.background})`);
        if (!look.font) fail(`${path} did not load the Inter font (fonts: ${look.fonts})`);
        if (mode === "keep-host") await shot(page, `tls-${path.replace(/\W+/g, "-").replace(/^-/, "")}-desktop`);
      }

      // 4. A server action through the proxy: signing out (the avatar menu).
      await page.goto(`${https}/attendance`, { waitUntil: "networkidle" });
      await page.locator('summary[aria-label^="Account menu"]:visible').first().click().catch(() => undefined);
      const signOut = page.getByRole("button", { name: /sign out/i }).first();
      if (await signOut.isVisible().catch(() => false)) {
        await signOut.click();
        await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => fail(`signing out did not reach the sign-in page (on ${page.url()})`));
        if (!page.url().startsWith(https)) fail(`signing out landed on ${page.url()}, not on https`);
      } else {
        fail("could not find the sign-out control");
      }

      for (const error of errors) fail(error);
      await context.close();
      await new Promise((resolve) => proxy!.close(resolve));
      proxy = null;
    }
  } finally {
    if (proxy !== null) await new Promise((resolve) => proxy!.close(resolve));
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function styled(page: Page): Promise<{ css: boolean; font: boolean; background: string; fonts: string }> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const background = getComputedStyle(document.body).backgroundColor;
    const loaded = [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family);
    return {
      // --fold-canvas, #f9f8f6: only there if the stylesheet arrived.
      css: background === "rgb(249, 248, 246)",
      font: loaded.some((family) => /inter/i.test(family)),
      background,
      fonts: loaded.join(", ") || "none loaded",
    };
  });
}
