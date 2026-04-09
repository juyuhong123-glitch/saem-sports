import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "..", ".env"), "utf8");
const url = envText.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim();
const key = envText.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();

if (!url || !key) {
  console.error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없습니다.");
  process.exit(1);
}

const supabase = createClient(url, key);

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const { data: clubs, error: clubErr } = await supabase
    .from("clubs")
    .select("id")
    .eq("name", "새샘 V리그");
  if (clubErr || !clubs?.length) {
    console.error("새샘 V리그 club 조회 실패:", clubErr?.message || clubErr);
    process.exit(1);
  }
  const clubIds = clubs.map((c) => c.id);
  const today = toYmd(new Date());

  const { data: matches, error: matchErr } = await supabase
    .from("vleague_matches")
    .select("home_class_id, away_class_id")
    .in("club_id", clubIds)
    .eq("match_date", today)
    .limit(200);
  if (matchErr) {
    console.error("오늘 경기 조회 실패:", matchErr.message);
    process.exit(1);
  }

  const classIds = [];
  for (const m of matches || []) {
    if (m.home_class_id) classIds.push(m.home_class_id);
    if (m.away_class_id) classIds.push(m.away_class_id);
  }
  const uniqClassIds = Array.from(new Set(classIds));
  if (!uniqClassIds.length) {
    console.error("오늘 경기 학급을 찾지 못했습니다.");
    process.exit(1);
  }

  const messages = [
    "응원 전광판 테스트 1 화이팅!",
    "응원 전광판 테스트 2 집중!",
    "응원 전광판 테스트 3 팀워크!",
    "응원 전광판 테스트 4 파이팅!",
    "응원 전광판 테스트 5 끝까지!",
    "응원 전광판 테스트 6 자신감!",
    "응원 전광판 테스트 7 에너지 업!",
    "응원 전광판 테스트 8 승리 가자!",
  ];

  const rows = Array.from({ length: 8 }).map((_, i) => ({
    club_id: clubIds[0],
    class_id: uniqClassIds[i % uniqClassIds.length],
    student_id: `991${String(i + 1).padStart(3, "0")}`,
    student_name: `보드테스트${String(i + 1).padStart(2, "0")}`,
    message: messages[i],
  }));

  const { error: insErr } = await supabase.from("vleague_cheers").insert(rows);
  if (insErr) {
    console.error("응원 삽입 실패:", insErr.message);
    process.exit(1);
  }

  console.log(`완료: 현재 윈도우 대상 응원 ${rows.length}건 삽입`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

