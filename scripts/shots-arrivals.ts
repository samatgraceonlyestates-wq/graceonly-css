// A scenario for scripts/screenshots.ts: drives the arrivals screen (/attendance/
// arrivals) with the keyboard, the way the front desk does, and takes pictures of
// each state. It WRITES attendance rows, so it must be run against a throwaway
// database, never the owner's local data:
//
//   SHOTS_DATABASE_URL="<local url>?options=-c%20search_path%3Dshot_e2e" \
//     npm run shots -- --scenario=scripts/shots-arrivals.ts
//
// Create and seed the throwaway schema first (steps are at the top of
// scripts/shots-arrivals.seed.sql), and drop it afterwards. The run fails on any
// expectation below that does not hold. It cannot be re-run on the same schema: the
// people it enters are then already recorded for today, so reseed first.
import type { Page } from "@playwright/test";
import type { ScenarioHelpers } from "./screenshots.ts";

const ROSTER_FOR_PHONE = [
  "Amaka Obi", "Chukwuemeka Eze", "Faith Udo", "Mariam Yusuf", "Blessing Ike", "Daniel Johnson", "Grace Nkem", "Chidera Nnamdi",
  "Amaka Obi-Eze", "Tunde Bello", "Ngozi Adeyemi", "Ifeanyi Okeke", "Zainab Musa", "Emeka Nwankwo", "Funke Adebisi", "Kelechi Ibe",
  "Halima Garba", "Obinna Eze", "Yetunde Cole", "Segun Alabi", "Ada Onuoha", "Musa Danjuma",
];
const NEW_FOR_PHONE = ["Zeta Quill", "Ximena Roe", "Wanjiru Kai", "Vikram Shah", "Ulrich Boateng", "Tamsin Reed", "Sunita Rao", "Rafiq Hasan"];

export default async function scenario({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  const expect = (condition: boolean, message: string) => {
    if (!condition) problem(message);
  };
  const text = (page: Page) => page.locator("main, body").first().innerText();

  // ---------------------------------------------------------------- phone: thirty rows by keyboard
  const phone = await open("phone");
  await phone.goto(`${base}/attendance/arrivals`, { waitUntil: "networkidle" });
  await phone.getByLabel("Row 1 name", { exact: true }).click();
  const everyone = [...ROSTER_FOR_PHONE, ...NEW_FOR_PHONE];
  for (const [i, name] of everyone.entries()) {
    await phone.keyboard.type(name);
    await phone.keyboard.press("Enter");
    // 00:01 onward: always a time that has already happened today.
    await phone.keyboard.type(`00${String(i + 1).padStart(2, "0")}`);
    await phone.keyboard.press("Enter");
  }
  const rowCount = await phone.locator("ol > li").count();
  expect(rowCount >= 31, `phone: Enter past the last field should have grown the sheet to at least 31 rows (it has ${rowCount})`);
  expect((await phone.getByLabel("Row 30 time in", { exact: true }).inputValue()) === "00:30", "phone: 0030 should show as 00:30");
  await shot(phone, "arrivals-5-thirty-rows-phone");
  expect((await text(phone)).includes("Save 30 arrivals"), "phone: the button should offer to save 30 arrivals");
  await phone.getByRole("button", { name: "Save 30 arrivals" }).click();
  await phone.getByText("30 arrivals saved").waitFor({ timeout: 20_000 });
  expect((await text(phone)).includes("8 people were added to the roster"), "phone: 8 new people should have been added");
  await shot(phone, "arrivals-6-saved-phone");

  // ---------------------------------------------------------------- desktop: suggestions, errors, prompts, refusals
  const page = await open("desktop");
  await page.goto(`${base}/attendance/arrivals`, { waitUntil: "networkidle" });

  // Row 1: "divi" offers "Divine Mike"; Enter takes it and moves to the time.
  const name1 = page.getByLabel("Row 1 name", { exact: true });
  await name1.click();
  await page.keyboard.type("divi");
  await page.getByRole("option", { name: /Divine Mike/ }).waitFor();
  await shot(page, "arrivals-1-suggestions-desktop");
  await page.keyboard.press("Enter");
  expect((await name1.inputValue()) === "Divine Mike", "desktop: Enter should take the single suggestion");
  expect(await page.getByLabel("Row 1 time in", { exact: true }).evaluate((el) => el === document.activeElement), "desktop: focus should move to the time in");
  await page.keyboard.type("8:15");
  await page.keyboard.press("Enter");

  // Row 2: a surname first finds the person; a malformed time is flagged as she leaves it.
  await page.keyboard.type("obi pet");
  await page.getByRole("option", { name: /Peter Obi/ }).waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type("815");
  await page.keyboard.press("Enter");

  // Row 3: a near-duplicate name.
  await page.keyboard.type("Divine Mikel");
  await page.keyboard.press("Tab");
  await page.keyboard.type("0830");
  await page.keyboard.press("Enter");

  // Row 4: a brand-new person.
  await page.keyboard.type("Brand New Person");
  await page.keyboard.press("Enter");
  await page.keyboard.type("0905");
  await page.keyboard.press("Enter");
  await page.getByLabel("Row 5 name", { exact: true }).click(); // leave row 4's time

  let body = await text(page);
  expect(body.includes("Did you mean") && body.includes("Divine Mike"), "desktop: 'Divine Mikel' should ask \"Did you mean Divine Mike?\"");
  expect(await page.getByRole("button", { name: /^Yes, Divine Mike/ }).count() === 1, "desktop: the existing person should be offered as a choice");
  expect(/\w+day, \d+ \w+ \d{4}/.test(body), "desktop: the day should be shown in words beside the picker");
  expect(body.includes("Time in: Type the time as"), "desktop: '815' should be flagged as soon as it is left");
  expect(body.includes("New person: will be added to the roster."), "desktop: a new name should say it is new");
  await shot(page, "arrivals-2-flags-desktop");

  // Save with problems: nothing is saved, and every problem is shown on its row.
  await page.getByRole("button", { name: /^Save 4 arrivals$/ }).click();
  await page.getByText("Nothing was saved").first().waitFor({ timeout: 20_000 });
  body = await text(page);
  expect(body.includes("Fix the row marked below"), "desktop: the refusal should point at the marked row");
  await shot(page, "arrivals-3-refused-desktop");

  // Fix both and save: "Divine Mikel" is confirmed a different person.
  await page.getByLabel("Row 2 time in", { exact: true }).fill("0830");
  await page.getByRole("button", { name: "No, a different person" }).click();
  expect((await text(page)).includes("New person, confirmed different from Divine Mike."), "desktop: the confirmation should be shown");
  await page.getByRole("button", { name: /^Save 4 arrivals$/ }).click();
  await page.getByText("4 arrivals saved").waitFor({ timeout: 20_000 });
  expect((await text(page)).includes("2 people were added to the roster"), "desktop: two new people (Divine Mikel, Brand New Person)");
  await shot(page, "arrivals-4-saved-desktop");

  // Two people called Ada Okafor: the list must tell them apart, and she can pick either.
  await page.getByLabel("Row 1 name", { exact: true }).click();
  await page.keyboard.type("ada ok");
  await page.getByRole("option", { name: /Ada Okafor/ }).first().waitFor();
  const options = await page.getByRole("option").allInnerTexts();
  expect(options.length === 2 && options.some((o) => o.includes("Legal")) && options.some((o) => o.includes("Finance")), `desktop: both Adas should be listed with their departments, got ${JSON.stringify(options)}`);
  expect(options.every((o) => /added/.test(o)), "desktop: and when they were added");
  await shot(page, "arrivals-10-same-name-desktop");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("0020");
  await page.getByRole("button", { name: /^Save 1 arrival$/ }).click();
  await page.getByText("1 arrival saved").waitFor({ timeout: 20_000 });

  // The same person again today: refused, naming them.
  await page.getByLabel("Row 1 name", { exact: true }).click();
  await page.keyboard.type("Peter Obi");
  await page.keyboard.press("Enter");
  await page.keyboard.type("0900");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Save 1 arrival$/ }).click();
  await page.getByText("Peter Obi already has a record for").waitFor({ timeout: 20_000 });
  await shot(page, "arrivals-7-duplicate-desktop");

  // An earlier day: the reason and the time out appear, and a missing reason is refused.
  await page.getByLabel("Day").fill("2026-10-16");
  await page.getByText("Why is this being entered late?").waitFor();
  await page.getByLabel("Row 1 time out", { exact: true }).fill("1700");
  await page.getByRole("button", { name: /^Save 1 arrival$/ }).click();
  await page.getByText("Say why these are being entered after their day").waitFor({ timeout: 20_000 });
  await shot(page, "arrivals-8-earlier-day-needs-reason-desktop");
  await page.getByPlaceholder("e.g. copied from the book the next morning").fill("Copied from the book the next morning");
  await page.getByRole("button", { name: /^Save 1 arrival$/ }).click();
  await page.getByText("1 arrival saved for 16 Oct 2026").waitFor({ timeout: 20_000 });

  // A future day is refused (by the server as well as the screen).
  await page.getByLabel("Day").fill("2026-10-30");
  await page.getByLabel("Row 1 name", { exact: true }).click();
  await page.keyboard.type("Divine Mike");
  await page.keyboard.press("Enter");
  await page.keyboard.type("0800");
  await page.getByRole("button", { name: /^Save 1 arrival$/ }).click();
  await page.getByText("has not happened yet").first().waitFor({ timeout: 20_000 });
  await shot(page, "arrivals-9-future-day-desktop");
}
