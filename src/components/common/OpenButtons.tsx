import { useQuery } from "@tanstack/react-query";
import { getSwIcon, getSwInstalled } from "../../api";
import swIconFallback from "../../assets/sw-generic.svg";
import { OpenGlyph } from "./OpenGlyph";

export function useSwIcon(): string {
  const icon = useQuery({
    queryKey: ["swIcon"],
    queryFn: getSwIcon,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return icon.data ?? swIconFallback;
}

/** Whether this computer has SolidWorks at all. */
export function useSwInstalled(): boolean {
  const q = useQuery({
    queryKey: ["swInstalled"],
    queryFn: getSwInstalled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return q.data ?? true;
}

export function OpenFileButton({
  path,
  lockable,
  disabled,
  onOpen,
}: {
  path: string;
  lockable: boolean;
  disabled?: boolean;
  onOpen: (path: string) => void;
}) {
  const swIcon = useSwIcon();
  const swInstalled = useSwInstalled();
  const what = !lockable
    ? "Open this file in whatever this computer normally opens it with"
    : swInstalled
      ? "Open in SolidWorks"
      : "Open this file";

  return (
    <button
      className="iconbtn openbtn"
      disabled={disabled}
      title={what}
      aria-label={what}
      onClick={() => onOpen(path)}
    >
      <OpenGlyph />
      {lockable && <img className="badgeicon" src={swIcon} alt="" />}
    </button>
  );
}

export function OpenFolderButton({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      className="iconbtn openbtn"
      title="Open this folder on your computer"
      aria-label="Open in File Explorer"
      onClick={() => onOpen(path)}
    >
      <OpenGlyph />
      <svg className="badgeicon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"
          fill="#f0a92e"
        />
      </svg>
    </button>
  );
}
