import { useState } from "react";
import { useTheme, type Theme } from "../../theme";
import DialLogo from "../DialLogo";

/* System first, because it is the one already selected. */
const CHOICES: { value: Theme; label: string }[] = [
  { value: "system", label: "Match System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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
              <span className={`themeswatch ${c.value}`} aria-hidden="true">
                <span className="themeswatch-bar" />
                <span className="themeswatch-body" />
              </span>
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
