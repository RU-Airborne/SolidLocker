import { useState } from "react";
import { ThemeChoiceDialog } from "../dialogs/ThemeChoiceDialog";
import { ViewChoiceDialog } from "../dialogs/ViewChoiceDialog";
import { NeedsGitSplash, StartingUpSplash } from "../setup/Splashes";
import { SetupWizard } from "../setup/SetupWizard";

/* ------------ NOT FOR RELEASE!!!!! -------------- */
/** Set to false to hide. */
export const SPLASH_GALLERY = true;

type Which =
  | "theme"
  | "view"
  | "starting"
  | "needsgit"
  | "setup"
  | null;

const SCREENS: { id: Exclude<Which, null>; label: string; when: string }[] = [
  {
    id: "theme",
    label: "Light or dark",
    when: "First launch, before anything else.",
  },
  {
    id: "view",
    label: "List or thumbnails",
    when: "First launch, straight after the light-or-dark question.",
  },
  {
    id: "starting",
    label: "Starting up",
    when: "Every launch, while the app reads its settings.",
  },
  {
    id: "needsgit",
    label: "You need Git",
    when: "Any launch on a computer without Git or Git LFS.",
  },
  {
    id: "setup",
    label: "Choose a project",
    when: "Every launch until a repository has been picked.",
  },
];

export function SplashGallery() {
  const [showing, setShowing] = useState<Which>(null);

  return (
    <section className="setupsection wide devsection">
      <div className="sectionhead">
        <h3>First-run screens</h3>
        <span className="devtag">Not for release</span>
      </div>
      <p className="muted">
        The screens a member only sees once. Opening one here does not change
        anything: whatever you pick is only remembered by the setting it
        belongs to, exactly as it would be on a real first launch. Press Escape
        or the close button to come back.
      </p>
      <div className="splashrow">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            className="splashpick"
            onClick={() => setShowing(s.id)}
          >
            <strong>{s.label}</strong>
            <span className="muted small">{s.when}</span>
          </button>
        ))}
      </div>

      {showing && (
        <div className="splashstage" role="dialog" aria-label="Screen preview">
          <button
            className="splashclose"
            onClick={() => setShowing(null)}
            title="Close the preview"
            autoFocus
            onKeyDown={(e) => e.key === "Escape" && setShowing(null)}
          >
            Close preview
          </button>
          {showing === "theme" && (
            <ThemeChoiceDialog onDone={() => setShowing(null)} />
          )}
          {showing === "view" && (
            <ViewChoiceDialog onDone={() => setShowing(null)} />
          )}
          {showing === "starting" && <StartingUpSplash />}
          {showing === "needsgit" && (
            <NeedsGitSplash onRecheck={() => setShowing(null)} />
          )}
          {showing === "setup" && (
            <SetupWizard onDone={() => setShowing(null)} />
          )}
        </div>
      )}
    </section>
  );
}
