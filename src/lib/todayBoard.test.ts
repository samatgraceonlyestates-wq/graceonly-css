import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupBoard, type BoardMovement, type BoardRecord } from "./todayBoard.ts";

// 10:45 on Wednesday 21 October 2026 in Lagos (UTC+1).
const NOW = new Date(Date.UTC(2026, 9, 21, 9, 45));

const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, hour - 1, minute)); // Lagos time on an October day
const record = (id: string, name: string, extra: Partial<BoardRecord> = {}): BoardRecord => ({
  id,
  staffId: `s-${id}`,
  name,
  department: null,
  clockInAt: at(21, 8),
  clockOutAt: null,
  signoutMissingAt: null,
  ...extra,
});
const movement = (recordId: string): BoardMovement => ({ recordId, leftAt: at(21, 10), destination: "Bank", purpose: "Lodgement", approvedByName: "Peter Obi" });
const names = (list: { name: string }[]) => list.map((p) => p.name);

describe("groupBoard: today's board, derived and never stored", () => {
  it("puts each record in exactly one group", () => {
    const board = groupBoard(
      [
        record("1", "In Person"),
        record("2", "Gone Person", { clockOutAt: at(21, 10, 30) }),
        record("3", "Out Person"),
        record("4", "Unsigned Person", { signoutMissingAt: at(21, 9) }),
      ],
      [movement("3")],
      NOW,
    );
    assert.deepEqual(names(board.inNow), ["In Person"]);
    assert.deepEqual(names(board.outNow), ["Out Person"]);
    assert.deepEqual(names(board.gone), ["Gone Person"]);
    assert.deepEqual(names(board.noSignout), ["Unsigned Person"]);
    assert.deepEqual(board.counts, { in: 1, out: 1, gone: 1, noSignout: 1 });
    assert.equal(board.today, "2026-10-21");
  });

  it("attaches the open movement to the person who is out", () => {
    const board = groupBoard([record("3", "Out Person")], [movement("3")], NOW);
    assert.equal(board.outNow[0]!.movement?.destination, "Bank");
    assert.equal(board.inNow.length, 0, "out on a movement is not also IN");
  });

  it("an empty day is four empty groups and zero counts, not an error", () => {
    const board = groupBoard([], [], NOW);
    assert.deepEqual(board.counts, { in: 0, out: 0, gone: 0, noSignout: 0 });
  });

  it("a shift left open from an EARLIER day is still IN, and says so", () => {
    const board = groupBoard([record("9", "Forgot Person", { clockInAt: at(19, 8) })], [], NOW);
    assert.deepEqual(names(board.inNow), ["Forgot Person"]);
    assert.equal(board.inNow[0]!.olderDay, true);
    assert.equal(board.inNow[0]!.arrivedOn, "2026-10-19");
  });

  it("an earlier day's CLOSED records are not on today's board", () => {
    const board = groupBoard(
      [
        record("1", "Old Gone", { clockInAt: at(19, 8), clockOutAt: at(19, 17) }),
        record("2", "Old Unsigned", { clockInAt: at(19, 8), signoutMissingAt: at(19, 18) }),
      ],
      [],
      NOW,
    );
    assert.deepEqual(board.counts, { in: 0, out: 0, gone: 0, noSignout: 0 });
  });

  it("counts the day in LAGOS: a 23:30 UTC arrival on the 20th is on the 21st", () => {
    const board = groupBoard([record("1", "Early Bird", { clockInAt: new Date(Date.UTC(2026, 9, 20, 23, 30)) })], [], NOW);
    assert.equal(board.inNow[0]!.olderDay, false);
  });

  it("a record marked never-signed-out is NO SIGN-OUT, not IN, and not GONE", () => {
    const board = groupBoard([record("1", "Marked", { signoutMissingAt: at(21, 9) })], [], NOW);
    assert.deepEqual(board.counts, { in: 0, out: 0, gone: 0, noSignout: 1 });
  });

  it("sorts each group by name, ignoring case", () => {
    const board = groupBoard([record("1", "bola Ade"), record("2", "Ada Obi"), record("3", "Chidi Eze")], [], NOW);
    assert.deepEqual(names(board.inNow), ["Ada Obi", "bola Ade", "Chidi Eze"]);
  });
});
