-- Gemini AI (Kaayra AI + Kaayra Intelligence). Additive and safe to run again. Needs: nothing (drafts may point at products, migration 3).
-- Server-only: RLS on, no grants to anon or authenticated; the API uses the service-role key.
-- What is stored: daily request and token COUNTS (budget protection), the owner's daily briefing text, and content DRAFTS awaiting a person.
-- What is NOT stored: customer questions, owner questions, model answers to them, or any personal data. Retention: see ai_purge() below.

create table if not exists public.ai_usage_daily (
  day date not null,
  scope text not null check (scope in ('customer', 'admin')),
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  primary key (day, scope)
);

create table if not exists public.ai_briefings (
  day date primary key,
  narrative text not null check (char_length(narrative) <= 4000),
  model text not null,
  generated_by text not null,
  generated_at timestamptz not null default now()
);

create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product_description','product_summary','seo_title','meta_description','product_faq','journal_article','social_caption','promo_email','campaign_ideas')),
  product_id uuid references public.products(id) on delete set null,
  topic text check (topic is null or char_length(topic) <= 200),
  body text not null check (char_length(body) between 1 and 6000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  -- Unsupported claims found by the safety check. A draft with flags cannot be approved until the text is edited and re-checked.
  flags text[] not null default '{}',
  model text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index if not exists ai_drafts_created_idx on public.ai_drafts (created_at desc);

-- Atomically takes one request from today's allowance. False when the allowance is used up. The row lock makes it safe across instances.
create or replace function public.ai_usage_reserve(p_day date, p_scope text, p_limit integer) returns boolean language plpgsql as $$
begin
  if p_scope not in ('customer', 'admin') or p_limit < 1 then return false; end if;
  insert into public.ai_usage_daily (day, scope) values (p_day, p_scope) on conflict do nothing;
  update public.ai_usage_daily set requests = requests + 1 where day = p_day and scope = p_scope and requests < p_limit;
  return found;
end $$;

create or replace function public.ai_usage_add_tokens(p_day date, p_scope text, p_in bigint, p_out bigint) returns void language plpgsql as $$
begin
  update public.ai_usage_daily set input_tokens = input_tokens + greatest(p_in, 0), output_tokens = output_tokens + greatest(p_out, 0) where day = p_day and scope = p_scope;
end $$;

-- Retention: rejected drafts and briefings older than p_days (default 30) and usage rows older than 400 days. Run by hand or from the daily job.
create or replace function public.ai_purge(p_days integer default 30) returns jsonb language plpgsql as $$
declare d integer; b integer; u integer;
begin
  delete from public.ai_drafts where status = 'rejected' and created_at < now() - make_interval(days => p_days); get diagnostics d = row_count;
  delete from public.ai_briefings where generated_at < now() - make_interval(days => p_days); get diagnostics b = row_count;
  delete from public.ai_usage_daily where day < current_date - 400; get diagnostics u = row_count;
  return jsonb_build_object('drafts', d, 'briefings', b, 'usage', u);
end $$;

alter table public.ai_usage_daily enable row level security;
alter table public.ai_briefings enable row level security;
alter table public.ai_drafts enable row level security;
revoke all on public.ai_usage_daily, public.ai_briefings, public.ai_drafts from anon, authenticated;
revoke all on function public.ai_usage_reserve(date, text, integer), public.ai_usage_add_tokens(date, text, bigint, bigint), public.ai_purge(integer) from public, anon, authenticated;
