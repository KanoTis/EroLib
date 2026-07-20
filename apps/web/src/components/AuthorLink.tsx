import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ProviderId } from "@erolib/shared";

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
  className,
}: {
  provider: ProviderId | string;
  authorId: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const label = children;
  if (!isValidAuthorId(authorId)) {
    return <span className={className}>{label}</span>;
  }
  return (
    <Link
      className={className ? `author-link ${className}` : "author-link"}
      to={`/authors/${encodeURIComponent(provider)}/${encodeURIComponent(authorId)}`}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}
