import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Link as MuiLink } from "@mui/material";

export function isValidAuthorId(
  authorId: string | null | undefined,
): authorId is string {
  if (!authorId) return false;
  const trimmed = authorId.trim();
  return trimmed.length > 0 && trimmed !== "_unknown";
}

export function AuthorLink({
  provider,
  authorId,
  children,
}: {
  provider: string;
  authorId: string | null | undefined;
  children: ReactNode;
}) {
  if (!isValidAuthorId(authorId)) return <span>{children}</span>;
  return (
    <MuiLink
      component={Link}
      to={`/authors/${encodeURIComponent(provider)}/${encodeURIComponent(authorId)}`}
      underline="none"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      sx={{
        color: "text.secondary",
        "&:hover": { color: "primary.main" },
      }}
    >
      {children}
    </MuiLink>
  );
}
