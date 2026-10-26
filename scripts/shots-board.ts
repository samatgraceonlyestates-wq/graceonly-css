// A scenario for scripts/screenshots.ts: drives the today board (/attendance). It
// WRITES (clock-outs, never-signed-out marks), so run it only against a THROWAWAY
// schema (see scripts/shots-arrivals.seed.sql for how to create one, then
// scripts/shots-board.seed.sql for today's records), with
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-board.ts
//
// Seeded: 6 people IN, 1 OUT on a movement, 2 GONE, 1 NO SIGN-OUT, and 1 person still
// open from two days ago. It cannot be re-run on the same data: reseed first.
import type { Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const lagosNow = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const body = (page: Page) => page.locator("body").innerText();
  const tile = async (page: Page, label: string) => (await page.locator("p", { hasText: new RegExp(`^${label}`, "i") }).first().locator("xpath=following-sibling::div[1]").innerText()).trim();

  // ---------------------------------------------------------------- phone: read-only look, and an open panel
  const phone = await open("phone");
  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  await shot(phone, "board-1-phone");
  await phone.getByRole("button", { name: /^Show / }).first().click(); // rows are collapsed on a phone
  await phone.getByRole("button", { name: "Clock out" }).first().click();
  await phone.getByRole("group", { name: /^Clock out / }).waitFor();
  await shot(phone, "board-2-panel-phone");

  // ---------------------------------------------------------------- desktop
  const page = await open("desktop");
  await page.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  let text = await body(page);
  expect(text.includes("In now") && text.includes("Out on a movement") && text.includes("Gone for the day") && text.includes("No sign-out"), "desktop: the four sections should be there");
  expect((await tile(page, "In now")) === "7", `desktop: 7 should be IN (6 today + 1 left open from two days ago), got ${await tile(page, "In now")}`);
  expect((await tile(page, "Out on a movement")) === "1", "desktop: 1 out on a movement");
  expect((await tile(page, "Gone for the day")) === "2", "desktop: 2 gone");
  expect((await tile(page, "No sign-out")) === "1", "desktop: 1 no sign-out");
  expect(text.includes("First Bank, Marina") && text.includes("Peter Obi"), "desktop: the movement shows where, and who approved it");
  expect(/Open since\s*\n?\s*Monday, \d+ \w+ \d{4}/i.test(text) || text.toLowerCase().includes("open since"), "desktop: the older open shift should say it is open since an earlier day");
  await shot(page, "board-3-desktop");

  // Peter Obi: open the panel; the time defaults to now.
  const peter = page.getByRole("listitem").filter({ hasText: "Peter Obi" }).first();
  await peter.getByRole("button", { name: "Clock out" }).click();
  const timeBox = page.getByRole("group", { name: "Clock out Peter Obi" }).getByRole("textbox");
  const shown = await timeBox.inputValue();
  expect(/^\d\d:\d\d$/.test(shown), `desktop: the time should default to now as HH:MM, got "${shown}"`);
  expect(Math.abs(Number(shown.slice(0, 2)) * 60 + Number(shown.slice(3)) - (Number(lagosNow().slice(0, 2)) * 60 + Number(lagosNow().slice(3)))) <= 2, `desktop: default ${shown} should be within two minutes of the Lagos time ${lagosNow()}`);
  await shot(page, "board-4-panel-desktop");

  // A time before their arrival (00:06): refused with the reason, nothing changes.
  await timeBox.fill("0001");
  await page.getByRole("button", { name: "Clock out Peter" }).click();
  await page.getByText("Time out must be after their time in, 00:06.").waitFor({ timeout: 20_000 });
  await shot(page, "board-5-refused-desktop");
  expect((await tile(page, "In now")) === "7", "desktop: a refused clock-out must not change the count");

  // Garbage is refused too.
  await timeBox.fill("815");
  await page.getByRole("button", { name: "Clock out Peter" }).click();
  await page.getByText("Type the time as").waitFor({ timeout: 20_000 });

  // Valid: now. He moves to Gone for the day.
  await timeBox.fill(lagosNow().replace(":", ""));
  await page.getByRole("button", { name: "Clock out Peter" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Gone for the day") && !document.querySelector('[aria-label="Clock out Peter Obi"]'), null, { timeout: 20_000 });
  expect((await tile(page, "In now")) === "6", "desktop: Peter should have left the IN list");
  expect((await tile(page, "Gone for the day")) === "3", "desktop: Peter should be in Gone for the day");

  // The future is refused (23:59, unless this run is at 23:59).
  const amaka = page.getByRole("listitem").filter({ hasText: "Amaka Obi" }).first();
  await amaka.getByRole("button", { name: "Clock out" }).click();
  await page.getByRole("group", { name: "Clock out Amaka Obi" }).getByRole("textbox").fill("2359");
  await page.getByRole("button", { name: "Clock out Amaka" }).click();
  await page.getByText("That time has not happened yet.").waitFor({ timeout: 20_000 });
  await amaka.getByRole("button", { name: "Close" }).click();

  // The shift left open two days ago: no default time, and it says why; mark it never signed out.
  const ngozi = page.getByRole("listitem").filter({ hasText: "Ngozi Adeyemi" }).first();
  await ngozi.getByRole("button", { name: "Clock out" }).click();
  const ngoziPanel = page.getByRole("group", { name: "Clock out Ngozi Adeyemi" });
  expect((await ngoziPanel.getByRole("textbox").inputValue()) === "", "desktop: an earlier day's shift has no default time");
  // The seed puts her arrival two days ago: the weekday depends on when this runs.
  const twoDaysAgo = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long" }).format(new Date(Date.now() - 2 * 24 * 3600 * 1000));
  expect((await ngoziPanel.innerText()).includes(`arrived on ${twoDaysAgo}`), "desktop: the panel should say which day they arrived");
  await shot(page, "board-6-older-day-desktop");
  await page.getByRole("button", { name: "Ngozi never signed out" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Ngozi Adeyemi"), null, { timeout: 20_000 });
  expect((await tile(page, "In now")) === "5", "desktop: Ngozi should have left the IN list");

  // End of day: an explicit, confirmed act that names the people.
  await page.getByRole("button", { name: /Mark 5 as not signed out/ }).click();
  text = await body(page);
  expect(text.includes("Their hours will be unknown. It can be undone"), "desktop: the confirmation should say what it does");
  await shot(page, "board-7-end-of-day-confirm-desktop");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await tile(page, "In now")) === "5", "desktop: cancelling must change nothing");
  await page.getByRole("button", { name: /Mark 5 as not signed out/ }).click();
  await page.getByRole("button", { name: "Yes, mark 5" }).click();
  await page.getByText("5 marked as not signed out.").waitFor({ timeout: 20_000 });
  expect((await tile(page, "In now")) === "0", "desktop: nobody should be IN after the end of day");
  expect((await tile(page, "No sign-out")) === "6", "desktop: 1 seeded + 5 marked = 6 with no sign-out");
  expect((await body(page)).includes("Hours unknown"), "desktop: marked shifts should say their hours are unknown");
  await shot(page, "board-8-after-end-of-day-desktop");
}
