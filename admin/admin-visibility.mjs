export async function setAdminVisibility(supabase, { surfaceKey, targetKey, hidden }){
  const { data, error } = await supabase.rpc("set_admin_visibility", {
    p_surface_key:surfaceKey,
    p_target_key:targetKey,
    p_hidden:Boolean(hidden),
  });
  if(error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
