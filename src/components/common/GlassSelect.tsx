import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface GlassOption {
  value: string;
  label: string;
}

/**
 * A custom dropdown menu with translucency and blur
 */
export function GlassSelect({
  value,
  options,
  onChange,
  disabled = false,
  title,
  className = "",
  ariaLabel,
}: {
  value: string;
  options: GlassOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLUListElement>(null);

  const current = options.find((o) => o.value === value);

  function openList() {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    setRect(btnRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  }

  function choose(v: string) {
    setOpen(false);
    if (v !== value) onChange(v);
    btnRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const sync = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
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
    const id = window.setTimeout(() => {
      if (!disposed) window.addEventListener("mousedown", onDown);
    }, 0);
    return () => {
      disposed = true;
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popRef.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const pick = options[active];
      if (pick) choose(pick.value);
    }
  }

  // Flip above the trigger when there is not enough room below.
  const maxH = 320;
  const below = rect ? window.innerHeight - rect.bottom - 12 : maxH;
  const flip = rect !== null && below < 180 && rect.top > below;

  // A trigger below the toolbar can scroll up underneath it,
  // and the list is fixed, so it would paint straight over the toolbar, clip
  // whatever crosses that edge.
  const inTopBar = btnRef.current?.closest(".ghbar") != null;
  const barBottom = inTopBar
    ? 0
    : (document.querySelector(".ghbar")?.getBoundingClientRect().bottom ?? 0);
  const popTop = rect && !flip ? rect.bottom + 6 : undefined;
  const clipTop = popTop === undefined ? 0 : Math.max(0, barBottom - popTop);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`gselect ${className}`.trim()}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="gselect-label">{current?.label ?? value}</span>
        <span className="gselect-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open &&
        rect &&
        createPortal(
          <ul
          ref={popRef}
          className="gselect-pop"
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{
            left: Math.max(
              8,
              Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8),
            ),
            minWidth: rect.width,
            maxHeight: Math.max(120, Math.min(maxH, flip ? rect.top - 12 : below)),
            ...(flip
              ? { bottom: window.innerHeight - rect.top + 6 }
              : { top: rect.bottom + 6 }),
            ...(clipTop > 0
              ? { clipPath: `inset(${clipTop}px 0 0 0 round 12px)` }
              : null),
          }}
        >
          {options.map((o, i) => (
            <li key={o.value} data-i={i}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`gselect-opt${o.value === value ? " chosen" : ""}${
                  i === active ? " active" : ""
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
