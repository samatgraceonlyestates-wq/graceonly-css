// The keystroke handling for the password prompt. Pure. Run: npm test
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import { HiddenInput } from "./hiddenPrompt.ts";

describe("HiddenInput", () => {
  it("collects characters until Enter, one keystroke at a time", () => {
    const input = new HiddenInput();
    for (const key of "hunter22") assert.deepEqual(input.feed(key), { done: false, cancelled: false });
    assert.deepEqual(input.feed("\r"), { done: true, cancelled: false });
    assert.equal(input.take(), "hunter22");
  });

  it("handles a whole line arriving at once (a paste), and either kind of Enter", () => {
    for (const enter of ["\r", "\n", "\r\n"]) {
      const input = new HiddenInput();
      assert.equal(input.feed(`pasted passphrase${enter}`).done, true);
      assert.equal(input.take(), "pasted passphrase");
    }
  });

  it("Backspace removes the last character, including a multi-byte one", () => {
    const input = new HiddenInput();
    input.feed("abc\u007f\u007fd");
    input.feed("é\u007f");
    input.feed("\b");
    input.feed("\r");
    assert.equal(input.take(), "a");
  });

  it("Backspace on an empty line does nothing", () => {
    const input = new HiddenInput();
    input.feed("\u007f\u007f\u007fx\r");
    assert.equal(input.take(), "x");
  });

  it("ignores arrow keys and other escape sequences instead of storing them", () => {
    const input = new HiddenInput();
    input.feed("ab\u001b[Acd\u001b[3~\u001b[1;5Cef\u001bOHg\r");
    assert.equal(input.take(), "abcdefg");
  });

  it("Ctrl-C cancels; Ctrl-D cancels only on an empty line", () => {
    assert.deepEqual(new HiddenInput().feed("ab\u0003"), { done: false, cancelled: true });
    assert.deepEqual(new HiddenInput().feed("\u0004"), { done: false, cancelled: true });
    const input = new HiddenInput();
    assert.deepEqual(input.feed("ab\u0004c\r"), { done: true, cancelled: false });
    assert.equal(input.take(), "abc");
  });

  it("Ctrl-U clears the line, and other control characters are dropped", () => {
    const input = new HiddenInput();
    input.feed("oops\u0015fresh\u0001\u0007\t\r");
    assert.equal(input.take(), "fresh");
  });

  it("keeps spaces and symbols", () => {
    const input = new HiddenInput();
    input.feed("a b!@#$%^&*() c\r");
    assert.equal(input.take(), "a b!@#$%^&*() c");
  });

  it("take() empties the buffer, and only the length is observable otherwise", () => {
    const input = new HiddenInput();
    input.feed("secret");
    assert.equal(input.length, 6);
    assert.equal(JSON.stringify(input), "{}", "the text is a true private field: not in JSON");
    assert.ok(!inspect(input, { showHidden: true }).includes("secret"), "nor in inspect");
    input.take();
    assert.equal(input.length, 0);
    assert.equal(input.take(), "");
  });
});
