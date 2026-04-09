/**
 * 새샘 V리그 응원 메시지 예시 8건 삽입
 * 실행: node scripts/seed-vleague-cheers-sample-8.mjs
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

const SAMPLE_MESSAGES = [
  "우리 반 파이팅! 끝까지 집중해서 멋진 경기 보여주자!",
  "서브부터 차분하게, 리시브는 정확하게! 응원합니다!",
  "팀워크 최고! 오늘도 즐겁고 멋지게 뛰자!",
  "한 점 한 점 소중하게! 모두 다치지 말고 화이팅!",
  "마지막까지 포기하지 않는 모습 기대할게요!",
  "패스 연결 좋다! 자신 있게 플레이하자!",
  "응원 열기 최고! 우리 반 할 수 있다!",
  "수비 집중, 공격 과감하게! 오늘 주인공은 우리 반!",
];

async function main() {
  const { data: clubs, error: clubErr } = await supabase
    .from("clubs")
    .select("id, name")
    .eq("name", "새샘 V리그");

  if (clubErr || !clubs?.length) {
    console.error("'새샘 V리그' 클럽을 찾지 못했습니다.", clubErr?.message || clubErr);
    process.exit(1);
  }

  const clubIds = clubs.map((c) => c.id);
  const { data: classes, error: clsErr } = await supabase
    .from("vleague_classes")
    .select("id, class_name, club_id")
    .in("club_id", clubIds)
    .order("class_name", { ascending: true });

  if (clsErr || !classes?.length) {
    console.error("vleague_classes 조회 실패", clsErr?.message || clsErr);
    process.exit(1);
  }

  const pickClasses = classes.slice(0, 8);
  const rows = pickClasses.map((c, i) => ({
    club_id: c.club_id,
    class_id: c.id,
    student_name: `응원학생${String(i + 1).padStart(2, "0")}`,
    student_id: `990${String(i + 1).padStart(3, "0")}`,
    message: SAMPLE_MESSAGES[i % SAMPLE_MESSAGES.length],
  }));

  const { error: insErr } = await supabase.from("vleague_cheers").insert(rows);
  if (insErr) {
    console.error("vleague_cheers 삽입 실패:", insErr.message);
    process.exit(1);
  }

  console.log(`완료: 응원 메시지 ${rows.length}건 삽입`);
  for (let i = 0; i < rows.length; i += 1) {
    console.log(
      `- ${pickClasses[i].class_name}: ${rows[i].student_name} / ${rows[i].message}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

