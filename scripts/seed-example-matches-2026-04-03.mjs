/**
 * 예시 일정: 2026-04-03
 * 맑은샘 5-4 vs 5-2 / 고운샘 6-1 vs 6-6
 * 실행: node scripts/seed-example-matches-2026-04-03.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
const envText = readFileSync(envPath, "utf8");
const url = envText.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();
if (!url || !key) {
  console.error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없습니다.");
  process.exit(1);
}

const supabase = createClient(url, key);

const CREATED_BY = "홍준영";

const CLASSES = [
  ["5학년 2반", 2],
  ["5학년 4반", 4],
  ["6학년 1반", 101],
  ["6학년 6반", 106],
];

async function main() {
  const { data: clubs, error: clubErr } = await supabase
    .from("clubs")
    .select("id")
    .eq("name", "새샘 V리그")
    .limit(1);

  if (clubErr || !clubs?.length) {
    console.error("클럽 '새샘 V리그' 를 찾을 수 없습니다.", clubErr);
    process.exit(1);
  }
  const clubId = clubs[0].id;

  for (const [className, sortOrder] of CLASSES) {
    const { data: existing } = await supabase
      .from("vleague_classes")
      .select("id")
      .eq("club_id", clubId)
      .eq("class_name", className)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("vleague_classes").insert({
        club_id: clubId,
        class_name: className,
        sort_order: sortOrder,
      });
      if (error) {
        console.error(`학급 추가 실패 (${className}):`, error.message);
        process.exit(1);
      }
      console.log("학급 추가:", className);
    }
  }

  const { data: classes, error: clsErr } = await supabase
    .from("vleague_classes")
    .select("id, class_name")
    .eq("club_id", clubId);

  if (clsErr || !classes?.length) {
    console.error("vleague_classes 조회 실패", clsErr);
    process.exit(1);
  }

  const byName = Object.fromEntries(classes.map((r) => [r.class_name, r.id]));
  const cid = (name) => {
    const id = byName[name];
    if (!id) throw new Error(`학급 없음: ${name}`);
    return id;
  };

  const matchRows = [
    {
      club_id: clubId,
      league: "malgeun",
      round_no: 1,
      match_no: 1,
      match_date: "2026-04-03",
      home_class_id: cid("5학년 4반"),
      away_class_id: cid("5학년 2반"),
      status: "scheduled",
      created_by: CREATED_BY,
    },
    {
      club_id: clubId,
      league: "goun",
      round_no: 1,
      match_no: 1,
      match_date: "2026-04-03",
      home_class_id: cid("6학년 1반"),
      away_class_id: cid("6학년 6반"),
      status: "scheduled",
      created_by: CREATED_BY,
    },
  ];

  for (const r of matchRows) {
    await supabase
      .from("vleague_matches")
      .delete()
      .eq("club_id", clubId)
      .eq("league", r.league)
      .eq("round_no", r.round_no)
      .eq("match_no", r.match_no);
  }

  let { error: insErr } = await supabase.from("vleague_matches").insert(matchRows);
  if (insErr) {
    const withoutCreated = matchRows.map(({ created_by, ...rest }) => rest);
    const retry = await supabase.from("vleague_matches").insert(withoutCreated);
    insErr = retry.error;
    if (insErr) {
      console.error("vleague_matches insert 실패:", insErr.message);
      process.exit(1);
    }
    console.warn("created_by 없이 삽입됨 (컬럼/정책 제한). 대시보드에서 UPDATE 권장.");
  }

  console.log("완료: 2026-04-03 맑은샘(5-4 vs 5-2), 고운샘(6-1 vs 6-6)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
