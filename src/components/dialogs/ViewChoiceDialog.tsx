import { usePersisted } from "../../persist";
import DialLogo from "../DialLogo";

export type FileView = "list" | "tiles";
export function viewUnchosen(): boolean {
  try {
    const saved = localStorage.getItem("solidlocker.fileView");
    return saved !== "list" && saved !== "tiles";
  } catch {
    return false;
  }
}

function ListSketch() {
  return (
    <svg viewBox="0 0 96 64" aria-hidden="true" className="viewsketch-art">
      <rect x="4" y="5" width="88" height="9" rx="2" className="vs-head" />
      {[18, 30, 42, 54].map((y) => (
        <g key={y}>
          <rect x="4" y={y} width="10" height="7" rx="1.6" className="vs-mark" />
          <rect x="18" y={y + 1.5} width="38" height="4" rx="2" className="vs-text" />
          <rect x="62" y={y + 1.5} width="12" height="4" rx="2" className="vs-dim" />
          <rect x="78" y={y + 0.5} width="14" height="6" rx="2" className="vs-btn" />
        </g>
      ))}
    </svg>
  );
}

function TilesSketch() {
  return (
    <svg viewBox="0 0 96 64" aria-hidden="true" className="viewsketch-art">
      {[0, 1, 2].flatMap((col) =>
        [0, 1].map((rowIdx) => {
          const x = 4 + col * 30.5;
          const y = 4 + rowIdx * 29;
          return (
            <g key={`${col}-${rowIdx}`}>
              <rect x={x} y={y} width="27" height="26" rx="3" className="vs-card" />
              <rect
                x={x + 3}
                y={y + 3}
                width="21"
                height="13"
                rx="2"
                className="vs-mark"
              />
              <rect
                x={x + 3}
                y={y + 18.5}
                width="15"
                height="3.4"
                rx="1.7"
                className="vs-text"
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

const CHOICES: {
  value: FileView;
  label: string;
  blurb: string;
  art: () => JSX.Element;
}[] = [
  {
    value: "list",
    label: "List",
    blurb: "Best when you know the file name you are after.",
    art: ListSketch,
  },
  {
    value: "tiles",
    label: "Thumbnails",
    blurb: "Best when you want to see the preview thumbnail visually.",
    art: TilesSketch,
  },
];

export function ViewChoiceDialog({ onDone }: { onDone: () => void }) {
  const [view, setView] = usePersisted<FileView>(
    "fileView",
    (raw) => (raw === "tiles" ? "tiles" : "list"),
    (v) => v,
  );

  return (
    <div className="modal-backdrop themepick">
      <div className="modal viewpick">
        <span className="logoglow themelogo">
          <DialLogo className="setuplogo" label="" />
        </span>
        <h2>How should your files look?</h2>
        <p className="muted">
          Either way you can switch at the top of the Files page whenever you
          like.
        </p>
        <div className="viewrow">
          {CHOICES.map((c) => {
            const Art = c.art;
            return (
              <button
                key={c.value}
                className={`viewsketch${view === c.value ? " on" : ""}`}
                onClick={() => setView(c.value)}
                aria-pressed={view === c.value}
              >
                <Art />
                <strong>{c.label}</strong>
                <span className="muted small">{c.blurb}</span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onDone}>
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}
