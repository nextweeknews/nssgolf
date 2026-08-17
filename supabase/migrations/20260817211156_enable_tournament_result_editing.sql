UPDATE public.tournament_admin_events
SET archived = false
WHERE event_key IN ('masters', 'proleague', 'superleague')
  AND archived;
