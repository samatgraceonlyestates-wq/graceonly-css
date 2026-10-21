// A scenario for scripts/screenshots.ts: the movement book on the board (/attendance), the
// restore of removed records, and the refresh that must never take away what she is typing.
// It WRITES, so run it only against a THROWAWAY schema: seed it with
// scripts/shots-arrivals.seed.sql, then scripts/shots-board.seed.sql, then
// scripts/shots-movements.seed.sql, and
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-movements.ts
//
// It cannot be re-run on the same data: reseed first. It takes about two minutes, most of it
// waiting for the live refresh.
import type { Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const lagosYesterday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() - 24 * 3600 * 1000));

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const body = (page: Page) => page.locator("body").innerText();
  const tile = async (page: Page, label: string) =>
    Number((await page.locator("p", { hasText: new RegExp(`^${label}`, "i") }).first().locator("xpath=following-sibling::div[1]").innerText()).trim());
  // A server action and the page it refreshes land a moment apart: wait for the count rather than race it.
  const waitTile = async (page: Page, label: string, expected: number, why: string) => {
    let got = Number.NaN;
    for (let i = 0; i < 40; i += 1) {
      got = await tile(page, label);
      if (got === expected) return;
      await page.waitForTimeout(500);
    }
    expect(false, `${why} (${label} is ${got}, wanted ${expected})`);
  };
  // A person's own row: the one holding their NAME as a name (not a movement that says "approved by Peter Obi").
  const row = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).first();
  // A person's row in the REMOVED records list (a person can also have a live row).
  const removedRow = (page: Page, name: string) =>
    page.locator('section[aria-labelledby="removed-heading"]').getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).first();
  const rowButton = (page: Page, name: string, button: string) => row(page, name).getByRole("button", { name: button }).first();
  const focusedLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");

  // ---------------------------------------------------------------- B: opens a clock-out panel and LEAVES IT OPEN
  // (the refresh must not take it away, even though the page changes under it)
  const b = await open("desktop");
  await b.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  expect((await tile(b, "In now")) === 8, `desktop: 8 should be IN to start with, got ${await tile(b, "In now")}`);
  await waitTile(b, "Out on a movement", 1, "desktop: Tunde should be out on a movement to start with");
  await rowButton(b, "Amaka Obi", "Clock out").click();
  const bPanel = b.getByRole("group", { name: "Clock out Amaka Obi" });
  await bPanel.getByRole("textbox").fill("0020");

  // ---------------------------------------------------------------- phone: the board with a movement, and the panel
  const phone = await open("phone");
  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await rowButton(phone, "Divine Mike", "Out…").click();
  await shot(phone, "mv-1-leave-panel-phone");

  // ---------------------------------------------------------------- A: the desktop
  const a = await open("desktop");
  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  let text = await body(a);
  expect(text.includes("First Bank, Marina") && text.includes("approved by Peter Obi"), "desktop: Tunde's movement should show where and who approved it");
  expect(/Gone for\s*\n?\s*\d+[hm]/i.test(text) || text.includes("Gone for"), "desktop: an out person should show how long they have been gone");
  await shot(a, "mv-2-board-desktop");

  // 1. Amaka goes out: suggestions for where and what for; the approver by suggestion; all by keyboard.
  await rowButton(a, "Amaka Obi", "Out…").click();
  const whereBox = a.getByLabel("Where Amaka is going");
  await whereBox.focus();
  await a.keyboard.type("grace");
  await a.getByRole("option", { name: /GraceWaters Site/ }).waitFor();
  await shot(a, "mv-3-destination-suggestions-desktop");
  await a.keyboard.press("Enter"); // takes the single suggestion, on to what for
  expect((await whereBox.inputValue()) === "GraceWaters Site", "desktop: Enter should take the destination suggestion");
  expect((await focusedLabel(a)).includes("What Amaka is going for"), "desktop: focus should move on to what for");
  await a.keyboard.type("insp");
  await a.getByRole("option", { name: /Site inspection/ }).waitFor();
  await a.keyboard.press("Enter");
  await a.keyboard.type("peter");
  await a.getByRole("option", { name: /Peter Obi/ }).waitFor();
  await a.keyboard.press("Enter"); // takes Peter Obi, on to the time
  expect((await focusedLabel(a)) === "" || (await a.getByLabel("Time left").evaluate((el) => el === document.activeElement)), "desktop: focus should be on the time left");
  const defaultLeft = await a.getByLabel("Time left").inputValue();
  expect(/^\d\d:\d\d$/.test(defaultLeft), `desktop: the time left should default to now, got "${defaultLeft}"`);
  await shot(a, "mv-4-leave-ready-desktop");
  await a.keyboard.press("Enter"); // submits
  await a.waitForFunction(() => document.body.innerText.includes("GraceWaters Site") && document.body.innerText.includes("approved by Peter Obi"), null, { timeout: 20_000 });
  await waitTile(a, "Out on a movement", 2, "desktop: Amaka should be OUT now");
  await waitTile(a, "In now", 7, "desktop: and no longer IN");

  // 2. Faith goes out, the approver typed with a typo: the close-name question is answered from the keyboard.
  await rowButton(a, "Faith Udo", "Out…").click();
  await a.getByLabel("Where Faith is going").fill("Court");
  await a.getByLabel("What Faith is going for").fill("Hearing");
  await a.getByLabel("Approved by", { exact: true }).fill("Peter Obii");
  await a.keyboard.press("Enter");
  expect((await focusedLabel(a)).startsWith("Yes, Peter Obi"), `desktop: Enter on a close approver should land on the question, got "${await focusedLabel(a)}"`);
  await shot(a, "mv-5-approver-question-desktop");
  await a.keyboard.press("y");
  expect((await a.getByLabel("Approved by", { exact: true }).inputValue()) === "Peter Obi", "desktop: Y should take Peter Obi");
  expect(await a.getByLabel("Time left").evaluate((el) => el === document.activeElement), "desktop: and carry on at the time");
  await a.keyboard.press("Enter");
  await a.waitForFunction(() => document.body.innerText.includes("Court"), null, { timeout: 20_000 });
  await waitTile(a, "Out on a movement", 3, "desktop: Faith should be OUT now");

  // 3. Peter cannot approve his own movement; a time before his arrival is refused.
  await rowButton(a, "Peter Obi", "Out…").click();
  await a.getByLabel("Where Peter is going").fill("Bank");
  await a.getByLabel("What Peter is going for").fill("Lodgement");
  await a.getByLabel("Approved by", { exact: true }).fill("Peter Obi");
  await a.getByLabel("Time left").fill("0001");
  await a.getByRole("button", { name: "Peter goes out" }).click();
  await a.getByText("Time left must be after their time in, 00:06.").waitFor({ timeout: 20_000 });
  await a.getByLabel("Time left").fill("");
  await a.getByRole("button", { name: "Peter goes out" }).click();
  await a.getByText("Enter a time.").waitFor({ timeout: 20_000 });
  await a.getByLabel("Time left").fill("0030");
  await a.getByRole("button", { name: "Peter goes out" }).click();
  await a.getByText("A person cannot approve their own movement.").waitFor({ timeout: 20_000 });
  await shot(a, "mv-6-self-approval-desktop");
  await rowButton(a, "Peter Obi", "Close").click();

  // 4. B (stale: still showing Amaka IN, with its panel open) tries to clock her out: refused, with the reason.
  const typedStill = await bPanel.getByRole("textbox").inputValue();
  expect(typedStill === "0020", `desktop B: what was typed must survive the refreshes while the panel is open (got "${typedStill}")`);
  await bPanel.getByRole("button", { name: /^Clock out Amaka/ }).click();
  await bPanel.getByText("is recorded as out on a movement. Record their return first.").waitFor({ timeout: 20_000 });
  await shot(b, "mv-7-clockout-while-out-desktop");

  // 5. Tunde comes back: a return before the departure is refused; the default (now) works.
  await rowButton(a, "Tunde Bello", "Back…").click();
  const backBox = a.getByRole("group", { name: "Tunde Bello is back" }).getByLabel("Time back");
  expect(/^\d\d:\d\d$/.test(await backBox.inputValue()), "desktop: the time back should default to now");
  await backBox.fill("0001");
  await a.getByRole("button", { name: "Tunde is back" }).click();
  await a.getByText("Time back must be after the time they left, 00:12.").waitFor({ timeout: 20_000 });
  await shot(a, "mv-8-return-before-departure-desktop");
  await backBox.fill(await a.getByLabel("Time left").count() ? "" : "");
  const nowText = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  await backBox.fill(nowText.replace(":", ""));
  await a.getByRole("button", { name: "Tunde is back" }).click();
  await a.waitForFunction(() => document.body.innerText.includes("Gone for the day"), null, { timeout: 20_000 });
  await a.waitForFunction(() => !document.querySelector('[aria-label="Tunde Bello is back"]'), null, { timeout: 20_000 });
  await waitTile(a, "Out on a movement", 2, "desktop: Tunde should be back");
  await waitTile(a, "In now", 7, "desktop: and IN again (Amaka and Faith are out, Tunde is back)");

  // 6. Correct a movement: no reason is refused; a time, the destination (suggested) and the approver; then it shows who and why.
  const mariamMovement = row(a, "Mariam Yusuf").locator("li", { hasText: "Federal Land Registry" }).first();
  await mariamMovement.getByRole("button", { name: "Correct…" }).click();
  let panel = a.getByRole("group", { name: "Correct movement: Federal Land Registry" });
  await panel.getByRole("button", { name: "Change time back" }).click();
  await panel.getByLabel("New time back").fill("0014");
  await panel.getByLabel(/^Why\?/).fill("   ");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await panel.getByText("A correction needs a reason").waitFor({ timeout: 20_000 });
  await panel.getByLabel(/^Why\?/).fill("Book says 00:14");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await row(a, "Mariam Yusuf").getByText("Book says 00:14").waitFor({ timeout: 20_000 });
  text = await body(a);
  expect(/corrected/i.test(text) && text.includes("by Screenshot Account"), "desktop: a corrected movement should say who and why");

  await rowButton(a, "Mariam Yusuf", "Correct…").scrollIntoViewIfNeeded();
  await row(a, "Mariam Yusuf").locator("li", { hasText: "Federal Land Registry" }).first().getByRole("button", { name: "Correct…" }).click();
  panel = a.getByRole("group", { name: "Correct movement: Federal Land Registry" });
  await panel.getByRole("button", { name: "Change approver" }).click();
  await panel.getByLabel("New approver").fill("Peter Obii");
  await a.keyboard.press("Enter");
  expect((await focusedLabel(a)).startsWith("Yes, Peter Obi"), "desktop: a close approver on a correction should ask the same question");
  await a.keyboard.press("n");
  await panel.getByLabel(/^Why\?/).fill("Wrong approver");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await row(a, "Mariam Yusuf").getByText("Wrong approver").waitFor({ timeout: 20_000 });
  await shot(a, "mv-9-corrected-movement-desktop");

  // 7. Remove an OPEN movement (Amaka): she is IN again (a removed movement counts for nothing) and can go out again.
  await row(a, "Amaka Obi").locator("li", { hasText: "GraceWaters Site" }).first().getByRole("button", { name: "Correct…" }).click();
  panel = a.getByRole("group", { name: "Correct movement: GraceWaters Site" });
  await panel.getByRole("button", { name: "Remove this movement" }).first().click();
  await panel.getByLabel(/^Why\?/).fill("Never left");
  await panel.getByRole("button", { name: "Remove this movement" }).last().click();
  await a.waitForFunction(() => document.body.innerText.includes("Never left"), null, { timeout: 20_000 });
  await waitTile(a, "Out on a movement", 1, "desktop: a removed movement must not count as out (only Faith is out)");
  await waitTile(a, "In now", 8, "desktop: Amaka should be IN again");
  expect(/\bRemoved\b/i.test(await body(a)), "desktop: the removed movement should be listed as removed");
  await shot(a, "mv-10-removed-movement-desktop");
  // ...and restore it (the way back).
  await row(a, "Amaka Obi").locator("li", { hasText: "GraceWaters Site" }).first().getByRole("button", { name: "Restore…" }).click();
  panel = a.getByRole("group", { name: "Correct movement: GraceWaters Site" });
  await panel.getByLabel(/^Why\?/).fill("Removed by mistake");
  await panel.getByRole("button", { name: "Restore this movement" }).click();
  await a.waitForFunction(() => document.body.innerText.includes("Removed by mistake"), null, { timeout: 20_000 });
  await waitTile(a, "Out on a movement", 2, "desktop: restoring should put Amaka back out");

  // 8. A stale movement correction: A opens Faith's, B corrects it first, A's save is refused cleanly.
  const c = await open("desktop");
  await c.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await row(a, "Faith Udo").locator("li", { hasText: "Court" }).first().getByRole("button", { name: "Correct…" }).click();
  panel = a.getByRole("group", { name: "Correct movement: Court" });
  await panel.getByRole("button", { name: "Change where" }).click();
  await row(c, "Faith Udo").locator("li", { hasText: "Court" }).first().getByRole("button", { name: "Correct…" }).click();
  const cPanel = c.getByRole("group", { name: "Correct movement: Court" });
  await cPanel.getByRole("button", { name: "Change what for" }).click();
  await cPanel.getByLabel("New purpose").fill("Mention");
  await cPanel.getByLabel(/^Why\?/).fill("C fixed it first");
  await cPanel.getByRole("button", { name: "Save correction" }).click();
  await c.waitForFunction(() => document.body.innerText.includes("C fixed it first"), null, { timeout: 20_000 });
  await panel.getByLabel("New destination").fill("High Court");
  await panel.getByLabel(/^Why\?/).fill("A typed this second");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await panel.getByText("changed by someone else").waitFor({ timeout: 20_000 });
  await shot(a, "mv-11-stale-movement-desktop");
  await row(a, "Faith Udo").getByRole("button", { name: "Close" }).first().click().catch(() => undefined);

  // 9. Restoring removed RECORDS: blocked by the one-open-shift rule, blocked by one-record-a-day, and one that works.
  await a.goto(`${base}/attendance?day=${lagosYesterday()}`, { waitUntil: "networkidle" });
  await removedRow(a, "Zainab Musa").getByRole("button", { name: "Restore…" }).click();
  panel = a.getByRole("group", { name: "Correct Zainab Musa" });
  await panel.getByLabel(/^Why\?/).fill("Removed by mistake");
  await panel.getByRole("button", { name: "Restore this record" }).click();
  await panel.getByText("can have only one open shift").waitFor({ timeout: 20_000 });
  await shot(a, "mv-12-restore-blocked-open-desktop");

  await a.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await removedRow(a, "Kelechi Ibe").getByRole("button", { name: "Restore…" }).click();
  panel = a.getByRole("group", { name: "Correct Kelechi Ibe" });
  await panel.getByLabel(/^Why\?/).fill("Removed by mistake");
  await panel.getByRole("button", { name: "Restore this record" }).click();
  await panel.getByText("already has a record for").waitFor({ timeout: 20_000 });
  await shot(a, "mv-13-restore-blocked-day-desktop");

  await removedRow(a, "Funke Adebisi").getByRole("button", { name: "Restore…" }).click();
  panel = a.getByRole("group", { name: "Correct Funke Adebisi" });
  await panel.getByLabel(/^Why\?/).fill("Removed by mistake");
  await panel.getByRole("button", { name: "Restore this record" }).click();
  await a.waitForFunction(() => document.body.innerText.includes("Removed by mistake"), null, { timeout: 20_000 });
  await waitTile(a, "In now", 8, "desktop: restoring Funke should put her IN (Amaka and Faith are out, Tunde is back)");
  await shot(a, "mv-14-restored-desktop");

  // 10. The refresh was PAUSED for B while its panel was open, and RESUMES when she is done:
  //     B's page (stale for minutes) catches up within one beat of closing the panel.
  // B loaded when exactly one person was out; now two are. If B still says one, the refresh was paused, not dropped.
  expect((await tile(b, "Out on a movement")) === 1, `desktop B: with its panel open the board must NOT have refreshed (it still shows 1 out, got ${await tile(b, "Out on a movement")})`);
  expect((await bPanel.getByRole("textbox").inputValue()) === "0020", "desktop B: and its typed text is still there");
  await rowButton(b, "Amaka Obi", "Close").click();
  let caught = false;
  for (let waited = 0; waited < 70_000 && !caught; waited += 2_000) {
    await b.waitForTimeout(2_000);
    caught = (await tile(b, "Out on a movement")) === 2;
  }
  expect(caught, "desktop B: once the panel is closed the waiting refresh should run and show the current board");

  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await shot(phone, "mv-15-board-phone");
}
