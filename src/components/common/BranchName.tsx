import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGraph } from "../../api";
import { routeColor, routeSets } from "../history/HistoryPage";

/** Branch name -> its Branches-page colour (the line it draws there). */
export function useBranchColors(): (name: string) => string | undefined {
  const graph = useQuery({
    queryKey: ["graph"],
    queryFn: getGraph,
    staleTime: 60_000,
  });
  return useMemo(() => {
    const routes = routeSets(graph.data ?? []);
    return (name: string) =>
      routes.repOf.has(name) ? routeColor(routes, name) : undefined;
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
