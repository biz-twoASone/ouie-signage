import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function ActivityItem({
  icon: Icon,
  children,
  timestamp,
  href,
  tone = "default",
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  timestamp: string;
  href?: string;
  tone?: "default" | "warning" | "destructive";
}) {
  const toneIconClass = {
    default: "text-muted-foreground bg-muted",
    warning: "text-status-warning bg-status-warning/10",
    destructive: "text-status-offline bg-status-offline/10",
  }[tone];

  const Wrapper: React.ElementType = href ? Link : "div";
  const wrapperProps = href ? { href } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "group flex items-start gap-3 rounded-md px-3 py-2",
        href && "hover:bg-muted/50 cursor-pointer transition-colors",
      )}
    >
      {Icon && (
        <div className={cn("mt-0.5 shrink-0 rounded-md p-1.5", toneIconClass)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-foreground text-sm">{children}</div>
        <time className="text-muted-foreground font-mono text-[10px]">
          {timestamp}
        </time>
      </div>
    </Wrapper>
  );
}
