"use client";

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { matchesFilter } from "@/lib/rosterMatch";
import styles from "./page.module.css";

// UNDESIGNED (the board is not in Figma). THE FILTER BOX: she types part of a name and the
// lists narrow, so finding one row among thirty to record a departure is not a scroll hunt.
// It filters WHAT IS SHOWN and nothing else: the tiles and the section counts are the day's
// truth, never a view of it, so they do not change. The box says how many rows it is showing
// and that the counts are the whole day. It never touches the end-of-day list either, which is
// a confirmation of everyone still in.
//
// The match is the suggestions' word rule (matchesFilter): "obi" finds Peter Obi and Amaka Obi.
// Escape clears it. Typing in it pauses the live refresh like any other field (BoardRefresher);
// the text survives a refresh, being state in this provider.

interface FilterState {
  query: string;
  setQuery: (query: string) => void;
  /** People on the board whose name matches (every row counts once). */
  matching: number;
  total: number;
}

const Context = createContext<FilterState | null>(null);

export function BoardFilterProvider({ names, children }: { names: string[]; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const matching = useMemo(() => names.filter((name) => matchesFilter(query, name)).length, [names, query]);
  const value = useMemo(() => ({ query, setQuery, matching, total: names.length }), [query, matching, names.length]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBoardFilter(): FilterState {
  const value = useContext(Context);
  if (value === null) throw new Error("useBoardFilter must be used inside a BoardFilterProvider.");
  return value;
}

export function BoardFilterBox() {
  const { query, setQuery, matching, total } = useBoardFilter();
  const id = useId();
  const filtering = query.trim() !== "";
  return (
    <div className={styles.filter} role="search">
      <label className={styles.label} htmlFor={id}>
        Find a person
      </label>
      <input
        id={id}
        className={styles.filterInput}
        type="search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Type part of a name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      {filtering ? (
        <p className={styles.filterNote} role="status">
          Showing {matching} of {total} {total === 1 ? "person" : "people"} on the board. The counts are for the whole day, not this search.
        </p>
      ) : null}
    </div>
  );
}

/** Inside a section: says so when the filter hides every row of it (the section's count stays). */
export function FilterMiss({ names }: { names: string[] }) {
  const { query } = useBoardFilter();
  if (query.trim() === "" || names.length === 0 || names.some((name) => matchesFilter(query, name))) return null;
  return <p className={styles.empty}>Nobody here matches &ldquo;{query.trim()}&rdquo;.</p>;
}
