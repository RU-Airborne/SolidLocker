import { useState } from "react";
import { RepoPicker } from "../common/RepoPicker";
import DialLogo from "../DialLogo";

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [opening, setOpening] = useState(false);

  if (opening) {
    return (
      <div className="center">
        <div className="card launchscreen" role="status" aria-live="polite">
          <span className="logoglow">
            <DialLogo className="setuplogo" label="" spinning />
          </span>
          <h2>Opening your project…</h2>
          <p className="muted">
            Checking the repository and preparing the CAD files. The first open
            of a large project can take a few minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center">
      <div className="card setupcard setuppick">
        <span className="logoglow">
          <DialLogo className="setuplogo" label="" />
        </span>
        <h1>Choose a repository from GitHub</h1>

        <div className="setupsection">
          <RepoPicker
            browseTitle="Select your team's repository folder"
            onOpened={() => {
              setOpening(true);
              onDone();
            }}
          />
        </div>
      </div>
    </div>
  );
}
