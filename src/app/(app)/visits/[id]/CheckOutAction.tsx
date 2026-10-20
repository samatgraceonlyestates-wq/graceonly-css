"use client";

import { useState } from "react";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import styles from "./CheckOutAction.module.css";

// UNVERIFIED AGAINST FIGMA (see Panels.tsx).
// TODO: checking out writes to CSS's own visit store, which does not exist yet.
// Until it does, pressing the button only SAYS so: it records nothing, fakes no
// success and goes nowhere. It stays enabled on purpose (a disabled button
// reads as a bug, not as unbuilt). Same as Check in on screen 04.
//
// The form is `display: contents`, so the button joins the header's row and the
// notice takes a full row under it.
export function CheckOutAction() {
  const [pressed, setPressed] = useState(false);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setPressed(true);
      }}
    >
      <Button type="submit">Check out</Button>
      {pressed ? (
        <Notice tone="info" title="Check-out is not wired up yet" role="status" className={styles.notice}>
          <p>
            CSS has no visit store yet, so nothing was recorded. The client details on this screen are live from the
            portal.
          </p>
        </Notice>
      ) : null}
    </form>
  );
}
