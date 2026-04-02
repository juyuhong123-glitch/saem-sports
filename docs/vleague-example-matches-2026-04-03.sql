-- 예시 리그 일정: 2026년 4월 3일
--   맑은샘: 5학년 4반 vs 5학년 2반  → 앱 표기 5-4 vs 5-2
--   고운샘: 6학년 1반 vs 6학년 6반  → 앱 표기 6-1 vs 6-6
--
-- Supabase → SQL Editor에서 순서대로 실행하세요.
-- 클럽 이름이 다르면 '새샘 V리그' 를 실제 종목명으로 바꿉니다.

-- 0) (선택) 같은 날짜 예시 경기를 다시 넣기 전에 지우기
-- DELETE FROM public.vleague_matches
-- WHERE match_date = '2026-04-03'
--   AND club_id = (SELECT id FROM public.clubs WHERE name = '새샘 V리그' LIMIT 1);

-- 1) 참가 학급이 없으면 추가 (이미 있으면 건너뜀)
INSERT INTO public.vleague_classes (club_id, class_name, sort_order)
SELECT c.id, x.class_name, x.ord
FROM public.clubs c
CROSS JOIN (
  VALUES
    ('5학년 2반', 2),
    ('5학년 4반', 4),
    ('6학년 1반', 101),
    ('6학년 6반', 106)
) AS x(class_name, ord)
WHERE c.name = '새샘 V리그'
  AND NOT EXISTS (
    SELECT 1
    FROM public.vleague_classes vc
    WHERE vc.club_id = c.id AND vc.class_name = x.class_name
  );

-- 2) 4월 3일 경기 2건
INSERT INTO public.vleague_matches (
  club_id,
  league,
  round_no,
  match_no,
  match_date,
  home_class_id,
  away_class_id,
  status
)
SELECT
  c.id,
  'malgeun',
  1,
  1,
  DATE '2026-04-03',
  h.id,
  a.id,
  'scheduled'
FROM public.clubs c
JOIN public.vleague_classes h ON h.club_id = c.id AND h.class_name = '5학년 4반'
JOIN public.vleague_classes a ON a.club_id = c.id AND a.class_name = '5학년 2반'
WHERE c.name = '새샘 V리그'
ON CONFLICT DO NOTHING;

-- unique index가 (club_id, league, round_no, match_no) 일 때만 ON CONFLICT 사용 가능.
-- 충돌 시 에러가 나면 아래를 쓰고, 위 INSERT 의 ON CONFLICT 줄은 제거하세요.

INSERT INTO public.vleague_matches (
  club_id,
  league,
  round_no,
  match_no,
  match_date,
  home_class_id,
  away_class_id,
  status
)
SELECT
  c.id,
  'goun',
  1,
  1,
  DATE '2026-04-03',
  h.id,
  a.id,
  'scheduled'
FROM public.clubs c
JOIN public.vleague_classes h ON h.club_id = c.id AND h.class_name = '6학년 1반'
JOIN public.vleague_classes a ON a.club_id = c.id AND a.class_name = '6학년 6반'
WHERE c.name = '새샘 V리그'
ON CONFLICT DO NOTHING;

-- 3) vleague_matches에 created_by 컬럼이 있고, 앱에서 관리자 필터를 쓰는 경우 (선택)
-- UPDATE public.vleague_matches m
-- SET created_by = '홍준영'
-- WHERE m.match_date = '2026-04-03'
--   AND m.club_id = (SELECT id FROM public.clubs WHERE name = '새샘 V리그' LIMIT 1);
