// A scenario for scripts/screenshots.ts: screen 08 (the attendance register) on a MESSY month,
// then the board's four fixes (the phone's collapsed rows, the filter box, a destination that
// differs only by case or spacing, a close one, and self-approval). It WRITES (the board part),
// so run it only against a THROWAWAY schema: seed it with scripts/shots-arrivals.seed.sql,
// scripts/shots-board.seed.sql, scripts/shots-movements.seed.sql and
// scripts/shots-register.seed.sql, then
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-register.ts
//
// It cannot be re-run on the same data: reseed first.
import type { Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const lagosDay = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() - daysAgo * 24 * 3600 * 1000));

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const body = (page: Page) => page.locator("body").innerText();
  const tileText = async (page: Page, label: string) =>
    (await page.locator("p", { hasText: new RegExp(`^${label}`, "i") }).first().locator("xpath=following-sibling::div[1]").innerText()).trim();
  const tile = async (page: Page, label: string) => Number(await tileText(page, label));
  const visible = (page: Page, text: string) => page.getByText(text, { exact: false }).first().isVisible();
  const height = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);
  const row = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) }).first();

  const month = `${base}/attendance/register?from=${lagosDay(30)}&to=${lagosDay(0)}`;

  // ================================================================ THE REGISTER, a messy month
  const a = await open("desktop");
  await a.goto(month, { waitUntil: "networkidle" });
  let text = await body(a);

  // Removed records count for nothing: not listed, and only their number is mentioned.
  expect(!text.includes("SEED-REMOVED"), "register: a removed record (or its reason) must not appear");
  expect(/5 removed records in this period are not counted/.test(text), "register: it should say how many removed records were left out (5)");

  // Hours: the unknowns are their own count beside the total, and the screen says what the total leaves out.
  const unknown = await tileText(a, "Hours unknown");
  expect(unknown === "10 shifts", `register: 8 no-sign-outs + 2 never closed = 10 shifts of unknown hours, got "${unknown}"`);
  expect(/8 no sign-out · 2 never closed/.test(text), "register: the unknown tile should break the 10 down");
  expect(/shifts have unknown hours/.test(text) && /it is a minimum, not the hours worked/.test(text), "register: the hours note must say the total is a minimum");
  expect(/still in progress today and not in the total yet/.test(text), "register: today's open shifts are not in the total, and it says so");

  // Late is by each record's THRESHOLD SNAPSHOT (016): the rule changed mid-month, and one record has none.
  expect(text.includes("by each day's rule (09:00, 09:15) · 1 unknown"), "register: late should be judged by each record's own rule, and say so");
  expect(await a.getByText("Late: unknown").first().isVisible(), "register: a record entered with no rule has unknown lateness");
  // Folded shifts are in the page but not in innerText: read the DOM text.
  const all = (await a.locator("main, body").first().textContent()) ?? "";
  expect(all.includes("Late · after 09:15") && all.includes("Late · after 09:00"), "register: with mixed rules, a late pill says which rule it broke");

  // Who entered: two front-desk people, arrivals and departures separately.
  expect(text.includes("Who entered") && text.includes("Joy Akpan") && text.includes("Screenshot Account"), "register: both front-desk people should be listed under Who entered");
  expect(/entered by Joy Akpan/.test(text) && /entered by Screenshot Account/.test(text), "register: each record says who entered it");

  // Marks are VISIBLE without opening anything.
  for (const mark of ["Book says 08:30", "Typed 18:15 for 17:15", "Wrong time out", "Book found in the drawer"]) {
    expect(await visible(a, mark), `register: the mark "${mark}" should be visible without expanding anything`);
  }
  expect(await a.getByText("Removed, then put back at").first().isVisible(), "register: a restored record should be marked Restored, visibly");
  expect(await a.getByText("Never closed").first().isVisible(), "register: Halima's open earlier shift should show as Never closed");
  expect((await a.getByText("Self-approved", { exact: true }).count()) >= 2, "register: the self-approved movements should be marked");

  // Grouped by department, with no department last.
  const headings = await a.locator("section h2").allInnerTexts();
  const departments = headings.filter((heading) => !/^(Who entered|On leave|No record)/.test(heading));
  expect(departments.at(-1)?.startsWith("No department") === true, `register: "No department" should be the last group, got ${departments.join(" | ")}`);
  expect(text.includes("On leave") && text.includes("Musa Danjuma"), "register: someone on leave with no record is listed as on leave");
  await shot(a, "reg-1-month-desktop");

  // A person's plain shifts are folded; opening them shows who entered each.
  const peter = row(a, "Peter Obi");
  await peter.locator("summary").first().click();
  await shot(a, "reg-2-month-folded-open-desktop");

  // One day: today, with people still in and a no-sign-out.
  await a.goto(`${base}/attendance/register`, { waitUntil: "networkidle" });
  text = await body(a);
  expect(/still in/i.test(text) && /so far, not in the total/.test(text), "register (today): an open shift today is shown as in progress, not in the total");
  expect(/no sign-out/i.test(text) && text.includes("Unknown, not in the total"), "register (today): a no-sign-out has unknown hours");
  expect(!text.includes("Wrong person") || !(await a.getByText("Wrong person").first().isVisible()), "register (today): removed records are not listed");
  await shot(a, "reg-3-today-desktop");

  // A backwards period is refused with a reason, not guessed.
  await a.goto(`${base}/attendance/register?from=${lagosDay(1)}&to=${lagosDay(5)}`, { waitUntil: "networkidle" });
  expect((await body(a)).includes("The first day is after the last day. Showing today."), "register: a backwards period should say why it shows today");

  const phone = await open("phone");
  await phone.goto(month, { waitUntil: "networkidle" });
  expect(!(await body(phone)).includes("SEED-REMOVED"), "register (phone): no removed record");
  await shot(phone, "reg-4-month-phone");
  await phone.goto(`${base}/attendance/register`, { waitUntil: "networkidle" });
  await shot(phone, "reg-5-today-phone");

  // ================================================================ THE BOARD: phone rows collapsed
  await phone.setViewportSize({ width: 390, height: 844 }); // a picture above grew the viewport to the page
  await phone.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  const collapsedHeight = await height(phone);
  expect(collapsedHeight < 3200, `board (phone): collapsed rows should keep the page short, got ${collapsedHeight}px`);
  expect(!(await phone.getByRole("button", { name: "Out…", exact: true }).first().isVisible()), "board (phone): a collapsed row shows no actions");
  await shot(phone, "reg-6-board-collapsed-phone");
  await phone.getByRole("button", { name: "Show Divine Mike" }).click();
  expect(await row(phone, "Divine Mike").getByRole("button", { name: "Out…" }).isVisible(), "board (phone): Show opens the row to its actions");
  await shot(phone, "reg-7-board-row-open-phone");

  // The filter box: narrows the lists, never the counts; one match opens by itself.
  const inBefore = await tile(phone, "In now");
  await phone.getByLabel("Find a person").fill("tunde");
  await phone.getByText(/Showing 1 of \d+ people on the board/).waitFor();
  expect((await tile(phone, "In now")) === inBefore, "board (phone): the filter must not change a count");
  expect(await row(phone, "Tunde Bello").getByRole("button", { name: /Correct…/ }).first().isVisible(), "board (phone): the only match opens by itself");
  expect(!(await row(phone, "Peter Obi").isVisible()), "board (phone): a row that does not match is hidden");
  await shot(phone, "reg-8-board-filter-phone");

  // ================================================================ THE BOARD, desktop: filter, drift, self-approval
  const b = await open("desktop");
  await b.goto(`${base}/attendance`, { waitUntil: "networkidle" });
  const desktopIn = await tile(b, "In now");
  await b.getByLabel("Find a person").fill("obi");
  await b.getByText(/Showing 2 of \d+ people on the board/).waitFor();
  expect((await tile(b, "In now")) === desktopIn, "board: the filter must not change a count");
  expect(await row(b, "Peter Obi").isVisible() && (await row(b, "Amaka Obi").isVisible()) && !(await row(b, "Divine Mike").isVisible()), "board: 'obi' shows Peter Obi and Amaka Obi only");
  await shot(b, "reg-9-board-filter-desktop");
  await b.getByLabel("Find a person").fill("");

  // Divine Mike goes out: "first bank,  marina" differs from "First Bank, Marina" only by case
  // and spacing: the existing spelling is used. He approves his own movement: allowed, marked.
  await row(b, "Divine Mike").getByRole("button", { name: "Out…" }).click();
  const where = b.getByLabel("Where Divine is going");
  await where.fill("first bank,  marina");
  await b.keyboard.press("Tab");
  expect((await where.inputValue()) === "First Bank, Marina", `board: the existing spelling should replace "first bank,  marina", got "${await where.inputValue()}"`);
  expect(await b.getByText("Same as one used before: saved with this spelling.").isVisible(), "board: and say so");
  const what = b.getByLabel("What Divine is going for");
  await what.fill("CHEQUE LODGEMENT");
  await b.keyboard.press("Tab");
  expect((await what.inputValue()) === "Cheque lodgement", `board: the existing purpose spelling should be used, got "${await what.inputValue()}"`);
  await b.getByLabel("Approved by", { exact: true }).fill("Divine Mike");
  await b.getByText("is approving their own movement").waitFor();
  await shot(b, "reg-10-drift-and-self-approval-desktop");
  await b.getByRole("button", { name: "Divine goes out" }).click();
  await row(b, "Divine Mike").getByText("Self-approved", { exact: true }).first().waitFor({ timeout: 20_000 });
  text = await body(b);
  expect(text.includes("First Bank, Marina") && !text.includes("first bank,  marina"), "board: the movement is stored with the existing spelling");

  // A CLOSE destination is a question offering the existing one, answered from the keyboard.
  await row(b, "Blessing Ike").getByRole("button", { name: "Out…" }).click();
  await b.getByLabel("Where Blessing is going").fill("Frist Bank, Marina");
  await b.keyboard.press("Enter");
  const focused = await b.evaluate(() => document.activeElement?.textContent ?? "");
  expect(focused.startsWith("Yes, First Bank, Marina"), `board: Enter on a close destination should land on the question, got "${focused}"`);
  await shot(b, "reg-11-close-destination-desktop");
  await b.keyboard.press("y");
  expect((await b.getByLabel("Where Blessing is going").inputValue()) === "First Bank, Marina", "board: Y takes the existing destination");
  await b.getByLabel("What Blessing is going for").fill("Lodgement");
  await b.keyboard.press("Tab");
  await b.getByLabel("Approved by", { exact: true }).fill("Peter Obi");
  await b.getByRole("button", { name: "Blessing goes out" }).click();
  await row(b, "Blessing Ike").getByText("First Bank, Marina", { exact: true }).first().waitFor({ timeout: 20_000 });
  await shot(b, "reg-12-board-after-desktop");

  // The register shows today's self-approved movement too.
  await b.goto(`${base}/attendance/register`, { waitUntil: "networkidle" });
  expect(await row(b, "Divine Mike").getByText("Self-approved", { exact: true }).first().isVisible(), "register (today): Divine's self-approved movement is marked");
}
