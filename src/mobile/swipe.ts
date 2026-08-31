/**
 * The two gestures a phone expects to be able to use on something that has
 * been opened over the top of something else: drag a sheet down to put it
 * away, and pull a page back in from the left edge.
 *
 * Both are written against native listeners rather than React's onTouch
 * props. React registers touch handlers as passive, and a passive handler
 * cannot call preventDefault, so the page underneath scrolls while the
 * gesture is being made and the whole thing fights itself.
 *
 * Both also move the element by writing to its style directly. Putting the
 * offset in React state would re-render the panel on every touchmove, which
 * on a long list is enough to drop frames on exactly the gesture that is
 * supposed to feel immediate.
 */

import { useEffect } from "react";
import type { RefObject } from "react";

/** How far, and how fast, counts as meaning it. */
const DRAG_CLOSE_PX = 90;
const FLICK_PX_PER_MS = 0.5;
/** How close to the left edge a page-back drag has to start. */
const EDGE_PX = 24;
/** A page goes back on a shorter pull than a sheet, in proportion. */
const BACK_FRACTION = 0.33;

/** True once the animation set by `settle` has run its course. */
function clearOffset(el: HTMLElement) {
  el.style.transition = "";
  el.style.transform = "";
}

/**
 * Drag a bottom sheet downwards to dismiss it.
 *
 * `scroller` is the sheet's scrolling body: a drag that starts inside a list
 * already scrolled down is a scroll, and only a list sitting at its top hands
 * the gesture over.
 */
export function useSheetDismiss(
  panel: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const el = panel.current;
    if (!el) return;

    let y0 = 0;
    let t0 = 0;
    let dy = 0;
    let active = false;

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const list = scroller.current;
      active = !(
        list &&
        list.contains(e.target as Node) &&
        list.scrollTop > 0
      );
      if (!active) return;
      y0 = e.touches[0].clientY;
      t0 = e.timeStamp;
      dy = 0;
      el.style.transition = "none";
    };

    const move = (e: TouchEvent) => {
      if (!active) return;
      dy = e.touches[0].clientY - y0;
      // Upward is not a dismissal: the sheet is already as far up as it goes.
      if (dy <= 0) {
        el.style.transform = "";
        return;
      }
      e.preventDefault();
      el.style.transform = `translateY(${dy}px)`;
    };

    const up = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const speed = dy / Math.max(1, e.timeStamp - t0);
      if (dy > DRAG_CLOSE_PX || speed > FLICK_PX_PER_MS) {
        // Let it carry on the way it was going rather than snapping shut.
        el.style.transition = "transform 0.18s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "translateY(100%)";
        onClose();
      } else {
        el.style.transition = "transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
      clearOffset(el);
    };
  }, [panel, scroller, onClose]);
}

/**
 * iOS's swipe back: pull from the left edge and the page follows your thumb,
 * going back if you take it far enough and springing home if you do not.
 *
 * The webview's own back gesture is not available here, and even where it is
 * it drives browser history rather than the app, so the gesture is made by
 * hand. It is deliberately edge-started: a drag beginning anywhere else is
 * something the page itself may want, such as a row that swipes.
 */
export function useEdgeBack(
  page: RefObject<HTMLElement | null>,
  enabled: boolean,
  onBack: () => void,
) {
  useEffect(() => {
    const el = page.current;
    if (!el || !enabled) return;

    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let dx = 0;
    let active = false;
    let decided = false;

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      active = t.clientX <= EDGE_PX;
      decided = false;
      if (!active) return;
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = e.timeStamp;
      dx = 0;
      el.style.transition = "none";
    };

    const move = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      dx = t.clientX - x0;
      const dyAbs = Math.abs(t.clientY - y0);
      // Work out once whether this is a back or a scroll that happened to
      // start near the edge, then stick with it. Deciding every frame let a
      // wandering thumb flip the panel in and out.
      if (!decided) {
        if (dyAbs > 12 && dyAbs > Math.abs(dx)) {
          active = false;
          el.style.transition = "";
          el.style.transform = "";
          return;
        }
        if (Math.abs(dx) < 8) return;
        decided = true;
      }
      if (dx <= 0) {
        el.style.transform = "";
        return;
      }
      e.preventDefault();
      el.style.transform = `translateX(${dx}px)`;
    };

    const up = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const speed = dx / Math.max(1, e.timeStamp - t0);
      const far = dx > el.offsetWidth * BACK_FRACTION;
      if (far || speed > FLICK_PX_PER_MS) {
        el.style.transition = "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "translateX(100%)";
        onBack();
      } else {
        el.style.transition = "transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
      clearOffset(el);
    };
  }, [page, enabled, onBack]);
}
