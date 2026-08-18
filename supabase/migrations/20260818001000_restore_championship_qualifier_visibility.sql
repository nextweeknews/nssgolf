-- Repair the accidentally persisted state that hid every tournament qualifier.
update public.championship_point_settings
set hidden_player_keys = '{}'::text[]
where id = 'current'
  and cardinality(hidden_player_keys) > 0;
