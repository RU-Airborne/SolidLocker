import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getCommitIdentities, type CommitIdentity } from "./api";

/**
 * GitHub's noreply commit emails ("12345+login@users.noreply.github.com")
 * carry the account's permanent numeric id, which survives username renames.
 * Commit history across ALL branches therefore doubles as a directory: for
 * every account id we take the name and username from that person's newest
 * commit, so old commits (and lock owners known only by username) can be
 * shown with the person's current real name.
 */

export interface Person {
  name: string;
  login: string | null;
  avatarUrl: string | null;
}

export function noreplyParts(
  email: string,
): { id: string | null; login: string } | null {
  const m = email.match(
    /^(?:(\d+)\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/,
  );
  return m ? { id: m[1] ?? null, login: m[2]! } : null;
}

/** "Name (login)" when both are known and differ; otherwise just the name. */
export function formatPerson(name: string, login: string | null): string {
  if (login && login.toLowerCase() !== name.toLowerCase()) {
    return `${name} (${login})`;
  }
  return name;
}

interface Directory {
  nameById: Map<string, string>;
  loginById: Map<string, string>;
  avatarById: Map<string, string>;
  idByLoginLower: Map<string, string>;
  nameByEmail: Map<string, string>;
}

function buildDirectory(identities: CommitIdentity[]): Directory {
  const nameById = new Map<string, string>();
  const loginById = new Map<string, string>();
  const avatarById = new Map<string, string>();
  const idByLoginLower = new Map<string, string>();
  const nameByEmail = new Map<string, string>();
  // Identities arrive newest first: the first sighting per id wins.
  for (const entry of identities) {
    const p = noreplyParts(entry.email);
    if (p) {
      const id = p.id ?? `login:${p.login.toLowerCase()}`;
      if (!nameById.has(id)) nameById.set(id, entry.name);
      if (!loginById.has(id)) loginById.set(id, p.login);
      if (!avatarById.has(id)) {
        // The numeric-id avatar URL survives renames; fall back to login.
        avatarById.set(
          id,
          p.id
            ? `https://avatars.githubusercontent.com/u/${p.id}?s=48`
            : `https://github.com/${encodeURIComponent(p.login)}.png?size=48`,
        );
      }
      if (!idByLoginLower.has(p.login.toLowerCase())) {
        idByLoginLower.set(p.login.toLowerCase(), id);
      }
    } else if (!nameByEmail.has(entry.email.toLowerCase())) {
      nameByEmail.set(entry.email.toLowerCase(), entry.name);
    }
  }
  return { nameById, loginById, avatarById, idByLoginLower, nameByEmail };
}

function resolvePerson(
  dir: Directory,
  authorName: string,
  authorEmail: string,
): Person {
  const p = noreplyParts(authorEmail);
  if (p) {
    const id = p.id ?? `login:${p.login.toLowerCase()}`;
    return {
      name: dir.nameById.get(id) ?? authorName,
      login: dir.loginById.get(id) ?? p.login,
      avatarUrl: dir.avatarById.get(id) ?? null,
    };
  }
  // Personal-email commit whose typed name matches a known username joins
  // that person (e.g. git name "OfficialShrek" → Andrew S).
  const linkedId = dir.idByLoginLower.get(authorName.toLowerCase());
  if (linkedId) {
    return {
      name: dir.nameById.get(linkedId) ?? authorName,
      login: dir.loginById.get(linkedId) ?? null,
      avatarUrl: dir.avatarById.get(linkedId) ?? null,
    };
  }
  return {
    name: dir.nameByEmail.get(authorEmail.toLowerCase()) ?? authorName,
    login: null,
    avatarUrl: null,
  };
}

/** Resolve every commit in a log to a person. */
export function resolveCommitAuthors(
  commits: Array<{ sha: string; author_name: string; author_email: string }>,
  identities: CommitIdentity[],
): Map<string, Person> {
  const dir = buildDirectory(identities);
  const bySha = new Map<string, Person>();
  for (const c of commits) {
    bySha.set(c.sha, resolvePerson(dir, c.author_name, c.author_email));
  }
  return bySha;
}

/** All-branch identity directory, cached and shared between components. */
export function useIdentities() {
  return useQuery({
    queryKey: ["identities"],
    queryFn: getCommitIdentities,
    staleTime: 5 * 60_000,
  });
}

/** Lookup for components that only know a GitHub username (lock owners). */
export function usePeople() {
  const identities = useIdentities();
  return useMemo(() => {
    const dir = buildDirectory(identities.data ?? []);
    return {
      /** Real name for a GitHub username, when commit history reveals it. */
      nameFor(login: string): string | null {
        const id = dir.idByLoginLower.get(login.toLowerCase());
        return id ? (dir.nameById.get(id) ?? null) : null;
      },
      /** Rename-proof avatar URL for a username; falls back to the login URL. */
      avatarFor(login: string): string {
        const id = dir.idByLoginLower.get(login.toLowerCase());
        return (
          (id && dir.avatarById.get(id)) ||
          `https://github.com/${encodeURIComponent(login)}.png?size=48`
        );
      },
    };
  }, [identities.data]);
}
