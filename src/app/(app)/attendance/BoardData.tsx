"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { personDetails, type RosterName } from "@/lib/rosterMatch";

// What the board's panels share, sent from the server ONCE for the whole page rather than
// with every one of up to thirty rows: the roster (for the approver of a movement, matched in
// the browser by the same rules as the arrivals sheet), what tells two people of one name
// apart, and the destinations and purposes already used (for suggestions).
export interface BoardData {
  roster: RosterName[];
  details: Map<string, string>;
  destinations: string[];
  purposes: string[];
}

const Context = createContext<BoardData | null>(null);

export function BoardDataProvider({
  roster,
  destinations,
  purposes,
  children,
}: {
  roster: RosterName[];
  destinations: string[];
  purposes: string[];
  children: ReactNode;
}) {
  const value = useMemo<BoardData>(() => ({ roster, details: personDetails(roster), destinations, purposes }), [roster, destinations, purposes]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBoardData(): BoardData {
  const value = useContext(Context);
  if (value === null) throw new Error("useBoardData must be used inside a BoardDataProvider.");
  return value;
}
