import { useEffect, useRef, useState } from "react";

/**
 * Per-browser memory for list views. Storage can be missing or throw (private mode, blocked site
 * data), so every access is guarded and the page works the same without it - it just forgets.
 */
const PREFIX = "drone-intel:view:";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not remembered this time; the current view is unaffected.
  }
}

/** A small choice ("compact" | "cards") that survives leaving the page. */
export function useRememberedChoice<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // Read after mount: the server render has no storage, and reading during render would make the
  // first client render disagree with it.
  useEffect(() => {
    const stored = read(key);
    if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
  }, [key, allowed]);
  return [
    value,
    (next) => {
      setValue(next);
      write(key, next);
    },
  ];
}

/**
 * A page whose search lives in the URL comes back the way it was left: opening it bare restores
 * the last filters, while a link that carries its own filters (?op=UA from a dossier) always wins.
 * The URL stays the single truth - this only fills it in once, on arrival.
 */
export function useRememberedSearch(
  key: string,
  url: Record<string, string>,
  setUrl: (next: Record<string, string>) => void,
) {
  const restored = useRef(false);
  const skipWrite = useRef(false);
  const empty = Object.keys(url).length === 0;
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!empty) return;
    try {
      const saved = JSON.parse(read(key) ?? "null") as Record<string, string> | null;
      if (saved && typeof saved === "object" && Object.keys(saved).length) {
        // The bare URL is about to be replaced; saving it would erase what is being restored.
        skipWrite.current = true;
        setUrl(saved);
      }
    } catch {
      // A damaged entry is ignored; the next change overwrites it.
    }
    // Restoring runs once per visit; later URL changes are saved below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const serialized = JSON.stringify(url);
  useEffect(() => {
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    write(key, serialized);
  }, [key, serialized]);
}
