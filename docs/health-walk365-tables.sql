-- 건강걷기 365 (V리그와 별도 운영, 1~6학년 전체 학급)
-- Supabase SQL Editor에서 실행하세요.
-- 사전 조건: public.clubs 에 name = '건강걷기 365' 행이 있어야 합니다.
--
--   select id, name from public.clubs where name ilike '%건강%365%';

-- === 참가 학급 (1~6학년) ===
create table if not exists public.health_walk365_classes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  class_name text not null,
  grade int not null check (grade between 1 and 6),
  class_no int not null default 1 check (class_no between 1 and 20),
  homeroom_teacher_name text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (club_id, grade, class_no),
  unique (club_id, class_name)
);

create index if not exists health_walk365_classes_club_grade_idx
  on public.health_walk365_classes (club_id, grade, sort_order);

comment on table public.health_walk365_classes is
  '건강걷기 365 참가 학급 (1~6학년). V리그 vleague_classes 와 독립.';

-- === 줍깅(플로깅) 실시일 (학급·날짜당 1건) ===
create table if not exists public.health_walk365_plogging_days (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  class_id uuid not null references public.health_walk365_classes (id) on delete cascade,
  event_date date not null,
  created_by text null,
  created_at timestamptz not null default now(),
  unique (class_id, event_date)
);

create index if not exists health_walk365_plogging_days_club_date_idx
  on public.health_walk365_plogging_days (club_id, event_date desc);

comment on table public.health_walk365_plogging_days is
  '건강걷기 365 담임교사 줍깅(플로깅) 실시 등록. club_events 대신 사용.';

-- === RLS (프로젝트에서 clubs / club_events 와 동일 정책으로 맞추세요) ===
-- alter table public.health_walk365_classes enable row level security;
-- alter table public.health_walk365_plogging_days enable row level security;
-- create policy "health_walk365_classes_select" on public.health_walk365_classes for select using (true);
-- create policy "health_walk365_plogging_select" on public.health_walk365_plogging_days for select using (true);
-- create policy "health_walk365_plogging_insert" on public.health_walk365_plogging_days for insert with check (true);
-- create policy "health_walk365_plogging_delete" on public.health_walk365_plogging_days for delete using (true);

-- === 학급 예시 시드 (clubs.name 에서 건강걷기 365 club_id 자동 조회) ===
-- 학년당 반 수: generate_series(1, 4) 의 4 를 학교에 맞게 변경하세요.
--
-- insert into public.health_walk365_classes (club_id, class_name, grade, class_no, homeroom_teacher_name, sort_order)
-- select
--   c.id,
--   g.grade || '학년 ' || bn.class_no || '반',
--   g.grade,
--   bn.class_no,
--   null,
--   g.grade * 100 + bn.class_no
-- from public.clubs c
-- cross join generate_series(1, 6) as g(grade)
-- cross join generate_series(1, 4) as bn(class_no)
-- where replace(c.name, ' ', '') ilike '%건강%365%'
-- on conflict (club_id, grade, class_no) do nothing;
--
-- 담임 예시:
-- update public.health_walk365_classes h
-- set homeroom_teacher_name = '민준기'
-- from public.clubs c
-- where h.club_id = c.id
--   and replace(c.name, ' ', '') ilike '%건강%365%'
--   and h.class_name = '6학년 2반';
