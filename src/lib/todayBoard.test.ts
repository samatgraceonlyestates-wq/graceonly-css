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
  version: "v1",
  correctedAt: null,
  correctedByName: null,
  correctionReason: null,
  voidedAt: null,
  ...extra,
});
const movement = (recordId: string, extra: Partial<BoardMovement> = {}): BoardMovement => ({
  id: `m-${recordId}`,
  recordId,
  leftAt: at(21, 10),
  returnedAt: null,
  destination: "Bank",
  purpose: "Lodgement",
  approvedByName: "Peter Obi",
  returnedByName: null,
  version: "v1",
  correctedAt: null,
  correctedByName: null,
  correctionReason: null,
  voidedAt: null,
  ...extra,
});
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

describe("groupBoard: another day, corrections and removed records", () => {
  it("an earlier DAY shows only the records that started on it, and a still-open one is flagged as forgotten", () => {
    const board = groupBoard(
      [
        record("1", "Monday Gone", { clockInAt: at(19, 8), clockOutAt: at(19, 17) }),
        record("2", "Monday Forgot", { clockInAt: at(19, 9) }),
        record("3", "Tuesday Person", { clockInAt: at(20, 8) }),
        record("4", "Today Person"),
      ],
      [],
      NOW,
      "2026-10-19",
    );
    assert.equal(board.isToday, false);
    assert.equal(board.day, "2026-10-19");
    assert.deepEqual(names(board.gone), ["Monday Gone"]);
    assert.deepEqual(names(board.inNow), ["Monday Forgot"]);
    assert.equal(board.inNow[0]!.olderDay, true);
    assert.equal(board.counts.in + board.counts.gone, 2);
  });

  it("an earlier day does not carry other days' open shifts, but today does", () => {
    const records = [record("1", "Forgot", { clockInAt: at(19, 8) }), record("2", "Today Person")];
    assert.deepEqual(names(groupBoard(records, [], NOW, "2026-10-20").inNow), []);
    assert.deepEqual(names(groupBoard(records, [], NOW).inNow), ["Forgot", "Today Person"]);
  });

  it("a REMOVED record is in its own list only: not IN, not GONE, not in any count", () => {
    const board = groupBoard(
      [
        record("1", "Wrong Person", { voidedAt: at(21, 9), correctedAt: at(21, 9), correctedByName: "Desk B", correctionReason: "Wrong person" }),
        record("2", "Right Person"),
      ],
      [],
      NOW,
    );
    assert.deepEqual(names(board.removed), ["Wrong Person"]);
    assert.deepEqual(names(board.inNow), ["Right Person"]);
    assert.deepEqual(board.counts, { in: 1, out: 0, gone: 0, noSignout: 0 });
    assert.equal(board.removed[0]!.correctionReason, "Wrong person");
  });

  it("a removed open record from an earlier day does not show as IN", () => {
    const board = groupBoard([record("1", "Wrong Person", { clockInAt: at(19, 8), voidedAt: at(19, 9) })], [], NOW);
    assert.equal(board.inNow.length, 0);
  });

  it("carries the correction (who, when, why) and the version on every person, so a list can show it", () => {
    const board = groupBoard(
      [record("1", "Corrected Person", { correctedAt: at(21, 10), correctedByName: "Desk B", correctionReason: "Book says 08:30", version: "2026-10-21 10:00:00.123456+01" })],
      [],
      NOW,
    );
    const person = board.inNow[0]!;
    assert.equal(person.correctedByName, "Desk B");
    assert.equal(person.correctionReason, "Book says 08:30");
    assert.equal(person.version, "2026-10-21 10:00:00.123456+01");
  });
});

describe("groupBoard: the movement book on the board", () => {
  it("someone with an open movement is OUT, with where, what for, who approved it", () => {
    const board = groupBoard([record("1", "Out Person")], [movement("1")], NOW);
    assert.deepEqual(names(board.outNow), ["Out Person"]);
    assert.equal(board.outNow[0]!.movement?.destination, "Bank");
    assert.equal(board.outNow[0]!.movement?.approvedByName, "Peter Obi");
    assert.deepEqual(board.counts, { in: 0, out: 1, gone: 0, noSignout: 0 });
  });

  it("someone whose movement has RETURNED is IN again, and the movement is listed under them", () => {
    const board = groupBoard([record("1", "Back Person")], [movement("1", { returnedAt: at(21, 10, 40) })], NOW);
    assert.deepEqual(names(board.inNow), ["Back Person"]);
    assert.equal(board.inNow[0]!.movement, null);
    assert.equal(board.inNow[0]!.movements.length, 1);
    assert.equal(board.counts.out, 0);
  });

  it("a REMOVED movement counts for nothing: not OUT, not in any count, listed only as removed", () => {
    const board = groupBoard([record("1", "Not Really Out")], [movement("1", { voidedAt: at(21, 10, 5), correctedAt: at(21, 10, 5), correctionReason: "Never left" })], NOW);
    assert.deepEqual(names(board.inNow), ["Not Really Out"]);
    assert.deepEqual(board.counts, { in: 1, out: 0, gone: 0, noSignout: 0 });
    assert.equal(board.inNow[0]!.movements.length, 0);
    assert.equal(board.inNow[0]!.removedMovements.length, 1);
  });

  it("a person can be out again after a removed movement, and several movements are kept in order", () => {
    const board = groupBoard(
      [record("1", "Busy Person")],
      [
        movement("1", { id: "b", leftAt: at(21, 10), returnedAt: null }),
        movement("1", { id: "a", leftAt: at(21, 9), returnedAt: at(21, 9, 30) }),
        movement("1", { id: "x", leftAt: at(21, 8), voidedAt: at(21, 8, 5) }),
      ],
      NOW,
    );
    assert.deepEqual(names(board.outNow), ["Busy Person"]);
    assert.deepEqual(board.outNow[0]!.movements.map((m) => m.id), ["a", "b"]);
    assert.equal(board.outNow[0]!.movement?.id, "b");
  });

  it("carries the movement's correction (who, when, why) and version", () => {
    const board = groupBoard(
      [record("1", "Corrected Out")],
      [movement("1", { correctedAt: at(21, 10, 10), correctedByName: "Desk B", correctionReason: "Wrong destination", version: "2026-10-21 10:10:00.5+01" })],
      NOW,
    );
    const m = board.outNow[0]!.movement!;
    assert.equal(m.correctedByName, "Desk B");
    assert.equal(m.correctionReason, "Wrong destination");
    assert.equal(m.version, "2026-10-21 10:10:00.5+01");
  });
});
