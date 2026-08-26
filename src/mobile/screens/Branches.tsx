import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import * as api from "../api";
import { useBranches } from "../queries";
import {
  BranchName,
  Empty,
  Search,
  Segmented,
  Sheet,
  Spinner,
  Trouble,
  UserAvatar,
} from "../components";
import { formatChanged } from "../../dates";
import { Railway } from "./Railway";

/**
 * Every branch, and which one the rest of the app is reading.
 *
 * "Switch" here does not mean a checkout. Nothing is on this device to switch,
 * so all it changes is which line of the project the other screens describe.
 * The wording says so, because a member who has used the desktop app would
 * otherwise reasonably expect their files to change.
 *
 * Not a tab of its own. Which branch you are reading is a setting on the work
 * you are doing, not a place you go, and it is only ever changed on the way to
 * looking at something else.
 */
export function BranchSheet({
  branch,
  defaultBranch,
  onClose,
}: {
  branch: string;
  defaultBranch: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const branches = useBranches(true);
  const [needle, setNeedle] = useState("");
  const [view, setView] = useState<"list" | "map">("list");

  const q = needle.trim().toLowerCase();
  const shown = (branches.data ?? []).filter((b) => b.name.toLowerCase().includes(q));

  // Ahead/behind is a call per branch, so it is asked for lazily and only for
  // the branches actually on screen.
  const standings = useQueries({
    queries: shown.slice(0, 25).map((b) => ({
      queryKey: ["cloud", "standing", defaultBranch, b.name],
      queryFn: () => api.branchStanding(defaultBranch, b.name),
      enabled: !b.is_default,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  async function look(name: string) {
    await api.setBranch(name);
    queryClient.invalidateQueries({ queryKey: ["cloud"] });
    onClose();
  }

  return (
    <Sheet
      title="Branches"
      onClose={onClose}
    >
      <div className="m-head-tools m-flush">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "list" as const, label: "Branches" },
            { value: "map" as const, label: "Railway" },
          ]}
        />
        {view === "list" && (
          <Search value={needle} onChange={setNeedle} placeholder="Search branches" />
        )}
      </div>

      {view === "map" && <Railway defaultBranch={defaultBranch} />}

      <div hidden={view === "map"}>
        {branches.isLoading && <Spinner label="Reading the branches…" />}
        {branches.isError && (
          <Trouble error={branches.error} onRetry={() => branches.refetch()} />
        )}
        {branches.data && shown.length === 0 && <Empty title="Nothing matched" />}

        {shown.map((b, i) => {
          const standing = standings[i]?.data;
          return (
            <button
              key={b.name}
              className={`m-row m-branch${b.name === branch ? " here" : ""}`}
              onClick={() => look(b.name)}
            >
              <span className="m-row-main">
                <span className="m-row-title">
                  <BranchName name={b.name} isDefault={b.is_default} />
                  {b.is_default && <span className="m-tag">default</span>}
                  {b.protected && <span className="m-tag">protected</span>}
                </span>
                <span className="muted small">
                  {standing?.subject || b.subject || "No changes of its own"}
                </span>
                {standing && (standing.ahead > 0 || standing.behind > 0) && (
                  <span className="m-standing">
                    {standing.ahead > 0 && <span className="ahead">{standing.ahead} ahead</span>}
                    {standing.behind > 0 && <span className="behind">{standing.behind} behind</span>}
                    {standing.last_commit_at > 0 && (
                      <span className="muted">
                        {formatChanged(standing.last_commit_at * 1000)}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {standing?.author_avatar && (
                <UserAvatar url={standing.author_avatar} name={standing.author} size={26} />
              )}
              {b.name === branch && <span className="m-here-mark">Reading</span>}
            </button>
          );
        })}
      </div>

    </Sheet>
  );
}
