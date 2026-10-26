// A visitor's phone number, as the desk types it, normalised to E.164 (+2348031234567),
// which is what visitor_phone_e164_check (003) requires and what makes one number one
// person (visitor_phone_live_key). Pure; safe in the browser and on the server.
//
// ACCEPTED, and nothing else (the same spirit as the time field: refused, never guessed):
//   +<country><number>        international, spaces, dashes, dots and brackets ignored
//   00<country><number>       the same, dialled from Nigeria
//   234<10 digits>            Nigerian, without the +
//   0<10 digits>              Nigerian, as it is usually written (0803 123 4567)
//   +234 (0) 803 ...          the "(0)" is dropped; so is a 0 straight after +234
// A 10-digit number with no leading 0 or country code ("803 123 4567") is REFUSED: it is
// probably Nigerian, but "probably" is a guess, and a wrong number is the wrong person.
// Empty means no number: a courier may give none (the column is optional).

export type PhoneResult = { kind: "none" } | { kind: "ok"; e164: string } | { kind: "invalid"; message: string };

export const PHONE_MESSAGE =
  "Type the number as 0803 123 4567, or with its country code as +234 803 123 4567. Leave it empty if they gave none.";

const E164 = /^\+[1-9][0-9]{6,14}$/;

export function normalisePhone(raw: string): PhoneResult {
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (typed === "") return { kind: "none" };
  if (typed.length > 40) return { kind: "invalid", message: PHONE_MESSAGE };

  // "(0)" is a written convention, not a digit to dial.
  const compact = typed.replace(/\(0\)/g, "").replace(/[\s\-.()]/g, "");
  if (!/^\+?[0-9]+$/.test(compact)) return { kind: "invalid", message: PHONE_MESSAGE };

  let e164: string;
  if (compact.startsWith("+")) e164 = compact;
  else if (compact.startsWith("00")) e164 = `+${compact.slice(2)}`;
  else if (compact.startsWith("234") && compact.length === 13) e164 = `+${compact}`;
  else if (compact.startsWith("0") && compact.length === 11) e164 = `+234${compact.slice(1)}`;
  else return { kind: "invalid", message: PHONE_MESSAGE };

  // +234 0803 ...: the trunk 0 is never dialled after the country code.
  if (/^\+2340[0-9]{10}$/.test(e164)) e164 = `+234${e164.slice(5)}`;
  // A Nigerian number is +234 and ten digits.
  if (e164.startsWith("+234") && e164.length !== 14) return { kind: "invalid", message: PHONE_MESSAGE };
  return E164.test(e164) ? { kind: "ok", e164 } : { kind: "invalid", message: PHONE_MESSAGE };
}

/** +2348031234567 as +234 803 123 4567, for reading back. Other countries are shown as stored. */
export function formatPhone(e164: string): string {
  const match = /^\+234([0-9]{3})([0-9]{3})([0-9]{4})$/.exec(e164);
  return match ? `+234 ${match[1]} ${match[2]} ${match[3]}` : e164;
}
