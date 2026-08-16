import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export function githubAvatarUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=48`;
}

export function githubAvatarFromEmail(email: string): string | null {
  const m = email.match(/^(?:(\d+)\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/);
  if (!m) return null;
  const [, id, login] = m;
  return id
    ? `https://avatars.githubusercontent.com/u/${id}?s=48`
    : githubAvatarUrl(login!);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function UserAvatar({
  url,
  name,
  size,
}: {
  url: string | null;
  name: string;
  size: number;
}) {
  const avatar = useQuery({
    queryKey: ["avatar", url],
    queryFn: () => invoke<string>("get_avatar", { url }),
    enabled: url !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  if (url && avatar.data) {
    return (
      <img
        src={avatar.data}
        alt=""
        className="avatar-img"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="avatar-img avatar-initials"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}
