-- V리그 응원글: 작성 후 3일(KST)이 지나면 DB에서 삭제
-- Supabase SQL Editor에서 실행

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

  delete from public.vleague_cheers c
  where v_now_kst >= timezone('Asia/Seoul', c.created_at) + interval '3 days';

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

comment on function public.delete_expired_vleague_cheers_kst is
  'KST 기준으로 응원 글 작성 시각부터 3일이 지난 V리그 응원 메시지를 삭제한다.';

-- cron은 기존 jobname 유지 (매시 5분 실행)
select cron.unschedule('vleague-cheers-delete-2pm-kst')
where exists (
  select 1 from cron.job where jobname = 'vleague-cheers-delete-2pm-kst'
);

select cron.schedule(
  'vleague-cheers-delete-2pm-kst',
  '5 * * * *',
  $$select public.delete_expired_vleague_cheers_kst();$$
);
