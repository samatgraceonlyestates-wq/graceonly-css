// A scenario for scripts/screenshots.ts: THE VISITOR LOG, end to end (screens 04, 03, 05 and
// the dashboard). It WRITES visits, so run it only against a THROWAWAY schema: seed it with
// scripts/shots-arrivals.seed.sql (the account) and scripts/shots-visits.seed.sql, then
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-visits.ts
//
// THE PORTAL IS A STAND-IN, never the real one: prepare() starts scripts/portalStub.ts on
// 127.0.0.1 (made-up clients, a made-up key) and points the app at it. The scenario switches it
// DOWN (503 on everything) to prove check-in still works and records PORTAL_UNAVAILABLE. It
// lives in the screenshot process and ends with it. It cannot be re-run on the same data:
// reseed first.
import type { Page } from "@playwright/test";
import { startPortalStub, type PortalStub } from "./portalStub.ts";
import type { ScenarioHelpers } from "./screenshots.ts";

let portal: PortalStub;

/** Starts the stand-in portal (scripts/portalStub.ts) and points the app at it. Runs before the server starts. */
export async function prepare(): Promise<Record<string, string>> {
  const started = await startPortalStub(3458);
  portal = started.stub;
  return started.env;
}

const lagosDay = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() - daysAgo * 24 * 3600 * 1000));

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const body = (page: Page) => page.locator("body").innerText();
  const settle = (page: Page) => page.waitForLoadState("networkidle");
  const visitUrl = /\/visits\/[0-9a-f-]{36}/;
  const chip = async (page: Page, label: string) =>
    Number((await page.getByRole("list", { name: "Visits in the building, by type" }).getByRole("listitem").filter({ hasText: new RegExp(`^${label}`) }).innerText()).replace(/\D+/g, ""));

  try {
    // ------------------------------------------------------------ 03 on the seeded day
    const page = await open("desktop");
    await page.goto(`${base}/visits`, { waitUntil: "networkidle" });
    let text = await body(page);
    expect(text.includes("Tunde Afolabi") && /Since \d+ \w+ \d{4}/.test(text), "03: Tunde's visit from two days ago should be in the building, 'Since <day>'");
    expect(/still open/i.test(text), "03: the forgotten visit's status should say Still open");
    expect(text.includes("Kingsley Eze"), "03: Kingsley (a client) should be in the building");
    expect((await chip(page, "All")) === 2, `03: 2 in the building, got ${await chip(page, "All")}`);
    expect(/Left today\s*1/.test(text) && text.includes("Grace Eke"), "03: Grace should be under Left today");
    expect(text.includes("corrected") && text.includes("the book says 00:05") && text.includes("Kemi Lawal"), "03: Grace's correction is marked, with who and why");
    expect(/Removed visits\s*1/.test(text) && text.includes("typed twice"), "03: the removed visit is listed apart, with its reason");
    expect(text.includes("2 visits"), "03: today's count is 2 (the removed one and the one from two days ago do not count)");
    await shot(page, "visits-01-seeded-desktop");
    const phone03 = await open("phone");
    await phone03.goto(`${base}/visits`, { waitUntil: "networkidle" });
    await shot(phone03, "visits-01-seeded-phone");

    // ------------------------------------------------------------ dashboard, seeded
    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    text = await body(page);
    expect(/VISITS TODAY\s*2/i.test(text) && /Yesterday: 1 in all/.test(text), "dashboard: 2 visits today, yesterday 1");
    expect(/ACTIVE NOW\s*2/i.test(text) && text.includes("1 open from an earlier day"), "dashboard: 2 active, 1 from an earlier day");
    expect(text.includes("Not connected yet") && !/Mrs\. Okolo|Receipt not reflected/.test(text), "dashboard: complaints say not connected, no sample cases");
    await shot(page, "visits-02-dashboard-desktop");

    // ------------------------------------------------------------ 04: a client, MATCHED
    await page.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Client name").fill("Chidinma Okafor");
    await page.getByRole("button", { name: "Look up" }).click();
    await page.getByRole("radio", { name: /^Chidinma Okafor/ }).check();
    await page.getByRole("heading", { name: "Chidinma Okafor" }).waitFor({ timeout: 20_000 }); // the brief, from the portal
    await page.getByRole("radio", { name: "Document collection" }).check();
    await page.getByLabel("Here to see (optional)").fill("Peter Obi");
    await shot(page, "visits-03-new-client-desktop");
    await page.getByRole("button", { name: /^Check in Chidinma/ }).click();
    await page.waitForURL(visitUrl, { timeout: 20_000 });
    await settle(page);
    text = await body(page);
    expect(text.includes("Checked in") && text.includes("Chidinma Okafor was checked in at"), "05: the check-in is confirmed");
    expect(text.includes("Client, picked from the portal's records") && text.includes("to see Peter Obi"), "05: MATCHED, and who they came to see");
    expect(!text.includes("Not verified"), "05: a matched client is not 'not verified'");
    expect(text.includes("Release position unknown"), "05: the live portal panels are shown for a client");
    await shot(page, "visits-04-checked-in-desktop");
    const chidinmaVisit = page.url().split("?")[0]!;

    // The same client again: refused, naming the open visit.
    await page.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Client name").fill("Chidinma Okafor");
    await page.getByRole("button", { name: "Look up" }).click();
    await page.getByRole("radio", { name: /^Chidinma Okafor/ }).check();
    await page.getByRole("radio", { name: "Inquiry" }).check();
    await page.getByRole("button", { name: /^Check in Chidinma/ }).click();
    await page.getByText("Chidinma Okafor is already checked in since").waitFor({ timeout: 20_000 });
    await shot(page, "visits-05-one-open-visit-desktop");

    // ------------------------------------------------------------ 04: the portal is DOWN
    portal.down = true;
    await page.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Client name").fill("Mrs Okolo");
    await page.getByRole("button", { name: "Look up" }).click();
    await page.getByText("The portal could not be reached").waitFor({ timeout: 30_000 });
    await page.getByRole("radio", { name: "Inquiry" }).check();
    // Without consent: refused, nothing written.
    await page.getByRole("button", { name: /^Check in Mrs/ }).click();
    await page.getByText("Ask whether they agree to their name and number being recorded").waitFor({ timeout: 20_000 });
    await page.getByLabel("Phone (optional)").fill("0803 111 2222");
    await page.getByRole("checkbox").check();
    await shot(page, "visits-06-portal-down-desktop");
    await page.getByRole("button", { name: /^Check in Mrs/ }).click();
    await page.waitForURL(visitUrl, { timeout: 20_000 });
    await settle(page);
    text = await body(page);
    expect(text.includes("Not verified") && text.includes("the portal could not be reached when they were checked in"), "05: PORTAL_UNAVAILABLE says NOT VERIFIED");
    expect(text.includes("+234 803 111 2222"), "05: the phone was normalised to +234 and shown back");
    await shot(page, "visits-07-not-verified-desktop");
    const phoneDown = await open("phone");
    await phoneDown.goto(page.url(), { waitUntil: "networkidle" });
    await shot(phoneDown, "visits-07-not-verified-phone");
    const okoloVisit = page.url().split("?")[0]!;
    portal.down = false;

    // ------------------------------------------------------------ 04: a non-client, NOT_LOOKED_UP
    const searchesBefore = portal.searches;
    await page.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /^Delivery/ }).check();
    await page.getByLabel("Visitor's name").fill("DHL Courier");
    await page.getByLabel("Organisation (optional)").fill("DHL");
    await page.getByRole("checkbox").check();
    await page.getByRole("radio", { name: "Inquiry" }).check();
    await page.getByRole("button", { name: /^Check in DHL/ }).click();
    await page.waitForURL(visitUrl, { timeout: 20_000 });
    await settle(page);
    expect((await body(page)).includes("Not a client: no lookup made"), "05: a delivery is NOT_LOOKED_UP");
    expect(portal.searches === searchesBefore, "04: a non-client type must never search the portal");
    const dhlVisit = page.url().split("?")[0]!;

    // ------------------------------------------------------------ 04: a repeat visitor, by phone, confirmed
    await page.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /^Visitor/ }).check();
    await page.getByLabel("Visitor's name").fill("Bola Adey");
    await page.getByLabel("Phone (optional)").fill("+234 803 555 0000");
    await page.getByRole("checkbox").check();
    await page.getByRole("radio", { name: "Scheduled meeting" }).check();
    await page.getByRole("button", { name: /^Check in Bola/ }).click();
    await page.getByText("That number is on file for Bola Ade").waitFor({ timeout: 20_000 });
    await shot(page, "visits-08-repeat-visitor-desktop");
    const phone04 = await open("phone");
    await phone04.goto(`${base}/visits/new`, { waitUntil: "networkidle" });
    await phone04.getByRole("radio", { name: /^Visitor/ }).check();
    await phone04.getByLabel("Visitor's name").fill("Someone New");
    await phone04.getByRole("checkbox").waitFor();
    await shot(phone04, "visits-09-new-visitor-phone");
    await page.getByRole("button", { name: "Yes, it is Bola Ade" }).click();
    await page.waitForURL(visitUrl, { timeout: 20_000 });
    await settle(page);
    text = await body(page);
    expect(text.includes("Bola Ade") && !text.includes("Bola Adey"), "05: the repeat visit is under the name on file, Bola Ade");

    // ------------------------------------------------------------ 03: check out from the row
    await page.goto(`${base}/visits`, { waitUntil: "networkidle" });
    expect((await chip(page, "All")) === 6, `03: 6 in the building now, got ${await chip(page, "All")}`);
    expect((await body(page)).includes("not verified"), "03: Mrs Okolo's row says not verified");
    await page.getByRole("button", { name: "Check out Chidinma Okafor" }).click();
    await page.waitForFunction(() => /Left today\s*2/.test(document.body.innerText), null, { timeout: 20_000 });
    expect((await chip(page, "All")) === 5, "03: 5 left in the building after one check-out");
    await shot(page, "visits-10-after-checkout-desktop");
    // The same check-out again, from 05 (a stale page): says who got there first.
    await page.goto(chidinmaVisit, { waitUntil: "networkidle" });
    expect((await body(page)).includes("Checked out"), "05: Chidinma's visit is checked out");

    // ------------------------------------------------------------ 05: corrections
    await page.goto(dhlVisit, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Correct…" }).click();
    await page.getByRole("button", { name: "Change the reason" }).click();
    await page.getByRole("combobox").selectOption("DOCUMENT_COLLECTION");
    await shot(page, "visits-11-correct-panel-desktop");
    await page.getByLabel("Why? (required)").fill("it was a document drop");
    await page.getByRole("button", { name: "Save correction" }).click();
    await page.getByText("DHL Courier: reason changed from Inquiry to Document collection.").waitFor({ timeout: 20_000 });
    text = await body(page);
    expect(/corrected/i.test(text) && text.includes("it was a document drop"), "05: the visit is marked Corrected, with the reason");
    expect(text.includes("Reason changed"), "05: the timeline shows the correction");

    // Remove, then restore.
    await page.getByRole("button", { name: "Correct…" }).click();
    await page.getByRole("button", { name: "Remove: entered wrongly" }).click();
    await page.getByLabel("Why? (required)").fill("test removal");
    await page.getByRole("button", { name: "Remove this visit" }).click();
    await page.getByText("This visit was removed").waitFor({ timeout: 20_000 });
    await page.goto(`${base}/visits`, { waitUntil: "networkidle" });
    expect((await chip(page, "All")) === 4 && /Removed visits\s*2/.test(await body(page)), "03: a removed visit leaves the building count and joins Removed");
    await page.goto(dhlVisit, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Restore…" }).click();
    await page.getByLabel("Why? (required)").fill("removed by mistake");
    await page.getByRole("button", { name: "Restore this visit" }).click();
    await page.getByText("DHL Courier's visit was restored.").waitFor({ timeout: 20_000 });

    // A stale panel: the other front-desk person changed the visit meanwhile.
    const other = await open("desktop");
    await page.goto(okoloVisit, { waitUntil: "networkidle" });
    await other.goto(okoloVisit, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Correct…" }).click();
    await page.getByRole("button", { name: "Change who they came to see" }).click();
    await other.getByRole("button", { name: "Correct…" }).click();
    await other.getByRole("button", { name: "Change who they came to see" }).click();
    await other.getByLabel("Here to see (empty to clear)").fill("Legal");
    await other.getByLabel("Why? (required)").fill("she named Legal");
    await other.getByRole("button", { name: "Save correction" }).click();
    await other.getByText("Mrs Okolo: came to see Legal.").waitFor({ timeout: 20_000 });
    await page.getByLabel("Here to see (empty to clear)").fill("Accounts");
    await page.getByLabel("Why? (required)").fill("she named Accounts");
    await page.getByRole("button", { name: "Save correction" }).click();
    await page.getByText("This visit was changed by someone else while you were looking at it").waitFor({ timeout: 20_000 });
    await shot(page, "visits-12-stale-correction-desktop");

    // ------------------------------------------------------------ 03: end of day
    await page.goto(`${base}/visits`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Close 5 open visits/ }).click();
    text = await body(page);
    expect(text.includes("Tunde Afolabi") && text.includes("by you"), "03: the confirmation names the visits and says who closes them");
    await shot(page, "visits-13-end-of-day-confirm-desktop");
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await chip(page, "All")) === 5, "03: cancelling changes nothing");
    await page.getByRole("button", { name: /^Close 5 open visits/ }).click();
    await page.getByRole("button", { name: "Yes, close 5" }).click();
    await page.getByText("5 visits closed with no time out.").waitFor({ timeout: 20_000 });
    text = await body(page);
    expect((await chip(page, "All")) === 0, "03: nobody is in the building after the end of day");
    expect(text.includes("left: not recorded") && text.includes("when they left is unknown"), "03: closed visits say their end is unknown, not a duration");
    await shot(page, "visits-14-after-end-of-day-desktop");
    const phoneEnd = await open("phone");
    await phoneEnd.goto(`${base}/visits`, { waitUntil: "networkidle" });
    await shot(phoneEnd, "visits-14-after-end-of-day-phone");

    // Tunde, two days ago: give the closed visit its real time, on its own day.
    await page.goto(`${base}/visits?day=${lagosDay(2)}`, { waitUntil: "networkidle" });
    expect((await body(page)).includes("Tunde Afolabi"), "03: the earlier day lists Tunde");
    await page.getByRole("link", { name: /Tunde Afolabi/ }).first().click();
    await page.waitForURL(visitUrl);
    await settle(page);
    expect((await body(page)).includes("Left: not recorded"), "05: an end-of-day close shows no length");
    await page.getByRole("button", { name: "Correct…" }).click();
    await page.getByRole("button", { name: "Add the time they left" }).click();
    await page.getByLabel("Time they left").fill("1700");
    await page.getByLabel("Why? (required)").fill("the book says 17:00");
    await page.getByRole("button", { name: "Save correction" }).click();
    await page.getByText("Tunde Afolabi: left at 17:00").waitFor({ timeout: 20_000 });
    expect((await body(page)).includes("0h 50m"), "05: with a real time, the length is known: 16:10 to 17:00");
    await shot(page, "visits-15-time-given-desktop");

    // ------------------------------------------------------------ dashboard, after
    await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    text = await body(page);
    expect(/VISITS TODAY\s*6/i.test(text) && /ACTIVE NOW\s*0/i.test(text), `dashboard: 6 today, 0 active (got: ${text.slice(0, 400).replace(/\s+/g, " ")})`);
    await shot(page, "visits-16-dashboard-desktop");
    const phoneDash = await open("phone");
    await phoneDash.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    await shot(phoneDash, "visits-16-dashboard-phone");
    const phone05 = await open("phone");
    await phone05.goto(chidinmaVisit, { waitUntil: "networkidle" });
    await shot(phone05, "visits-17-client-visit-phone");

    expect(portal.keyHeaderSeen, "the app must send the service key header on every portal call");
  } finally {
    portal.close();
  }
}
