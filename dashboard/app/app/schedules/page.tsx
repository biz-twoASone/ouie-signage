import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-composed/page-header";
import { SchedulesTable } from "./schedules-table";
import { Plus } from "lucide-react";

type Rule = {
  id: string;
  label: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  effective_at: string;
  playlists: { name: string } | null;
  target_device_id: string | null;
  devices: { name: string } | null;
  target_device_group_id: string | null;
  device_groups: { name: string } | null;
};

export default async function SchedulesPage() {
  const supabase = await createClient();
  const { data: rules } = await supabase.from("dayparting_rules")
    .select(`
      id, label, days_of_week, start_time, end_time, effective_at,
      playlists(name),
      target_device_id, devices(name),
      target_device_group_id, device_groups(name)
    `)
    .order("effective_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduling"
        description="Schedule playlists to run at specific times and days."
        primaryAction={
          <Button asChild data-testid="dayparting-add-rule-button">
            <Link href="/app/schedules/new">
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Link>
          </Button>
        }
      />
      <SchedulesTable data={(rules ?? []) as unknown as Rule[]} />
    </div>
  );
}
