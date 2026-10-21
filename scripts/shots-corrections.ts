// A scenario for scripts/screenshots.ts: corrections on the board (/attendance), the day
// view, a stale correction, a stale clock-out, and the live refresh. It WRITES, so run it
// only against a THROWAWAY schema: seed it with scripts/shots-arrivals.seed.sql, then
// scripts/shots-board.seed.sql, then scripts/shots-corrections.seed.sql, and
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-corrections.ts
//
// It cannot be re-run on the same data: reseed first. It takes about two minutes, most of
// it waiting for the live refresh.
import type { Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const lagosToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const lagosYesterday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() - 24 * 3600 * 1000));
const lagosNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const body = (page: Page) => page.locator("body").innerText();
  const tile = async (page: Page, label: string) =>
    Number((await page.locator("p", { hasText: new RegExp(`^${label}`, "i") }).first().locator("xpath=following-sibling::div[1]").innerText()).trim());
  const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name }).first();
  const openCorrect = async (page: Page, name: string) => {
    await row(page, name).getByRole("button", { name: "Correct…" }).click();
    return page.getByRole("group", { name: `Correct ${name}` });
  };
  const correct = async (page: Page, name: string, choice: string, fields: { time?: string; reason?: string }) => {
    const panel = await openCorrect(page, name);
    await panel.getByRole("button", { name: choice }).click();
    if (fields.time !== undefined) await panel.getByLabel(/^New time/).fill(fields.time);
    if (fields.reason !== undefined) await panel.getByLabel(/^Why\?/).fill(fields.reason);
    await panel.getByRole("button", { name: /^(Save correction|Remove this record)$/ }).click();
    return panel;
  };

  // ---------------------------------------------------------------- phone: the correction panel
  const phone = await open("phone");
  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  const phonePanel = await openCorrect(phone, "Amaka Obi");
  await phonePanel.getByRole("button", { name: "Change time in" }).click();
  await shot(phone, "corr-1-panel-phone");

  // ---------------------------------------------------------------- desktop A
  const a = await open("desktop");
  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  expect((await tile(a, "In now")) === 9, `desktop: 9 IN to start with, got ${await tile(a, "In now")}`);

  // 1. No reason: refused. Whitespace passes the browser's own "required", so this is the server's answer.
  let panel = await openCorrect(a, "Amaka Obi");
  await panel.getByRole("button", { name: "Change time in" }).click();
  await panel.getByLabel(/^New time/).fill("0003");
  await panel.getByLabel(/^Why\?/).fill("   ");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await panel.getByText("A correction needs a reason").waitFor({ timeout: 20_000 });
  expect(!/corrected/i.test(await body(a)), "desktop: a correction without a reason must change nothing");
  await shot(a, "corr-2-needs-reason-desktop");

  // 2. With a reason: the time changes and the row says so, with who, when and why.
  await panel.getByLabel(/^Why\?/).fill("Book says 00:03");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await row(a, "Amaka Obi").getByText("Book says 00:03").waitFor({ timeout: 20_000 });
  let text = await body(a);
  expect(!text.includes("changed after you opened this"), "desktop: her own correction must not trigger the stale warning");
  expect(/corrected/i.test(text) && text.includes("Book says 00:03") && text.includes("Screenshot Account"), "desktop: the corrected row should show who and why");
  await shot(a, "corr-3-corrected-desktop");

  // 3. Reopen a clock-out made by mistake (Halima, gone 00:13 to 00:20).
  await correct(a, "Halima Garba", "Reopen: undo clock-out", { reason: "Clocked out by mistake" });
  await a.waitForFunction(() => document.body.innerText.includes("Clocked out by mistake"), null, { timeout: 20_000 });
  expect((await tile(a, "Gone for the day")) === 2, "desktop: Halima should have left Gone");
  expect((await tile(a, "In now")) === 10, "desktop: and be back IN");

  // 4. Unmark a never-signed-out (Chidera).
  await correct(a, "Chidera Nnamdi", "Unmark: back to still in", { reason: "She did sign out" });
  await a.waitForFunction(() => document.body.innerText.includes("She did sign out"), null, { timeout: 20_000 });
  expect((await tile(a, "No sign-out")) === 0, "desktop: Chidera should be unmarked");
  expect((await tile(a, "In now")) === 11, "desktop: and IN");

  // 5. Remove a record entered for the wrong person (Funke).
  await correct(a, "Funke Adebisi", "Remove: wrong person", { reason: "Entered for the wrong person" });
  await a.getByText("Removed records").waitFor({ timeout: 20_000 });
  text = await body(a);
  expect(text.includes("Entered for the wrong person") && text.includes("Removed records"), "desktop: the removed record should be listed with its reason");
  expect((await tile(a, "In now")) === 10, "desktop: a removed record is in no count");
  await shot(a, "corr-4-removed-desktop");

  // 6. An earlier day: view yesterday, change a time out; reopening Zainab's closed record is
  //    BLOCKED because she is IN today.
  await a.goto(`${base}/attendance?day=${lagosYesterday()}`, { waitUntil: "networkidle" });
  text = await body(a);
  expect(text.includes("Who was in") && /\w+day, \d+ \w+ \d{4}/.test(text), "desktop: an earlier day should be titled and dated in words");
  await correct(a, "Kelechi Ibe", "Change time out", { time: "1700", reason: "Book says 17:00" });
  await a.waitForFunction(() => document.body.innerText.includes("Book says 17:00"), null, { timeout: 20_000 });
  panel = await correct(a, "Zainab Musa", "Reopen: undo clock-out", { reason: "Testing the rule" });
  await panel.getByText("can have only one open shift").waitFor({ timeout: 20_000 });
  expect((await body(a)).includes("already recorded as in since"), "desktop: reopening should say why it cannot");
  await shot(a, "corr-5-reopen-blocked-desktop");

  // 7. A stale CORRECTION: A opens Blessing; B corrects her first; A's save is refused cleanly.
  const b = await open("desktop");
  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await b.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  panel = await openCorrect(a, "Blessing Ike");
  await panel.getByRole("button", { name: "Change time in" }).click();
  await correct(b, "Blessing Ike", "Change time in", { time: "0004", reason: "B fixed it first" });
  await b.waitForFunction(() => document.body.innerText.includes("B fixed it first"), null, { timeout: 20_000 });
  await panel.getByLabel(/^New time/).fill("0005");
  await panel.getByLabel(/^Why\?/).fill("A typed this second");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await panel.getByText("changed by someone else").waitFor({ timeout: 20_000 });
  await shot(a, "corr-6-stale-correction-desktop");

  // 8. A stale CLOCK-OUT: B clocks Faith out; A, still showing her IN, tries and is told who got there first.
  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await b.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await row(a, "Faith Udo").getByRole("button", { name: "Clock out" }).click();
  await row(b, "Faith Udo").getByRole("button", { name: "Clock out" }).click();
  await b.getByRole("group", { name: "Clock out Faith Udo" }).getByRole("button", { name: /^Clock out Faith/ }).click();
  await b.waitForFunction(() => !document.querySelector('[aria-label="Clock out Faith Udo"]'), null, { timeout: 20_000 });
  const aPanel = a.getByRole("group", { name: "Clock out Faith Udo" });
  await aPanel.getByRole("button", { name: /^Clock out Faith/ }).click();
  await aPanel.getByText(/was already clocked out at \d\d:\d\d by Screenshot Account/).waitFor({ timeout: 20_000 });
  await shot(a, "corr-7-stale-clockout-desktop");

  // 9. The live refresh: B clocks Mariam out; A sees it without a reload (within about a minute).
  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  const goneBefore = await tile(a, "Gone for the day");
  await b.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await row(b, "Mariam Yusuf").getByRole("button", { name: "Clock out" }).click();
  await b.getByRole("group", { name: "Clock out Mariam Yusuf" }).getByRole("button", { name: /^Clock out Mariam/ }).click();
  await b.waitForFunction(() => !document.querySelector('[aria-label="Clock out Mariam Yusuf"]'), null, { timeout: 20_000 });
  let refreshed = false;
  for (let waited = 0; waited < 80_000 && !refreshed; waited += 2_000) {
    await a.waitForTimeout(2_000);
    refreshed = (await tile(a, "Gone for the day")) === goneBefore + 1;
  }
  expect(refreshed, "desktop: the board should refresh by itself and show Mariam as gone (no reload)");
  void lagosToday;
  void lagosNow;

  // ---------------------------------------------------------------- phone: the corrected board
  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await shot(phone, "corr-8-board-phone");
}
