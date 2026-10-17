import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Density = "compact" | "comfortable" | "analyst";

interface DensityContextValue {
  density: Density;
  setDensity: (next: Density) => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

const STORAGE_KEY = "drone-intel-density";

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => {
    if (typeof window === "undefined") return "comfortable";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "compact" || stored === "analyst" ? stored : "comfortable";
  });

  useEffect(() => {
    document.documentElement.dataset["density"] = density;
    try {
      window.localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // localStorage may be unavailable (private mode); the in-memory value still applies.
    }
  }, [density]);

  const value: DensityContextValue = {
    density,
    setDensity: (next) => setDensityState(next),
  };

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    // Allow non-provider consumers (tests, isolated renders) to fall back gracefully.
    return { density: "comfortable", setDensity: () => {} };
  }
  return ctx;
}

export function DensityToggle({ className }: { className?: string }) {
  const { density, setDensity } = useDensity();
  const options: Density[] = ["compact", "comfortable", "analyst"];
  return (
    <div className={className} role="group" aria-label="Display density">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={density === option}
          onClick={() => setDensity(option)}
          className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
            density === option
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
