export function SignInDialog({
  checking,
  signingIn,
  onSignIn,
  onCheckAgain,
  onClose,
}: {
  checking: boolean;
  signingIn: boolean;
  onSignIn: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Sign in to GitHub first</h2>
        <p>
          This computer has not signed in to GitHub yet, so locking and sharing
          will not work.
        </p>
        <p>
          Click <strong>Sign in</strong> below and a browser window opens asking
          you to sign in and to authorize <strong>Git Credential Manager</strong>.
          Say yes to both. Windows remembers it afterwards, and SolidLocker never
          sees your password.
        </p>
        <p>
          You can also sign in later from the{" "}
          <strong>Profile</strong> button in the top right corner.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Continue anyway</button>
          <button onClick={onCheckAgain} disabled={checking || signingIn}>
            {checking ? "Checking…" : "I already signed in"}
          </button>
          <button
            className="primary"
            onClick={onSignIn}
            disabled={signingIn || checking}
          >
            {signingIn ? "Waiting for GitHub…" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
