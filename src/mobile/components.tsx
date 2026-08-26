/** Small parts the phone screens share. */

import { useEffect, useRef, useState } from "react";

import { isAppError } from "../types";
import { laneColor, LANE_COUNT } from "../lanes";
import { UserAvatar } from "../components/common/UserAvatar";

export { UserAvatar };
export { FileTypeIcon } from "../components/common/FileTypeIcon";

/**
 * A branch always reads in its own colour, the same rule the desktop app
 * follows. It cannot be the same colour though: on the desktop the hue comes
 * from where the branch sits on the graph, and there is no graph here. A hash
 * gives every branch a stable colour of its own, which is what the colour is
 * for.
 */
function laneOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % LANE_COUNT;
}

export function BranchName({
  name,
  isDefault = false,
}: {
  name: string;
  isDefault?: boolean;
}) {
  return (
    <strong
      className="branchword"
      style={{ color: isDefault ? laneColor(0) : laneColor(laneOf(name)) }}
    >
      {name}
    </strong>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="m-spinner" role="status">
      <span className="m-spinner-dial" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}

/** Whatever went wrong, said once, with a way out. */
export function Trouble({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const said = isAppError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
  const code = isAppError(error) ? error.code : null;
  return (
    <div className="m-trouble">
      <p>{said}</p>
      {code === "PERMISSION" && (
        <p className="muted small">
          Ask whoever runs the project on GitHub for write access.
        </p>
      )}
      {onRetry && (
        <button className="m-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="m-empty">
      <p className="m-empty-title">{title}</p>
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="m-search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value && (
        <button
          className="m-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear the search"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="m-segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && option.count > 0 && (
            <span className="m-seg-count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A sheet that slides up from the bottom, which is where a phone puts things
 * that a thumb has to reach. Closing on the backdrop and on Escape, because
 * the on-screen keyboard has one and an external one might too.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="m-sheet-back" onClick={onClose}>
      <div
        className="m-sheet"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-sheet-grip" aria-hidden="true" />
        <header className="m-sheet-head">
          <h2>{title}</h2>
          <button className="m-sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Yes/no, for the handful of things that cannot be taken back. */
export function Confirm({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="m-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={danger ? "m-btn m-btn-danger" : "m-btn m-btn-go"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="m-confirm">{body}</div>
    </Sheet>
  );
}

/** A one-line note that fades on its own. Used for "Lock taken" and friends. */
export function useFlash(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(t);
  }, [message]);
  return [message, setMessage];
}

export function Flash({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="m-flash" role="status">
      {message}
    </div>
  );
}

export function bytes(n: number): string {
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
