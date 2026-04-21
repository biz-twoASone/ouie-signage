-- supabase/migrations/20260421000800_dayparting_rules.sql
CREATE TABLE dayparting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id),

  -- Exactly one target type. XOR enforced via CHECK.
  target_device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  target_device_group_id uuid REFERENCES device_groups(id) ON DELETE CASCADE,
  CONSTRAINT rule_single_target CHECK (
    (target_device_id IS NOT NULL)::int + (target_device_group_id IS NOT NULL)::int = 1
  ),

  -- Rule timing (evaluated against device.store.timezone)
  days_of_week int[] NOT NULL
    CHECK (array_length(days_of_week, 1) BETWEEN 1 AND 7
           AND days_of_week <@ ARRAY[1,2,3,4,5,6,7]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  -- Note: end_time < start_time means crosses midnight; valid.

  effective_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
