-- 건강걷기 365 전용 테이블 제거 (앱에서 기능 제거됨, 2026-05-20)
-- Supabase SQL Editor에서 실행하거나 Management API로 적용

drop policy if exists health_walk365_plogging_delete on public.health_walk365_plogging_days;
drop policy if exists health_walk365_plogging_insert on public.health_walk365_plogging_days;
drop policy if exists health_walk365_plogging_select on public.health_walk365_plogging_days;
drop policy if exists health_walk365_classes_select on public.health_walk365_classes;

drop table if exists public.health_walk365_plogging_days cascade;
drop table if exists public.health_walk365_classes cascade;

-- 참고: public.clubs 의 '건강걷기 365' 행은 남아 있을 수 있습니다.
-- 클럽 행까지 지우려면 (다른 데이터 참조 없을 때만):
-- delete from public.clubs where replace(name, ' ', '') ilike '%건강%365%';
