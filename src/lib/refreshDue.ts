// When the board should re-read the server. Pure: the board's one shared poll
// (BoardRefresher) asks this on every beat of the existing shared clock (useNow.ts), so
// no timer of its own exists. Nothing is fetched while the tab is hidden; coming back to
// a hidden tab asks again at once.
//
// A refresh must NEVER take away what she is typing: while a panel is open or a field has
// focus the refresh is PAUSED (not dropped: it runs as soon as she is done). Losing typed
// text is how people learn to distrust a tool.

/** A beat lands up to this much before a full interval has passed, because beats are floored to the interval. */
const TOLERANCE_MS = 5_000;

export function refreshDue(input: { now: number; lastRefreshAt: number; everyMs: number; visible: boolean; paused?: boolean }): boolean {
  if (!input.visible || input.paused === true) return false;
  return input.now - input.lastRefreshAt >= input.everyMs - TOLERANCE_MS;
}
