-- Suppliers can now register themselves. A self-registered company may upload its logo, but other files only into the
-- folder of a request Japan actually sent it (<company>/<assignment id>/...), so a stranger cannot use the storage.
alter policy attach_insert on storage.objects with check (
  bucket_id = 'attachments' and (
    public.is_admin() or (
      (storage.foldername(name))[1] = public.my_company()::text
      and public.accepted_current_terms()
      and not public.attachment_locked(name)
      and (
        (storage.foldername(name))[2] = 'logo'
        or exists (select 1 from public.assignments a
                   where a.id::text = (storage.foldername(objects.name))[2]
                     and a.company_id = public.my_company() and a.status <> 'draft')))));
