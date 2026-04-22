import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1 text-sm">
      {items.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{crumb.label}</span>
          )}
          {i < items.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      ))}
    </nav>
  );
}
