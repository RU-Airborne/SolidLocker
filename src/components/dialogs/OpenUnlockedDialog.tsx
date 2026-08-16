export function OpenUnlockedDialog({
  path,
  lockedByOther,
  swInstalled,
  onLockAndOpen,
  onOpenAnyway,
  onCancel,
}: {
  path: string;
  lockedByOther: string | null;
  swInstalled: boolean;
  onLockAndOpen: () => void;
  onOpenAnyway: () => void;
  onCancel: () => void;
}) {
  const name = path.split("/").pop() ?? path;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>You have not locked this file</h2>
        <p>
          <strong>{name}</strong>{" "}
          {lockedByOther
            ? `is locked by ${lockedByOther}. You can view it, but anything you change cannot be shared until they unlock it.`
            : swInstalled
              ? "is not locked by you. SolidWorks will open it read only, and any changes you make will be difficult to save."
              : "is not locked by you. It will open read only, and any changes you make will be difficult to save."}
        </p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onOpenAnyway}>Open anyway</button>
          {!lockedByOther && (
            <button className="primary" onClick={onLockAndOpen}>
              Lock and open
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
