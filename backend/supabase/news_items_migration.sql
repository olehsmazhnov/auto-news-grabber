-- Auto News Grabber -> Supabase news_items migration
-- Keeps legacy columns and adds stable linkage + legal metadata.

alter table if exists public.news_items
  add column if not exists external_id text,
  add column if not exists dedupe_key text,
  add column if not exists source_id text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists article_path text,
  add column if not exists content text,
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists published_date text,
  add column if not exists published_time text,
  add column if not exists scraped_at timestamptz,
  add column if not exists rights_flag text,
  add column if not exists license_text text;

update public.news_items
set external_id = coalesce(external_id, concat('legacy-', id::text))
where external_id is null;

update public.news_items
set dedupe_key = coalesce(
  dedupe_key,
  md5(
    lower(
      coalesce(source_url, '') || '|' ||
      coalesce(title, '') || '|' ||
      coalesce(date, '')
    )
  )
)
where dedupe_key is null;

update public.news_items
set source_name = coalesce(source_name, category, ''),
    source_url = coalesce(source_url, ''),
    article_path = coalesce(article_path, ''),
    rights_flag = coalesce(rights_flag, 'unknown'),
    license_text = coalesce(license_text, ''),
    scraped_at = coalesce(scraped_at, published_at, now())
where source_name is null
   or source_url is null
   or article_path is null
   or rights_flag is null
   or license_text is null
   or scraped_at is null;

alter table public.news_items
  alter column external_id set not null,
  alter column dedupe_key set not null;

create unique index if not exists news_items_dedupe_key_uidx
  on public.news_items (dedupe_key);

create unique index if not exists news_items_external_id_uidx
  on public.news_items (external_id);

create index if not exists news_items_source_id_idx
  on public.news_items (source_id);

create index if not exists news_items_scraped_at_idx
  on public.news_items (scraped_at desc);
