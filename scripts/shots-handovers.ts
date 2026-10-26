// A scenario for scripts/screenshots.ts: DOCUMENT HANDOVERS on screen 05 (the visit), through
// every answer the portal can give: the gate OFF (as today), ON and ALLOWING, ON and BLOCKING,
// and the portal DOWN; then a correction appended and shown with its original, a replacement,
// a visit that cannot be removed because of them, a non-client refused, and the append-only
// triggers refusing an UPDATE made directly in the database.
//
// It WRITES, so run it only against a THROWAWAY schema seeded with scripts/shots-arrivals.seed.sql
// and scripts/shots-visits.seed.sql (Kingsley Eze, a client, in the building; Tunde Afolabi, a
// non-client):
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-handovers.ts
//
// THE PORTAL IS A STAND-IN (scripts/portalStub.ts on 127.0.0.1), never the real one. It cannot be
// re-run on the same data: reseed first.
import type { Locator, Page } from "@playwright/test";
import pg from "pg";
import { startPortalStub, type PortalStub } from "./portalStub.ts";
import type { ScenarioHelpers } from "./screenshots.ts";

const KINGSLEY_VISIT = "c0000000-0000-4000-8000-000000000005";
const TUNDE_VISIT = "c0000000-0000-4000-8000-000000000001";

let portal: PortalStub;

export async function prepare(): Promise<Record<string, string>> {
  const started = await startPortalStub(3458);
  portal = started.stub;
  return started.env;
}

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const card = (page: Page) => page.getByRole("region", { name: /^Documents handed over/ });
  const count = async (page: Page) => Number((await card(page).getByRole("heading").innerText()).replace(/\D+/g, ""));
  const entry = (page: Page, text: string): Locator => card(page).getByRole("listitem").filter({ hasText: text }).first();
  const visit = `${base}/visits/${KINGSLEY_VISIT}`;

  async function fill(page: Page, quantities: Record<string, string>) {
    await card(page).getByRole("button", { name: /^Record (a handover|the right one)/ }).first().click();
    for (const [label, quantity] of Object.entries(quantities)) await page.getByLabel(`How many ${label}`).fill(quantity);
    await page.getByRole("button", { name: "Check with the portal and record" }).click();
  }

  try {
    // ------------------------------------------------------------ the visit, before anything
    const page = await open("desktop");
    await page.goto(visit, { waitUntil: "networkidle" });
    let text = await page.locator("body").innerText();
    expect(text.includes("Release position unknown — do not release"), "05: the gate is off: the banner says do not release");
    expect(text.includes("Issued by the portal") && text.includes("not a release decision"), "05: issued documents say they are not a release decision");
    expect((await count(page)) === 0 && text.includes("No documents have been recorded as handed over"), "05: nothing handed over yet");
    await shot(page, "handovers-01-before-desktop");

    // ------------------------------------------------------------ THE GATE OFF: asked, then recorded as NOT VERIFIED
    await fill(page, { "Deed of Assignment": "1" });
    await page.getByText("Nobody can verify this release", { exact: true }).waitFor({ timeout: 20_000 });
    expect((await page.locator("body").innerText()).includes("Silence is not permission."), "gate off: the screen says silence is not permission");
    expect((await count(page)) === 0, "gate off: nothing is recorded before she confirms");
    await shot(page, "handovers-02-gate-off-confirm-desktop");
    await page.getByRole("button", { name: "Record it as NOT VERIFIED" }).click();
    await page.getByText(/^Recorded as NOT VERIFIED/).waitFor({ timeout: 20_000 });
    const first = entry(page, "Deed of Assignment × 1");
    expect((await first.innerText()).includes("NOBODY VERIFIED THIS RELEASE") && (await first.innerText()).includes("stub-gate-off"), "gate off: the record says nobody verified it, with the portal's reference");
    expect((await count(page)) === 1, "gate off: one handover recorded");

    // ------------------------------------------------------------ THE GATE BLOCKING: stopped, not warned
    portal.release = "block";
    await fill(page, { "Deed of Assignment": "1", "Receipt of Payment": "1" });
    await page.getByText("Not recorded: the portal refused", { exact: true }).waitFor({ timeout: 20_000 });
    text = await card(page).innerText();
    expect(text.includes("Deed of Assignment: Documentation fee outstanding"), "blocked: it names the refused document and why");
    expect((await page.getByRole("button", { name: "Record it as NOT VERIFIED" }).count()) === 0, "blocked: there is no way to record it anyway");
    expect((await count(page)) === 1, "blocked: nothing was recorded");
    await shot(page, "handovers-03-blocked-desktop");
    await card(page).getByRole("button", { name: "Cancel" }).click();

    // ------------------------------------------------------------ THE GATE ALLOWING
    portal.release = "allow";
    await fill(page, { "Provisional Survey Plan": "1" });
    await page.getByText(/^Recorded\. The portal's release-check allowed/).waitFor({ timeout: 20_000 });
    expect(/portal allowed/i.test(await entry(page, "Provisional Survey Plan × 1").innerText()), "allowed: marked Portal allowed");
    expect((await count(page)) === 2, "allowed: two handovers");

    // ------------------------------------------------------------ THE PORTAL DOWN
    portal.down = true;
    await page.goto(visit, { waitUntil: "networkidle" });
    expect((await page.locator("body").innerText()).includes("Client details not loaded"), "down: the page says the client details did not load, and still shows the visit");
    await fill(page, { "Receipt of Payment": "1" });
    await page.getByText("Nobody can verify this release", { exact: true }).waitFor({ timeout: 30_000 });
    expect((await card(page).innerText()).includes("could not be asked"), "down: says the portal could not be asked");
    await page.getByRole("button", { name: "Record it as NOT VERIFIED" }).click();
    await page.getByText(/^Recorded as NOT VERIFIED/).waitFor({ timeout: 30_000 });
    const downEntry = await entry(page, "Receipt of Payment × 1").innerText();
    expect(downEntry.includes("could not be asked") && downEntry.includes("No purchase recorded"), "down: recorded as unverified, with no purchase");
    await shot(page, "handovers-04-portal-down-desktop");
    portal.down = false;
    portal.release = "off";

    // ------------------------------------------------------------ A CORRECTION, APPENDED
    await page.goto(visit, { waitUntil: "networkidle" });
    await first.getByRole("button", { name: "Correct…" }).click();
    await page.getByLabel("What is wrong with this record? (required)").fill("two copies were handed over, not one");
    await page.getByRole("button", { name: "Withdraw this record" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("It no longer counts as a release."), null, { timeout: 20_000 });
    text = await first.innerText();
    expect(/withdrawn/i.test(text) && text.includes("two copies were handed over, not one") && text.includes("Deed of Assignment × 1"), "correction: the original is still listed, WITH its correction");
    expect((await count(page)) === 2, "correction: a withdrawn record counts for nothing");
    // The right one, recorded again (the portal asked again), naming the withdrawn record.
    await first.getByRole("button", { name: "Record the right one…" }).click();
    await page.getByLabel("How many Deed of Assignment").fill("2");
    await page.getByRole("button", { name: "Check with the portal and record" }).click();
    await page.getByRole("button", { name: "Record it as NOT VERIFIED" }).click();
    await page.getByText(/^Recorded as NOT VERIFIED/).waitFor({ timeout: 20_000 });
    text = await card(page).innerText();
    expect(/Replaces the record of \d\d:\d\d \(withdrawn: “two copies were handed over, not one”\)/.test(text), "replacement: names the withdrawn record and why");
    expect(/Replaced by the record of \d\d:\d\d/.test(text), "replacement: the original says what replaced it");
    expect((await count(page)) === 3, "replacement: three live handovers");
    await shot(page, "handovers-05-corrected-desktop");
    const phone = await open("phone");
    await phone.goto(visit, { waitUntil: "networkidle" });
    await shot(phone, "handovers-05-corrected-phone");

    // ------------------------------------------------------------ the visit cannot be removed now
    const corrections = page.getByRole("region", { name: "Corrections" });
    await corrections.getByRole("button", { name: "Correct…" }).click();
    await corrections.getByRole("button", { name: "Remove: entered wrongly" }).click();
    await corrections.getByLabel("Why? (required)").fill("test");
    await corrections.getByRole("button", { name: "Remove this visit" }).click();
    await page.getByText("has documents handed over recorded against it, so it cannot be removed").waitFor({ timeout: 20_000 });

    // ------------------------------------------------------------ a non-client: nothing can be recorded
    await page.goto(`${base}/visits/${TUNDE_VISIT}`, { waitUntil: "networkidle" });
    expect((await card(page).innerText()).includes("This visitor is not one"), "non-client: the card says documents go to clients only");
    expect((await card(page).getByRole("button", { name: /^Record/ }).count()) === 0, "non-client: no way to record a handover");
    const phoneTunde = await open("phone");
    await phoneTunde.goto(`${base}/visits/${TUNDE_VISIT}`, { waitUntil: "networkidle" });
    await shot(phoneTunde, "handovers-06-non-client-phone");

    // The dashboard counts today's live handovers (the withdrawn one does not count) and says how many nobody verified.
    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    const dashboard = await page.locator("body").innerText();
    expect(/DOCS RELEASED\s*3\s*2 not verified by the portal/i.test(dashboard), "dashboard: 3 documents handovers today, 2 not verified");
    await shot(page, "handovers-07-dashboard-desktop");

    expect(portal.keyHeaderSeen, "the app must send the service key header on every portal call");

    // ------------------------------------------------------------ THE DATABASE: append-only, and what was written
    const client = new pg.Client({ connectionString: process.env.SHOTS_DATABASE_URL });
    await client.connect();
    try {
      const rows = await client.query<{ gate_answer: string; replaces: boolean }>(
        "SELECT gate_answer, replaces_handover_id IS NOT NULL AS replaces FROM handover ORDER BY released_at",
      );
      expect(
        JSON.stringify(rows.rows.map((row) => row.gate_answer)) === JSON.stringify(["GATE_OFF", "CHECKED_ALLOWED", "UNAVAILABLE", "GATE_OFF"]),
        `db: four handovers (the blocked one was never written): ${rows.rows.map((row) => row.gate_answer).join(", ")}`,
      );
      expect(rows.rows[3]?.replaces === true, "db: the last one replaces the withdrawn record");
      for (const statement of [
        "UPDATE handover SET gate_answer = 'CHECKED_ALLOWED'",
        "DELETE FROM handover_item",
        "UPDATE handover_correction SET reason = 'changed'",
        "DELETE FROM handover_correction",
      ]) {
        let refused = "";
        try {
          await client.query(statement);
        } catch (error) {
          refused = (error as { code?: string }).code ?? "error";
        }
        expect(refused === "23001", `db: "${statement}" must be refused by the append-only trigger (got ${refused || "no error"})`);
      }
    } finally {
      await client.end();
    }
  } finally {
    portal.close();
  }
}
