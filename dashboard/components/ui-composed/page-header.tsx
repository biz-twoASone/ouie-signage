import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b pb-6 md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-shrink-0 items-center gap-2">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
