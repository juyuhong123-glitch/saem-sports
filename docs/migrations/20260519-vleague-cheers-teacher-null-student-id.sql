-- 담임 교사 응원: student_id 없이 저장 (앱은 교사 insert 시 student_id 를 넣지 않음)
-- Supabase Dashboard > SQL Editor 에서 이 파일 전체를 실행하세요.

alter table public.vleague_cheers
  alter column student_id drop not null;

-- 이벤트 추첨은 학생 응원만 대상 (student_id 가 있는 행만)
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
    where c.student_id is not null
      and timezone('Asia/Seoul', c.created_at) >= ((v_target_date::timestamp - interval '1 day') + interval '14 hour')
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
