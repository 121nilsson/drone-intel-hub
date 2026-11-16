import { useEffect, useRef, useState } from "react";

/**
 * True once the element has come near the viewport, and it stays true. For work that is only
 * worth doing for what the analyst can actually see: in a list of hundreds, computing something
 * per row up front costs every row, and again on every catalogue change.
 *
 * Without IntersectionObserver (old browsers, tests) the element counts as seen at once, so the
 * work still happens. The first render is always false, so server and client markup agree.
 */
export function useSeen<T extends Element>(margin = "300px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}
