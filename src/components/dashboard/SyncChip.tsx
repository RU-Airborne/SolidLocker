import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SyncGlyph } from "../common/HistoryDiagrams";

function agoText(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function SyncedDetail({
  lastFetchAt,
  fetchIntervalS,
}: {
  lastFetchAt: number;
  fetchIntervalS: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const agoSec = Math.max(0, Math.round((now - lastFetchAt) / 1000));
  const nextSec = Math.max(0, fetchIntervalS - agoSec);
  return (
    <>
      Last checked {agoText(agoSec)}. Checking again in {nextSec}s.
    </>
  );
}

type Tone = "ok" | "busy" | "warn" | "bad";

function ToneMark({ tone }: { tone: Tone }) {
  const common = {
    viewBox: "0 0 16 16",
    width: 13,
    height: 13,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "ok") {
    return (
      <svg {...common}>
        <path d="M2.5 8.6 6.2 12.3 13.5 4.2" />
      </svg>
    );
  }
  if (tone === "bad") {
    return (
      <svg {...common}>
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg {...common}>
        <path d="M8 1.8 15 14H1z" />
        <path d="M8 6.4v3.1" />
        <path d="M8 11.7h.01" />
      </svg>
    );
  }
  // busy: the same arrows as Check now, turning
  return (
    <svg {...common}>
      <path d="M14.2 8a6.2 6.2 0 1 1-1.9-4.4" />
      <path d="M14.4 1.6v3.4h-3.4" />
    </svg>
  );
}

export function SyncChip({
  offline,
  stale,
  updating,
  behind,
  dirtyCount,
  lastFetchAt,
  fetchIntervalS,
  syncing,
  checking,
  onSyncNow,
}: {
  offline: boolean;
  stale: boolean;
  updating: boolean;
  behind: number;
  dirtyCount: number;
  lastFetchAt: number | null;
  fetchIntervalS: number;
  syncing: boolean;
  checking: boolean;
  onSyncNow: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  let tone: Tone;
  let word: string;
  let headline: string;
  let detail: React.ReactNode;

  if (offline) {
    tone = "bad";
    word = "Offline";
    headline = "Can't reach GitHub";
    detail =
      "Nothing is going out or coming in until the connection is back. What you already hold is still yours to work on.";
  } else if (stale) {
    tone = "warn";
    word = "Out of date";
    headline = "Lock information may be out of date";
    detail =
      "The last check with GitHub did not go through, so somebody may have taken a file since then.";
  } else if (updating) {
    tone = "busy";
    word = "Syncing…";
    headline = "Getting the team's latest";
    detail = "Bringing the project up to date with GitHub.";
  } else if (behind > 0 && dirtyCount > 0) {
    tone = "warn";
    word = `${behind} waiting`;
    headline = `${behind} team change${behind === 1 ? "" : "s"} waiting`;
    detail =
      "Save & Share what you have first, then the team's work comes down on the next check.";
  } else if (behind > 0) {
    tone = "busy";
    word = "Syncing…";
    headline = "Getting the team's latest";
    detail = `${behind} change${behind === 1 ? "" : "s"} on the way down.`;
  } else if (syncing || checking) {
    tone = "busy";
    word = "Checking…";
    headline = syncing ? "Checking with GitHub" : "Checking with GitHub on its own";
    detail = syncing
      ? "Asking what has changed since the last check."
      : "The regular check the app runs on its own.";
  } else if (lastFetchAt !== null) {
    tone = "ok";
    word = "In sync";
    headline = "In sync with the team";
    detail = (
      <SyncedDetail lastFetchAt={lastFetchAt} fetchIntervalS={fetchIntervalS} />
    );
  } else {
    tone = "busy";
    word = "Checking…";
    headline = "Checking with the team";
    detail = "Asking GitHub what has changed.";
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setRect(btnRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const follow = () =>
      setRect(btnRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    // Opening click must not immediately close it again.
    const id = window.setTimeout(() => {
      if (!disposed) window.addEventListener("mousedown", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const POP_W = 304;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`syncchip tone-${tone}`}
        onClick={toggle}
        title={headline}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="syncmark" aria-hidden="true">
          <ToneMark tone={tone} />
        </span>
        <span className="syncword">{word}</span>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="syncpop"
            role="dialog"
            aria-label="Sync with the team"
            style={{
              top: rect.bottom + 6,
              left: Math.max(
                8,
                Math.min(rect.left, window.innerWidth - POP_W - 8),
              ),
              width: POP_W,
            }}
          >
            <p className="syncpop-state">{headline}</p>
            <p className="syncpop-detail muted small">{detail}</p>
            <button
              className="minibtn"
              onClick={onSyncNow}
              disabled={updating || syncing}
              title="Check GitHub for team changes right now"
            >
              <span className={syncing ? "spinicon" : "stillicon"}>
                <SyncGlyph />
              </span>
              {syncing ? "Checking…" : "Check now"}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
