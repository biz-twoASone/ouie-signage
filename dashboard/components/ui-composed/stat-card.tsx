import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = "default",
  className,
  "data-testid": testid,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "warning" | "destructive" | "success";
  className?: string;
  "data-testid"?: string;
}) {
  const toneClass = {
    default: "text-foreground",
    warning: "text-status-warning",
    destructive: "text-status-offline",
    success: "text-status-online",
  }[tone];

  return (
    <Card data-testid={testid} className={cn("overflow-hidden", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm font-medium">{label}</p>
            <p className={cn("text-3xl font-semibold tracking-tight", toneClass)}>
              {value}
            </p>
            {subtext && (
              <p className="text-muted-foreground text-xs">{subtext}</p>
            )}
          </div>
          {Icon && (
            <div className="bg-muted text-muted-foreground rounded-md p-2">
              <Icon className="h-4 w-4" strokeWidth={1.5} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
