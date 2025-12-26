import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function useTheme() {
  const getInitial = () => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved as "dark" | "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  };
  const [theme, setTheme] = useState<"dark" | "light">(getInitial);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return { theme, setTheme };
}

export const ThemeToggle: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      title={t("toggle_theme")}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
};
