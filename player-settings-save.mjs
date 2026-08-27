async function updatePlayerSettings(supabase, payload, discordUserId){
  return supabase
    .from("player_settings")
    .update(payload)
    .eq("discord_user_id", discordUserId)
    .select("discord_user_id")
    .maybeSingle();
}

export async function savePlayerSettings(supabase, payload, discordUserId){
  const updated = await updatePlayerSettings(supabase, payload, discordUserId);
  if(updated.error || updated.data) return { error: updated.error };

  const inserted = await supabase.from("player_settings").insert(payload);
  if(!inserted.error || inserted.error.code !== "23505") return { error: inserted.error };

  const retried = await updatePlayerSettings(supabase, payload, discordUserId);
  return { error: retried.error || (retried.data ? null : inserted.error) };
}
