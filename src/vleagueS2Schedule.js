/** 새샘 V리그 2학기 그룹 대항전 리그전 스케줄 유틸 */

export function getIsoWeekKeyYmd(ymd) {
  const s = String(ymd || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(12, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day + 3);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    );
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * 교차 그룹 대진 생성 (같은 그룹끼리 경기 없음).
 * A[i] vs B[(i+r) % |B|] 로 라운드를 구성한다.
 */
export function generateCrossGroupRounds(groupA, groupB) {
  const a = (groupA || []).filter(Boolean);
  const b = (groupB || []).filter(Boolean);
  if (a.length === 0 || b.length === 0) return [];
  const rounds = [];
  for (let r = 0; r < b.length; r += 1) {
    const matches = [];
    for (let i = 0; i < a.length; i += 1) {
      const home = a[i];
      const away = b[(i + r) % b.length];
      matches.push({ home, away });
    }
    rounds.push(matches);
  }
  return rounds;
}

/**
 * 날짜 배정:
 * - isPlayableYmd 기준으로 월·목/주말/공휴일/제외일 스킵
 * - 가급적 한 주에 학급당 1경기
 * - 불가하면 같은 주 2경기까지 허용
 */
export function assignCrossGroupMatchDates({
  rounds,
  startDate,
  gamesPerDay = 2,
  isPlayableYmd,
  addDaysYmd,
}) {
  const flat = [];
  let matchNo = 1;
  let curDate = isPlayableYmd(startDate) ? startDate : null;
  if (!curDate && startDate) {
    curDate = startDate;
    for (let i = 0; i < 366; i += 1) {
      curDate = addDaysYmd(curDate, 1);
      if (isPlayableYmd(curDate)) break;
    }
  }

  const weekLoad = new Map(); // `${week}__${classId}` -> count
  const dayLoad = new Map(); // ymd -> count

  const getWeekLoad = (week, classId) =>
    weekLoad.get(`${week}__${classId}`) || 0;
  const bumpWeek = (week, classId) => {
    const k = `${week}__${classId}`;
    weekLoad.set(k, (weekLoad.get(k) || 0) + 1);
  };

  const findDateForPair = (homeId, awayId, fromDate, maxPerWeek) => {
    let probe = fromDate;
    for (let step = 0; step < 120; step += 1) {
      if (!probe) return null;
      if (!isPlayableYmd(probe)) {
        probe = addDaysYmd(probe, 1);
        continue;
      }
      const week = getIsoWeekKeyYmd(probe);
      const dayCnt = dayLoad.get(probe) || 0;
      if (dayCnt >= Math.max(1, Number(gamesPerDay || 1))) {
        probe = addDaysYmd(probe, 1);
        continue;
      }
      if (
        getWeekLoad(week, homeId) < maxPerWeek &&
        getWeekLoad(week, awayId) < maxPerWeek
      ) {
        return probe;
      }
      probe = addDaysYmd(probe, 1);
    }
    return null;
  };

  for (let r = 0; r < rounds.length; r += 1) {
    const roundNo = r + 1;
    for (const { home, away } of rounds[r]) {
      let matchDate =
        findDateForPair(home.id, away.id, curDate, 1) ||
        findDateForPair(home.id, away.id, curDate, 2);

      if (matchDate) {
        const week = getIsoWeekKeyYmd(matchDate);
        bumpWeek(week, home.id);
        bumpWeek(week, away.id);
        dayLoad.set(matchDate, (dayLoad.get(matchDate) || 0) + 1);
        curDate = matchDate;
      }

      flat.push({
        round_no: roundNo,
        match_no: matchNo,
        home_class_id: home.id,
        away_class_id: away.id,
        match_date: matchDate,
        status: "scheduled",
        home_score: null,
        away_score: null,
      });
      matchNo += 1;
    }
    // 라운드가 끝나면 다음 playable 날짜로 살짝 전진(같은 날 과밀 방지)
    if (curDate) {
      let next = addDaysYmd(curDate, 1);
      for (let i = 0; i < 60; i += 1) {
        if (isPlayableYmd(next)) {
          curDate = next;
          break;
        }
        next = addDaysYmd(next, 1);
      }
    }
  }

  const roundGroups = [];
  for (const row of flat) {
    const idx = row.round_no - 1;
    if (!roundGroups[idx]) roundGroups[idx] = { round_no: row.round_no, matches: [] };
    roundGroups[idx].matches.push(row);
  }
  return { rounds: roundGroups.filter(Boolean), flat };
}
