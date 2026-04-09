-- 새샘 V리그: 참가 학급 / 순위표 (Supabase SQL 편집기에서 실행)
-- clubs 테이블에 name = '새샘 V리그' 인 행이 있어야 club_id를 맞출 수 있습니다.

create table if not exists public.vleague_classes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  class_name text not null,
  sort_order int not null default 0
);

-- 별명 / 담당 교사 (앱에서 별명 수정 권한에 사용). 테이블을 이미 만든 뒤라면 SQL Editor에서 실행:
alter table public.vleague_classes add column if not exists nickname text;
alter table public.vleague_classes add column if not exists homeroom_teacher_name text;

-- 참가 학급 카드에 표시: 승·패·순위 (Supabase에서 갱신)
alter table public.vleague_classes add column if not exists wins int not null default 0;
alter table public.vleague_classes add column if not exists losses int not null default 0;
alter table public.vleague_classes add column if not exists rank_order int;

-- === 대진표(풀리그전) ===
-- 앱에서 대진표를 자동 생성/저장/일정 반영하는 데 사용합니다.
create table if not exists public.vleague_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  -- 'malgeun' = 5학년(맑은샘), 'goun' = 6학년(고운샘)
  league text not null check (league in ('malgeun', 'goun')),
  round_no int not null,
  match_no int not null,
  match_date date null,
  home_class_id uuid not null references public.vleague_classes (id) on delete cascade,
  away_class_id uuid not null references public.vleague_classes (id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  home_score int null,
  away_score int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vleague_matches_unique
on public.vleague_matches (club_id, league, round_no, match_no);

-- RLS를 켰다면, 최소한 SELECT 정책이 필요합니다.
-- 운영 방식에 따라 "교사만 INSERT/DELETE" 정책을 추가하세요.

create table if not exists public.vleague_standings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  rank_order int not null,
  team_name text not null,
  wins int not null default 0,
  losses int not null default 0,
  points int not null default 0
);

-- === 심판 배정 ===
create table if not exists public.vleague_referees (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  student_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vleague_referee_assignments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  match_id uuid not null references public.vleague_matches (id) on delete cascade,
  student_id text not null,
  student_name text not null,
  assignment_role text not null check (assignment_role in ('chief', 'assistant1', 'assistant2')),
  created_at timestamptz not null default now()
);

create unique index if not exists vleague_referee_assignments_match_role_unique
on public.vleague_referee_assignments (match_id, assignment_role);

-- 과거 인덱스(경기당 1명 제한)를 썼다면 제거하세요.
-- drop index if exists public.vleague_referee_assignments_match_unique;

-- 테스트 시 RLS를 끄거나, anon용 SELECT/정책을 추가하세요.

-- === 참가 학급이 앱에 안 보일 때 (데이터는 있는데 0건) ===
-- vleague_classes.club_id 가 clubs 테이블의 '새샘 V리그' 행 id 와 같아야 합니다.
--
-- 1) 올바른 club_id 확인:
--    select id, name from public.clubs where name = '새샘 V리그';
--
-- 2) vleague_classes 에 들어 있는 club_id 샘플 확인:
--    select distinct club_id from public.vleague_classes limit 5;
--
-- 3) 둘이 다르면, 아래의 올바른_uuid 를 1)에서 나온 id 로 바꾼 뒤 실행 (주의: 전체 행이 그 종목으로 바뀜):
--    update public.vleague_classes
--    set club_id = '올바른_uuid'
--    where club_id = '잘못_넣었던_uuid';

-- === vleague_cheers: 담임 교사 응원 글은 student_id 없이 저장할 수 있어야 합니다. ===
-- (이미 테이블이 있고 student_id 가 NOT NULL 이면 아래 한 줄 실행)
-- alter table public.vleague_cheers alter column student_id drop not null;
