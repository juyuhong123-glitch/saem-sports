/**
 * 예시 일정 삭제: 2026-04-03 맑은샘·고운샘 각 1경기 (seed 스크립트와 동일 키)
 * 실행: node scripts/delete-example-matches-2026-04-03.mjs
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

const TO_DELETE = [
  { league: "malgeun", round_no: 1, match_no: 1 },
  { league: "goun", round_no: 1, match_no: 1 },
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

  let total = 0;
  for (const { league, round_no, match_no } of TO_DELETE) {
    const { data, error } = await supabase
      .from("vleague_matches")
      .delete()
      .eq("club_id", clubId)
      .eq("league", league)
      .eq("round_no", round_no)
      .eq("match_no", match_no)
      .eq("match_date", "2026-04-03")
      .select("id");

    if (error) {
      console.error(`삭제 실패 (${league} R${round_no} M${match_no}):`, error.message);
      process.exit(1);
    }
    total += data?.length ?? 0;
  }

  console.log(`완료: 예시 경기 ${total}건 삭제 (2026-04-03)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
