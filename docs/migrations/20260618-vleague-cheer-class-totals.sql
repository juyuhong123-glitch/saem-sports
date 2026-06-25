-- V리그 학급별 응원 누적 등록 횟수 (내일 이후 경기 응원부터 앱에서 +1/-1)
-- Supabase SQL Editor 또는 MCP apply_migration 으로 실행

create table if not exists public.vleague_cheer_class_totals (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  class_id uuid not null references public.vleague_classes (id) on delete cascade,
  total_count integer not null default 0 check (total_count >= 0),
  updated_at timestamptz not null default now(),
  unique (club_id, class_id)
);

create index if not exists vleague_cheer_class_totals_club_id_idx
  on public.vleague_cheer_class_totals (club_id);

comment on table public.vleague_cheer_class_totals is
  'V리그 학급별 응원글 누적 등록 횟수 (경기일이 집계 시작일 이후인 응원만 앱에서 반영)';

create or replace function public.adjust_vleague_cheer_class_total(
  p_club_id uuid,
  p_class_id uuid,
  p_delta integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_club_id is null or p_class_id is null or p_delta = 0 then
    return;
  end if;

  insert into public.vleague_cheer_class_totals (club_id, class_id, total_count)
  values (p_club_id, p_class_id, greatest(p_delta, 0))
  on conflict (club_id, class_id)
  do update set
    total_count = greatest(0, public.vleague_cheer_class_totals.total_count + p_delta),
    updated_at = now();
end;
$$;

comment on function public.adjust_vleague_cheer_class_total is
  '학급별 응원 누적 등록 횟수를 p_delta 만큼 조정한다.';
