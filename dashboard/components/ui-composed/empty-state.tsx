import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-muted/20 flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="bg-muted text-muted-foreground rounded-full p-3">
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2">
          {secondaryAction}
          {primaryAction}
        </div>
      )}
    </div>
  );
}
