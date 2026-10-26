-- Trigger functions are never called through the API; RLS helpers are only needed by signed-in users.
revoke execute on function approvals_guard() from public, anon, authenticated;
revoke execute on function has_brand_access(uuid, role_t) from public, anon;
revoke execute on function has_workspace_access(uuid, role_t) from public, anon;
grant execute on function has_brand_access(uuid, role_t) to authenticated, service_role;
grant execute on function has_workspace_access(uuid, role_t) to authenticated, service_role;
