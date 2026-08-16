/**
 * Detailed offline help, opened from the "can't verify locks" banner.
 *
 * Static prose lives here rather than in copy.ts, per the project convention
 * that dialog-internal explanations stay with their dialog.
 */
export function OfflineHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Working while offline</h2>

        <p>
          SolidLocker can't reach GitHub right now, so it can't lock new files,
          Save &amp; Share, or unlock anything until you're back online. A lock
          only counts once GitHub's server confirms it, and there's no server to
          ask while you're offline.
        </p>

        <h3>Files you already locked are fine</h3>
        <p>
          Any file you locked before you lost connection is still yours and stays
          editable. Open it and save it in SolidWorks like normal. SolidLocker
          won't put it back to read only while you're offline.
        </p>

        <h3>If you have to edit a file you didn't lock</h3>
        <p>
          Normally SolidLocker keeps files you haven't locked read only, so two
          people never edit the same one by accident. While offline it can't lock
          a file for you. If you're certain no teammate will touch a file and you
          truly have to edit it now, you can clear the read only flag yourself in
          Windows:
        </p>
        <ol>
          <li>Find the file in your project folder in <strong>File Explorer</strong>.</li>
          <li>
            Right click it and choose <strong>Properties</strong>.
          </li>
          <li>
            On the <strong>General</strong> tab, untick{" "}
            <strong>Read-only</strong>, then click <strong>OK</strong>.
          </li>
          <li>
            For a whole folder, untick <strong>Read-only</strong> on the folder
            and let Windows apply it to everything inside.
          </li>
        </ol>
        <p>The file is now editable in SolidWorks.</p>

        <div className="warn-inline">
          <p>
            <strong>Before you do this:</strong>
          </p>
          <ul>
            <li>
              You'd be working <strong>without a lock</strong>. No teammate can
              see that you took the file, so someone else could edit the very
              same file at the same time. SolidWorks files can't be merged, so
              one of you would lose that work for good.
            </li>
            <li>
              Only do this if you're sure nobody else will open that file while
              you're offline.
            </li>
            <li>
              Your changes live only on your computer until you're back online
              and Save &amp; Share.
            </li>
          </ul>
        </div>

        <h3>When you're back online</h3>
        <ol>
          <li>
            Reconnect to the internet. SolidLocker comes back on its own.
          </li>
          <li>
            For a file you had already locked, just <strong>Save &amp; Share</strong>{" "}
            like usual, then unlock it when you're done.
          </li>
          <li>
            For a file you edited without a lock, <strong>lock it now</strong>, then <strong>Save &amp; Share</strong> to push
            your work up to the team.
          </li>
          <li>
            If a teammate changed that same file while you were away, SolidLocker
            stops and warns you instead of overwriting anything. Because these
            files can't be merged, you'll have to decide whose version to keep.
          </li>
        </ol>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Okie
          </button>
        </div>
      </div>
    </div>
  );
}
