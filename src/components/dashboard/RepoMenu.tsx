import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { forgetRepo, readRecentRepos, type RecentRepo } from "../../persist";

export function RepoMenu({
  slug,
  path,
  onPick,
  onBrowse,
  onOpenFolder,
}: {
  slug: string;
  path: string;
  onPick: (path: string) => void;
  onBrowse: () => void;
  onOpenFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [recent, setRecent] = useState<RecentRepo[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const here = path.toLowerCase();
  const others = recent.filter((r) => r.path.toLowerCase() !== here);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setRecent(readRecentRepos());
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

  const POP_W = 340;

  return (
    <>
      <button
        ref={btnRef}
        className="crumb"
        onClick={toggle}
        title={`${path}\nClick to switch project`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          className="crumbicon"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
        </svg>
        <span className="crumbword">{slug.split("/")[1] ?? slug}</span>
        <span className="crumbswap" aria-hidden="true">
          ⇄
        </span>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            className="repopop"
            role="menu"
            style={{
              top: rect.bottom + 6,
              left: Math.max(
                8,
                Math.min(rect.left, window.innerWidth - POP_W - 8),
              ),
              width: POP_W,
            }}
          >
            {others.length > 0 && (
              <>
                <p className="repopop-head muted small">Opened before</p>
                {others.map((r) => (
                  <div key={r.path} className="repopop-row">
                    <button
                      className="repopop-item"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onPick(r.path);
                      }}
                      title={r.path}
                    >
                      <span className="repopop-name">
                        {r.slug.split("/")[1] ?? r.slug}
                      </span>
                      <span className="repopop-path muted small">{r.path}</span>
                    </button>
                    <button
                      className="repopop-forget"
                      title="Take this off the list. The folder is not touched"
                      aria-label={`Forget ${r.slug}`}
                      onClick={() => setRecent(forgetRepo(r.path))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="repopop-rule" />
              </>
            )}
            <button
              className="repopop-browse"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenFolder();
              }}
              title="Open the current project's root folder in your file explorer"
            >
              <span className="repopop-browseicon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 5h6v6M19 5l-9 9" />
                  <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
                </svg>
              </span>
              Show in File Explorer
            </button>
            <button
              className="repopop-browse"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onBrowse();
              }}
              title="Point SolidLocker at a project folder already on this computer"
            >
              <span className="repopop-browseicon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
                  <path d="M12 11v5M9.5 13.5h5" />
                </svg>
              </span>
              Choose another folder on this computer…
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
