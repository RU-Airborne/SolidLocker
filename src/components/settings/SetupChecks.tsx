import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { runSetupChecks, type SetupCheck } from "../../api";

const MARK: Record<string, string> = { ok: "✓", warn: "!", fail: "✕" };

/** Setup checks on demand. */
export function SetupChecks() {
  const [ran, setRan] = useState(false);
  const checks = useQuery<SetupCheck[]>({
    queryKey: ["setupChecks"],
    queryFn: runSetupChecks,
    enabled: ran,
    staleTime: 60_000,
    retry: false,
  });

  const problems = (checks.data ?? []).filter((c) => c.state !== "ok");

  return (
    <div className="checkblock">
      <div className="setuprow toolrow">
        <button
          onClick={() => (ran ? checks.refetch() : setRan(true))}
          disabled={checks.isFetching}
        >
          {checks.isFetching ? "Checking…" : ran ? "Check again" : "Run checks"}
        </button>
        {checks.isSuccess && (
          <span className="muted small">
            {problems.length === 0
              ? "Everything looks right."
              : `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at.`}
          </span>
        )}
      </div>

      {checks.isError && (
        <p className="muted small">Could not run the checks just now.</p>
      )}

      {checks.data && (
        <ul className="checklist">
          {checks.data.map((c) => (
            <li key={c.id} className={`checkrow check-${c.state}`}>
              <span className="checkmark" aria-hidden="true">
                {MARK[c.state] ?? "•"}
              </span>
              <span className="checkbody">
                <strong>{c.label}</strong>
                <span className="muted small"> — {c.detail}</span>
                {c.fix && <span className="checkfix">{c.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
