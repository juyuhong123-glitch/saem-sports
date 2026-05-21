-- 건강걷기 365 전용 테이블 (V리그 분리) — Supabase SQL Editor에서 실행
-- 상세 설명: docs/health-walk365-tables.sql

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
