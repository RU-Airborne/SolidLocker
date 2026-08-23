import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { read, usePersisted } from "./persist";

export type Theme = "system" | "light" | "dark";

const THEMES: Theme[] = ["system", "light", "dark"];

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = usePersisted<Theme>(
    "theme",
    (raw) => (raw !== null && THEMES.includes(raw as Theme) ? (raw as Theme) : "system"),
    (value) => value,
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    void getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
  }, [theme]);

  return [theme, setTheme];
}

export function applySavedTheme() {
  const saved = read("theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}
