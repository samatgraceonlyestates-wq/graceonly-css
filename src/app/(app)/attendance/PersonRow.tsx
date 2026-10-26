"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { matchesFilter } from "@/lib/rosterMatch";
import { useBoardFilter } from "./BoardFilter";
import styles from "./page.module.css";

// UNDESIGNED (the board is not in Figma). ONE person's row on the board.
//
// ON A PHONE each row is COLLAPSED by default to the name and one line (in at, out since,
// gone at, no sign-out), with a Show button that opens it to their facts, movements and
// actions. Thirty open rows came to 5000px, which nobody scrolls. The DESKTOP is unchanged: the
// head and the body are `display: contents` there, so the cells sit in the row's grid exactly as
// before and the toggle is not drawn.
//
// A row whose name does not match the filter box is hidden (the counts do not change). When the
// filter leaves exactly ONE person on the board, that row opens by itself: she typed the name to
// act on it. Opening state is client state, so it survives the live refresh; a row that moves to
// another group starts collapsed again. A collapsed row keeps any panel it holds (and the panel
// still pauses the refresh), so nothing she typed is lost by closing it.
export function PersonRow({ name, head, glance, children }: { name: string; head: ReactNode; glance: ReactNode; children: ReactNode }) {
  const { query, matching } = useBoardFilter();
  // null until she presses Show or Hide herself; her choice then wins over the filter's.
  const [choice, setChoice] = useState<boolean | null>(null);
  const bodyId = useId();
  const shown = matchesFilter(query, name);
  const expanded = choice ?? (shown && query.trim() !== "" && matching === 1);

  return (
    <li className={styles.item} hidden={!shown} data-expanded={expanded ? "true" : "false"}>
      <div className={styles.rowHead}>
        {head}
        <p className={styles.rowGlance}>{glance}</p>
        <span className={styles.rowToggle}>
          <Button variant="row-action" aria-expanded={expanded} aria-controls={bodyId} aria-label={`${expanded ? "Hide" : "Show"} ${name}`} onClick={() => setChoice(!expanded)}>
            {expanded ? "Hide" : "Show"}
          </Button>
        </span>
      </div>
      <div className={styles.rowBody} id={bodyId}>
        {children}
      </div>
    </li>
  );
}
