import { useEffect, useRef } from "react";
import { Box, CircularProgress } from "@mui/material";

export function InfiniteScrollSentinel({
  active,
  loading,
  onVisible,
}: {
  active: boolean;
  loading?: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onVisibleRef.current();
        }
      },
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  if (!active) return null;

  return (
    <Box ref={ref} sx={{ display: "flex", justifyContent: "center", py: 2 }}>
      {loading && <CircularProgress size={20} />}
    </Box>
  );
}
