// Visual check for the "Assign to staff" UI on a complaint, run inside the bounded
// screenshot runner (scripts/screenshots.ts):
//
//   npm run shots -- --scenario=scripts/shots-assign.ts
//
// prepare() starts a SINGLE stand-in HTTP server on 127.0.0.1 that plays BOTH the
// client portal (so the complaint detail page renders: GET /api/css/v1/support-cases/{id})
// and the staff portal (so the Assign panel's staff list loads: GET /api/team/v1/staff;
// POST /api/team/v1/tasks is handled too). It is NEVER the real portal and lives in the
// runner's process, ending with it. The scenario captures the detail page and the open
// Assign panel at desktop and phone width. It does NOT submit, so nothing is written to the
// database and no real task is created — that chain is the owner's live end-to-end test.
import { createServer, type Server } from "node:http";
import type { ScenarioHelpers } from "./screenshots.ts";

const CASE_ID = "7b3d9c10-0000-4000-8000-0000000000aa";

const CASE_DETAIL = {
  id: CASE_ID,
  reference: "CASE-0042",
  referenceNo: 42,
  channel: "IN_PERSON",
  type: { code: "WRONG_AMOUNT_CHARGED", label: "Wrong amount charged", kind: "ISSUE" },
  purchaseId: "p-7b3d",
  purchaseLabel: "Plot E-108 · GraceWaters",
  subject: "Receipt shows the wrong amount",
  description: "The client says the receipt shows ₦250,000 but the amount paid at the desk was ₦200,000. Asked us to check and correct it.",
  resolutionNote: null,
  status: "OPEN",
  statusLabel: "Open",
  version: 3,
  via: "SERVICE_KEY",
  recordedBy: { via: "SERVICE_KEY", staffName: "Front Desk", role: "FRONT_DESK" },
  raisedAt: new Date(Date.now() - 36 * 3_600_000).toISOString(),
  resolvedAt: null,
  escalated: false,
  lastEventSeq: 2,
  events: [
    {
      id: "ev-1",
      seq: 1,
      kind: "RAISED",
      actor: { role: "FRONT_DESK", via: "SERVICE_KEY", name: "Front Desk" },
      body: "Logged at reception.",
      fromStatus: null,
      toStatus: "OPEN",
      visibleToClient: true,
      createdAt: new Date(Date.now() - 36 * 3_600_000).toISOString(),
    },
  ],
};

const STAFF = {
  staff: [
    { id: "s-1", full_name: "Ada Okafor", email: "ada@graceonlyestates.test", department: "Legal", role: "HOD" },
    { id: "s-2", full_name: "Emeka Obi", email: "emeka@graceonlyestates.test", department: "Sales", role: "Staff" },
    { id: "s-3", full_name: "Ngozi Balogun", email: "ngozi@graceonlyestates.test", department: null, role: "Director" },
  ],
};

let server: Server | null = null;

export async function prepare(): Promise<Record<string, string>> {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    // Client portal: case detail.
    if (/\/api\/css\/v1\/support-cases\/[^/]+$/.test(url.pathname) && request.method === "GET") {
      return send(200, { data: CASE_DETAIL, requestId: "stub-case" });
    }
    // Staff portal: roster.
    if (url.pathname === "/api/team/v1/staff" && request.method === "GET") {
      return send(200, STAFF);
    }
    // Staff portal: create a task (not exercised by the no-submit scenario, here for completeness).
    if (url.pathname === "/api/team/v1/tasks" && request.method === "POST") {
      return send(201, { ok: true, taskId: "task-stub-1", linkPath: "/tasks/task-stub-1", replayed: false });
    }
    return send(404, { error: "stub: not found" });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  server.unref(); // must never keep the run alive

  const origin = `http://127.0.0.1:${port}`;
  return {
    CSS_PORTAL_BASE_URL: `${origin}/api/css/v1`,
    CSS_PORTAL_SERVICE_KEY: "stub-id.stub-secret",
    // The staff portal base is the ORIGIN; the code appends /api/team/v1/...
    STAFF_PORTAL_BASE_URL: origin,
    TEAM_SERVICE_KEY: "team-stub-secret",
    CSS_PUBLIC_ORIGIN: "http://localhost:3457",
  };
}

export default async function run({ base, open, shot, problem }: ScenarioHelpers): Promise<void> {
  for (const width of ["desktop", "phone"] as const) {
    const page = await open(width);
    await page.goto(`${base}/complaints/${CASE_ID}`, { waitUntil: "networkidle", timeout: 30_000 });

    const assignButton = page.getByRole("button", { name: "Assign to staff" });
    if ((await assignButton.count()) === 0) problem(`${width}: no "Assign to staff" button on the complaint detail page`);
    await shot(page, `assign-detail-${width}`);

    await assignButton.first().click();
    try {
      // The <select> appears only once the staff list has loaded; selectOption then
      // waits for the option itself (options in a closed select are never "visible",
      // so a visibility wait on an <option> would wrongly time out).
      await page.waitForSelector("#assign-staff", { state: "attached", timeout: 15_000 });
      await page.selectOption("#assign-staff", { label: "Ada Okafor — Legal · HOD" });
      await page.selectOption("#assign-priority", "High");
    } catch {
      problem(`${width}: the staff list did not populate in the Assign panel`);
    }
    await shot(page, `assign-panel-${width}`);
    await page.close();
  }
}
