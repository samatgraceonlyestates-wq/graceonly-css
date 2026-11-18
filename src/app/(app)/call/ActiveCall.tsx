"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteTrack, Room } from "livekit-client";
import { Button } from "@/components/Button/Button";
import { Notice } from "@/components/Notice/Notice";
import { useNow } from "@/lib/useNow";
import type { CallSession } from "./actions";
import styles from "./CallStaff.module.css";

type Phase = "ringing" | "connected" | "no-answer" | "error" | "ended";

// How long to ring before giving up. The team app auto-clears an unanswered ring
// at its own ~45s sweep; this just stops the caller waiting forever.
const RING_TIMEOUT_MS = 45_000;

function CallTimer({ since }: { since: string }) {
  const now = useNow(since, 1000);
  const secs = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const mm = Math.floor(secs / 60).toString();
  const ss = (secs % 60).toString().padStart(2, "0");
  return <span className={styles.timer}>{mm}:{ss}</span>;
}

export function ActiveCall({ session, onClose }: { session: CallSession; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("ringing");
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ringTimer: ReturnType<typeof setTimeout> | undefined;
    const audioEls: HTMLMediaElement[] = [];
    let room: Room | null = null;

    const markConnected = () => {
      if (cancelled) return;
      if (ringTimer) clearTimeout(ringTimer);
      setConnectedAt((at) => at ?? new Date().toISOString());
      setPhase((p) => (p === "ringing" ? "connected" : p));
    };

    (async () => {
      // Load the SDK only in the browser, so nothing LiveKit touches runs during SSR.
      const livekit = await import("livekit-client");
      if (cancelled) return;

      room = new livekit.Room();
      roomRef.current = room;

      room
        .on(livekit.RoomEvent.ParticipantConnected, markConnected)
        .on(livekit.RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === livekit.Track.Kind.Audio) {
            const el = track.attach();
            el.autoplay = true;
            document.body.appendChild(el);
            audioEls.push(el);
            markConnected();
          }
        })
        .on(livekit.RoomEvent.Disconnected, () => {
          if (cancelled) return;
          // Only a disconnect we did not already label (no-answer / error / hang up).
          setPhase((p) => (p === "ringing" || p === "connected" ? "ended" : p));
        });

      try {
        await room.connect(session.livekitUrl, session.callerToken);
      } catch {
        if (cancelled) return;
        setMessage("Could not connect the call. Check your connection and try again.");
        setPhase("error");
        await room.disconnect().catch(() => {});
        return;
      }
      if (cancelled) return;

      // The callee may already be in the room by the time we connect.
      if (room.remoteParticipants.size > 0) markConnected();

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setMessage(
          name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError"
            ? "Microphone access was blocked. Allow the microphone in your browser, then call again."
            : "Could not turn on the microphone. Check it is connected, then call again.",
        );
        setPhase("error");
        await room.disconnect().catch(() => {});
        return;
      }

      ringTimer = setTimeout(() => {
        if (cancelled) return;
        setPhase((p) => {
          if (p !== "ringing") return p;
          room?.disconnect().catch(() => {});
          return "no-answer";
        });
      }, RING_TIMEOUT_MS);
    })();

    return () => {
      cancelled = true;
      if (ringTimer) clearTimeout(ringTimer);
      for (const el of audioEls) {
        el.pause();
        el.remove();
      }
      room?.disconnect().catch(() => {});
      roomRef.current = null;
    };
  }, [session]);

  const hangUp = useCallback(async () => {
    setPhase("ended");
    await roomRef.current?.disconnect().catch(() => {});
    onClose();
  }, [onClose]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    try {
      await roomRef.current?.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch {
      // Leave the state as it was; the button simply did nothing.
    }
  }, [muted]);

  if (phase === "error") {
    return (
      <div className={styles.calling}>
        <Notice tone="failure" role="alert">
          <p>{message ?? "The call could not be placed."}</p>
        </Notice>
        <Button size="compact" variant="row-action" onClick={onClose}>Back</Button>
      </div>
    );
  }

  if (phase === "no-answer" || phase === "ended") {
    return (
      <div className={styles.calling} role="status">
        <p className={styles.callingText}>
          {phase === "no-answer" ? `No answer from ${session.calleeName}.` : `Call with ${session.calleeName} ended.`}
        </p>
        <Button size="compact" variant="row-action" onClick={onClose}>Call someone else</Button>
      </div>
    );
  }

  // ringing or connected
  return (
    <div className={styles.calling} role="status" aria-live="polite">
      {phase === "ringing" ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.callingText}>
            Ringing <strong>{session.calleeName}</strong>…
          </p>
        </>
      ) : (
        <>
          <p className={styles.callingText}>
            Connected to <strong>{session.calleeName}</strong>
          </p>
          {connectedAt ? <CallTimer since={connectedAt} /> : null}
        </>
      )}

      <div className={styles.controls}>
        {phase === "connected" ? (
          <Button
            size="compact"
            variant="row-action"
            onClick={toggleMute}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
        ) : null}
        <Button size="compact" onClick={hangUp} className={styles.hangUp}>
          Hang up
        </Button>
      </div>
    </div>
  );
}
