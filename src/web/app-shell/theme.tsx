import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ChronicleTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ChronicleTheme;
  toggleTheme(): void;
}

const STORAGE_KEY = "chronicle-theme-v1";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function initialTheme(): ChronicleTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable in hardened local browser profiles.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ChronicleTheme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for this session.
    }
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme: () => setTheme((value) => value === "light" ? "dark" : "light"),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
