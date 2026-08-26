import { useId, useState } from "react";
import { useTheme, type Theme } from "../../theme";
import DialLogo from "../DialLogo";

/* System first, because it is the one already selected. */
const CHOICES: { value: Theme; label: string }[] = [
  { value: "system", label: "Match System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PALETTE = {
  light: {
    page: "#ffffff",
    bar: "#eef1f5",
    rail: "#e3e7ed",
    edge: "#d3dae1",
    ink: "#8d97a2",
  },
  dark: {
    page: "#14171c",
    bar: "#1b1e24",
    rail: "#181b21",
    edge: "#2b313a",
    ink: "#525c68",
  },
} as const;

const ACCENT = "rgb(169, 46, 49)";

/** SolidLocker itself, three centimetres wide. */
function WindowArt({
  mode,
  clip,
}: {
  mode: "light" | "dark";
  clip?: string;
}) {
  const c = PALETTE[mode];
  return (
    <g clipPath={clip ? `url(#${clip})` : undefined}>
      <rect x="0" y="0" width="96" height="64" fill={c.page} />
      <rect x="0" y="0" width="96" height="13" fill={c.bar} />
      <rect x="0" y="0" width="13" height="64" fill={c.rail} />
      <line x1="13" y1="13" x2="96" y2="13" stroke={c.edge} strokeWidth="0.9" />
      <line x1="13" y1="0" x2="13" y2="64" stroke={c.edge} strokeWidth="0.9" />

      {/* the mark at the top of the rail */}
      <circle cx="6.5" cy="7" r="3.4" fill={ACCENT} />

      {/* the branch you are on, and Save & Share */}
      <rect x="18" y="4.6" width="24" height="4.4" rx="2.2" fill={c.ink} />
      <rect x="66" y="3.6" width="24" height="6.4" rx="3.2" fill={ACCENT} />

      {[19, 30, 41, 52].map((y) => (
        <g key={y}>
          <rect x="18" y={y} width="7.5" height="6.5" rx="1.6" fill={ACCENT} opacity="0.62" />
          <rect x="29.5" y={y + 1.2} width="30" height="4" rx="2" fill={c.ink} opacity="0.85" />
          <rect
            x="68"
            y={y + 0.6}
            width="22"
            height="5.4"
            rx="2.7"
            fill="none"
            stroke={c.edge}
            strokeWidth="1"
          />
          <line
            x1="18"
            y1={y + 9}
            x2="90"
            y2={y + 9}
            stroke={c.edge}
            strokeWidth="0.7"
          />
        </g>
      ))}
    </g>
  );
}

function ThemeSketch({ value }: { value: Theme }) {
  const uid = useId().replace(/:/g, "");

  if (value === "system") {
    return (
      <svg viewBox="0 0 96 64" className="themeart" aria-hidden="true">
        <defs>
          <clipPath id={`${uid}L`}>
            <polygon points="0,0 58,0 38,64 0,64" />
          </clipPath>
          <clipPath id={`${uid}R`}>
            <polygon points="58,0 96,0 96,64 38,64" />
          </clipPath>
        </defs>
        <WindowArt mode="light" clip={`${uid}L`} />
        <WindowArt mode="dark" clip={`${uid}R`} />
        <line
          x1="58"
          y1="0"
          x2="38"
          y2="64"
          stroke="rgba(150,158,168,0.75)"
          strokeWidth="1.1"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 64" className="themeart" aria-hidden="true">
      <WindowArt mode={value} />
    </svg>
  );
}

/**
 * Asked once, on the first launch. Picking applies straight away so the
 * choice is made by looking at it rather than by reading the labels.
 */
export function ThemeChoiceDialog({ onDone }: { onDone: () => void }) {
  const [theme, setTheme] = useTheme();
  const [tried, setTried] = useState<Theme | null>(null);

  return (
    <div className="modal-backdrop themepick">
      <div className="modal">
        {/* setuplogo carries the hover turn from dial.css. */}
        <span className="logoglow themelogo">
          <DialLogo className="setuplogo" label="" />
        </span>
        <h2>How should SolidLocker look?</h2>
        <p className="muted">
          You can change this later in Settings.
        </p>
        <div className="themerow">
          {CHOICES.map((c) => (
            <button
              key={c.value}
              className={`themecard${(tried ?? theme) === c.value ? " on" : ""}`}
              onClick={() => {
                setTried(c.value);
                setTheme(c.value);
              }}
            >
              {/* was: two flat bands, .themeswatch / -bar / -body */}
              <ThemeSketch value={c.value} />
              <strong>{c.label}</strong>
            </button>
          ))}
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
