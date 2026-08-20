-- 새샘 V리그 2학기 그룹 대항전 리그전 일정/결과
create table if not exists public.vleague_s2_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  league text not null check (league in ('malgeun', 'goun')),
  round_no int not null,
  match_no int not null,
  match_date date null,
  home_class_id uuid not null references public.vleague_classes (id) on delete cascade,
  away_class_id uuid not null references public.vleague_classes (id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  home_score int null,
  away_score int null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vleague_s2_matches_unique
on public.vleague_s2_matches (club_id, league, round_no, match_no);

create index if not exists vleague_s2_matches_club_league_date_idx
on public.vleague_s2_matches (club_id, league, match_date);

comment on table public.vleague_s2_matches is '새샘 V리그 2학기 그룹 대항전 리그전 일정/결과';
