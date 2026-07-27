import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

/** Caches keyed by react-router's location.key, i.e. one slot per history entry. */
const scrollOffsets = new Map<string, number>();
const pageSnapshots = new Map<string, unknown>();
const MAX_OFFSETS = 50;
const MAX_SNAPSHOTS = 8;

/** Keep re-applying until the document is tall enough (images / restored lists). */
const RESTORE_TIMEOUT_MS = 4000;
const ABORT_EVENTS = ["wheel", "touchstart", "keydown"] as const;

function put<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Restores the scroll offset on back/forward and jumps to the top on new navigations.
 *
 * Important: do NOT read window.scrollY after a route swap to "save" the old page.
 * Replacing a tall page with a short one clamps scrollY to 0 before layout effects run,
 * which would wipe the real offset. Offsets are recorded only from scroll/click while
 * the old page is still on screen.
 */
export function ScrollManager() {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const restoringRef = useRef(false);
  const keyRef = useRef(key);

  useEffect(() => {
    if (!("scrollRestoration" in history)) return;
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const save = () => {
      if (restoringRef.current) return;
      put(scrollOffsets, keyRef.current, window.scrollY, MAX_OFFSETS);
    };
    window.addEventListener("scroll", save, { passive: true });
    // Capture phase: record offset before React Router swaps the DOM on link click.
    document.addEventListener("click", save, true);
    document.addEventListener("keydown", save, true);
    return () => {
      window.removeEventListener("scroll", save);
      document.removeEventListener("click", save, true);
      document.removeEventListener("keydown", save, true);
    };
  }, []);

  useLayoutEffect(() => {
    keyRef.current = key;

    const target = navigationType === "POP" ? (scrollOffsets.get(key) ?? 0) : 0;
    if (navigationType !== "POP") {
      put(scrollOffsets, key, 0, MAX_OFFSETS);
    }

    restoringRef.current = true;
    const apply = () => window.scrollTo(0, target);

    apply();

    if (target <= 0) {
      const id = requestAnimationFrame(() => {
        restoringRef.current = false;
      });
      return () => {
        cancelAnimationFrame(id);
        restoringRef.current = false;
      };
    }

    const deadline = performance.now() + RESTORE_TIMEOUT_MS;
    let frame = 0;
    let ro: ResizeObserver | null = null;

    const stop = () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      restoringRef.current = false;
      for (const type of ABORT_EVENTS) window.removeEventListener(type, stop);
    };

    const retry = () => {
      apply();
      if (Math.abs(window.scrollY - target) <= 1 || performance.now() > deadline) {
        stop();
        return;
      }
      frame = requestAnimationFrame(retry);
    };

    frame = requestAnimationFrame(retry);
    ro = new ResizeObserver(() => {
      if (restoringRef.current) apply();
    });
    ro.observe(document.documentElement);
    for (const type of ABORT_EVENTS) window.addEventListener(type, stop, { passive: true });
    return stop;
  }, [key, navigationType]);

  return null;
}

/**
 * Keeps a per-history-entry snapshot of page state. On back navigation the page renders
 * its previous content synchronously, which is what makes the old scroll offset reachable.
 *
 * Call `keep` only with committed state (e.g. after loading finishes), not while empty.
 */
export function usePageSnapshot<T>(): [T | undefined, (next: T) => void] {
  const { key } = useLocation();
  const keyRef = useRef(key);
  keyRef.current = key;
  const [restored] = useState<T | undefined>(() => pageSnapshots.get(key) as T | undefined);
  const latest = useRef<T | undefined>(undefined);

  useEffect(
    () => () => {
      if (latest.current !== undefined) put(pageSnapshots, key, latest.current, MAX_SNAPSHOTS);
    },
    [key],
  );

  const keep = useCallback((next: T) => {
    latest.current = next;
    put(pageSnapshots, keyRef.current, next, MAX_SNAPSHOTS);
  }, []);

  return [restored, keep];
}

/** Goes back to wherever the user came from; falls back to the library on a direct hit. */
export function useGoBack(): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    if (key === "default") navigate("/");
    else navigate(-1);
  }, [key, navigate]);
}
