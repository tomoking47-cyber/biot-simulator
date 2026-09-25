alter function public.touch_updated_at() set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.assignments_guard() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.my_company() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_company() to authenticated;
