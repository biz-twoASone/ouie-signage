import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

type Variant = "online" | "offline" | "warning" | "pending";

const variantClasses: Record<Variant, string> = {
  online:
    "bg-status-online/10 text-status-online ring-1 ring-status-online/20",
  offline:
    "bg-status-offline/10 text-status-offline ring-1 ring-status-offline/20",
  warning:
    "bg-status-warning/10 text-status-warning ring-1 ring-status-warning/20",
  pending:
    "bg-status-pending/10 text-status-pending ring-1 ring-status-pending/20",
};

const labels: Record<Variant, string> = {
  online: copy.online,
  offline: copy.offline,
  warning: copy.warning,
  pending: copy.pending,
};

export function StatusPill({
  variant,
  label,
  timestamp,
  className,
  "data-testid": testid,
}: {
  variant: Variant;
  label?: string;
  timestamp?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", {
          "bg-status-online": variant === "online",
          "bg-status-offline": variant === "offline",
          "bg-status-warning": variant === "warning",
          "bg-status-pending": variant === "pending",
        })}
      />
      <span>{label ?? labels[variant]}</span>
      {timestamp && (
        <span className="text-muted-foreground font-mono text-[10px]">
          {timestamp}
        </span>
      )}
    </span>
  );
}
