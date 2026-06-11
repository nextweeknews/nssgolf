-- Enable Supabase Realtime events for rank hide/show actions so the Discord
-- bot can refresh leaderboard embeds when website admins moderate a rank.

do $$
begin
  alter publication supabase_realtime add table public.player_global_rank_moderation;
exception
  when duplicate_object then null;
end;
$$;
