import { useEffect, useId, useRef } from "react";

import patch from "../assets/patch.png";
import {
  BODY_D,
  CENTRE_R,
  COLOUR,
  CX,
  CY,
  EDGE_W,
  FACE_R,
  INDEX_D,
  TEETH,
  TICKS,
  VIEWBOX,
} from "../dialmark";

type Props = {
  className?: string;
  /* Empty when the mark sits next to a heading that already names the app. */
  label?: string;
  /* Turn the dial continuously, for a wait the member cannot shorten. */
  spinning?: boolean;
};

const SPIN_MS = 3200;
const SPIN_MS_CALM = 9000;
const SETTLE_MS = 620;
/* The graduations repeat every 45 degrees, so the dial can come to rest on any
   multiple of 45 and look exactly as it did before it started turning. */
const STEP = 45;

/* The SolidLocker mark, drawn inline so the dial can turn on hover. The face
   and its graduations sit in .dialface; the tab, the index and the roundel are
   outside it and stay put, the way the body of a real lock does. */
export default function DialLogo({
  className,
  label = "SolidLocker",
  spinning = false,
}: Props) {
  const clip = `dialbody-${useId().replace(/:/g, "")}`;
  const face = useRef<SVGGElement>(null);

  /* The spin is driven here rather than from CSS so that when the work
     finishes we can read where the dial actually is, let it run on a little
     further, and swing it back to the nearest mark — the way a dial lands on
     its number instead of stopping dead. */
  useEffect(() => {
    const el = face.current;
    if (!el || !spinning) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = calm ? SPIN_MS_CALM : SPIN_MS;
    const spin = el.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration, iterations: Infinity, easing: "linear" },
    );

    return () => {
      const at = Number(spin.currentTime ?? 0);
      spin.cancel();
      if (calm || !el.isConnected) return;
      const start = 360 * ((at % duration) / duration);
      const rest = Math.ceil((start + 20) / STEP) * STEP;
      el.animate(
        [
          { transform: `rotate(${start}deg)` },
          {
            transform: `rotate(${rest + 16}deg)`,
            offset: 0.66,
            easing: "cubic-bezier(0.15, 0.85, 0.3, 1)",
          },
          { transform: `rotate(${rest}deg)` },
        ],
        { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    };
  }, [spinning]);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      role={label ? "img" : "presentation"}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={clip} clipRule="evenodd">
          <path d={BODY_D} clipRule="evenodd" />
        </clipPath>
      </defs>

      <path d={BODY_D} fillRule="evenodd" fill={COLOUR.rim} />
      <g clipPath={`url(#${clip})`}>
        {/* One hard-edged tone break instead of a gradient. */}
        <rect
          x={CX - 400}
          y={CY - 400}
          width={800}
          height={400}
          transform={`rotate(-38 ${CX} ${CY})`}
          fill={COLOUR.rimLit}
        />
        <path
          d={TEETH.d}
          stroke={COLOUR.tooth}
          strokeWidth={TEETH.width}
          strokeLinecap="round"
        />
      </g>
      <path
        d={BODY_D}
        fillRule="evenodd"
        fill="none"
        stroke={COLOUR.edge}
        strokeWidth={EDGE_W}
      />

      <g
        ref={face}
        className="dialface"
        style={{ transformOrigin: `${CX}px ${CY}px` }}
      >
        <circle cx={CX} cy={CY} r={FACE_R} fill={COLOUR.face} />
        <path d={TICKS.major} stroke={COLOUR.tick} strokeWidth={TICKS.majorW} />
        <path
          d={TICKS.minor}
          stroke={COLOUR.tick}
          strokeOpacity={0.82}
          strokeWidth={TICKS.minorW}
        />
      </g>

      <circle cx={CX} cy={CY} r={CENTRE_R * 1.02} fill={COLOUR.face} />
      {/* Airborne roundel: original artwork, unmodified. */}
      <image
        href={patch}
        x={CX - CENTRE_R}
        y={CY - CENTRE_R}
        width={CENTRE_R * 2}
        height={CENTRE_R * 2}
        preserveAspectRatio="xMidYMid meet"
      />
      <path d={INDEX_D} fill={COLOUR.index} />
    </svg>
  );
}
