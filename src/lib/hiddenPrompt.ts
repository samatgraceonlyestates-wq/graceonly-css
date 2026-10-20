// The keystroke handling for a password typed at a terminal prompt, with nothing
// echoed. Pure: the script feeds it the characters the terminal delivers in raw
// mode and it says when the line is finished. Kept out of the script so the
// editing rules (backspace, paste, arrow keys, Ctrl-C) can be tested.
//
// The collected text is only ever read through take(), once, by the code that
// asked for the password. It is never printed.

export interface FeedResult {
  /** Enter was pressed. */
  done: boolean;
  /** Ctrl-C, or Ctrl-D on an empty line. */
  cancelled: boolean;
}

export class HiddenInput {
  #text = "";
  // 0: normal. 1: just saw ESC. 2: inside an ESC [ ... escape sequence (an arrow key, Home, Delete ...).
  #escape: 0 | 1 | 2 = 0;

  /** How many characters are held. Never the characters. */
  get length(): number {
    return [...this.#text].length;
  }

  feed(chunk: string): FeedResult {
    for (const char of chunk) {
      if (this.#escape === 1) {
        this.#escape = char === "[" || char === "O" ? 2 : 0;
        continue;
      }
      if (this.#escape === 2) {
        // A CSI sequence ends at a final byte in @ to ~.
        if (char >= "@" && char <= "~") this.#escape = 0;
        continue;
      }
      switch (char) {
        case "\u001b":
          this.#escape = 1;
          break;
        case "\r":
        case "\n":
          return { done: true, cancelled: false };
        case "\u0003": // Ctrl-C
          return { done: false, cancelled: true };
        case "\u0004": // Ctrl-D
          if (this.#text.length === 0) return { done: false, cancelled: true };
          break;
        case "\u007f": // DEL: what Backspace sends in most terminals
        case "\b": {
          const characters = [...this.#text];
          characters.pop();
          this.#text = characters.join("");
          break;
        }
        case "\u0015": // Ctrl-U: clear the line
          this.#text = "";
          break;
        default:
          // Ignore every other control character; keep anything printable.
          if (char >= " " && char !== "\u007f") this.#text += char;
      }
    }
    return { done: false, cancelled: false };
  }

  /** The text, once. The buffer is cleared as it is returned. */
  take(): string {
    const value = this.#text;
    this.#text = "";
    return value;
  }
}
