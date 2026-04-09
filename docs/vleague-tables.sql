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
  student_id text not null,
  student_name text not null,
  created_at timestamptz not null default now()
);

alter table public.vleague_referees add column if not exists student_id text;

create unique index if not exists vleague_referees_club_student_unique
on public.vleague_referees (club_id, student_id);

-- === V리그 규칙 팝업 설정 ===
create table if not exists public.vleague_rule_settings (
  club_id uuid primary key references public.clubs (id) on delete cascade,
  rule_text text not null default '',
  updated_by text null,
  updated_at timestamptz not null default now()
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

-- === 응원 메시지 자동 정리 (KST 기준) ===
-- 요구사항:
-- 1) 경기 당일 13:00부터는 앱에서 자동 숨김 (프론트에서 처리)
-- 2) 경기 당일 14:00부터는 Supabase에서 물리 삭제 (아래 함수+cron)
--
-- 주의:
-- - created_at은 timestamptz이므로 KST 기준 비교를 위해 timezone('Asia/Seoul', ...)를 사용합니다.
-- - pg_cron이 비활성이라면 Supabase Dashboard > Database > Extensions에서 활성화하세요.
create or replace function public.delete_expired_vleague_cheers_kst()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer := 0;
  v_now_kst timestamp;
begin
  v_now_kst := timezone('Asia/Seoul', now());

  with expired as (
    select distinct c.id
    from public.vleague_cheers c
    join public.vleague_matches m
      on m.club_id = c.club_id
     and (m.home_class_id = c.class_id or m.away_class_id = c.class_id)
    where m.match_date is not null
      -- 실제 응원 작성 허용 창(전날 14:00 ~ 당일 13:00)에서 작성된 글만 정리 대상
      and timezone('Asia/Seoul', c.created_at) >= ((m.match_date::timestamp - interval '1 day') + interval '14 hour')
      and timezone('Asia/Seoul', c.created_at) <  (m.match_date::timestamp + interval '13 hour')
      -- 당일 14:00 이후 삭제
      and v_now_kst >= (m.match_date::timestamp + interval '14 hour')
  )
  delete from public.vleague_cheers c
  using expired e
  where c.id = e.id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

comment on function public.delete_expired_vleague_cheers_kst is
'KST 기준으로 경기 당일 14:00이 지난 V리그 응원 메시지를 삭제한다.';

-- 기존 스케줄이 있으면 제거 후 재등록
select cron.unschedule('vleague-cheers-delete-2pm-kst')
where exists (
  select 1
  from cron.job
  where jobname = 'vleague-cheers-delete-2pm-kst'
);

-- 매시 5분에 실행: 14:00 이후 대상은 다음 실행 시점에 자동 삭제
select cron.schedule(
  'vleague-cheers-delete-2pm-kst',
  '5 * * * *',
  $$select public.delete_expired_vleague_cheers_kst();$$
);

-- === 응원 이벤트 자동 추첨/기록 (KST 기준) ===
-- 목표:
-- - 경기 당일 13:01에 자동 추첨
-- - 추첨 대상: 전날 14:00 ~ 당일 13:00 사이에 등록된 응원 메시지 작성자
-- - 결과를 match_date와 함께 영구 기록 (예: "5월 10일 경기 당첨자")
create table if not exists public.vleague_cheer_event_winners (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  class_id uuid not null references public.vleague_classes (id) on delete cascade,
  match_date date not null,
  winner_student_id text null,
  winner_student_name text not null,
  source_cheer_id uuid null,
  picked_at timestamptz not null default now(),
  note text null,
  unique (club_id, class_id, match_date)
);

create index if not exists vleague_cheer_event_winners_match_date_idx
on public.vleague_cheer_event_winners (match_date desc);

create or replace function public.draw_vleague_cheer_event_winners_kst(
  p_match_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_date date;
  v_now_kst timestamp;
  v_inserted_count integer := 0;
begin
  v_now_kst := timezone('Asia/Seoul', now());
  v_target_date := coalesce(p_match_date, v_now_kst::date);

  -- 운영 실수 방지: 자동/수동 실행 모두 당일 13:01 이후에만 처리
  if v_now_kst < (v_target_date::timestamp + interval '13 hour 1 minute') then
    return 0;
  end if;

  with classes_today as (
    select distinct m.club_id, m.home_class_id as class_id
    from public.vleague_matches m
    where m.match_date = v_target_date
    union
    select distinct m.club_id, m.away_class_id as class_id
    from public.vleague_matches m
    where m.match_date = v_target_date
  ),
  candidates as (
    select
      ct.club_id,
      ct.class_id,
      c.id as cheer_id,
      c.student_id,
      c.student_name,
      row_number() over (
        partition by ct.club_id, ct.class_id
        order by random()
      ) as rn
    from classes_today ct
    join public.vleague_cheers c
      on c.club_id = ct.club_id
     and c.class_id = ct.class_id
    where timezone('Asia/Seoul', c.created_at) >= ((v_target_date::timestamp - interval '1 day') + interval '14 hour')
      and timezone('Asia/Seoul', c.created_at) <  (v_target_date::timestamp + interval '13 hour')
  ),
  picked as (
    select
      club_id,
      class_id,
      cheer_id,
      student_id,
      student_name
    from candidates
    where rn = 1
  ),
  inserted as (
    insert into public.vleague_cheer_event_winners (
      club_id,
      class_id,
      match_date,
      winner_student_id,
      winner_student_name,
      source_cheer_id,
      note
    )
    select
      p.club_id,
      p.class_id,
      v_target_date,
      p.student_id,
      p.student_name,
      p.cheer_id,
      to_char(v_target_date, 'MM"월" DD"일"') || ' 경기 자동 추첨'
    from picked p
    on conflict (club_id, class_id, match_date) do nothing
    returning 1
  )
  select count(*) into v_inserted_count
  from inserted;

  return v_inserted_count;
end;
$$;

comment on function public.draw_vleague_cheer_event_winners_kst is
'KST 기준 당일 13:01 이후 V리그 응원 이벤트 당첨자를 자동 추첨해 match_date와 함께 저장한다.';

-- 기존 스케줄 제거 후 재등록
select cron.unschedule('vleague-cheer-event-draw-1301-kst')
where exists (
  select 1
  from cron.job
  where jobname = 'vleague-cheer-event-draw-1301-kst'
);

-- 매일 13:01 자동 추첨
select cron.schedule(
  'vleague-cheer-event-draw-1301-kst',
  '1 13 * * *',
  $$select public.draw_vleague_cheer_event_winners_kst();$$
);

-- 특정 날짜(예: 2026-05-10) 수동 추첨이 필요할 때:
-- select public.draw_vleague_cheer_event_winners_kst('2026-05-10'::date);
