-- Company logo (JPG in the private attachments bucket: <company_id>/logo/...).
alter table public.companies add column if not exists logo_path text;
