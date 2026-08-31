import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "../api";
import { Empty, Search, Spinner, Trouble, UserAvatar } from "../components";
import { formatAgo } from "../../dates";

export function PickProject({ onSignOut }: { onSignOut: () => void }) {
  const queryClient = useQueryClient();
  const [needle, setNeedle] = useState("");
  const [typed, setTyped] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const repos = useQuery({
    queryKey: ["cloud", "myRepos"],
    queryFn: api.myRepos,
    staleTime: 5 * 60_000,
  });

  const shown = useMemo(() => {
    const all = repos.data ?? [];
    const q = needle.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => r.slug.toLowerCase().includes(q));
  }, [repos.data, needle]);

  async function open(slug: string) {
    setOpening(slug);
    setError(null);
    try {
      await api.chooseRepo(slug);
      queryClient.invalidateQueries({ queryKey: ["cloud"] });
    } catch (e) {
      setError(e);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="m-screen">
      <header className="m-head">
        <h1>Pick a project</h1>
        <button className="m-linkbtn" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className="m-head-tools">
        <Search
          value={needle}
          onChange={setNeedle}
          placeholder="Search your projects"
        />
      </div>

      {error != null && <Trouble error={error} onRetry={() => setError(null)} />}

      <div className="m-scroll">
        {repos.isLoading && <Spinner label="Reading your projects..." />}
        {repos.isError && (
          <Trouble error={repos.error} onRetry={() => repos.refetch()} />
        )}

        {repos.data && shown.length === 0 && (
          <Empty
            title="Nothing matched"
            hint="You can type the full owner/name below instead."
          />
        )}

        {shown.map((repo) => (
          <button
            key={repo.slug}
            className="m-row m-repo"
            onClick={() => open(repo.slug)}
            disabled={opening !== null}
          >
            <UserAvatar url={repo.owner_avatar} name={repo.owner} size={34} />
            <span className="m-row-main">
              <span className="m-row-title">
                {repo.name}
                {repo.private && (
                  <span className="m-tag" title="Private">
                    private
                  </span>
                )}
              </span>
              <span className="muted small">
                {repo.owner}
                {repo.updated_at && ` · ${formatAgo(repo.updated_at)}`}
              </span>
            </span>
            {opening === repo.slug && <span className="m-row-busy" />}
          </button>
        ))}

        <div className="m-bypath">
          <label htmlFor="slug">Or type it out</label>
          <div className="m-bypath-row">
            <input
              id="slug"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="owner/project"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              className="m-btn"
              onClick={() => open(typed.trim())}
              disabled={!typed.includes("/") || opening !== null}
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
