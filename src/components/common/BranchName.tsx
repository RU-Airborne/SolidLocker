import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGraph } from "../../api";
import { laneColor, layoutGraph } from "../history/HistoryPage";

/** Branch name -> its Branches-page colour (the lane its tip is on). */
export function useBranchColors(): (name: string) => string | undefined {
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 60_000,
  });
  return useMemo(() => {
    const byName = new Map<string, string>();
    for (const row of layoutGraph(graph.data ?? []).rows) {
      for (const r of row.commit.refs) {
        const name = r.startsWith("origin/") ? r.slice(7) : r;
        if (name === "HEAD" || r.startsWith("tag: ")) continue;
        if (!byName.has(name)) byName.set(name, laneColor(row.lane));
      }
    }
    return (name: string) => byName.get(name);
  }, [graph.data]);
}

/** A branch name in running text, in its own colour. */
export function BranchName({ name }: { name: string }) {
  const colorOf = useBranchColors();
  return (
    <strong
      className="branchword"
      style={{ color: colorOf(name) }}
    >
      {name}
    </strong>
  );
}
