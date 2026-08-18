ALTER TABLE private.season_configuration_action_logs
ALTER COLUMN created_at SET DEFAULT clock_timestamp();
