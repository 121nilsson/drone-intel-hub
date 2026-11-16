import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "drone-intel-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The first render matches the server's markup (dark); the stored choice is applied after
  // mount. Reading storage during render would disagree with the server's HTML, and it throws
  // where site data is blocked.
  const [theme, setThemeState] = useState<Theme>("dark");
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "light") setThemeState("light");
    } catch {
      // Storage unavailable: the default applies and the choice is simply not remembered.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    // Not before the stored choice is read, or the default would overwrite it.
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme, restored]);

  const value: ThemeContextValue = {
    theme,
    setTheme: (next) => setThemeState(next),
    toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) return { theme: "dark", setTheme: () => {}, toggle: () => {} };
  return ctx;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} className={className} aria-pressed={theme === "light"}>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" theme={theme} />;
}
