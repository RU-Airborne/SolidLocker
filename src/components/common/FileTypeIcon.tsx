/** cube = part, two boxes = assembly, sheet = drawing. */
export function FileTypeIcon({ path, size = 13 }: { path: string; size?: number }) {
  const ext = path.toLowerCase().split(".").pop();
  const kind =
    ext === "sldasm"
      ? "asm"
      : ext === "slddrw"
        ? "drw"
        : ext === "sldprt"
          ? "prt"
          : "any";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `ftype ftype-${kind}`,
    "aria-hidden": true,
  };
  if (ext === "sldasm") {
    return (
      <svg {...common}>
        <rect x="3" y="11" width="10" height="10" rx="1" />
        <path d="M8 11V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7" />
      </svg>
    );
  }
  if (ext === "slddrw") {
    return (
      <svg {...common}>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M15 2v5h5" />
        <path d="M9.5 13h7M9.5 17h4" />
      </svg>
    );
  }
  if (ext === "sldprt") {
    return (
      <svg {...common}>
        <path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" />
        <path d="M12 11.5 20 6.5M12 11.5 4 6.5M12 11.5V22" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M15 2v5h5" />
    </svg>
  );
}
