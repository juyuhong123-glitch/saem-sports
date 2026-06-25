import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { supabase } from "./supabaseClient";
import { APP_RELEASE_VERSION } from "./version";
import "./App.css";

/** 참가 학급: class_name이 5학년 → 맑은샘, 6학년 → 고운샘 */
function splitVLeagueClassesByGrade(list) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const sortFn = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return {
    malgeun: list
      .filter((r) => norm(r.class_name).startsWith("5학년"))
      .sort(sortFn),
    goun: list
      .filter((r) => norm(r.class_name).startsWith("6학년"))
      .sort(sortFn),
    other: list
      .filter(
        (r) =>
          !norm(r.class_name).startsWith("5학년") &&
          !norm(r.class_name).startsWith("6학년")
      )
      .sort(sortFn),
  };
}

function parseHomeroomFromStudentId(studentId) {
  const s = String(studentId || "");
  if (!/^\d{6}$/.test(s)) return null;
  const grade = Number(s.slice(0, 2));
  const cls = Number(s.slice(2, 4));
  return { grade, cls };
}

function formatClassNameFromStudentId(studentId) {
  const parsed = parseHomeroomFromStudentId(studentId);
  if (!parsed) return null;
  return `${parsed.grade}학년 ${parsed.cls}반`;
}

function shortClassLabel(className) {
  const s = String(className || "").trim();
  const m = s.match(/^(\d+)\s*학년\s*(\d+)\s*반$/);
  if (!m) return s;
  return `${Number(m[1])}-${Number(m[2])}`;
}

function toYmdLocal(d) {
  const x = d instanceof Date ? d : new Date(d);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

function addDaysYmdLocal(ymd, addDays) {
  if (!ymd) return null;
  const [yy, mm, dd] = String(ymd).split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + Number(addDays || 0));
  return toYmdLocal(d);
}

function dedupeVLeagueMatchesByRound(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = `${row?.league || ""}__${row?.round_no || 0}__${row?.match_no || 0}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    const prevDate = String(prev?.match_date || "");
    const curDate = String(row?.match_date || "");
    // 같은 경기번호가 중복으로 존재할 때, 최신(뒤로 밀린) 날짜를 우선 노출
    if (curDate > prevDate) {
      map.set(key, row);
      continue;
    }
    if (curDate === prevDate && String(row?.id || "") > String(prev?.id || "")) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function getVLeagueNicknameToneClass(className) {
  const key = String(className || "").replace(/\s+/g, "");
  if (!key) return "vleague-nick-readonly--tone-1";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 12;
  }
  return `vleague-nick-readonly--tone-${hash + 1}`;
}

/** 경기일(YYYY-MM-DD) 기준 로컬 시간: 전날 14:00 ~ 당일 13:00 직전까지 응원 작성 가능 */
function getVLeagueCheerWindowForMatchDate(matchDateYmd) {
  const ymd = String(matchDateYmd || "").slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!parts) return null;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  const matchDay = new Date(y, mo - 1, d);
  const dayBefore = new Date(matchDay);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const start = new Date(
    dayBefore.getFullYear(),
    dayBefore.getMonth(),
    dayBefore.getDate(),
    14,
    0,
    0,
    0
  );
  const end = new Date(y, mo - 1, d, 13, 0, 0, 0);
  return { start, end };
}

/** 경기일 당일 14:00부터는 응원 글을 화면에서 숨긴다. */
function getVLeagueCheerHideAtForMatchDate(matchDateYmd) {
  const ymd = String(matchDateYmd || "").slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!parts) return null;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  return new Date(y, mo - 1, d, 14, 0, 0, 0);
}

/** 경기일 당일 13:01 ~ 14:00 사이에 응원 이벤트 추첨 가능 */
function getVLeagueCheerDrawWindowForMatchDate(matchDateYmd) {
  const ymd = String(matchDateYmd || "").slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!parts) return null;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  const start = new Date(y, mo - 1, d, 13, 1, 0, 0);
  const end = new Date(y, mo - 1, d, 14, 0, 0, 0);
  return { start, end };
}

/** 이벤트 카드 노출 시간: 경기일 당일 13:00 ~ 14:00 */
function isNowInVLeagueCheerEventDisplayWindow(matchDateYmd, now = new Date()) {
  const ymd = String(matchDateYmd || "").slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!parts) return false;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  const start = new Date(y, mo - 1, d, 13, 0, 0, 0);
  const end = new Date(y, mo - 1, d, 14, 0, 0, 0);
  return now >= start && now < end;
}

function isNowInVLeagueCheerWindow(matchDateYmd) {
  const w = getVLeagueCheerWindowForMatchDate(matchDateYmd);
  if (!w) return false;
  const now = new Date();
  return now >= w.start && now < w.end;
}

/**
 * 응원 글 표시:
 * - 작성 시각은 응원 작성 창(전날 14:00 ~ 당일 13:00 직전) 안이어야 하고,
 * - 현재 시각은 당일 14:00 이전이어야 한다. (14:00부터 자동 숨김)
 */
function isVLeagueCheerVisibleNow(cheer, matches, now = new Date()) {
  const classId = cheer.class_id;
  const created = new Date(cheer.created_at);
  if (classId == null || Number.isNaN(created.getTime())) return false;

  for (const m of matches || []) {
    if (!m.match_date) continue;
    if (m.home_class_id !== classId && m.away_class_id !== classId) continue;
    const ymd = String(m.match_date).slice(0, 10);
    const w = getVLeagueCheerWindowForMatchDate(ymd);
    const hideAt = getVLeagueCheerHideAtForMatchDate(ymd);
    if (!w || !hideAt) continue;
    if (created >= w.start && created < w.end && now < hideAt) {
      return true;
    }
  }
  return false;
}

const VLEAGUE_POSTPONE_UNDO_STORAGE_KEY = "vleague_postpone_undo_v1";

/** 누적 집계: 오늘(KST) 기준 내일 이후 경기(match_date) 응원만 포함 */
function getVLeagueCheerCumulativeMinMatchYmd(now = new Date()) {
  return addDaysYmdLocal(toYmdLocal(now), 1);
}

function shouldCountCheerTowardCumulativeTotal(
  classId,
  createdAt,
  matches,
  minMatchYmd
) {
  const created = new Date(createdAt);
  if (!classId || Number.isNaN(created.getTime())) return false;
  const minYmd = String(minMatchYmd || "").slice(0, 10);
  if (!minYmd) return false;

  for (const m of matches || []) {
    if (!m.match_date) continue;
    if (m.home_class_id !== classId && m.away_class_id !== classId) continue;
    const ymd = String(m.match_date).slice(0, 10);
    if (ymd < minYmd) continue;
    const w = getVLeagueCheerWindowForMatchDate(ymd);
    if (!w) continue;
    if (created >= w.start && created < w.end) return true;
  }
  return false;
}

function shouldCountCheerNowForCumulativeTotal(classId, matches, minMatchYmd) {
  return shouldCountCheerTowardCumulativeTotal(
    classId,
    new Date(),
    matches,
    minMatchYmd
  );
}

/** 2026년 대한민국 공휴일(대체공휴일 포함) */
const KOREA_HOLIDAYS_2026 = new Set([
  "2026-01-01", // 신정
  "2026-02-16", // 설날 연휴
  "2026-02-17", // 설날
  "2026-02-18", // 설날 연휴
  "2026-03-01", // 삼일절
  "2026-03-02", // 삼일절 대체공휴일
  "2026-05-05", // 어린이날
  "2026-05-24", // 부처님오신날
  "2026-05-25", // 부처님오신날 대체공휴일
  "2026-06-06", // 현충일
  "2026-06-08", // 현충일 대체공휴일
  "2026-08-15", // 광복절
  "2026-08-17", // 광복절 대체공휴일
  "2026-09-23", // 추석 연휴
  "2026-09-24", // 추석
  "2026-09-25", // 추석 연휴
  "2026-10-03", // 개천절
  "2026-10-05", // 개천절 대체공휴일
  "2026-10-09", // 한글날
  "2026-12-25", // 성탄절
]);
const AUTO_LOGOUT_IDLE_MS = 3 * 60 * 1000;

/** 메인 종목 카드·V리그 오늘 경기: 전광판식 가로 흐름 (이중 문구 + CSS 이동) */
function HomeHorizontalTicker({
  text,
  title,
  rootClassName,
  trackClassName,
  segClassName,
  minDurSec = 10,
  maxDurSec = 28,
  durPerChar = 0.42,
}) {
  const t = String(text || "").trim();
  const rootRef = useRef(null);
  const [marqueeDurSec, setMarqueeDurSec] = useState(minDurSec);
  const durSec = Math.min(
    maxDurSec,
    Math.max(minDurSec, Math.round(t.length * durPerChar))
  );

  const motionOk =
    typeof window === "undefined"
      ? true
      : !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    if (!t) return undefined;
    setMarqueeDurSec(durSec);
    const root = rootRef.current;
    if (!root) return undefined;
    const syncDur = () => {
      const track = root.querySelector("[data-ticker-track]");
      const seg = track?.firstElementChild;
      if (!seg || !track) return;
      const copyW = seg.scrollWidth || seg.getBoundingClientRect().width || 0;
      const viewW = root.clientWidth || root.getBoundingClientRect().width || 0;
      const pxPerSec = 42;
      if (copyW > 1 && viewW > 1) {
        setMarqueeDurSec(
          Math.min(maxDurSec, Math.max(minDurSec, Math.round(copyW / pxPerSec)))
        );
      }
    };
    syncDur();
    const ro = new ResizeObserver(syncDur);
    ro.observe(root);
    return () => ro.disconnect();
  }, [t, durSec, minDurSec, maxDurSec]);

  if (!t) return null;

  const tip = title ?? t;
  const trackClass = motionOk
    ? `${trackClassName} sport-vleague-board-head-item-marquee-track--active`
    : trackClassName;

  return (
    <span ref={rootRef} className={rootClassName} title={tip}>
      <span
        data-ticker-track
        className={trackClass}
        style={motionOk ? { "--marquee-dur": `${marqueeDurSec}s` } : undefined}
      >
        <span className={segClassName}>{t}</span>
        <span className={segClassName} aria-hidden>
          {t}
        </span>
      </span>
    </span>
  );
}

const BRACKET_WIRE_BASE =
  "M50 0V11M23 11H77M23 11V22M77 11V22M11 22H35M11 22V44M35 22V44M65 22H89M65 22V44M89 22V44";

const BRACKET_ADVANCE_PATHS = {
  s1a: "M11 44V22H23V11H50V0",
  s1b: "M35 44V22H23V11H50V0",
  s2a: "M65 44V22H77V11H50V0",
  s2b: "M89 44V22H77V11H50V0",
};

function buildBracketDownWireBase(semi1Win, semi2Win) {
  const hubY = 12;
  const endY = 24;
  const center = 50;
  const has1 = semi1Win === "home" || semi1Win === "away";
  const has2 = semi2Win === "home" || semi2Win === "away";
  const x1 = has1 ? (semi1Win === "home" ? 35 : 11) : 23;
  const x2 = has2 ? (semi2Win === "home" ? 89 : 65) : 77;
  return `M${x1} 0V${hubY}H${center}V${endY}M${x2} 0V${hubY}H${center}V${endY}`;
}

function getBracketBronzeFeedAdvancePaths(semi1Win, semi2Win) {
  const paths = {};
  const hubY = 12;
  const endY = 24;
  const center = 50;
  if (semi1Win === "home") {
    paths.s1b = `M35 0V${hubY}H${center}V${endY}`;
  } else if (semi1Win === "away") {
    paths.s1a = `M11 0V${hubY}H${center}V${endY}`;
  }
  if (semi2Win === "home") {
    paths.s2b = `M89 0V${hubY}H${center}V${endY}`;
  } else if (semi2Win === "away") {
    paths.s2a = `M65 0V${hubY}H${center}V${endY}`;
  }
  return paths;
}

function getTournamentWinnerSideFromContent(content) {
  const raw = String(content || "");
  const withWin = raw.match(/승리점수\s*(\d+)\s*\|\s*결과\s*(\d+)\s*:\s*(\d+)/);
  if (withWin) {
    const winScore = Number(withWin[1]);
    const homeScore = Number(withWin[2]);
    const awayScore = Number(withWin[3]);
    if (!Number.isFinite(winScore) || winScore <= 0) return null;
    if (homeScore === winScore && awayScore !== winScore) return "home";
    if (awayScore === winScore && homeScore !== winScore) return "away";
    return null;
  }
  const m = raw.match(/결과\s*(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  const homeScore = Number(m[1]);
  const awayScore = Number(m[2]);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) {
    return null;
  }
  return homeScore > awayScore ? "home" : "away";
}

function stripTournamentResultSuffix(content) {
  return String(content || "")
    .replace(
      /\s*\|\s*승리점수\s*\d+\s*\|\s*결과\s*\d+\s*:\s*\d+(\s*\|\s*승리팀\s*[^|]+)?\s*$/g,
      ""
    )
    .replace(/\s*\|\s*결과\s*\d+\s*:\s*\d+(\s*\|\s*승리팀\s*[^|]+)?\s*$/g, "")
    .trim();
}

function parseTournamentTeamsFromContent(content) {
  const base = stripTournamentResultSuffix(content);
  const rhs = String(base).split(":").slice(1).join(":").trim();
  if (!rhs.includes(" vs ")) return null;
  const [home, away] = rhs.split(" vs ").map((s) => String(s || "").trim());
  if (!home || !away) return null;
  return { home, away };
}

function getTournamentWinnerLoserFromContent(content) {
  const teams = parseTournamentTeamsFromContent(content);
  const side = getTournamentWinnerSideFromContent(content);
  if (!teams || !side) return null;
  return {
    winner: side === "home" ? teams.home : teams.away,
    loser: side === "home" ? teams.away : teams.home,
  };
}

function getVLeagueLabelByKey(leagueKey) {
  return leagueKey === "goun" ? "고운샘" : "맑은샘";
}

function standingTeamKey(teamName) {
  return String(teamName || "").replace(/\s+/g, " ").trim();
}

function tournamentTeamKey(label) {
  const parsed = parseBracketTeamLabel(label);
  if (!parsed) return standingTeamKey(label);
  if (parsed.single) return standingTeamKey(parsed.single);
  if (parsed.cls) return standingTeamKey(`${parsed.name}${parsed.cls}`);
  return standingTeamKey(parsed.name);
}

function filterTournamentEventsByLeague(events, leagueKey) {
  const marker = `[토너먼트][${getVLeagueLabelByKey(leagueKey)}]`;
  return (events || []).filter((ev) =>
    String(ev.content || "").includes(marker)
  );
}

function isVLeagueSeasonComplete(matches, leagueKey) {
  const leagueMatches = (matches || []).filter((m) => m.league === leagueKey);
  if (leagueMatches.length === 0) return false;
  return leagueMatches.every(
    (m) =>
      m.status === "completed" &&
      m.home_score != null &&
      m.away_score != null
  );
}

function getFinalSeriesResult(events) {
  const finals = (events || [])
    .filter((ev) => /결승\s*\d+\s*차전/.test(String(ev.content || "")))
    .sort((a, b) => {
      const ga = Number(
        String(a.content || "").match(/결승\s*(\d+)\s*차전/)?.[1] || 0
      );
      const gb = Number(
        String(b.content || "").match(/결승\s*(\d+)\s*차전/)?.[1] || 0
      );
      return ga - gb;
    });
  if (finals.length === 0) return { complete: false };
  const winCounts = new Map();
  let finalistKeys = null;
  for (const ev of finals) {
    const teams = parseTournamentTeamsFromContent(ev.content);
    const side = getTournamentWinnerSideFromContent(ev.content);
    if (!teams || !side) continue;
    const homeKey = tournamentTeamKey(teams.home);
    const awayKey = tournamentTeamKey(teams.away);
    if (!finalistKeys) finalistKeys = new Set([homeKey, awayKey]);
    const winnerKey = side === "home" ? homeKey : awayKey;
    winCounts.set(winnerKey, (winCounts.get(winnerKey) || 0) + 1);
  }
  if (!finalistKeys || finalistKeys.size < 2) return { complete: false };
  for (const [teamKey, count] of winCounts.entries()) {
    if (count >= 2) {
      const runnerUp = [...finalistKeys].find((k) => k !== teamKey) || "";
      return { complete: true, championKey: teamKey, runnerUpKey: runnerUp };
    }
  }
  return { complete: false };
}

function isVLeagueTournamentComplete(events) {
  const list = events || [];
  if (list.length === 0) return false;
  const semi1 = list.find((ev) => String(ev.content || "").includes("준결승 1"));
  const semi2 = list.find((ev) => String(ev.content || "").includes("준결승 2"));
  const bronze = list.find((ev) => String(ev.content || "").includes("3·4위전"));
  if (!semi1 || !semi2 || !bronze) return false;
  if (!getTournamentWinnerSideFromContent(semi1.content)) return false;
  if (!getTournamentWinnerSideFromContent(semi2.content)) return false;
  if (!getTournamentWinnerSideFromContent(bronze.content)) return false;
  return getFinalSeriesResult(list).complete;
}

function buildTournamentBasedStandings(leagueStandingsRows, events) {
  const bronze = (events || []).find((ev) =>
    String(ev.content || "").includes("3·4위전")
  );
  const bronzeResult = bronze
    ? getTournamentWinnerLoserFromContent(bronze.content)
    : null;
  const finalSeries = getFinalSeriesResult(events);
  if (!bronzeResult || !finalSeries.complete) return null;

  const orderedKeys = [
    finalSeries.championKey,
    finalSeries.runnerUpKey,
    tournamentTeamKey(bronzeResult.winner),
    tournamentTeamKey(bronzeResult.loser),
  ].filter(Boolean);

  const keyToRow = new Map();
  for (const row of leagueStandingsRows || []) {
    keyToRow.set(standingTeamKey(row.team_name), row);
  }

  const usedIds = new Set();
  const result = [];
  for (const key of orderedKeys) {
    const row = keyToRow.get(key);
    if (!row || usedIds.has(row.class_id)) continue;
    usedIds.add(row.class_id);
    result.push({ ...row });
  }

  const rest = (leagueStandingsRows || [])
    .filter((row) => !usedIds.has(row.class_id))
    .sort((a, b) => a.rank_order - b.rank_order);
  for (const row of rest) {
    result.push({ ...row });
  }

  return result.map((row, idx) => ({
    ...row,
    rank_order: idx + 1,
    standings_source: "tournament",
  }));
}

function getVLeagueDisplayStandings(
  leagueKey,
  leagueStandingsRows,
  matches,
  tournamentEvents
) {
  const leagueEvents = filterTournamentEventsByLeague(tournamentEvents, leagueKey);
  if (
    isVLeagueSeasonComplete(matches, leagueKey) &&
    isVLeagueTournamentComplete(leagueEvents)
  ) {
    const tournamentRows = buildTournamentBasedStandings(
      leagueStandingsRows,
      leagueEvents
    );
    if (tournamentRows) return tournamentRows;
  }
  return (leagueStandingsRows || []).map((row) => ({
    ...row,
    standings_source: "league",
  }));
}

const PROMOTION_MATCHUP_DEFS = [
  { gameNo: 1, gounRank: 5, malgeunRank: 3 },
  { gameNo: 2, gounRank: 6, malgeunRank: 2 },
  { gameNo: 3, gounRank: 7, malgeunRank: 1 },
];

const PROMOTION_EVENT_MARKER = "[승강전]";

function areBothLeaguesReadyForPromotion(matches, tournamentEvents) {
  for (const leagueKey of ["malgeun", "goun"]) {
    const leagueEvents = filterTournamentEventsByLeague(tournamentEvents, leagueKey);
    if (!isVLeagueSeasonComplete(matches, leagueKey)) return false;
    if (!isVLeagueTournamentComplete(leagueEvents)) return false;
  }
  return true;
}

function findStandingRowByRank(standings, rankOrder) {
  return (standings || []).find((row) => row.rank_order === rankOrder) || null;
}

function buildPromotionMatchContent(
  gameNo,
  gounRank,
  gounTeamName,
  malgeunRank,
  malgeunTeamName
) {
  return `${PROMOTION_EVENT_MARKER} ${gameNo}경기(단판): 고운샘 ${gounRank}위 ${gounTeamName} vs 맑은샘 ${malgeunRank}위 ${malgeunTeamName}`;
}

function getTournamentPhaseLabel(content) {
  const c = String(content || "");
  if (c.includes("준결승 1")) return "준결승";
  if (c.includes("준결승 2")) return "준결승";
  if (c.includes("준결승")) return "준결승";
  if (c.includes("3·4위전")) return "3·4위전";
  if (c.includes("승강전")) return "승강전";
  const finalM = c.match(/결승\s*(\d+)\s*차전/);
  if (finalM) {
    return Number(finalM[1]) === 1 ? "결승전" : `결승 ${finalM[1]}차전`;
  }
  if (c.includes("결승")) return "결승전";
  return "토너먼트";
}

function formatTournamentTeamForScoreboard(teamLabel) {
  const parsed = parseBracketTeamLabel(teamLabel);
  if (!parsed) return String(teamLabel || "").trim() || "팀";
  if (parsed.single) return parsed.single;
  if (parsed.cls) return `${parsed.name}${parsed.cls}`;
  return parsed.name || parsed.rank || String(teamLabel || "").trim();
}

function formatTournamentEventForScoreboard(content, leagueLabel) {
  const phase = getTournamentPhaseLabel(content);
  const teams = parseTournamentTeamsFromContent(content);
  if (!teams) return `[${leagueLabel}] (${phase})`;
  const home = formatTournamentTeamForScoreboard(teams.home);
  const away = formatTournamentTeamForScoreboard(teams.away);
  return `[${leagueLabel}] (${phase}) ${home} VS ${away}`;
}

function getTournamentLeagueKeyFromContent(content) {
  const c = String(content || "");
  if (c.includes("[맑은샘]")) return "malgeun";
  if (c.includes("[고운샘]")) return "goun";
  return "";
}

function getBracketSparkSlotFromEvent(content, winnerSide) {
  const c = String(content || "");
  if (!winnerSide) return null;
  if (c.includes("준결승 1")) return winnerSide === "home" ? "s1a" : "s1b";
  if (c.includes("준결승 2")) return winnerSide === "home" ? "s2a" : "s2b";
  if (c.includes("3·4위전")) return winnerSide === "home" ? "b1" : "b2";
  if (c.includes("결승")) {
    if (!winnerSide) return null;
    return winnerSide === "home" ? "f1" : "f2";
  }
  return null;
}

function parseBracketTeamLabel(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "-") return null;
  const rankM = /^(\d+)\s*위\s+(.+)$/.exec(s);
  if (!rankM) return { single: s };
  const rest = String(rankM[2] || "").trim();
  const classM = /^(.*)\(([^)]+)\)\s*$/.exec(rest);
  if (classM && String(classM[1] || "").trim()) {
    return {
      rank: `${rankM[1]}위`,
      name: String(classM[1]).trim(),
      cls: `(${String(classM[2]).trim()})`,
    };
  }
  return {
    rank: `${rankM[1]}위`,
    name: rest,
    cls: null,
  };
}

function getTeamClassShortLabel(teamLabel) {
  const parsed = parseBracketTeamLabel(teamLabel);
  if (!parsed) return "팀";
  if (parsed.cls) return parsed.cls.replace(/^\(|\)$/g, "");
  if (parsed.name) return parsed.name;
  return parsed.rank || "팀";
}

function formatTeamForResultInput(teamLabel) {
  const parsed = parseBracketTeamLabel(teamLabel);
  if (!parsed) return String(teamLabel || "").trim() || "-";
  if (parsed.single) return parsed.single;
  return parsed.cls
    ? `${parsed.rank} ${parsed.name} ${parsed.cls}`
    : `${parsed.rank} ${parsed.name}`;
}

function parseTournamentMatchInfo(content) {
  const c = String(content || "");
  let ruleLabel = "한 경기 승부";
  let ruleHint = "각 팀 점수를 입력하세요. 점수가 더 높은 팀이 승리합니다.";
  let gameNo = null;
  if (c.includes("3판 2선승")) {
    ruleLabel = "3판 2선승";
    ruleHint =
      "이번 경기(세트) 점수를 입력하세요. 점수가 더 높은 팀이 이 세트를 승리합니다.";
    const gm = c.match(/결승\s*(\d+)\s*차전/);
    gameNo = gm ? Number(gm[1]) : null;
  } else if (c.includes("3·4위전")) {
    ruleLabel = "단판";
    ruleHint = "3·4위를 가리는 경기입니다. 각 팀 점수를 입력하세요.";
  } else if (c.includes("승강전")) {
    ruleLabel = "단판";
    ruleHint = "승강전 단판 경기입니다. 각 팀 점수를 입력하세요.";
    const pm = c.match(/(\d+)\s*경기/);
    gameNo = pm ? Number(pm[1]) : null;
  } else if (c.includes("단판")) {
    ruleLabel = "단판";
    ruleHint = "각 팀 점수를 입력하세요. 점수가 더 높은 팀이 승리합니다.";
    const sm = c.match(/준결승\s*(\d+)/);
    gameNo = sm ? Number(sm[1]) : null;
  }
  return { ruleLabel, ruleHint, gameNo };
}

function BracketTeamContent({ label, hideRank = false }) {
  const parsed = parseBracketTeamLabel(label);
  if (!parsed) return <>-</>;
  if (parsed.single) return <>{parsed.single}</>;
  return (
    <>
      {!hideRank ? (
        <span className="vleague-bracket-box-rank">{parsed.rank}</span>
      ) : null}
      <span className="vleague-bracket-box-name">{parsed.name}</span>
      {parsed.cls ? (
        <span className="vleague-bracket-box-class">{parsed.cls}</span>
      ) : null}
    </>
  );
}

function BracketTeamBox({ label, className, hideRank = false }) {
  const parsed = parseBracketTeamLabel(label);
  if (!parsed) {
    return <div className={className}>-</div>;
  }
  return (
    <div className={className}>
      <BracketTeamContent label={label} hideRank={hideRank} />
    </div>
  );
}

function BracketMatchBox({
  homeLabel,
  awayLabel,
  homeSlot,
  awaySlot,
  winners,
  losers,
  sparkSlot,
  className,
}) {
  const sideClass = (slot) => {
    let cls = "vleague-bracket-match-side";
    if (winners?.[slot]) cls += " vleague-bracket-match-side--winner";
    if (losers?.[slot]) cls += " vleague-bracket-match-side--loser";
    if (sparkSlot === slot) cls += " vleague-bracket-match-side--spark";
    return cls;
  };
  let boxCls = "vleague-bracket-match-box";
  if (className) boxCls += ` ${className}`;
  if (sparkSlot === homeSlot || sparkSlot === awaySlot) {
    boxCls += " vleague-bracket-match-box--spark";
  }
  return (
    <div className={boxCls}>
      <div className={sideClass(homeSlot)}>
        <BracketTeamContent label={homeLabel} hideRank />
      </div>
      <span className="vleague-bracket-vs">VS</span>
      <div className={sideClass(awaySlot)}>
        <BracketTeamContent label={awayLabel} hideRank />
      </div>
    </div>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState(null); // {role, name, id?}
  const [clubs, setClubs] = useState([]); // Supabase에서 불러온 클럽 목록
  const [selectedClubName, setSelectedClubName] = useState("배구");
  const [applications, setApplications] = useState([]); // 교사용 신청 목록
  const [loadingClubData, setLoadingClubData] = useState(false);
  const [mainMsg, setMainMsg] = useState("");
  const [myAppByClubId, setMyAppByClubId] = useState({}); // 학생: { [clubId]: {status, id} }
  const [page, setPage] = useState({ type: "home", clubName: null }); // home | clubMain | clubManage
  const [clubTab, setClubTab] = useState("schedule"); // schedule | members | attendance | records | vClasses | vStandings | vReferee | vRules
  const [membersLoading, setMembersLoading] = useState(false);
  const [vLeagueClasses, setVLeagueClasses] = useState([]);
  const [vLeagueClassesError, setVLeagueClassesError] = useState(null);
  const [vLeagueStandings, setVLeagueStandings] = useState([]);
  const [vLeagueLoading, setVLeagueLoading] = useState(false);
  const [vLeagueNickDrafts, setVLeagueNickDrafts] = useState({});
  const [vLeagueNicknameSavingId, setVLeagueNicknameSavingId] = useState(null);
  /** 참가 학급 안: 맑은샘(5학년) / 고운샘(6학년) */
  const [vLeagueGradeTab, setVLeagueGradeTab] = useState("malgeun");
  const [vLeagueScheduleClassFilterEnabled, setVLeagueScheduleClassFilterEnabled] =
    useState(false);
  const [vLeagueScheduleClassFilter, setVLeagueScheduleClassFilter] = useState("5-1");
  const [vLeagueScheduleFilterMenuOpen, setVLeagueScheduleFilterMenuOpen] =
    useState(false);
  /** 대진표 */
  const [vLeagueMatches, setVLeagueMatches] = useState([]);
  const [vLeagueMatchesLoading, setVLeagueMatchesLoading] = useState(false);
  const [vLeagueMatchesError, setVLeagueMatchesError] = useState(null);
  const [vLeagueMatchesDraft, setVLeagueMatchesDraft] = useState(null); // { league, rounds: [{round_no, matches: [...] }], flat: [...] }
  const [vLeagueMatchViewMode, setVLeagueMatchViewMode] = useState("round"); // round | list
  const [vLeagueMatchFilter, setVLeagueMatchFilter] = useState("all"); // all | scheduled | completed
  const [vLeagueGenStartDate, setVLeagueGenStartDate] = useState(() => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  const [vLeagueGenGamesPerDay, setVLeagueGenGamesPerDay] = useState(2);
  const [vLeagueGenApplyDates, setVLeagueGenApplyDates] = useState(true);
  const [vLeagueExcludeDatesByLeague, setVLeagueExcludeDatesByLeague] = useState({
    malgeun: [],
    goun: [],
  }); // { malgeun: ['YYYY-MM-DD', ...], goun: ['YYYY-MM-DD', ...] }
  const [vLeagueExcludeOpen, setVLeagueExcludeOpen] = useState(false);
  const [vLeagueExcludeMonth, setVLeagueExcludeMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [vLeagueSavingMatches, setVLeagueSavingMatches] = useState(false);
  const [vLeaguePushingToCalendar, setVLeaguePushingToCalendar] = useState(false);
  /** 토너먼트 일정 생성 */
  const [vLeagueTournamentStartDate, setVLeagueTournamentStartDate] = useState(
    () => {
      const d = new Date();
      const pad2 = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  );
  const [vLeagueTournamentBronzeDate, setVLeagueTournamentBronzeDate] =
    useState("2026-06-22");
  const [vLeagueTournamentDraft, setVLeagueTournamentDraft] = useState([]);
  const [vLeagueTournamentSaving, setVLeagueTournamentSaving] = useState(false);
  const [vLeagueTournamentEvents, setVLeagueTournamentEvents] = useState([]);
  const [vLeagueTournamentLoading, setVLeagueTournamentLoading] = useState(false);
  const [vLeagueTournamentResultDrafts, setVLeagueTournamentResultDrafts] = useState({});
  const [vLeagueTournamentResultSavingId, setVLeagueTournamentResultSavingId] =
    useState(null);
  const [vLeagueTournamentDeletingId, setVLeagueTournamentDeletingId] = useState(null);
  const [vLeagueTournamentPostponingId, setVLeagueTournamentPostponingId] =
    useState(null);
  /** 승강전 일정 생성 */
  const [vLeaguePromotionStartDate, setVLeaguePromotionStartDate] = useState(() => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  });
  const [vLeaguePromotionDraft, setVLeaguePromotionDraft] = useState([]);
  const [vLeaguePromotionSaving, setVLeaguePromotionSaving] = useState(false);
  const [vLeaguePromotionEvents, setVLeaguePromotionEvents] = useState([]);
  const [vLeaguePromotionLoading, setVLeaguePromotionLoading] = useState(false);
  const [vLeaguePromotionResultDrafts, setVLeaguePromotionResultDrafts] = useState({});
  const [vLeaguePromotionResultSavingId, setVLeaguePromotionResultSavingId] =
    useState(null);
  const [vLeaguePromotionDeletingId, setVLeaguePromotionDeletingId] = useState(null);
  const [vLeaguePromotionPostponingId, setVLeaguePromotionPostponingId] =
    useState(null);
  const [vLeagueSyncingCalendar, setVLeagueSyncingCalendar] = useState(false);
  const [vLeagueDeletingMatchesAll, setVLeagueDeletingMatchesAll] = useState(false);
  const [vLeagueValidating, setVLeagueValidating] = useState(false);
  const [vLeagueResultDrafts, setVLeagueResultDrafts] = useState({});
  const [vLeagueResultSavingId, setVLeagueResultSavingId] = useState(null);
  const [vLeagueMatchPostponingId, setVLeagueMatchPostponingId] = useState(null);
  const [vLeagueUndoingMatchId, setVLeagueUndoingMatchId] = useState(null);
  const [vLeagueManualRestoreMatchId, setVLeagueManualRestoreMatchId] = useState(null);
  const [vLeaguePostponeUndoByMatchId, setVLeaguePostponeUndoByMatchId] = useState(() => {
    try {
      const raw = localStorage.getItem(VLEAGUE_POSTPONE_UNDO_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [vLeagueCheerDraft, setVLeagueCheerDraft] = useState("");
  const [vLeagueCheers, setVLeagueCheers] = useState([]);
  const [vLeagueCheerLoading, setVLeagueCheerLoading] = useState(false);
  const [vLeagueCheerBoard, setVLeagueCheerBoard] = useState([]);
  const [vLeagueCheerBoardMatches, setVLeagueCheerBoardMatches] = useState([]);
  const [vLeagueCheerCumulativeTotals, setVLeagueCheerCumulativeTotals] = useState([]);
  const [vLeagueCheerCumulativeLoading, setVLeagueCheerCumulativeLoading] = useState(false);
  const [vLeagueCheerBoardIndex, setVLeagueCheerBoardIndex] = useState(0);
  const [vLeagueCheerEventWinners, setVLeagueCheerEventWinners] = useState([]);
  const [cheerStripNoTransition, setCheerStripNoTransition] = useState(false);
  /** 전광판 슬라이드 높이(px) — 첫 슬롯 DOM 측정으로 rotator/transform과 일치 */
  const [cheerSlidePx, setCheerSlidePx] = useState(64);
  const cheerFirstSlideRef = useRef(null);
  const vLeagueScheduleFilterMenuRef = useRef(null);
  /** 응원 작성 가능 시각 창이 바뀌면 UI 갱신 */
  const [cheerEligibilityTick, setCheerEligibilityTick] = useState(0);
  const [vLeagueTodayMatches, setVLeagueTodayMatches] = useState({
    malgeun: "",
    goun: "",
  });
  const [vLeagueTodayMatchIds, setVLeagueTodayMatchIds] = useState({
    malgeun: null,
    goun: null,
  });
  const loadVLeagueTodayMatchTextRef = useRef(async () => {});
  const [vLeagueReferees, setVLeagueReferees] = useState([]);
  const [vLeagueRefereeAssignments, setVLeagueRefereeAssignments] = useState([]);
  const [vLeagueRefereeLoading, setVLeagueRefereeLoading] = useState(false);
  const [vLeagueRefereeStudentIdDraft, setVLeagueRefereeStudentIdDraft] = useState("");
  const [vLeagueScheduleRefLookupDraft, setVLeagueScheduleRefLookupDraft] = useState("");
  const [vLeagueScheduleRefLookupStudentId, setVLeagueScheduleRefLookupStudentId] =
    useState("");
  const [vLeagueRefereeSaving, setVLeagueRefereeSaving] = useState(false);
  const [vLeagueRuleText, setVLeagueRuleText] = useState("");
  const [vLeagueRuleDraft, setVLeagueRuleDraft] = useState("");
  const [vLeagueRuleLoading, setVLeagueRuleLoading] = useState(false);
  const [vLeagueRuleSaving, setVLeagueRuleSaving] = useState(false);
  const [showVLeagueRulePopup, setShowVLeagueRulePopup] = useState(false);
  const [showVLeagueHomeStandingsPopup, setShowVLeagueHomeStandingsPopup] = useState(false);
  const [showVLeagueHomeTournamentPopup, setShowVLeagueHomeTournamentPopup] =
    useState(false);
  const [homeVLeagueTournamentEvents, setHomeVLeagueTournamentEvents] = useState([]);
  const [homeVLeagueTournamentLoading, setHomeVLeagueTournamentLoading] = useState(false);
  const [bracketSparkSlot, setBracketSparkSlot] = useState(null);
  const [homeTournamentYmdByClubId, setHomeTournamentYmdByClubId] = useState({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [eventsByDate, setEventsByDate] = useState({}); // { 'YYYY-MM-DD': [{id, content}] }
  const [eventLoading, setEventLoading] = useState(false);
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [eventEditorDate, setEventEditorDate] = useState("");
  const [newEventContent, setNewEventContent] = useState("");

  const closeHomeTournamentPopupToStandings = useCallback(() => {
    setShowVLeagueHomeTournamentPopup(false);
    setShowVLeagueHomeStandingsPopup(true);
  }, []);

  useEffect(() => {
    if (!bracketSparkSlot) return undefined;
    const timer = window.setTimeout(() => setBracketSparkSlot(null), 3600);
    return () => window.clearTimeout(timer);
  }, [bracketSparkSlot]);
  const [approvedStudents, setApprovedStudents] = useState([]); // [{student_id, student_name}]
  const [attendanceByStudentId, setAttendanceByStudentId] = useState({}); // { [student_id]: true|false }
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceLoaded, setAttendanceLoaded] = useState(false);
  const [stackingType, setStackingType] = useState("3-6-3"); // '3-6-3' | '싸이클'
  const [stackingTime, setStackingTime] = useState("");
  const [stackingPhoto, setStackingPhoto] = useState(null); // File
  const [stackingSaving, setStackingSaving] = useState(false);
  const [stackingRecords, setStackingRecords] = useState([]);
  const [appCols, setAppCols] = useState({
    club_id: "club_id",
    student_id: "student_id",
    student_name: "student_name",
    status: "status",
    approved_at: "approved_at",
  });

  const [authTab, setAuthTab] = useState("login"); // 'login' | 'signup'
  const [loginRole, setLoginRole] = useState("student"); // 'student' | 'teacher'

  // 로그인/회원가입 입력 상태
  const [studentLoginId, setStudentLoginId] = useState("");
  const [studentLoginPw, setStudentLoginPw] = useState("");
  const [showStudentLoginPw, setShowStudentLoginPw] = useState(false);

  const [teacherCodeLogin, setTeacherCodeLogin] = useState("");
  const [teacherLoginName, setTeacherLoginName] = useState("");
  const [showTeacherCodeLogin, setShowTeacherCodeLogin] = useState(false);

  const [studentSignupId, setStudentSignupId] = useState("");
  const [studentSignupName, setStudentSignupName] = useState("");
  const [studentSignupPw, setStudentSignupPw] = useState("");
  const [studentNameDuplicateCountMap, setStudentNameDuplicateCountMap] = useState({});

  const [errorMsg, setErrorMsg] = useState("");

  const TEACHER_JOIN_CODE = "saem2026";
  const ADMIN_TEACHER_NAME = "홍준영";
  const ADMIN_TEACHER_JOIN_CODE = "saem2026@!";

  const resetErrors = () => setErrorMsg("");

  const isValidStudentId = (id) => /^\d{6}$/.test(id); // 정확히 6자리 숫자

  // 새로고침해도 로그인 유지 (localStorage)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("saesam_currentUser");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        (parsed.role === "student" || parsed.role === "teacher") &&
        typeof parsed.name === "string"
      ) {
        setCurrentUser(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (!currentUser) {
        localStorage.removeItem("saesam_currentUser");
      } else {
        localStorage.setItem("saesam_currentUser", JSON.stringify(currentUser));
      }
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return undefined;

    let idleTimerId = null;
    const activityEvents = ["mousedown", "keydown", "touchstart", "wheel", "scroll"];

    const triggerAutoLogout = () => {
      setCurrentUser(null);
      setPage({ type: "home", clubName: null });
      setApplications([]);
      setMainMsg("");
      setErrorMsg("3분 이상 활동이 없어 자동 로그아웃되었습니다.");
    };

    const resetIdleTimer = () => {
      if (idleTimerId) window.clearTimeout(idleTimerId);
      idleTimerId = window.setTimeout(triggerAutoLogout, AUTO_LOGOUT_IDLE_MS);
    };

    for (const ev of activityEvents) {
      window.addEventListener(ev, resetIdleTimer, { passive: true });
    }
    resetIdleTimer();

    return () => {
      if (idleTimerId) window.clearTimeout(idleTimerId);
      for (const ev of activityEvents) {
        window.removeEventListener(ev, resetIdleTimer);
      }
    };
  }, [currentUser]);

  useEffect(() => {
    try {
      localStorage.setItem(
        VLEAGUE_POSTPONE_UNDO_STORAGE_KEY,
        JSON.stringify(vLeaguePostponeUndoByMatchId || {})
      );
    } catch {
      // ignore
    }
  }, [vLeaguePostponeUndoByMatchId]);

  useEffect(() => {
    let alive = true;
    const loadStudentNameCountMap = async () => {
      const { data, error } = await supabase.from("students").select("student_id, name");
      if (error || !alive) return;
      const counts = {};
      for (const row of data || []) {
        const name = String(row?.name || "").trim();
        if (!name) continue;
        counts[name] = (counts[name] || 0) + 1;
      }
      setStudentNameDuplicateCountMap(counts);
    };
    loadStudentNameCountMap();
    return () => {
      alive = false;
    };
  }, []);

  const formatStudentDisplayName = useCallback(
    (name, studentId = null) => {
      const n = String(name || "").trim();
      if (!n) return "—";
      const count = Number(studentNameDuplicateCountMap[n] || 0);
      if (count <= 1) return n;
      const className = formatClassNameFromStudentId(studentId);
      const short = className ? shortClassLabel(className) : null;
      if (!short) return n;
      return `${n}(${short})`;
    },
    [studentNameDuplicateCountMap]
  );

  const detectApplicationColumns = async () => {
    // 현재 프로젝트에서는 고정 컬럼명을 사용합니다.
    // 필수 컬럼: club_id, student_id, student_name, status, approved_at
    const cols = {
      club_id: "club_id",
      student_id: "student_id",
      student_name: "student_name",
      status: "status",
      approved_at: "approved_at",
    };

    const { error } = await supabase
      .from("club_applications")
      .select(
        `id, ${cols.club_id}, ${cols.student_id}, ${cols.student_name}, ${cols.status}, ${cols.approved_at}`
      )
      .limit(1);

    if (error) {
      setMainMsg(
        `club_applications 테이블 컬럼이 부족합니다. (필요: student_id, student_name) 현재 에러: ${error.message}`
      );
      return null;
    }

    setAppCols(cols);
    return cols;
  };

  const pad2 = (n) => String(n).padStart(2, "0");
  const toYmd = (d) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseYmdLocal = (ymd) => {
    const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const formatYmdDot = (ymd) => {
    const d = parseYmdLocal(ymd);
    if (!d) return "";
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  };
  const formatDdayLabel = (ymd) => {
    const target = parseYmdLocal(ymd);
    if (!target) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs = 24 * 60 * 60 * 1000;
    const diff = Math.round((target.getTime() - today.getTime()) / dayMs);
    if (diff === 0) return "D-Day";
    if (diff > 0) return `D-${diff}`;
    return `D+${Math.abs(diff)}`;
  };
  const addDaysYmd = (ymd, addDays) => {
    if (!ymd) return null;
    const [yy, mm, dd] = String(ymd).split("-").map((x) => Number(x));
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd))
      return null;
    const d = new Date(yy, mm - 1, dd);
    d.setDate(d.getDate() + Number(addDays || 0));
    return toYmd(d);
  };

  const ymdToDate = (ymd) => {
    const [yy, mm, dd] = String(ymd || "").split("-").map((x) => Number(x));
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd))
      return null;
    return new Date(yy, mm - 1, dd);
  };

  const isWeekendYmd = (ymd) => {
    const d = ymdToDate(ymd);
    if (!d) return false;
    const day = d.getDay(); // 0 Sun, 6 Sat
    return day === 0 || day === 6;
  };

  const getVLeagueExcludeDates = useCallback(
    (leagueKey) =>
      leagueKey === "goun"
        ? vLeagueExcludeDatesByLeague.goun || []
        : vLeagueExcludeDatesByLeague.malgeun || [],
    [vLeagueExcludeDatesByLeague]
  );

  const vLeagueCurrentExcludeDates = useMemo(
    () => getVLeagueExcludeDates(vLeagueGradeTab),
    [getVLeagueExcludeDates, vLeagueGradeTab]
  );
  const vLeagueExcludedDateSetByLeague = useMemo(() => {
    const toSet = (list) => {
      const set = new Set();
      for (const ymd of list || []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) set.add(String(ymd));
      }
      return set;
    };
    return {
      malgeun: toSet(vLeagueExcludeDatesByLeague.malgeun),
      goun: toSet(vLeagueExcludeDatesByLeague.goun),
    };
  }, [vLeagueExcludeDatesByLeague]);

  const getVLeagueExcludedDateSet = useCallback(
    (leagueKey) =>
      leagueKey === "goun"
        ? vLeagueExcludedDateSetByLeague.goun
        : vLeagueExcludedDateSetByLeague.malgeun,
    [vLeagueExcludedDateSetByLeague]
  );

  const vLeagueCurrentExcludedDateSet = useMemo(
    () => getVLeagueExcludedDateSet(vLeagueGradeTab),
    [getVLeagueExcludedDateSet, vLeagueGradeTab]
  );

  const toggleVLeagueExcludeDate = (leagueKey, ymd) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return;
    setVLeagueExcludeDatesByLeague((prev) => {
      const key = leagueKey === "goun" ? "goun" : "malgeun";
      const set = new Set(prev?.[key] || []);
      if (set.has(ymd)) set.delete(ymd);
      else set.add(ymd);
      return {
        malgeun: prev?.malgeun || [],
        goun: prev?.goun || [],
        [key]: Array.from(set).sort(),
      };
    });
  };

  const buildMonthCells = (monthDate) => {
    const start = monthStart(monthDate);
    const end = monthEnd(monthDate);
    const firstDow = start.getDay(); // 0 Sun
    const daysInMonth = end.getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push(new Date(start.getFullYear(), start.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  };

  const nextPlayableYmd = (ymd, leagueKey = vLeagueGradeTab) => {
    const excluded = getVLeagueExcludedDateSet(leagueKey);
    let cur = ymd;
    // 안전장치: 무한루프 방지(최대 366번 스킵)
    for (let i = 0; i < 366; i += 1) {
      if (!cur) return null;
      if (isWeekendYmd(cur)) {
        cur = addDaysYmd(cur, 1);
        continue;
      }
      if (excluded.has(cur)) {
        cur = addDaysYmd(cur, 1);
        continue;
      }
      return cur;
    }
    return cur;
  };

  const nextPlayableYmdPromotion = useCallback(
    (ymd) => {
      const malgeunExcluded = getVLeagueExcludedDateSet("malgeun");
      const gounExcluded = getVLeagueExcludedDateSet("goun");
      let cur = ymd;
      for (let i = 0; i < 366; i += 1) {
        if (!cur) return null;
        if (isWeekendYmd(cur)) {
          cur = addDaysYmd(cur, 1);
          continue;
        }
        if (malgeunExcluded.has(cur) || gounExcluded.has(cur)) {
          cur = addDaysYmd(cur, 1);
          continue;
        }
        return cur;
      }
      return cur;
    },
    [getVLeagueExcludedDateSet]
  );

  const formatVLeagueMatchToken = (matchId) =>
    matchId ? ` ⟦vm:${matchId}⟧` : "";

  const getVLeagueLabel = (leagueKey) =>
    leagueKey === "malgeun" ? "맑은샘" : "고운샘";

  const formatVLeagueEventContent = (m, clubIdForNameMap) => {
    const homeName = vLeagueScheduleTeamLabelById[m.home_class_id] || "학급";
    const awayName = vLeagueScheduleTeamLabelById[m.away_class_id] || "학급";
    const leagueLabel = getVLeagueLabel(m.league);
    return `[${leagueLabel}] ${homeName} vs ${awayName}${formatVLeagueMatchToken(
      m.id
    )}`;
  };

  // 화면 표시용: 중복 정리용 내부 토큰은 숨긴다.
  const formatEventContentForDisplay = (content) =>
    String(content || "")
      .replace(/\s*⟦vm:[^⟧]+⟧/g, "")
      .trim();

  const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  const loadEventsForMonth = async (clubIdsOrId, monthDate) => {
    setEventLoading(true);
    const start = monthStart(monthDate);
    const end = monthEnd(monthDate);
    const startYmd = toYmd(start);
    const endYmd = toYmd(end);
    const clubIds = Array.isArray(clubIdsOrId)
      ? clubIdsOrId.filter(Boolean)
      : [clubIdsOrId].filter(Boolean);
    if (clubIds.length === 0) {
      setEventsByDate({});
      setEventLoading(false);
      return;
    }

    let query = supabase
      .from("club_events")
      .select("id, event_date, content")
      .gte("event_date", startYmd)
      .lte("event_date", endYmd)
      .order("event_date", { ascending: true });
    if (clubIds.length === 1) {
      query = query.eq("club_id", clubIds[0]);
    } else {
      query = query.in("club_id", clubIds);
    }
    const { data, error } = await query;

    if (error) {
      setMainMsg(`일정 로딩 실패: ${error.message}`);
      setEventsByDate({});
      setEventLoading(false);
      return;
    }

    const next = {};
    for (const row of data || []) {
      const ymd = row.event_date;
      if (!next[ymd]) next[ymd] = [];
      next[ymd].push({ id: row.id, content: row.content });
    }
    setEventsByDate(next);
    setEventLoading(false);
  };

  const ensureClubEventsLoaded = async (clubName, monthDate) => {
    if (isVLeagueClub(clubName)) {
      const clubIds = getClubsByName(V_LEAGUE_LABEL)
        .map((c) => c?.id)
        .filter(Boolean);
      if (clubIds.length === 0) return;
      await loadEventsForMonth(clubIds, monthDate);
      return;
    }
    const club = getClubByName(clubName);
    if (!club) return;
    await loadEventsForMonth(club.id, monthDate);
  };

  const loadHomeTournamentDates = useCallback(async () => {
    const clubIds = (clubs || []).map((c) => c?.id).filter(Boolean);
    if (clubIds.length === 0) {
      setHomeTournamentYmdByClubId({});
      return;
    }
    const { data, error } = await supabase
      .from("club_events")
      .select("club_id, event_date, content")
      .in("club_id", clubIds)
      .order("event_date", { ascending: true })
      .limit(2000);
    if (error) {
      setHomeTournamentYmdByClubId({});
      return;
    }
    const todayYmd = toYmd(new Date());
    const grouped = new Map();
    for (const row of data || []) {
      const clubId = row?.club_id;
      const ymd = String(row?.event_date || "").slice(0, 10);
      const content = String(row?.content || "").trim();
      if (!clubId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      if (!content.includes("대회")) continue;
      if (!grouped.has(clubId)) grouped.set(clubId, []);
      grouped.get(clubId).push(ymd);
    }
    const next = {};
    for (const clubId of clubIds) {
      const list = grouped.get(clubId) || [];
      if (list.length === 0) continue;
      const upcoming = list.find((ymd) => ymd >= todayYmd);
      next[clubId] = upcoming || list[list.length - 1];
    }
    setHomeTournamentYmdByClubId(next);
  }, [clubs]);

  const handleCalendarPrev = async () => {
    const prev = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    setCalendarMonth(prev);
    if (page.type === "clubMain" && page.clubName) {
      await ensureClubEventsLoaded(page.clubName, prev);
    }
  };

  const handleCalendarNext = async () => {
    const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    setCalendarMonth(next);
    if (page.type === "clubMain" && page.clubName) {
      await ensureClubEventsLoaded(page.clubName, next);
    }
  };

  const handleSelectDay = (d) => {
    setSelectedDate(d);
    if (canCurrentTeacherEditSchedule(page.clubName) && clubTab === "schedule") {
      const ymd = toYmd(d);
      setEventEditorOpen(true);
      setEventEditorDate(ymd);
    }
  };

  const parseHomeroom = (studentId) => {
    const s = String(studentId || "");
    if (!/^\d{6}$/.test(s)) return null;
    const grade = Number(s.slice(0, 2));
    const cls = Number(s.slice(2, 4));
    return { grade, cls };
  };

  const formatHomeroom = (studentId) => {
    const parsed = parseHomeroom(studentId);
    if (!parsed) return "-";
    return `${parsed.grade}학년 ${parsed.cls}반`;
  };

  const formatDateTimeCompact = (isoLike) => {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return String(isoLike || "");
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours()
    )}:${pad2(d.getMinutes())}`;
  };

  const formatYmdKorean = (ymd) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return String(ymd || "");
    return `${Number(m[2])}월 ${Number(m[3])}일`;
  };

  const loadApprovedStudents = async (clubId) => {
    const cols = await detectApplicationColumns();
    if (!cols) return [];
    const { data, error } = await supabase
      .from("club_applications")
      .select(`${cols.student_id}, ${cols.student_name}`)
      .eq(cols.club_id, clubId)
      .eq(cols.status, "approved")
      .order(cols.student_id, { ascending: true });

    if (error) {
      setMainMsg(`승인 학생 목록 로딩 실패: ${error.message}`);
      setApprovedStudents([]);
      return [];
    }

    const next = (data || []).map((r) => ({
      student_id: r[cols.student_id],
      student_name: r[cols.student_name],
    }));
    setApprovedStudents(next);
    return next;
  };

  const loadAttendance = async (clubId, ymd) => {
    setAttendanceLoading(true);
    const { data, error } = await supabase
      .from("club_attendance")
      .select("student_id, present")
      .eq("club_id", clubId)
      .eq("att_date", ymd);

    if (error) {
      setMainMsg(`출석 로딩 실패: ${error.message}`);
      setAttendanceByStudentId({});
      setAttendanceLoaded(false);
      setAttendanceLoading(false);
      return;
    }

    const next = {};
    for (const row of data || []) {
      next[row.student_id] = Boolean(row.present);
    }
    setAttendanceByStudentId(next);
    setAttendanceLoaded(true);
    setAttendanceLoading(false);
  };

  const setAttendance = async (clubId, ymd, studentId, present) => {
    setMainMsg("");
    const { data: existing, error: checkError } = await supabase
      .from("club_attendance")
      .select("id")
      .eq("club_id", clubId)
      .eq("att_date", ymd)
      .eq("student_id", studentId)
      .maybeSingle();

    if (checkError) {
      setMainMsg(`출석 확인 실패: ${checkError.message}`);
      return;
    }

    if (existing?.id) {
      const { error } = await supabase
        .from("club_attendance")
        .update({
          present,
          marked_at: new Date().toISOString(),
          marked_by: currentUser?.name || null,
        })
        .eq("id", existing.id);
      if (error) {
        setMainMsg(`출석 저장 실패: ${error.message}`);
        return;
      }
    } else {
      const { error } = await supabase.from("club_attendance").insert([
        {
          club_id: clubId,
          att_date: ymd,
          student_id: studentId,
          present,
          marked_at: new Date().toISOString(),
          marked_by: currentUser?.name || null,
        },
      ]);
      if (error) {
        setMainMsg(`출석 저장 실패: ${error.message}`);
        return;
      }
    }

    setAttendanceByStudentId((prev) => ({ ...prev, [studentId]: present }));
  };

  const formatTimeMs = (ms) => {
    if (ms == null) return "-";
    return (Number(ms) / 1000).toFixed(3);
  };

  const loadStackingRecords = async (clubId, type) => {
    const { data, error } = await supabase
      .from("stacking_records")
      .select(
        "id, created_at, student_id, student_name, event_type, time_ms, photo_url"
      )
      .eq("club_id", clubId)
      .eq("event_type", type)
      .order("time_ms", { ascending: true })
      .limit(50);

    if (error) {
      setMainMsg(`기록 로딩 실패: ${error.message}`);
      setStackingRecords([]);
      return;
    }
    setStackingRecords(data || []);
  };

  const handleSaveStackingRecord = async () => {
    setMainMsg("");
    if (!currentUser || currentUser.role !== "student") {
      setMainMsg("학생만 기록을 등록할 수 있습니다.");
      return;
    }
    if (!isSportStackingClub(page.clubName)) {
      setMainMsg("스포츠 스태킹 종목에서만 기록을 등록할 수 있습니다.");
      return;
    }

    const club = getClubByName(page.clubName);
    if (!club) {
      setMainMsg("클럽 정보를 찾을 수 없습니다.");
      return;
    }

    const secs = Number(stackingTime);
    if (!Number.isFinite(secs) || secs <= 0) {
      setMainMsg("기록(초)을 올바르게 입력해 주세요.");
      return;
    }
    const timeMs = Math.round(secs * 1000);

    setStackingSaving(true);
    let photoUrl = null;
    try {
      if (stackingPhoto) {
        const ext = (stackingPhoto.name.split(".").pop() || "jpg").toLowerCase();
        const safeExt = ["png", "jpg", "jpeg", "webp"].includes(ext) ? ext : "jpg";
        const filePath = `${club.id}/${currentUser.id}/${Date.now()}.${safeExt}`;

        const bucketCandidates = Array.from(
          new Set([STACKING_PHOTO_BUCKET, "stacking-records", "stacking_records"].filter(Boolean))
        );
        let uploadedBucket = null;
        let uploadError = null;
        for (const bucketName of bucketCandidates) {
          const { error: upErr } = await supabase.storage
            .from(bucketName)
            .upload(filePath, stackingPhoto, { upsert: false });
          if (!upErr) {
            uploadedBucket = bucketName;
            uploadError = null;
            break;
          }
          uploadError = upErr;
          const isBucketMissing =
            String(upErr?.message || "").toLowerCase().includes("bucket not found") ||
            String(upErr?.statusCode || "") === "404";
          if (!isBucketMissing) break;
        }
        if (!uploadedBucket) {
          const isBucketMissing =
            String(uploadError?.message || "").toLowerCase().includes("bucket not found") ||
            String(uploadError?.statusCode || "") === "404";
          if (isBucketMissing) {
            setMainMsg(
              `사진 업로드용 버킷이 없습니다. Supabase Storage에 '${STACKING_PHOTO_BUCKET}' 버킷을 만들어 주세요.`
            );
          } else {
            setMainMsg(`사진 업로드 실패: ${uploadError?.message || "알 수 없는 오류"}`);
          }
          return;
        }

        const { data } = supabase.storage.from(uploadedBucket).getPublicUrl(filePath);
        photoUrl = data?.publicUrl || null;
      }

      const { error: deleteErr } = await supabase
        .from("stacking_records")
        .delete()
        .eq("club_id", club.id)
        .eq("student_id", currentUser.id)
        .eq("event_type", stackingType);
      if (deleteErr) {
        setMainMsg(`기존 기록 정리 실패: ${deleteErr.message}`);
        return;
      }

      const { error } = await supabase.from("stacking_records").insert([
        {
          club_id: club.id,
          student_id: currentUser.id,
          student_name: currentUser.name,
          event_type: stackingType,
          time_ms: timeMs,
          photo_url: photoUrl,
        },
      ]);

      if (error) {
        setMainMsg(`기록 저장 실패: ${error.message}`);
        return;
      }

      setStackingTime("");
      setStackingPhoto(null);
      setMainMsg("기록이 등록되었습니다.");
      await loadStackingRecords(club.id, stackingType);
    } finally {
      setStackingSaving(false);
    }
  };

  const handleAddEvent = async () => {
    setMainMsg("");
    if (!canCurrentTeacherEditSchedule(page.clubName)) {
      setMainMsg("해당 종목의 담당 교사만 일정을 추가할 수 있습니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) {
      setMainMsg("클럽 정보를 찾을 수 없습니다.");
      return;
    }
    if (!eventEditorDate) {
      setMainMsg("달력에서 날짜를 선택해 주세요.");
      return;
    }
    if (!newEventContent.trim()) {
      setMainMsg("활동 내용을 입력해 주세요.");
      return;
    }

    const { error } = await supabase.from("club_events").insert([
      {
        club_id: club.id,
        event_date: eventEditorDate,
        content: newEventContent.trim(),
        created_by: currentUser.name,
      },
    ]);

    if (error) {
      setMainMsg(`일정 저장 실패: ${error.message}`);
      return;
    }

    setNewEventContent("");
    setEventEditorOpen(false);
    setMainMsg("일정이 추가되었습니다.");
    await loadEventsForMonth(club.id, calendarMonth);
  };

  const handleDeleteEvent = async (eventId, ymd) => {
    setMainMsg("");
    if (!page.clubName) return;
    if (!canCurrentTeacherEditSchedule(page.clubName)) {
      setMainMsg("해당 종목의 담당 교사만 일정을 삭제할 수 있습니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club) {
      setMainMsg("클럽 정보를 찾을 수 없습니다.");
      return;
    }
    if (!eventId) return;
    if (!window.confirm("이 일정을 삭제할까요?")) return;

    const { error } = await supabase
      .from("club_events")
      .delete()
      .eq("id", eventId)
      .eq("club_id", club.id);
    if (error) {
      setMainMsg(`일정 삭제 실패: ${error.message}`);
      return;
    }
    setMainMsg("일정을 삭제했습니다.");
    const baseDate = parseYmdLocal(ymd) || calendarMonth;
    await loadEventsForMonth(club.id, baseDate);
  };

  const loadClubs = async () => {
    setLoadingClubData(true);
    const { data, error } = await supabase
      .from("clubs")
      .select("id, name, teacher_name");
    if (error) {
      setMainMsg(`클럽 목록 로딩 실패: ${error.message}`);
      setClubs([]);
      setLoadingClubData(false);
      return [];
    }
    const next = data || [];
    setClubs(next);
    setLoadingClubData(false);
    return next;
  };

  // 로그인 후 클럽 목록 불러오기
  useEffect(() => {
    const fetchClubs = async () => {
      if (!currentUser) return;
      await loadClubs();
    };
    fetchClubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // club_applications 컬럼명 자동 감지 (student_id가 없다는 에러 대응)
  useEffect(() => {
    if (!currentUser) return;
    detectApplicationColumns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // 학생 로그인 후: 내 신청 상태 미리 불러오기
  useEffect(() => {
    const fetchMyApplications = async () => {
      if (!currentUser || currentUser.role !== "student") return;
      const cols = await detectApplicationColumns();
      if (!cols) return;
      const { data, error } = await supabase
        .from("club_applications")
        .select(`id, ${cols.club_id}, ${cols.status}`)
        .eq(cols.student_id, currentUser.id);

      if (error) {
        setMainMsg(`내 신청 상태 로딩 실패: ${error.message}`);
        return;
      }
      const next = {};
      for (const row of data || []) {
        next[row[cols.club_id]] = {
          id: row.id,
          status: row[cols.status] || "pending",
        };
      }
      setMyAppByClubId(next);
    };
    fetchMyApplications();
  }, [currentUser]);

  const normalizeClubName = (name) => (name || "").replace(/\s+/g, "").trim();
  const normalizeTeacherName = (name) =>
    (name || "").replace(/\s+/g, "").trim();
  const splitTeacherNames = (teacherNameField) =>
    String(teacherNameField || "")
      .split(/[,/|]/)
      .map((s) => normalizeTeacherName(s))
      .filter(Boolean);
  const isTeacherAssignedToClubRow = (clubRow, teacherNameNorm) =>
    splitTeacherNames(clubRow?.teacher_name).includes(teacherNameNorm);

  const isSportStackingClub = (clubName) =>
    normalizeClubName(clubName) === normalizeClubName("스포츠 스태킹");

  const V_LEAGUE_LABEL = "새샘 V리그";
  const STACKING_PHOTO_BUCKET =
    String(import.meta.env.VITE_STACKING_PHOTO_BUCKET || "").trim() || "stacking-records";
  /** 동일 이름 클럽이 DB에 여러 개일 때, 실제 vleague_classes가 있는 클럽을 고릅니다. */
  const V_LEAGUE_PRIMARY_CLUB_ID =
    String(import.meta.env.VITE_VLEAGUE_PRIMARY_CLUB_ID || "").trim() ||
    "ac9e1c37-b2c7-4ab6-9c79-667da9325aa8";
  const V_LEAGUE_ADMIN_TEACHER_NAME = "홍준영";
  const vLeagueAdminNameNorm = normalizeTeacherName(V_LEAGUE_ADMIN_TEACHER_NAME);
  const isVLeagueAdmin =
    currentUser?.role === "teacher" &&
    normalizeTeacherName(currentUser?.name) === vLeagueAdminNameNorm;

  const getClubHeaderTitle = (clubName) => {
    if (!clubName) return "";
    if (normalizeClubName(clubName) === normalizeClubName("컬러풀 스포츠")) {
      return "여학생체육활성화 컬러풀 스포츠";
    }
    if (normalizeClubName(clubName) === normalizeClubName("티볼")) {
      return "365+체육온활동 티볼 스포츠클럽";
    }
    if (isVLeagueClub(clubName)) {
      return "교내 수준별스포츠리그 새샘 V리그";
    }
    return `${clubName} 스포츠클럽`;
  };

  /** select('*'): DB에 wins/losses/rank_order 컬럼이 없어도 조회가 실패하지 않게 함 */
  const loadVLeagueClasses = useCallback(async (clubIdsOrId) => {
    setVLeagueLoading(true);
    setVLeagueClassesError(null);
    const clubIds = Array.isArray(clubIdsOrId)
      ? clubIdsOrId.filter(Boolean)
      : [clubIdsOrId].filter(Boolean);
    if (clubIds.length === 0) {
      setVLeagueLoading(false);
      setVLeagueClasses([]);
      return;
    }
    let query = supabase
      .from("vleague_classes")
      .select("*")
      .order("sort_order", { ascending: true });
    if (clubIds.length === 1) {
      query = query.eq("club_id", clubIds[0]);
    } else {
      query = query.in("club_id", clubIds);
    }
    const { data, error } = await query;
    setVLeagueLoading(false);
    if (error) {
      const msg = error.message;
      setVLeagueClassesError(msg);
      setMainMsg(`참가 학급 로딩 실패: ${msg}`);
      setVLeagueClasses([]);
      return;
    }
    setVLeagueClassesError(null);
    setVLeagueClasses(data || []);
  }, []);

  const loadVLeagueStandings = async (clubIdsOrId) => {
    setVLeagueLoading(true);
    const clubIds = Array.isArray(clubIdsOrId)
      ? clubIdsOrId.filter(Boolean)
      : [clubIdsOrId].filter(Boolean);
    if (clubIds.length === 0) {
      setVLeagueLoading(false);
      setVLeagueStandings([]);
      return;
    }
    let query = supabase
      .from("vleague_standings")
      .select("id, rank_order, team_name, wins, losses, points")
      .order("rank_order", { ascending: true });
    if (clubIds.length === 1) {
      query = query.eq("club_id", clubIds[0]);
    } else {
      query = query.in("club_id", clubIds);
    }
    const { data, error } = await query;
    setVLeagueLoading(false);
    if (error) {
      setMainMsg(`순위표 로딩 실패: ${error.message}`);
      setVLeagueStandings([]);
      return;
    }
    setVLeagueStandings(data || []);
  };

  const loadVLeagueMatches = useCallback(async (clubIdsOrId) => {
    setVLeagueMatchesLoading(true);
    setVLeagueMatchesError(null);
    const clubIds = Array.isArray(clubIdsOrId)
      ? clubIdsOrId.filter(Boolean)
      : [clubIdsOrId].filter(Boolean);
    if (clubIds.length === 0) {
      setVLeagueMatchesLoading(false);
      setVLeagueMatches([]);
      return;
    }
    let query = supabase
      .from("vleague_matches")
      .select("*")
      .order("league", { ascending: true })
      .order("round_no", { ascending: true })
      .order("match_no", { ascending: true });
    if (clubIds.length === 1) {
      query = query.eq("club_id", clubIds[0]);
    } else {
      query = query.in("club_id", clubIds);
    }
    if (!isVLeagueAdmin) {
      query = query.eq("created_by", vLeagueAdminNameNorm);
    }
    const { data, error } = await query;
    setVLeagueMatchesLoading(false);
    if (error) {
      const msg = error.message;
      setVLeagueMatchesError(msg);
      setVLeagueMatches([]);
      return;
    }
    setVLeagueMatchesError(null);
    setVLeagueMatches(dedupeVLeagueMatchesByRound(data || []));
  }, [isVLeagueAdmin, vLeagueAdminNameNorm]);

  const loadVLeagueTournamentEvents = useCallback(
    async (clubIds, leagueKey) => {
      const ids = Array.isArray(clubIds)
        ? clubIds.filter(Boolean)
        : [clubIds].filter(Boolean);
      if (ids.length === 0) {
        setVLeagueTournamentEvents([]);
        return;
      }
      setVLeagueTournamentLoading(true);
      const marker = `[토너먼트][${getVLeagueLabel(leagueKey)}]`;
      const { data, error } = await supabase
        .from("club_events")
        .select("id, club_id, event_date, content")
        .in("club_id", ids)
        .ilike("content", `%${marker}%`)
        .order("event_date", { ascending: true });
      setVLeagueTournamentLoading(false);
      if (error) {
        setMainMsg(`토너먼트 일정 로딩 실패: ${error.message}`);
        setVLeagueTournamentEvents([]);
        return;
      }
      setVLeagueTournamentEvents(data || []);
    },
    [setMainMsg]
  );

  const loadVLeaguePromotionEvents = useCallback(async (clubIds) => {
    const ids = Array.isArray(clubIds)
      ? clubIds.filter(Boolean)
      : [clubIds].filter(Boolean);
    if (ids.length === 0) {
      setVLeaguePromotionEvents([]);
      return;
    }
    setVLeaguePromotionLoading(true);
    const { data, error } = await supabase
      .from("club_events")
      .select("id, club_id, event_date, content")
      .in("club_id", ids)
      .ilike("content", `${PROMOTION_EVENT_MARKER}%`)
      .order("event_date", { ascending: true });
    setVLeaguePromotionLoading(false);
    if (error) {
      setMainMsg(`승강전 일정 로딩 실패: ${error.message}`);
      setVLeaguePromotionEvents([]);
      return;
    }
    setVLeaguePromotionEvents(data || []);
  }, [setMainMsg]);

  const parseTournamentTeams = useCallback(
    (content) => parseTournamentTeamsFromContent(content),
    []
  );

  const parseTournamentSavedScore = useCallback((content) => {
    const c = String(content || "");
    const withWin = c.match(/승리점수\s*(\d+)\s*\|\s*결과\s*(\d+)\s*:\s*(\d+)/);
    if (withWin) {
      return { winScore: withWin[1], home: withWin[2], away: withWin[3] };
    }
    const m = c.match(/결과\s*(\d+)\s*:\s*(\d+)/);
    if (!m) return null;
    return { home: m[1], away: m[2] };
  }, []);

  const buildTournamentResultContent = useCallback(
    (content, winScore, homeScore, awayScore) => {
      const base = stripTournamentResultSuffix(content);
      const teams = parseTournamentTeams(base);
      let winnerText = "";
      if (teams) {
        const homeWin =
          Number(homeScore) === Number(winScore) &&
          Number(awayScore) !== Number(winScore);
        const winner = homeWin ? teams.home : teams.away;
        winnerText = ` | 승리팀 ${winner}`;
      }
      return `${base} | 승리점수 ${winScore} | 결과 ${homeScore}:${awayScore}${winnerText}`.trim();
    },
    [parseTournamentTeams]
  );

  const handleSaveVLeagueTournamentResult = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const draft = vLeagueTournamentResultDrafts[row.id] || {};
      const saved = parseTournamentSavedScore(row.content) || {};
      const homeRaw = draft.home ?? saved.home ?? "";
      const awayRaw = draft.away ?? saved.away ?? "";
      const winRaw = draft.winScore ?? saved.winScore ?? "";
      const homeScore = Number(homeRaw);
      const awayScore = Number(awayRaw);
      const winScore = Number(winRaw);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
        setMainMsg("점수를 숫자로 입력해 주세요.");
        return;
      }
      if (!Number.isFinite(winScore) || winScore <= 0) {
        setMainMsg("경기별 승리 점수를 1 이상 숫자로 입력해 주세요.");
        return;
      }
      if (homeScore < 0 || awayScore < 0) {
        setMainMsg("점수는 0 이상이어야 합니다.");
        return;
      }
      const homeWin = homeScore === winScore && awayScore !== winScore;
      const awayWin = awayScore === winScore && homeScore !== winScore;
      if (!homeWin && !awayWin) {
        setMainMsg("한 팀만 '승리 점수'에 도달해야 결과를 저장할 수 있습니다.");
        return;
      }
      const nextContent = buildTournamentResultContent(
        row.content,
        winScore,
        homeScore,
        awayScore
      );
      setVLeagueTournamentResultSavingId(row.id);
      try {
        const { error } = await supabase
          .from("club_events")
          .update({ content: nextContent })
          .eq("id", row.id);
        if (error) {
          setMainMsg(`토너먼트 결과 저장 실패: ${error.message}`);
          return;
        }
        setVLeagueTournamentEvents((prev) =>
          (prev || []).map((ev) =>
            ev.id === row.id ? { ...ev, content: nextContent } : ev
          )
        );
        setHomeVLeagueTournamentEvents((prev) =>
          (prev || []).map((ev) =>
            ev.id === row.id ? { ...ev, content: nextContent } : ev
          )
        );
        const winnerSide = homeWin ? "home" : "away";
        const sparkSlot = getBracketSparkSlotFromEvent(row.content, winnerSide);
        if (sparkSlot) setBracketSparkSlot(sparkSlot);
        setVLeagueTournamentResultDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setMainMsg("토너먼트 경기 결과를 저장했습니다.");
        await loadVLeagueTodayMatchTextRef.current();
      } finally {
        setVLeagueTournamentResultSavingId(null);
      }
    },
    [
      isVLeagueAdmin,
      vLeagueTournamentResultDrafts,
      parseTournamentSavedScore,
      buildTournamentResultContent,
      setMainMsg,
    ]
  );

  const handleDeleteVLeagueTournamentEvent = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const ok = window.confirm("이 토너먼트 일정을 삭제할까요?");
      if (!ok) return;
      const vClubIds = Array.from(
        new Set(
          (clubs || [])
            .filter(
              (c) =>
                normalizeClubName(c?.name) === normalizeClubName(V_LEAGUE_LABEL)
            )
            .map((c) => c?.id)
            .filter(Boolean)
        )
      );
      setVLeagueTournamentDeletingId(row.id);
      try {
        const { error } = await supabase.from("club_events").delete().eq("id", row.id);
        if (error) {
          setMainMsg(`토너먼트 일정 삭제 실패: ${error.message}`);
          return;
        }
        setVLeagueTournamentEvents((prev) => (prev || []).filter((ev) => ev.id !== row.id));
        setMainMsg("토너먼트 일정을 삭제했습니다.");
        await loadVLeagueTournamentEvents(vClubIds, vLeagueGradeTab);
        await loadEventsForMonth(vClubIds, calendarMonth);
      } finally {
        setVLeagueTournamentDeletingId(null);
      }
    },
    [
      isVLeagueAdmin,
      clubs,
      normalizeClubName,
      loadVLeagueTournamentEvents,
      vLeagueGradeTab,
      loadEventsForMonth,
      calendarMonth,
    ]
  );

  const handlePostponeVLeagueTournamentEvent = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const ok = window.confirm("이 토너먼트 일정을 맨 뒤 날짜로 미룰까요?");
      if (!ok) return;
      const vClubIds = Array.from(
        new Set(
          (clubs || [])
            .filter(
              (c) =>
                normalizeClubName(c?.name) === normalizeClubName(V_LEAGUE_LABEL)
            )
            .map((c) => c?.id)
            .filter(Boolean)
        )
      );
      const clubId = vClubIds[0];
      if (!clubId) {
        setMainMsg("새샘 V리그 club_id를 찾지 못했습니다.");
        return;
      }
      setVLeagueTournamentPostponingId(row.id);
      try {
        const maxDate = (vLeagueTournamentEvents || [])
          .map((ev) => String(ev.event_date || ""))
          .filter(Boolean)
          .sort()
          .pop();
        let cand = nextPlayableYmd(
          addDaysYmd(maxDate || row.event_date || toYmd(new Date()), 1),
          vLeagueGradeTab
        );
        let nextDate = cand;
        for (let i = 0; i < 366; i += 1) {
          if (!nextDate) break;
          const { data, error } = await supabase
            .from("club_events")
            .select("id")
            .eq("club_id", clubId)
            .eq("event_date", nextDate)
            .limit(1);
          if (error) {
            setMainMsg(`일정 충돌 확인 실패: ${error.message}`);
            return;
          }
          if ((data || []).length === 0) break;
          cand = nextPlayableYmd(addDaysYmd(nextDate, 1), vLeagueGradeTab);
          nextDate = cand;
        }
        if (!nextDate) {
          setMainMsg("다음 가능한 날짜를 찾지 못했습니다.");
          return;
        }
        const { error: upErr } = await supabase
          .from("club_events")
          .update({ event_date: nextDate })
          .eq("id", row.id);
        if (upErr) {
          setMainMsg(`토너먼트 일정 이동 실패: ${upErr.message}`);
          return;
        }
        setMainMsg(`일정을 ${nextDate}로 뒤로 미뤘습니다.`);
        await loadVLeagueTournamentEvents(vClubIds, vLeagueGradeTab);
        await loadEventsForMonth(vClubIds, calendarMonth);
      } finally {
        setVLeagueTournamentPostponingId(null);
      }
    },
    [
      isVLeagueAdmin,
      clubs,
      normalizeClubName,
      vLeagueTournamentEvents,
      nextPlayableYmd,
      addDaysYmd,
      vLeagueGradeTab,
      loadVLeagueTournamentEvents,
      loadEventsForMonth,
      calendarMonth,
    ]
  );

  const getClubByName = (name) => {
    const n = normalizeClubName(name);
    if (!n) return null;
    const matches = clubs.filter(
      (club) => normalizeClubName(club.name) === n
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    if (n === normalizeClubName(V_LEAGUE_LABEL)) {
      const pref = matches.find((c) => c.id === V_LEAGUE_PRIMARY_CLUB_ID);
      if (pref) return pref;
    }
    return matches[0];
  };

  const getClubsByName = (name) => {
    const n = normalizeClubName(name);
    return clubs.filter((club) => normalizeClubName(club.name) === n);
  };

  const getVLeagueClubIds = useCallback(
    () =>
      Array.from(
        new Set(
          getClubsByName(V_LEAGUE_LABEL)
            .map((c) => c?.id)
            .filter(Boolean)
        )
      ),
    [clubs]
  );

  const loadHomeVLeagueTournamentEvents = useCallback(async () => {
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) {
      setHomeVLeagueTournamentEvents([]);
      return;
    }
    setHomeVLeagueTournamentLoading(true);
    const { data, error } = await supabase
      .from("club_events")
      .select("id, club_id, event_date, content")
      .in("club_id", vClubIds)
      .ilike("content", "[토너먼트]%")
      .order("event_date", { ascending: true });
    setHomeVLeagueTournamentLoading(false);
    if (error) {
      setMainMsg(`토너먼트 진행표 로딩 실패: ${error.message}`);
      setHomeVLeagueTournamentEvents([]);
      return;
    }
    setHomeVLeagueTournamentEvents(data || []);
  }, [getVLeagueClubIds]);

  const myStudentClassName = useMemo(
    () => formatClassNameFromStudentId(currentUser?.id),
    [currentUser?.id]
  );

  /** Supabase clubs.name 과 앱 표기가 조금 달라도 같은 행이면 V리그로 인식 */
  const isVLeagueClub = (clubName) => {
    if (!clubName) return false;
    if (normalizeClubName(clubName) === normalizeClubName(V_LEAGUE_LABEL)) {
      return true;
    }
    const current = getClubByName(clubName);
    const ref = getClubByName(V_LEAGUE_LABEL);
    return Boolean(current && ref && current.id === ref.id);
  };

  /** 참가 학급 탭: 클럽 목록이 늦게 로드되거나 탭만 바뀐 경우에도 다시 조회 */
  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vClasses") return;
    if (!isVLeagueClub(page.clubName)) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueClasses(vClubIds);
  }, [page.type, page.clubName, clubTab, clubs, loadVLeagueClasses]);

  /** 대진표 탭: 기존 대진표 로드 */
  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vMatches") return;
    if (!isVLeagueClub(page.clubName)) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueClasses(vClubIds);
    loadVLeagueMatches(vClubIds);
  }, [
    page.type,
    page.clubName,
    clubTab,
    clubs,
    loadVLeagueClasses,
    loadVLeagueMatches,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vTournament") return;
    if (!isVLeagueClub(page.clubName) || !isVLeagueAdmin) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueTournamentEvents(vClubIds, vLeagueGradeTab);
  }, [
    page.type,
    clubTab,
    page.clubName,
    clubs,
    vLeagueGradeTab,
    isVLeagueAdmin,
    loadVLeagueTournamentEvents,
    getVLeagueClubIds,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vPromotion") return;
    if (!isVLeagueClub(page.clubName) || !isVLeagueAdmin) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeaguePromotionEvents(vClubIds);
    loadHomeVLeagueTournamentEvents();
  }, [
    page.type,
    clubTab,
    page.clubName,
    clubs,
    isVLeagueAdmin,
    loadVLeaguePromotionEvents,
    loadHomeVLeagueTournamentEvents,
    getVLeagueClubIds,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain") return;
    if (!isVLeagueClub(page.clubName)) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueClasses(vClubIds);
    loadVLeagueMatches(vClubIds);
    loadHomeVLeagueTournamentEvents();
  }, [
    page.type,
    page.clubName,
    clubs,
    loadVLeagueClasses,
    loadVLeagueMatches,
    loadHomeVLeagueTournamentEvents,
    getVLeagueClubIds,
  ]);

  useEffect(() => {
    if (page.type !== "home") return;
    if (!isVLeagueClub(selectedClubName)) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueClasses(vClubIds);
    loadVLeagueMatches(vClubIds);
    loadHomeVLeagueTournamentEvents();
  }, [
    page.type,
    selectedClubName,
    clubs,
    loadVLeagueClasses,
    loadVLeagueMatches,
    loadHomeVLeagueTournamentEvents,
    getVLeagueClubIds,
  ]);

  const vleagueClassNameById = useMemo(() => {
    const map = {};
    for (const row of vLeagueClasses || []) {
      map[row.id] = row.class_name;
    }
    return map;
  }, [vLeagueClasses]);

  const vLeagueScheduleTeamLabelById = useMemo(() => {
    const map = {};
    for (const row of vLeagueClasses || []) {
      const classLabel = shortClassLabel(row.class_name || "학급");
      const nickname = String(row.nickname || "").trim();
      map[row.id] = nickname ? `${nickname}(${classLabel})` : classLabel;
    }
    return map;
  }, [vLeagueClasses]);

  const vLeagueScheduleClassFilterOptions = useMemo(() => {
    const out = [];
    for (let c = 1; c <= 8; c += 1) out.push(`5-${c}`);
    for (let c = 1; c <= 7; c += 1) out.push(`6-${c}`);
    return out;
  }, []);

  const vLeagueScheduleHighlightDateSet = useMemo(() => {
    if (!vLeagueScheduleClassFilterEnabled || !vLeagueScheduleClassFilter) return new Set();
    const set = new Set();
    for (const m of vLeagueMatches || []) {
      if (!m?.match_date) continue;
      const homeLabel = shortClassLabel(vleagueClassNameById[m.home_class_id] || "");
      const awayLabel = shortClassLabel(vleagueClassNameById[m.away_class_id] || "");
      if (homeLabel === vLeagueScheduleClassFilter || awayLabel === vLeagueScheduleClassFilter) {
        set.add(String(m.match_date).slice(0, 10));
      }
    }
    return set;
  }, [
    vLeagueScheduleClassFilterEnabled,
    vLeagueScheduleClassFilter,
    vLeagueMatches,
    vleagueClassNameById,
  ]);

  useEffect(() => {
    if (!vLeagueScheduleFilterMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (!vLeagueScheduleFilterMenuRef.current) return;
      if (!vLeagueScheduleFilterMenuRef.current.contains(e.target)) {
        setVLeagueScheduleFilterMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [vLeagueScheduleFilterMenuOpen]);

  const vLeagueCurrentLeagueMatches = useMemo(() => {
    return (vLeagueMatches || [])
      .filter((m) => m.league === vLeagueGradeTab && Boolean(m.id))
      .sort((a, b) => {
        const ad = String(a.match_date || "");
        const bd = String(b.match_date || "");
        if (ad !== bd) return ad.localeCompare(bd);
        if ((a.round_no || 0) !== (b.round_no || 0)) {
          return (a.round_no || 0) - (b.round_no || 0);
        }
        return (a.match_no || 0) - (b.match_no || 0);
      });
  }, [vLeagueMatches, vLeagueGradeTab]);

  const vLeagueMatchById = useMemo(() => {
    const map = new Map();
    for (const m of vLeagueMatches || []) map.set(m.id, m);
    return map;
  }, [vLeagueMatches]);

  const vLeagueRefereeAssignmentsByMatch = useMemo(() => {
    const map = new Map();
    for (const a of vLeagueRefereeAssignments || []) {
      if (!a?.match_id) continue;
      if (!map.has(a.match_id)) map.set(a.match_id, []);
      map.get(a.match_id).push(a);
    }
    return map;
  }, [vLeagueRefereeAssignments]);

  const vLeagueScheduleRefLookupDateSet = useMemo(() => {
    const sid = String(vLeagueScheduleRefLookupStudentId || "").replace(/\D/g, "");
    if (!sid) return new Set();
    const ownHomeroom = parseHomeroomFromStudentId(sid);
    const ownClassLabel = ownHomeroom
      ? `${Number(ownHomeroom.grade)}-${Number(ownHomeroom.cls)}`
      : null;
    const set = new Set();
    for (const a of vLeagueRefereeAssignments || []) {
      if (String(a?.student_id || "") !== sid) continue;
      const m = vLeagueMatchById.get(a.match_id);
      if (!m) continue;
      const ymd = String(m.match_date || "");
      if (!ymd) continue;
      const home = shortClassLabel(vleagueClassNameById[m.home_class_id] || "학급");
      const away = shortClassLabel(vleagueClassNameById[m.away_class_id] || "학급");
      if (ownClassLabel && (home === ownClassLabel || away === ownClassLabel)) continue;
      set.add(ymd);
    }
    return set;
  }, [
    vLeagueScheduleRefLookupStudentId,
    vLeagueRefereeAssignments,
    vLeagueMatchById,
    vleagueClassNameById,
  ]);

  const handleRunRefereeLookup = useCallback(() => {
    const sid = String(vLeagueScheduleRefLookupDraft || "").replace(/\D/g, "");
    if (sid.length < 6) {
      setMainMsg("배정심판 조회는 학번 6자리를 입력해 주세요.");
      return;
    }
    setMainMsg("");
    setVLeagueScheduleRefLookupStudentId(sid);
  }, [vLeagueScheduleRefLookupDraft]);

  const handleResetRefereeLookup = useCallback(() => {
    setMainMsg("");
    setVLeagueScheduleRefLookupDraft("");
    setVLeagueScheduleRefLookupStudentId("");
  }, []);

  const getRefereeRoleLabel = (role) => {
    return "심판";
  };

  const getRefereeSummaryByMatchId = useCallback(
    (matchId) => {
      if (!matchId) return "";
      const rows = vLeagueRefereeAssignmentsByMatch.get(matchId) || [];
      if (rows.length === 0) return "";
      const names = rows
        .map((r) => String(r?.student_name || "").trim())
        .filter(Boolean)
        .slice(0, 3);
      if (names.length === 0) return "";
      return `심판 ${names.join(", ")}`;
    },
    [vLeagueRefereeAssignmentsByMatch]
  );

  const getComputedStandingsByLeague = useCallback(
    (leagueKey) => {
      const { malgeun, goun } = splitVLeagueClassesByGrade(vLeagueClasses || []);
      const classes = leagueKey === "malgeun" ? malgeun : goun;
      const teamMap = new Map();
      for (const cls of classes) {
        const nickname = String(cls.nickname || "").trim();
        const classLabel = shortClassLabel(cls.class_name || "학급");
        const displayName = nickname
          ? `${nickname}(${classLabel})`
          : classLabel;
        teamMap.set(cls.id, {
          class_id: cls.id,
          team_name: displayName,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          goals_for: 0,
          goals_against: 0,
          goal_diff: 0,
          h2h_wins: 0,
        });
      }
      const matches = (vLeagueMatches || []).filter(
        (m) =>
          m.league === leagueKey &&
          m.status === "completed" &&
          m.home_score != null &&
          m.away_score != null
      );
      for (const m of matches) {
        const home = teamMap.get(m.home_class_id);
        const away = teamMap.get(m.away_class_id);
        if (!home || !away) continue;
        const hs = Number(m.home_score);
        const as = Number(m.away_score);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        home.goals_for += hs;
        home.goals_against += as;
        away.goals_for += as;
        away.goals_against += hs;
        if (hs > as) {
          home.wins += 1;
          home.points += 3;
          away.losses += 1;
        } else if (hs < as) {
          away.wins += 1;
          away.points += 3;
          home.losses += 1;
        } else {
          home.draws += 1;
          away.draws += 1;
          home.points += 1;
          away.points += 1;
        }
      }
      const rows = [...teamMap.values()].map((row) => ({
        ...row,
        goal_diff: row.goals_for - row.goals_against,
      }));

      // 동률(승점+득실차) 그룹에서만 승자승을 계산
      const tieGroups = new Map();
      for (const row of rows) {
        const k = `${row.points}|${row.goal_diff}`;
        if (!tieGroups.has(k)) tieGroups.set(k, []);
        tieGroups.get(k).push(row.class_id);
      }
      const classToTieSet = new Map();
      for (const ids of tieGroups.values()) {
        if (ids.length < 2) continue;
        const set = new Set(ids);
        for (const id of ids) classToTieSet.set(id, set);
      }

      for (const m of matches) {
        const hs = Number(m.home_score);
        const as = Number(m.away_score);
        if (!Number.isFinite(hs) || !Number.isFinite(as) || hs === as) continue;
        const homeTie = classToTieSet.get(m.home_class_id);
        const awayTie = classToTieSet.get(m.away_class_id);
        if (!homeTie || !awayTie || homeTie !== awayTie) continue;
        const winnerId = hs > as ? m.home_class_id : m.away_class_id;
        const winner = teamMap.get(winnerId);
        if (winner) winner.h2h_wins += 1;
      }

      return rows
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
          if (b.h2h_wins !== a.h2h_wins) return b.h2h_wins - a.h2h_wins;
          return String(a.team_name).localeCompare(String(b.team_name), "ko");
        })
        .map((row, idx) => ({ ...row, rank_order: idx + 1 }));
    },
    [vLeagueClasses, vLeagueMatches]
  );

  const vLeagueComputedStandings = useMemo(() => {
    const leagueRows = getComputedStandingsByLeague(vLeagueGradeTab);
    return getVLeagueDisplayStandings(
      vLeagueGradeTab,
      leagueRows,
      vLeagueMatches,
      homeVLeagueTournamentEvents
    );
  }, [
    getComputedStandingsByLeague,
    vLeagueGradeTab,
    vLeagueMatches,
    homeVLeagueTournamentEvents,
  ]);

  const vLeagueStandingsUsesTournament = useMemo(
    () =>
      (vLeagueComputedStandings || []).some(
        (row) => row.standings_source === "tournament"
      ),
    [vLeagueComputedStandings]
  );

  const homeTournamentBracketRows = useMemo(() => {
    const leagueLabel = getVLeagueLabel(vLeagueGradeTab);
    const list = (homeVLeagueTournamentEvents || [])
      .filter((ev) => String(ev.content || "").includes(`[토너먼트][${leagueLabel}]`))
      .sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")));
    const findBy = (k) => list.find((ev) => String(ev.content || "").includes(k)) || null;
    const toTeams = (ev, fallback) => {
      if (!ev) return fallback;
      const teams = parseTournamentTeams(ev.content);
      if (teams) return `${teams.home} vs ${teams.away}`;
      const display = formatEventContentForDisplay(ev.content);
      const rhs = String(display).split(":").slice(1).join(":").trim();
      return rhs || fallback;
    };
    const toFinalLabel = (ev) => {
      const raw = toTeams(ev, "결승전");
      const norm = String(raw).replace(/\s+/g, " ").trim();
      if (/준결승\s*1\s*승자\s*vs\s*준결승\s*2\s*승자/.test(norm)) {
        return "결승전";
      }
      return raw || "결승전";
    };
    const semi1Ev = findBy("준결승 1");
    const semi2Ev = findBy("준결승 2");
    const bronzeEv = findBy("3·4위전");
    const semi1Win = getTournamentWinnerSideFromContent(semi1Ev?.content);
    const semi2Win = getTournamentWinnerSideFromContent(semi2Ev?.content);
    const finalEv = findBy("결승 1차전") || findBy("결승");
    const finalWin = getTournamentWinnerSideFromContent(finalEv?.content);
    const bronzeWin = getTournamentWinnerSideFromContent(bronzeEv?.content);
    const semi1Str = toTeams(semi1Ev, "-");
    const semi2Str = toTeams(semi2Ev, "-");
    const [s1aRaw, s1bRaw] = String(semi1Str).split(" vs ").map((s) => String(s || "").trim());
    const [s2aRaw, s2bRaw] = String(semi2Str).split(" vs ").map((s) => String(s || "").trim());
    const bronzeTeams = bronzeEv
      ? parseTournamentTeamsFromContent(bronzeEv.content)
      : null;
    let bronzeB1 = bronzeTeams?.home || "";
    let bronzeB2 = bronzeTeams?.away || "";
    if (!bronzeB1 && semi1Win === "home") bronzeB1 = s1bRaw;
    else if (!bronzeB1 && semi1Win === "away") bronzeB1 = s1aRaw;
    if (!bronzeB2 && semi2Win === "home") bronzeB2 = s2bRaw;
    else if (!bronzeB2 && semi2Win === "away") bronzeB2 = s2aRaw;
    const finalTeams = finalEv
      ? parseTournamentTeamsFromContent(finalEv.content)
      : null;
    let finalF1 = finalTeams?.home || "";
    let finalF2 = finalTeams?.away || "";
    if (!finalF1 && semi1Win === "home") finalF1 = s1aRaw;
    else if (!finalF1 && semi1Win === "away") finalF1 = s1bRaw;
    if (!finalF2 && semi2Win === "home") finalF2 = s2aRaw;
    else if (!finalF2 && semi2Win === "away") finalF2 = s2bRaw;
    return {
      semi1: semi1Str,
      semi2: semi2Str,
      final: toFinalLabel(finalEv),
      finalF1: finalF1 || "-",
      finalF2: finalF2 || "-",
      bronzeB1: bronzeB1 || "-",
      bronzeB2: bronzeB2 || "-",
      bronzeScheduled: Boolean(bronzeEv),
      downWireBase: buildBracketDownWireBase(semi1Win, semi2Win),
      bronzeFeedPaths: getBracketBronzeFeedAdvancePaths(semi1Win, semi2Win),
      hasAny: list.length > 0,
      winners: {
        s1a: semi1Win === "home",
        s1b: semi1Win === "away",
        s2a: semi2Win === "home",
        s2b: semi2Win === "away",
        f1: finalWin === "home",
        f2: finalWin === "away",
        b1: bronzeWin === "home",
        b2: bronzeWin === "away",
      },
      losers: {
        s1a: semi1Win === "away",
        s1b: semi1Win === "home",
        s2a: semi2Win === "away",
        s2b: semi2Win === "home",
        f1: finalWin === "away",
        f2: finalWin === "home",
        b1: bronzeWin === "away",
        b2: bronzeWin === "home",
      },
    };
  }, [homeVLeagueTournamentEvents, vLeagueGradeTab, formatEventContentForDisplay, parseTournamentTeams]);

  const handleGenerateVLeagueTournamentDraft = useCallback(() => {
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    const leagueLabel = getVLeagueLabel(vLeagueGradeTab);
    const marker = `[토너먼트][${leagueLabel}]`;
    const existing = (vLeagueTournamentEvents || [])
      .filter((ev) => String(ev.content || "").includes(marker))
      .sort((a, b) =>
        String(a.event_date || "").localeCompare(String(b.event_date || ""))
      );
    const semi1Ev =
      existing.find((ev) => String(ev.content || "").includes("준결승 1")) || null;
    const semi2Ev =
      existing.find((ev) => String(ev.content || "").includes("준결승 2")) || null;
    const semi1Result = semi1Ev
      ? getTournamentWinnerLoserFromContent(semi1Ev.content)
      : null;
    const semi2Result = semi2Ev
      ? getTournamentWinnerLoserFromContent(semi2Ev.content)
      : null;

    if (semi1Result && semi2Result) {
      const rows = [];
      for (const ev of [semi1Ev, semi2Ev]) {
        rows.push({
          order: rows.length + 1,
          event_date: ev.event_date,
          content: ev.content,
          existingId: ev.id,
        });
      }
      const bronzeDate = nextPlayableYmd(
        vLeagueTournamentBronzeDate,
        vLeagueGradeTab
      );
      rows.push({
        order: rows.length + 1,
        event_date: bronzeDate,
        content: `[토너먼트][${leagueLabel}] 3·4위전(단판): ${semi1Result.loser} vs ${semi2Result.loser}`,
      });
      const finalMatchup = `${semi1Result.winner} vs ${semi2Result.winner}`;
      let cur = nextPlayableYmd(addDaysYmd(bronzeDate, 1), vLeagueGradeTab);
      for (let game = 1; game <= 3; game += 1) {
        const suffix = game === 3 ? "(필요 시)" : "";
        rows.push({
          order: rows.length + 1,
          event_date: cur,
          content: `[토너먼트][${leagueLabel}] 결승 ${game}차전(3판 2선승)${suffix}: ${finalMatchup}`,
        });
        cur = nextPlayableYmd(addDaysYmd(cur, 1), vLeagueGradeTab);
      }
      setVLeagueTournamentDraft(rows);
      setMainMsg(
        "준결승 결과를 반영해 3·4위전·결승(팀 확정) 일정 초안을 만들었습니다."
      );
      return;
    }

    if (semi1Ev || semi2Ev) {
      setVLeagueTournamentDraft([]);
      setMainMsg(
        "준결승 2경기 결과가 모두 저장되어야 3·4위전·결승 일정을 생성할 수 있습니다."
      );
      return;
    }

    const standings = getComputedStandingsByLeague(vLeagueGradeTab);
    if ((standings || []).length < 4) {
      setMainMsg("토너먼트 일정 생성을 위해 최소 4개 학급 순위가 필요합니다.");
      setVLeagueTournamentDraft([]);
      return;
    }
    const top4 = standings.slice(0, 4);
    const semiPairs = [
      { a: top4[0], b: top4[3] },
      { a: top4[1], b: top4[2] },
    ];
    let cur = nextPlayableYmd(vLeagueTournamentStartDate, vLeagueGradeTab);
    const rows = [];

    for (let idx = 0; idx < semiPairs.length; idx += 1) {
      const p = semiPairs[idx];
      rows.push({
        order: rows.length + 1,
        event_date: cur,
        content: `[토너먼트][${leagueLabel}] 준결승 ${idx + 1}(단판): ${p.a.rank_order}위 ${p.a.team_name} vs ${p.b.rank_order}위 ${p.b.team_name}`,
      });
      cur = nextPlayableYmd(addDaysYmd(cur, 1), vLeagueGradeTab);
    }

    setVLeagueTournamentDraft(rows);
    setMainMsg(
      "준결승 2경기 일정 초안을 만들었습니다. 경기 후 결과를 저장하고 다시 생성하면 3·4위전·결승 일정이 채워집니다."
    );
  }, [
    isVLeagueAdmin,
    vLeagueTournamentEvents,
    getComputedStandingsByLeague,
    vLeagueGradeTab,
    vLeagueTournamentStartDate,
    vLeagueTournamentBronzeDate,
    nextPlayableYmd,
    addDaysYmd,
    setMainMsg,
  ]);

  const handleSaveVLeagueTournamentEvents = useCallback(async () => {
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    const rows = vLeagueTournamentDraft || [];
    if (rows.length === 0) {
      setMainMsg("저장할 토너먼트 일정 초안이 없습니다.");
      return;
    }
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) {
      setMainMsg("새샘 V리그 club_id를 찾지 못했습니다.");
      return;
    }
    const marker = `[토너먼트][${getVLeagueLabel(vLeagueGradeTab)}]`;
    setVLeagueTournamentSaving(true);
    try {
      const keepIds = new Set(
        rows.map((r) => r.existingId).filter(Boolean)
      );
      const partialSave = keepIds.size > 0;
      const { data: existing } = await supabase
        .from("club_events")
        .select("id, content")
        .in("club_id", vClubIds)
        .ilike("content", `%${marker}%`);
      const ids = (existing || [])
        .filter((r) => {
          if (keepIds.has(r.id)) return false;
          if (!partialSave) return true;
          const c = String(r.content || "");
          return /3·4위전|결승\s*\d+\s*차전/.test(c);
        })
        .map((r) => r.id)
        .filter(Boolean);
      if (ids.length > 0) {
        const { error: delErr } = await supabase
          .from("club_events")
          .delete()
          .in("id", ids);
        if (delErr) {
          setMainMsg(`기존 토너먼트 일정 삭제 실패: ${delErr.message}`);
          return;
        }
      }

      const payload = rows
        .filter((r) => !r.existingId)
        .map((r) => ({
          club_id: vClubIds[0],
          event_date: r.event_date,
          content: r.content,
          created_by: currentUser?.name || null,
        }));
      if (payload.length === 0) {
        setMainMsg("저장할 새 일정이 없습니다.");
        return;
      }
      const { error } = await supabase.from("club_events").insert(payload);
      if (error) {
        setMainMsg(`토너먼트 일정 저장 실패: ${error.message}`);
        return;
      }
      setMainMsg("토너먼트 일정이 저장되었습니다.");
      setVLeagueTournamentDraft([]);
      await loadVLeagueTournamentEvents(vClubIds, vLeagueGradeTab);
      await loadHomeVLeagueTournamentEvents();
      await loadVLeagueTodayMatchTextRef.current();
      await loadEventsForMonth(vClubIds, calendarMonth);
    } finally {
      setVLeagueTournamentSaving(false);
    }
  }, [
    isVLeagueAdmin,
    vLeagueTournamentDraft,
    getVLeagueClubIds,
    vLeagueGradeTab,
    currentUser?.name,
    loadVLeagueTournamentEvents,
    loadHomeVLeagueTournamentEvents,
    loadEventsForMonth,
    calendarMonth,
  ]);

  const handleGenerateVLeaguePromotionDraft = useCallback(() => {
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    if (
      !areBothLeaguesReadyForPromotion(vLeagueMatches, homeVLeagueTournamentEvents)
    ) {
      setVLeaguePromotionDraft([]);
      setMainMsg(
        "맑은샘·고운샘 리그전과 토너먼트가 모두 종료되어야 승강전 일정을 생성할 수 있습니다."
      );
      return;
    }
    const malgeunRows = getVLeagueDisplayStandings(
      "malgeun",
      getComputedStandingsByLeague("malgeun"),
      vLeagueMatches,
      homeVLeagueTournamentEvents
    );
    const gounRows = getVLeagueDisplayStandings(
      "goun",
      getComputedStandingsByLeague("goun"),
      vLeagueMatches,
      homeVLeagueTournamentEvents
    );
    const rows = [];
    let cur = nextPlayableYmdPromotion(vLeaguePromotionStartDate);
    for (const def of PROMOTION_MATCHUP_DEFS) {
      const gounTeam = findStandingRowByRank(gounRows, def.gounRank);
      const malgeunTeam = findStandingRowByRank(malgeunRows, def.malgeunRank);
      if (!gounTeam || !malgeunTeam) {
        setVLeaguePromotionDraft([]);
        setMainMsg(
          `승강전 매칭에 필요한 최종 순위를 찾지 못했습니다. (고운샘 ${def.gounRank}위·맑은샘 ${def.malgeunRank}위)`
        );
        return;
      }
      rows.push({
        order: rows.length + 1,
        event_date: cur,
        content: buildPromotionMatchContent(
          def.gameNo,
          def.gounRank,
          gounTeam.team_name,
          def.malgeunRank,
          malgeunTeam.team_name
        ),
      });
      cur = nextPlayableYmdPromotion(addDaysYmd(cur, 1));
    }
    setVLeaguePromotionDraft(rows);
    setMainMsg(
      "승강전 3경기(단판) 일정 초안을 만들었습니다. 확인 후 일정에 저장하세요."
    );
  }, [
    isVLeagueAdmin,
    vLeagueMatches,
    homeVLeagueTournamentEvents,
    getComputedStandingsByLeague,
    vLeaguePromotionStartDate,
    nextPlayableYmdPromotion,
    addDaysYmd,
    setMainMsg,
  ]);

  const handleSaveVLeaguePromotionEvents = useCallback(async () => {
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    const rows = vLeaguePromotionDraft || [];
    if (rows.length === 0) {
      setMainMsg("저장할 승강전 일정 초안이 없습니다.");
      return;
    }
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) {
      setMainMsg("새샘 V리그 club_id를 찾지 못했습니다.");
      return;
    }
    setVLeaguePromotionSaving(true);
    try {
      const { data: existing } = await supabase
        .from("club_events")
        .select("id, content")
        .in("club_id", vClubIds)
        .ilike("content", `${PROMOTION_EVENT_MARKER}%`);
      const ids = (existing || []).map((r) => r.id).filter(Boolean);
      if (ids.length > 0) {
        const { error: delErr } = await supabase
          .from("club_events")
          .delete()
          .in("id", ids);
        if (delErr) {
          setMainMsg(`기존 승강전 일정 삭제 실패: ${delErr.message}`);
          return;
        }
      }
      const payload = rows.map((r) => ({
        club_id: vClubIds[0],
        event_date: r.event_date,
        content: r.content,
        created_by: currentUser?.name || null,
      }));
      const { error } = await supabase.from("club_events").insert(payload);
      if (error) {
        setMainMsg(`승강전 일정 저장 실패: ${error.message}`);
        return;
      }
      setMainMsg("승강전 일정이 저장되었습니다.");
      setVLeaguePromotionDraft([]);
      await loadVLeaguePromotionEvents(vClubIds);
      await loadVLeagueTodayMatchTextRef.current();
      await loadEventsForMonth(vClubIds, calendarMonth);
    } finally {
      setVLeaguePromotionSaving(false);
    }
  }, [
    isVLeagueAdmin,
    vLeaguePromotionDraft,
    getVLeagueClubIds,
    currentUser?.name,
    loadVLeaguePromotionEvents,
    loadEventsForMonth,
    calendarMonth,
    setMainMsg,
  ]);

  const handleSaveVLeaguePromotionResult = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const draft = vLeaguePromotionResultDrafts[row.id] || {};
      const saved = parseTournamentSavedScore(row.content) || {};
      const homeRaw = draft.home ?? saved.home ?? "";
      const awayRaw = draft.away ?? saved.away ?? "";
      const winRaw = draft.winScore ?? saved.winScore ?? "";
      const homeScore = Number(homeRaw);
      const awayScore = Number(awayRaw);
      const winScore = Number(winRaw);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
        setMainMsg("점수를 숫자로 입력해 주세요.");
        return;
      }
      if (!Number.isFinite(winScore) || winScore <= 0) {
        setMainMsg("승리 점수를 입력해 주세요.");
        return;
      }
      const homeWin =
        homeScore === winScore && awayScore !== winScore;
      const awayWin =
        awayScore === winScore && homeScore !== winScore;
      if (!homeWin && !awayWin) {
        setMainMsg("한 팀만 '승리 점수'에 도달해야 결과를 저장할 수 있습니다.");
        return;
      }
      const nextContent = buildTournamentResultContent(
        row.content,
        winScore,
        homeScore,
        awayScore
      );
      setVLeaguePromotionResultSavingId(row.id);
      try {
        const { error } = await supabase
          .from("club_events")
          .update({ content: nextContent })
          .eq("id", row.id);
        if (error) {
          setMainMsg(`승강전 결과 저장 실패: ${error.message}`);
          return;
        }
        setVLeaguePromotionEvents((prev) =>
          (prev || []).map((ev) =>
            ev.id === row.id ? { ...ev, content: nextContent } : ev
          )
        );
        setVLeaguePromotionResultDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setMainMsg("승강전 경기 결과를 저장했습니다.");
        await loadVLeagueTodayMatchTextRef.current();
      } finally {
        setVLeaguePromotionResultSavingId(null);
      }
    },
    [
      isVLeagueAdmin,
      vLeaguePromotionResultDrafts,
      parseTournamentSavedScore,
      buildTournamentResultContent,
      setMainMsg,
    ]
  );

  const handleDeleteVLeaguePromotionEvent = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const ok = window.confirm("이 승강전 일정을 삭제할까요?");
      if (!ok) return;
      const vClubIds = getVLeagueClubIds();
      setVLeaguePromotionDeletingId(row.id);
      try {
        const { error } = await supabase.from("club_events").delete().eq("id", row.id);
        if (error) {
          setMainMsg(`승강전 일정 삭제 실패: ${error.message}`);
          return;
        }
        setVLeaguePromotionEvents((prev) => (prev || []).filter((ev) => ev.id !== row.id));
        setMainMsg("승강전 일정을 삭제했습니다.");
        await loadVLeaguePromotionEvents(vClubIds);
        await loadEventsForMonth(vClubIds, calendarMonth);
      } finally {
        setVLeaguePromotionDeletingId(null);
      }
    },
    [
      isVLeagueAdmin,
      getVLeagueClubIds,
      loadVLeaguePromotionEvents,
      loadEventsForMonth,
      calendarMonth,
      setMainMsg,
    ]
  );

  const handlePostponeVLeaguePromotionEvent = useCallback(
    async (row) => {
      if (!isVLeagueAdmin) {
        setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
        return;
      }
      const ok = window.confirm("이 승강전 일정을 맨 뒤 날짜로 미룰까요?");
      if (!ok) return;
      const vClubIds = getVLeagueClubIds();
      const clubId = vClubIds[0];
      if (!clubId) {
        setMainMsg("새샘 V리그 club_id를 찾지 못했습니다.");
        return;
      }
      setVLeaguePromotionPostponingId(row.id);
      try {
        const maxDate = (vLeaguePromotionEvents || [])
          .map((ev) => String(ev.event_date || ""))
          .filter(Boolean)
          .sort()
          .pop();
        let cand = nextPlayableYmdPromotion(
          addDaysYmd(maxDate || row.event_date || toYmd(new Date()), 1)
        );
        let nextDate = cand;
        for (let i = 0; i < 366; i += 1) {
          if (!nextDate) break;
          const { data, error } = await supabase
            .from("club_events")
            .select("id")
            .eq("club_id", clubId)
            .eq("event_date", nextDate)
            .limit(1);
          if (error) {
            setMainMsg(`일정 충돌 확인 실패: ${error.message}`);
            return;
          }
          if ((data || []).length === 0) break;
          cand = nextPlayableYmdPromotion(addDaysYmd(nextDate, 1));
          nextDate = cand;
        }
        if (!nextDate) {
          setMainMsg("다음 가능한 날짜를 찾지 못했습니다.");
          return;
        }
        const { error: upErr } = await supabase
          .from("club_events")
          .update({ event_date: nextDate })
          .eq("id", row.id);
        if (upErr) {
          setMainMsg(`승강전 일정 이동 실패: ${upErr.message}`);
          return;
        }
        setMainMsg(`일정을 ${nextDate}로 뒤로 미뤘습니다.`);
        await loadVLeaguePromotionEvents(vClubIds);
        await loadEventsForMonth(vClubIds, calendarMonth);
      } finally {
        setVLeaguePromotionPostponingId(null);
      }
    },
    [
      isVLeagueAdmin,
      getVLeagueClubIds,
      vLeaguePromotionEvents,
      nextPlayableYmdPromotion,
      addDaysYmd,
      loadVLeaguePromotionEvents,
      loadEventsForMonth,
      calendarMonth,
      setMainMsg,
    ]
  );

  const promotionPlayoffReady = useMemo(
    () =>
      areBothLeaguesReadyForPromotion(vLeagueMatches, homeVLeagueTournamentEvents),
    [vLeagueMatches, homeVLeagueTournamentEvents]
  );

  const promotionMatchupPreview = useMemo(() => {
    if (!promotionPlayoffReady) return [];
    const malgeunRows = getVLeagueDisplayStandings(
      "malgeun",
      getComputedStandingsByLeague("malgeun"),
      vLeagueMatches,
      homeVLeagueTournamentEvents
    );
    const gounRows = getVLeagueDisplayStandings(
      "goun",
      getComputedStandingsByLeague("goun"),
      vLeagueMatches,
      homeVLeagueTournamentEvents
    );
    return PROMOTION_MATCHUP_DEFS.map((def) => {
      const gounTeam = findStandingRowByRank(gounRows, def.gounRank);
      const malgeunTeam = findStandingRowByRank(malgeunRows, def.malgeunRank);
      return {
        gameNo: def.gameNo,
        gounRank: def.gounRank,
        malgeunRank: def.malgeunRank,
        gounTeamName: gounTeam?.team_name || "-",
        malgeunTeamName: malgeunTeam?.team_name || "-",
      };
    });
  }, [
    promotionPlayoffReady,
    getComputedStandingsByLeague,
    vLeagueMatches,
    homeVLeagueTournamentEvents,
  ]);

  const myVLeagueClassRow = useMemo(() => {
    if (currentUser?.role !== "student" || !myStudentClassName) return null;
    return (
      (vLeagueClasses || []).find(
        (r) => normalizeClubName(r.class_name) === normalizeClubName(myStudentClassName)
      ) || null
    );
  }, [currentUser?.role, myStudentClassName, vLeagueClasses]);

  /** vleague_classes.homeroom_teacher_name 과 로그인 교사 이름이 일치하는 학급 (담임 응원용) */
  const myTeacherVLeagueHomeroomRow = useMemo(() => {
    if (currentUser?.role !== "teacher" || !currentUser?.name) return null;
    const myN = normalizeTeacherName(currentUser.name);
    const list = (vLeagueClasses || []).filter((r) => {
      const t = r.homeroom_teacher_name;
      if (!t || !String(t).trim()) return false;
      return normalizeTeacherName(String(t)) === myN;
    });
    if (list.length === 0) return null;
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return list[0];
  }, [currentUser?.role, currentUser?.name, vLeagueClasses]);

  const canCurrentTeacherEditSchedule = (clubName) => {
    if (!currentUser || currentUser.role !== "teacher" || !clubName) return false;
    const myNameN = normalizeTeacherName(currentUser.name);
    if (isVLeagueClub(clubName)) {
      return myNameN === vLeagueAdminNameNorm;
    }
    return getClubsByName(clubName).some(
      (c) => isTeacherAssignedToClubRow(c, myNameN)
    );
  };

  /** 학생: 학번 학급 / 교사: 담임 학급 — 응원 작성 대상 행 */
  const vLeagueCheerWriterClassRow = useMemo(() => {
    if (currentUser?.role === "student") return myVLeagueClassRow;
    if (currentUser?.role === "teacher") return myTeacherVLeagueHomeroomRow;
    return null;
  }, [currentUser?.role, myVLeagueClassRow, myTeacherVLeagueHomeroomRow]);

  /** 해당 학급 경기일마다: 전날 14:00 ~ 당일 13:00 직전에만 작성 가능 */
  const canWriteVLeagueCheerNow = useMemo(() => {
    if (!vLeagueCheerWriterClassRow?.id) return false;
    for (const m of vLeagueMatches || []) {
      if (!m.match_date) continue;
      if (
        m.home_class_id !== vLeagueCheerWriterClassRow.id &&
        m.away_class_id !== vLeagueCheerWriterClassRow.id
      ) {
        continue;
      }
      const ymd = String(m.match_date).slice(0, 10);
      if (isNowInVLeagueCheerWindow(ymd)) return true;
    }
    return false;
  }, [vLeagueCheerWriterClassRow, vLeagueMatches, cheerEligibilityTick]);

  const myTeacherCheerDisplayName = useMemo(() => {
    if (currentUser?.role !== "teacher" || !vLeagueCheerWriterClassRow?.class_name) {
      return "";
    }
    return `${shortClassLabel(vLeagueCheerWriterClassRow.class_name)} 선생님`;
  }, [currentUser?.role, vLeagueCheerWriterClassRow?.class_name]);

  const isMyVLeagueCheer = useCallback(
    (row) => {
      if (!row || !currentUser) return false;
      if (currentUser.role === "student") {
        return String(row.student_id || "") === String(currentUser.id || "");
      }
      if (currentUser.role === "teacher" && vLeagueCheerWriterClassRow?.id) {
        if (row.class_id !== vLeagueCheerWriterClassRow.id) return false;
        if (row.student_id) return false;
        return String(row.student_name || "") === myTeacherCheerDisplayName;
      }
      return false;
    },
    [currentUser, vLeagueCheerWriterClassRow, myTeacherCheerDisplayName]
  );

  const canDeleteVLeagueCheer = useCallback(
    (row) => canWriteVLeagueCheerNow && isMyVLeagueCheer(row),
    [canWriteVLeagueCheerNow, isMyVLeagueCheer]
  );

  const visibleVLeagueCheers = useMemo(() => {
    const now = new Date();
    return (vLeagueCheers || []).filter((c) =>
      isVLeagueCheerVisibleNow(c, vLeagueMatches, now)
    );
  }, [vLeagueCheers, vLeagueMatches, cheerEligibilityTick]);

  const vLeagueCheerAutoDrawInfo = useMemo(() => {
    if (!vLeagueCheerWriterClassRow?.id) {
      return { enabled: false, reason: "내 학급 정보가 없어서 추첨 상태를 확인할 수 없습니다." };
    }
    const now = new Date();
    const writerClassId = vLeagueCheerWriterClassRow.id;
    const classMatchDates = Array.from(
      new Set(
        (vLeagueMatches || [])
          .filter(
            (m) =>
              Boolean(m.match_date) &&
              (m.home_class_id === writerClassId || m.away_class_id === writerClassId)
          )
          .map((m) => String(m.match_date).slice(0, 10))
      )
    );
    const drawYmd = classMatchDates.find((ymd) => {
      const w = getVLeagueCheerDrawWindowForMatchDate(ymd);
      return w ? now >= w.start && now < w.end : false;
    });
    if (!drawYmd) {
      return {
        enabled: false,
        reason: "자동 추첨은 경기 당일 13:01~14:00에 실행됩니다.",
      };
    }
    return { enabled: true, reason: "", drawYmd };
  }, [vLeagueCheerWriterClassRow, vLeagueMatches, cheerEligibilityTick]);

  const showVLeagueCheerEventPanelNow = useMemo(() => {
    if (!vLeagueCheerWriterClassRow?.id) return false;
    const now = new Date();
    return (vLeagueMatches || []).some(
      (m) =>
        Boolean(m.match_date) &&
        (m.home_class_id === vLeagueCheerWriterClassRow.id ||
          m.away_class_id === vLeagueCheerWriterClassRow.id) &&
        isNowInVLeagueCheerEventDisplayWindow(String(m.match_date).slice(0, 10), now)
    );
  }, [vLeagueCheerWriterClassRow, vLeagueMatches, cheerEligibilityTick]);

  const visibleVLeagueCheerBoard = useMemo(() => {
    const now = new Date();
    const sourceMatches =
      vLeagueCheerBoardMatches && vLeagueCheerBoardMatches.length > 0
        ? vLeagueCheerBoardMatches
        : vLeagueMatches;
    return (vLeagueCheerBoard || []).filter((c) =>
      isVLeagueCheerVisibleNow(c, sourceMatches, now)
    );
  }, [vLeagueCheerBoard, vLeagueCheerBoardMatches, vLeagueMatches, cheerEligibilityTick]);

  const vLeagueCheerCumulativeMinMatchYmd = useMemo(
    () => getVLeagueCheerCumulativeMinMatchYmd(),
    [cheerEligibilityTick]
  );

  const vLeagueCheerCumulativeSummary = useMemo(() => {
    const totalMap = new Map();
    for (const row of vLeagueCheerCumulativeTotals || []) {
      if (row?.class_id) totalMap.set(row.class_id, Number(row.total_count) || 0);
    }
    const { malgeun, goun } = splitVLeagueClassesByGrade(vLeagueClasses || []);
    const toRows = (list) =>
      list.map((cls) => {
        const nickname = String(cls.nickname || "").trim();
        const classLabel = shortClassLabel(cls.class_name || "학급");
        const teamName = nickname ? `${nickname}(${classLabel})` : classLabel;
        return {
          class_id: cls.id,
          team_name: teamName,
          total_count: totalMap.get(cls.id) || 0,
        };
      });
    return { malgeun: toRows(malgeun), goun: toRows(goun) };
  }, [vLeagueClasses, vLeagueCheerCumulativeTotals]);

  const vLeagueTodayYmd = useMemo(() => toYmd(new Date()), [cheerEligibilityTick]);
  const myClassEventWinnerToday = useMemo(() => {
    if (!vLeagueCheerWriterClassRow?.id) return null;
    return (
      (vLeagueCheerEventWinners || []).find(
        (row) =>
          row.class_id === vLeagueCheerWriterClassRow.id &&
          String(row.match_date || "").slice(0, 10) === vLeagueTodayYmd
      ) || null
    );
  }, [vLeagueCheerEventWinners, vLeagueCheerWriterClassRow, vLeagueTodayYmd]);

  useEffect(() => {
    const shouldTick =
      Boolean(currentUser) &&
      (page.type === "home" ||
        (page.type === "clubMain" &&
          isVLeagueClub(page.clubName) &&
          clubTab === "vCheer"));
    if (!shouldTick) return;
    const id = window.setInterval(
      () => setCheerEligibilityTick((t) => t + 1),
      30000
    );
    return () => window.clearInterval(id);
  }, [currentUser, page.type, page.clubName, clubTab, clubs]);

  const loadVLeagueCheers = useCallback(async (clubId, classId = null) => {
    if (!clubId) {
      setVLeagueCheers([]);
      return;
    }
    setVLeagueCheerLoading(true);
    let query = supabase
      .from("vleague_cheers")
      .select("id, message, student_name, student_id, created_at, class_id")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false })
      .limit(150);
    if (classId) query = query.eq("class_id", classId);
    const { data, error } = await query;
    setVLeagueCheerLoading(false);
    if (error) {
      setMainMsg(`응원 글 로딩 실패: ${error.message}`);
      setVLeagueCheers([]);
      return;
    }
    setVLeagueCheers(data || []);
  }, []);

  const loadVLeagueCheerCumulativeTotals = useCallback(async (clubIdsOrId) => {
    const clubIds = Array.isArray(clubIdsOrId)
      ? clubIdsOrId.filter(Boolean)
      : [clubIdsOrId].filter(Boolean);
    if (clubIds.length === 0) {
      setVLeagueCheerCumulativeTotals([]);
      return;
    }
    setVLeagueCheerCumulativeLoading(true);
    let query = supabase
      .from("vleague_cheer_class_totals")
      .select("class_id, total_count, updated_at")
      .order("total_count", { ascending: false });
    if (clubIds.length === 1) {
      query = query.eq("club_id", clubIds[0]);
    } else {
      query = query.in("club_id", clubIds);
    }
    const { data, error } = await query;
    setVLeagueCheerCumulativeLoading(false);
    if (error) {
      setVLeagueCheerCumulativeTotals([]);
      setMainMsg(
        `응원 누적 집계 테이블을 불러오지 못했습니다. Supabase SQL Editor에서 docs/migrations/20260618-vleague-cheer-class-totals.sql 을 실행해 주세요. (${error.message})`
      );
      return;
    }
    setVLeagueCheerCumulativeTotals(data || []);
  }, [setMainMsg]);

  const adjustVLeagueCheerClassTotal = useCallback(
    async (clubId, classId, delta) => {
      if (!clubId || !classId || !delta) return true;
      const { error: rpcErr } = await supabase.rpc("adjust_vleague_cheer_class_total", {
        p_club_id: clubId,
        p_class_id: classId,
        p_delta: delta,
      });
      if (!rpcErr) return true;

      const { data: cur } = await supabase
        .from("vleague_cheer_class_totals")
        .select("total_count")
        .eq("club_id", clubId)
        .eq("class_id", classId)
        .maybeSingle();
      const next = Math.max(0, (Number(cur?.total_count) || 0) + delta);
      const { error: upErr } = await supabase.from("vleague_cheer_class_totals").upsert(
        {
          club_id: clubId,
          class_id: classId,
          total_count: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "club_id,class_id" }
      );
      return !upErr;
    },
    []
  );

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vCheerLookup") return;
    if (!isVLeagueClub(page.clubName) || !isVLeagueAdmin) return;
    const vClubIds = getVLeagueClubIds();
    if (vClubIds.length === 0) return;
    loadVLeagueClasses(vClubIds);
    loadVLeagueCheerCumulativeTotals(vClubIds);
  }, [
    page.type,
    clubTab,
    page.clubName,
    clubs,
    isVLeagueAdmin,
    loadVLeagueClasses,
    loadVLeagueCheerCumulativeTotals,
    getVLeagueClubIds,
  ]);

  const loadVLeagueCheerBoard = useCallback(async () => {
    const vLeagueClubRows = getClubsByName(V_LEAGUE_LABEL);
    const clubIds = Array.from(
      new Set((vLeagueClubRows || []).map((c) => c?.id).filter(Boolean))
    );
    if (clubIds.length === 0) {
      setVLeagueCheerBoard([]);
      setVLeagueCheerBoardMatches([]);
      setVLeagueCheerBoardIndex(0);
      return;
    }
    const today = toYmd(new Date());
    const ymdYesterday = addDaysYmd(today, -1);
    const ymdTomorrow = addDaysYmd(today, 1);
    const { data: matchRows } = await supabase
      .from("vleague_matches")
      .select("id, home_class_id, away_class_id, match_date, league")
      .in("club_id", clubIds)
      .gte("match_date", ymdYesterday)
      .lte("match_date", ymdTomorrow)
      .order("match_date", { ascending: true })
      .limit(200);
    setVLeagueCheerBoardMatches(matchRows || []);
    const { data, error } = await supabase
      .from("vleague_cheers")
      .select(
        "id, class_id, message, student_name, created_at, class:vleague_classes(class_name)"
      )
      .in("club_id", clubIds)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      setVLeagueCheerBoard([]);
      setVLeagueCheerBoardMatches([]);
      setVLeagueCheerBoardIndex(0);
      return;
    }
    setVLeagueCheerBoard(data || []);
    setVLeagueCheerBoardIndex(0);
  }, [clubs]);

  const loadVLeagueCheerEventWinners = useCallback(async () => {
    const vLeagueClubRows = getClubsByName(V_LEAGUE_LABEL);
    const clubIds = Array.from(
      new Set((vLeagueClubRows || []).map((c) => c?.id).filter(Boolean))
    );
    if (clubIds.length === 0) {
      setVLeagueCheerEventWinners([]);
      return;
    }
    const ymdBase = toYmd(new Date());
    const ymdFrom = addDaysYmd(ymdBase, -7) || ymdBase;
    const { data, error } = await supabase
      .from("vleague_cheer_event_winners")
      .select(
        "id, club_id, class_id, match_date, winner_student_id, winner_student_name, picked_at"
      )
      .in("club_id", clubIds)
      .gte("match_date", ymdFrom)
      .order("match_date", { ascending: false })
      .order("picked_at", { ascending: false })
      .limit(80);
    if (error) {
      setVLeagueCheerEventWinners([]);
      return;
    }
    setVLeagueCheerEventWinners(data || []);
  }, [clubs]);

  const runAutoVLeagueCheerEventDraw = useCallback(async () => {
    const vLeagueClubRows = getClubsByName(V_LEAGUE_LABEL);
    const clubIds = Array.from(
      new Set((vLeagueClubRows || []).map((c) => c?.id).filter(Boolean))
    );
    if (clubIds.length === 0) return;

    const now = new Date();
    const today = toYmd(now);
    const cheerWriteWindow = getVLeagueCheerWindowForMatchDate(today);
    const drawWindow = getVLeagueCheerDrawWindowForMatchDate(today);
    if (
      !cheerWriteWindow ||
      !drawWindow ||
      !(now >= drawWindow.start && now < drawWindow.end)
    ) {
      return;
    }

    const { data: todaysMatches, error: matchErr } = await supabase
      .from("vleague_matches")
      .select("club_id, match_date, home_class_id, away_class_id")
      .in("club_id", clubIds)
      .eq("match_date", today)
      .limit(300);
    if (matchErr || !todaysMatches?.length) return;

    const classToClubId = new Map();
    for (const m of todaysMatches) {
      if (m?.home_class_id && !classToClubId.has(m.home_class_id)) {
        classToClubId.set(m.home_class_id, m.club_id);
      }
      if (m?.away_class_id && !classToClubId.has(m.away_class_id)) {
        classToClubId.set(m.away_class_id, m.club_id);
      }
    }
    const classIds = Array.from(classToClubId.keys()).filter(Boolean);
    if (classIds.length === 0) return;

    const { data: existingWinners } = await supabase
      .from("vleague_cheer_event_winners")
      .select("club_id, class_id, match_date")
      .in("club_id", clubIds)
      .eq("match_date", today)
      .in("class_id", classIds)
      .limit(300);

    const existingKey = new Set(
      (existingWinners || []).map(
        (r) =>
          `${String(r.club_id || "")}__${String(r.class_id || "")}__${String(r.match_date || "")}`
      )
    );

    for (const classId of classIds) {
      const clubId = classToClubId.get(classId);
      if (!clubId) continue;
      const key = `${clubId}__${classId}__${today}`;
      if (existingKey.has(key)) continue;

      const { data: cheers } = await supabase
        .from("vleague_cheers")
        .select("student_id, student_name")
        .eq("club_id", clubId)
        .eq("class_id", classId)
        .gte("created_at", cheerWriteWindow.start.toISOString())
        .lt("created_at", drawWindow.start.toISOString())
        .not("student_id", "is", null)
        .limit(300);

      const uniqueStudents = [];
      const seen = new Set();
      for (const c of cheers || []) {
        const sid = String(c.student_id || "").trim();
        const sname = String(c.student_name || "").trim();
        if (!sid || !sname) continue;
        if (seen.has(sid)) continue;
        seen.add(sid);
        uniqueStudents.push({ sid, sname });
      }
      if (uniqueStudents.length === 0) continue;

      const picked = uniqueStudents[Math.floor(Math.random() * uniqueStudents.length)];
      const { error: insErr } = await supabase.from("vleague_cheer_event_winners").insert([
        {
          club_id: clubId,
          class_id: classId,
          match_date: today,
          winner_student_id: picked.sid,
          winner_student_name: picked.sname,
          picked_at: now.toISOString(),
        },
      ]);
      if (!insErr) {
        existingKey.add(key);
      }
    }
  }, [clubs]);

  const loadVLeagueTodayMatchText = useCallback(async () => {
    const vLeagueClubRows = getClubsByName(V_LEAGUE_LABEL);
    const clubIds = Array.from(
      new Set((vLeagueClubRows || []).map((c) => c?.id).filter(Boolean))
    );
    if (clubIds.length === 0) {
      setVLeagueTodayMatches({ malgeun: "", goun: "" });
      setVLeagueTodayMatchIds({ malgeun: null, goun: null });
      return;
    }
    const today = toYmd(new Date());
    const { data: classes } = await supabase
      .from("vleague_classes")
      .select("id, class_name")
      .in("club_id", clubIds);
    const classMap = new Map((classes || []).map((c) => [c.id, c.class_name]));
    for (const c of vLeagueClasses || []) {
      if (c?.id && c?.class_name && !classMap.has(c.id)) {
        classMap.set(c.id, c.class_name);
      }
    }
    const ymdYesterday = addDaysYmd(today, -1);
    const ymdTomorrow = addDaysYmd(today, 1);
    const isNowInTodayMatchBannerWindow = (matchDateYmd) => {
      const ymd = String(matchDateYmd || "").slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
      if (!m) return false;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const matchDay = new Date(y, mo - 1, d);
      const prevDay = new Date(matchDay);
      prevDay.setDate(prevDay.getDate() - 1);
      const start = new Date(
        prevDay.getFullYear(),
        prevDay.getMonth(),
        prevDay.getDate(),
        14,
        0,
        0,
        0
      );
      const end = new Date(y, mo - 1, d, 14, 0, 0, 0);
      const now = new Date();
      return now >= start && now < end;
    };

    const [{ data: matches, error }, { data: tournamentEvents }] = await Promise.all([
      supabase
        .from("vleague_matches")
        .select("id, home_class_id, away_class_id, match_date, league")
        .in("club_id", clubIds)
        .gte("match_date", ymdYesterday)
        .lte("match_date", ymdTomorrow)
        .order("match_date", { ascending: true })
        .order("match_no", { ascending: true })
        .limit(300),
      supabase
        .from("club_events")
        .select("id, event_date, content")
        .in("club_id", clubIds)
        .ilike("content", "%[토너먼트]%")
        .gte("event_date", ymdYesterday)
        .lte("event_date", ymdTomorrow)
        .order("event_date", { ascending: true })
        .limit(50),
    ]);
    if (error) {
      setVLeagueTodayMatches({ malgeun: "", goun: "" });
      setVLeagueTodayMatchIds({ malgeun: null, goun: null });
      return;
    }
    const fallbackMatches = (vLeagueMatches || []).filter((m) => {
      const clubOk = !m?.club_id || clubIds.includes(m.club_id);
      return (
        clubOk &&
        String(m?.match_date || "") >= ymdYesterday &&
        String(m?.match_date || "") <= ymdTomorrow
      );
    });
    const sourceMatches = (matches && matches.length > 0 ? matches : fallbackMatches) || [];

    const tournamentByLeague = { malgeun: [], goun: [] };
    for (const ev of tournamentEvents || []) {
      if (!isNowInTodayMatchBannerWindow(ev.event_date)) continue;
      const leagueKey = getTournamentLeagueKeyFromContent(ev.content);
      if (leagueKey === "malgeun" || leagueKey === "goun") {
        tournamentByLeague[leagueKey].push(ev);
      }
    }

    if (sourceMatches.length === 0 && !tournamentByLeague.malgeun.length && !tournamentByLeague.goun.length) {
      setVLeagueTodayMatches({ malgeun: "", goun: "" });
      setVLeagueTodayMatchIds({ malgeun: null, goun: null });
      return;
    }
    const inferGradeFromClassName = (className) => {
      const s = String(className || "").trim();
      if (!s) return null;
      const n = s.match(/(\d{1,2})/);
      if (!n) return null;
      const grade = Number(n[1]);
      if (grade === 5 || grade === 6) return grade;
      return null;
    };
    const resolveLeagueKey = (m) => {
      const raw = String(m?.league || "")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (raw.includes("malgeun") || raw.includes("맑은")) return "malgeun";
      if (raw.includes("goun") || raw.includes("고운")) return "goun";
      const homeClassName = String(classMap.get(m?.home_class_id) || "");
      const awayClassName = String(classMap.get(m?.away_class_id) || "");
      const homeGrade = inferGradeFromClassName(homeClassName);
      const awayGrade = inferGradeFromClassName(awayClassName);
      const grade = homeGrade || awayGrade;
      if (grade === 5) return "malgeun";
      if (grade === 6) return "goun";
      return "";
    };

    const byLeague = { malgeun: [], goun: [] };
    for (const m of sourceMatches) {
      if (!isNowInTodayMatchBannerWindow(m.match_date)) continue;
      const k = resolveLeagueKey(m);
      if (k === "malgeun" || k === "goun") byLeague[k].push(m);
    }
    const firstMalgeun = byLeague.malgeun[0] || null;
    const firstGoun = byLeague.goun[0] || null;
    const toMatchText = (m, leagueLabel) => {
      if (!m) return "";
      const homeClass = classMap.get(m.home_class_id) || "학급";
      const awayClass = classMap.get(m.away_class_id) || "학급";
      const homeShort = shortClassLabel(homeClass);
      const awayShort = shortClassLabel(awayClass);
      const homeRow = (vLeagueClasses || []).find((r) => r.id === m.home_class_id);
      const awayRow = (vLeagueClasses || []).find((r) => r.id === m.away_class_id);
      const homeNick = String(homeRow?.nickname || "").trim();
      const awayNick = String(awayRow?.nickname || "").trim();
      const home = homeNick ? `${homeNick}(${homeShort})` : homeShort;
      const away = awayNick ? `${awayNick}(${awayShort})` : awayShort;
      return `[${leagueLabel}] ${home} VS ${away}`;
    };
    const firstMalgeunTournament = tournamentByLeague.malgeun[0] || null;
    const firstGounTournament = tournamentByLeague.goun[0] || null;
    const toTournamentText = (ev, leagueLabel) => {
      if (!ev) return "";
      return formatTournamentEventForScoreboard(ev.content, leagueLabel);
    };
    setVLeagueTodayMatches({
      malgeun:
        toTournamentText(firstMalgeunTournament, "맑은샘") ||
        toMatchText(firstMalgeun, "맑은샘"),
      goun:
        toTournamentText(firstGounTournament, "고운샘") ||
        toMatchText(firstGoun, "고운샘"),
    });
    setVLeagueTodayMatchIds({
      malgeun: firstMalgeunTournament ? null : firstMalgeun?.id || null,
      goun: firstGounTournament ? null : firstGoun?.id || null,
    });
  }, [clubs, vLeagueClasses, vLeagueMatches]);

  useEffect(() => {
    loadVLeagueTodayMatchTextRef.current = loadVLeagueTodayMatchText;
  }, [loadVLeagueTodayMatchText]);

  const loadVLeagueRefereeData = useCallback(async (clubId) => {
    if (!clubId) {
      setVLeagueReferees([]);
      setVLeagueRefereeAssignments([]);
      return;
    }
    setVLeagueRefereeLoading(true);
    const [{ data: refs, error: refErr }, { data: assigns, error: assignErr }] =
      await Promise.all([
        supabase
          .from("vleague_referees")
          .select("id, student_id, student_name, created_at")
          .eq("club_id", clubId)
          .order("created_at", { ascending: false }),
        supabase
          .from("vleague_referee_assignments")
          .select("id, match_id, student_id, student_name, assignment_role, created_at")
          .eq("club_id", clubId)
          .order("created_at", { ascending: false }),
      ]);
    setVLeagueRefereeLoading(false);
    if (refErr || assignErr) {
      setMainMsg(
        `심판 데이터 로딩 실패: ${(refErr || assignErr)?.message || "unknown error"}`
      );
      setVLeagueReferees([]);
      setVLeagueRefereeAssignments([]);
      return;
    }
    setVLeagueReferees(refs || []);
    setVLeagueRefereeAssignments(assigns || []);
  }, []);

  const loadVLeagueRuleText = useCallback(async (clubId) => {
    const vLeagueClubRows = getClubsByName(V_LEAGUE_LABEL);
    const clubIds = Array.from(
      new Set(
        [clubId, ...(vLeagueClubRows || []).map((c) => c?.id)].filter(Boolean)
      )
    );
    if (clubIds.length === 0) {
      setVLeagueRuleText("");
      setVLeagueRuleDraft("");
      return;
    }
    setVLeagueRuleLoading(true);
    const { data, error } = await supabase
      .from("vleague_rule_settings")
      .select("*")
      .in("club_id", clubIds)
      .order("updated_at", { ascending: false })
      .limit(20);
    setVLeagueRuleLoading(false);
    if (error) {
      setMainMsg(`V리그 규칙 로딩 실패: ${error.message}`);
      return;
    }
    const picked =
      (data || []).find((r) => String(r?.rule_text || "").trim()) ||
      (data || [])[0] ||
      null;
    const txt = String(picked?.rule_text || "").trim();
    setVLeagueRuleText(txt);
    setVLeagueRuleDraft(txt);
  }, [clubs]);

  useEffect(() => {
    if (!currentUser || page.type !== "home") return;
    loadVLeagueCheerBoard();
  }, [currentUser, page.type, loadVLeagueCheerBoard]);

  useEffect(() => {
    if (
      !currentUser ||
      !(
        page.type === "home" ||
        (page.type === "clubMain" &&
          isVLeagueClub(page.clubName) &&
          clubTab === "vCheer")
      )
    ) {
      return;
    }
    loadVLeagueCheerEventWinners();
  }, [
    currentUser,
    page.type,
    page.clubName,
    clubTab,
    clubs,
    loadVLeagueCheerEventWinners,
  ]);

  useEffect(() => {
    if (
      !currentUser ||
      !(
        page.type === "home" ||
        (page.type === "clubMain" &&
          isVLeagueClub(page.clubName) &&
          clubTab === "vCheer")
      )
    ) {
      return;
    }
    const run = async () => {
      await runAutoVLeagueCheerEventDraw();
      await loadVLeagueCheerEventWinners();
    };
    run();
    const id = window.setInterval(run, 30000);
    return () => window.clearInterval(id);
  }, [
    currentUser,
    page.type,
    page.clubName,
    clubTab,
    clubs,
    runAutoVLeagueCheerEventDraw,
    loadVLeagueCheerEventWinners,
  ]);

  useEffect(() => {
    if (!currentUser || page.type !== "home") return;
    loadVLeagueTodayMatchText();
  }, [currentUser, page.type, loadVLeagueTodayMatchText]);

  useEffect(() => {
    if (!currentUser || page.type !== "home") return;
    loadHomeTournamentDates();
  }, [currentUser, page.type, loadHomeTournamentDates]);

  useEffect(() => {
    if (visibleVLeagueCheerBoard.length <= 1) return;
    const timer = setInterval(() => {
      setVLeagueCheerBoardIndex((prev) => {
        const len = visibleVLeagueCheerBoard.length;
        if (len <= 1) return prev;
        const next = (prev + 1) % len;
        if (next === 0 && prev === len - 1) {
          setCheerStripNoTransition(true);
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [visibleVLeagueCheerBoard.length]);

  useEffect(() => {
    if (visibleVLeagueCheerBoard.length === 0) {
      setVLeagueCheerBoardIndex(0);
      return;
    }
    setVLeagueCheerBoardIndex((prev) =>
      prev >= visibleVLeagueCheerBoard.length ? 0 : prev
    );
  }, [visibleVLeagueCheerBoard.length]);

  useEffect(() => {
    if (!cheerStripNoTransition) return;
    const t = window.setTimeout(() => setCheerStripNoTransition(false), 24);
    return () => clearTimeout(t);
  }, [cheerStripNoTransition]);

  useLayoutEffect(() => {
    const el = cheerFirstSlideRef.current;
    if (!el || visibleVLeagueCheerBoard.length === 0) return;
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) setCheerSlidePx((prev) => (prev === h ? prev : h));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visibleVLeagueCheerBoard]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vCheer") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    loadVLeagueMatches(club.id);
    loadVLeagueCheers(club.id);
    loadVLeagueCheerEventWinners();
  }, [
    page.type,
    clubTab,
    page.clubName,
    clubs,
    loadVLeagueCheers,
    loadVLeagueMatches,
    loadVLeagueCheerEventWinners,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "schedule") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    loadVLeagueRefereeData(club.id);
  }, [page.type, clubTab, page.clubName, clubs, loadVLeagueRefereeData]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vReferee") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    loadVLeagueMatches(club.id);
    loadVLeagueClasses(club.id);
    loadVLeagueRefereeData(club.id);
  }, [
    page.type,
    clubTab,
    page.clubName,
    clubs,
    loadVLeagueMatches,
    loadVLeagueClasses,
    loadVLeagueRefereeData,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vRules") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    loadVLeagueRuleText(club.id);
  }, [page.type, clubTab, page.clubName, clubs, loadVLeagueRuleText]);

  useEffect(() => {
    if (page.type !== "clubMain") return;
    if (!isVLeagueClub(page.clubName)) return;
    if (isVLeagueAdmin) return;
    if (
      clubTab === "vReferee" ||
      clubTab === "vRules" ||
      clubTab === "vTournament" ||
      clubTab === "vPromotion" ||
      clubTab === "vCheerLookup"
    ) {
      setClubTab("vMatches");
    }
  }, [page.type, page.clubName, clubTab, isVLeagueAdmin]);

  useEffect(() => {
    const vLeagueClub = getClubByName(V_LEAGUE_LABEL);
    if (!vLeagueClub?.id) return;
    if (page.type === "home" || (page.type === "clubMain" && isVLeagueClub(page.clubName))) {
      loadVLeagueRefereeData(vLeagueClub.id);
    }
  }, [page.type, page.clubName, clubs, loadVLeagueRefereeData]);

  const handleCreateVLeagueCheer = async () => {
    setMainMsg("");
    if (currentUser?.role !== "student" && currentUser?.role !== "teacher") return;
    if (!vLeagueCheerWriterClassRow?.id) {
      setMainMsg(
        currentUser.role === "teacher"
          ? "참가 학급에 담임으로 등록된 학급이 없거나, 담임 이름이 일치하지 않습니다."
          : "소속 학급 정보를 찾을 수 없습니다."
      );
      return;
    }
    if (!canWriteVLeagueCheerNow) {
      setMainMsg(
        "응원 글은 우리 반 경기 전날 오후 2시부터, 당일 오후 1시 전까지만 남길 수 있습니다."
      );
      return;
    }
    const msg = String(vLeagueCheerDraft || "").trim();
    if (!msg) {
      setMainMsg("응원 메시지를 입력해 주세요.");
      return;
    }
    if (msg.length > 25) {
      setMainMsg("응원 메시지는 25자 이내로 입력해 주세요.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;

    // 학생은 "같은 경기일(=같은 응원 창)"에 1회만 응원 등록 가능
    if (currentUser.role === "student" && currentUser.id) {
      const now = new Date();
      const activeMatchDates = Array.from(
        new Set(
          (vLeagueMatches || [])
            .filter(
              (m) =>
                (m.home_class_id === vLeagueCheerWriterClassRow.id ||
                  m.away_class_id === vLeagueCheerWriterClassRow.id) &&
                Boolean(m.match_date)
            )
            .map((m) => String(m.match_date).slice(0, 10))
            .filter((ymd) => isNowInVLeagueCheerWindow(ymd))
        )
      );
      if (activeMatchDates.length > 0) {
        const { data: myCheers, error: myCheerErr } = await supabase
          .from("vleague_cheers")
          .select("created_at")
          .eq("club_id", club.id)
          .eq("class_id", vLeagueCheerWriterClassRow.id)
          .eq("student_id", currentUser.id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (myCheerErr) {
          setMainMsg(`응원 글 확인 실패: ${myCheerErr.message}`);
          return;
        }
        const alreadyCheeredTodayMatch = (myCheers || []).some((row) => {
          const created = new Date(row.created_at);
          if (Number.isNaN(created.getTime())) return false;
          return activeMatchDates.some((ymd) => {
            const w = getVLeagueCheerWindowForMatchDate(ymd);
            if (!w) return false;
            return now >= w.start && now < w.end && created >= w.start && created < w.end;
          });
        });
        if (alreadyCheeredTodayMatch) {
          setMainMsg("같은 경기일에는 학생 1명당 응원 메시지를 1회만 등록할 수 있습니다.");
          return;
        }
      }
    }

    const studentName =
      currentUser.role === "teacher"
        ? `${shortClassLabel(vLeagueCheerWriterClassRow.class_name)} 선생님`
        : currentUser.name;
    const cheerInsert = {
      club_id: club.id,
      class_id: vLeagueCheerWriterClassRow.id,
      student_name: studentName,
      message: msg,
    };
    if (currentUser.role === "student" && currentUser.id) {
      cheerInsert.student_id = currentUser.id;
    }
    const { error } = await supabase.from("vleague_cheers").insert([cheerInsert]);
    if (error) {
      const isTeacherStudentIdConstraint =
        currentUser.role === "teacher" &&
        /student_id/i.test(String(error.message || "")) &&
        /not-null|null value/i.test(String(error.message || ""));
      setMainMsg(
        isTeacherStudentIdConstraint
          ? "담임 응원 저장을 위해 DB 설정이 필요합니다. Supabase SQL Editor에서 docs/migrations/20260519-vleague-cheers-teacher-null-student-id.sql 내용을 실행해 주세요."
          : `응원 글 저장 실패: ${error.message}`
      );
      return;
    }
    setVLeagueCheerDraft("");
    const minMatchYmd = getVLeagueCheerCumulativeMinMatchYmd();
    if (
      shouldCountCheerNowForCumulativeTotal(
        vLeagueCheerWriterClassRow.id,
        vLeagueMatches,
        minMatchYmd
      )
    ) {
      await adjustVLeagueCheerClassTotal(
        club.id,
        vLeagueCheerWriterClassRow.id,
        1
      );
      await loadVLeagueCheerCumulativeTotals(club.id);
    }
    await loadVLeagueCheers(club.id, vLeagueCheerWriterClassRow.id);
    await loadVLeagueCheerBoard();
    setMainMsg("우리 반 응원 글을 등록했습니다.");
  };

  const handleDeleteVLeagueCheer = async (row) => {
    setMainMsg("");
    if (!row?.id) return;
    if (currentUser?.role !== "student" && currentUser?.role !== "teacher") return;
    if (!canDeleteVLeagueCheer(row)) {
      setMainMsg(
        canWriteVLeagueCheerNow
          ? "본인이 작성한 응원 글만 삭제할 수 있습니다."
          : "응원 글은 우리 반 경기 전날 오후 2시부터, 당일 오후 1시 전까지만 삭제할 수 있습니다."
      );
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    if (!window.confirm("이 응원 글을 삭제할까요?")) return;

    let query = supabase
      .from("vleague_cheers")
      .delete()
      .eq("id", row.id)
      .eq("club_id", club.id);
    if (currentUser.role === "student") {
      query = query.eq("student_id", currentUser.id);
    } else {
      query = query
        .eq("class_id", vLeagueCheerWriterClassRow.id)
        .is("student_id", null)
        .eq("student_name", myTeacherCheerDisplayName);
    }
    const { error } = await query;
    if (error) {
      setMainMsg(`응원 글 삭제 실패: ${error.message}`);
      return;
    }
    const minMatchYmd = getVLeagueCheerCumulativeMinMatchYmd();
    if (
      shouldCountCheerTowardCumulativeTotal(
        row.class_id,
        row.created_at,
        vLeagueMatches,
        minMatchYmd
      )
    ) {
      await adjustVLeagueCheerClassTotal(club.id, row.class_id, -1);
      await loadVLeagueCheerCumulativeTotals(club.id);
    }
    setMainMsg("응원 글을 삭제했습니다.");
    await loadVLeagueCheers(club.id);
    await loadVLeagueCheerBoard();
  };

  const handleRegisterVLeagueReferee = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("심판 등록은 관리자(홍준영)만 가능합니다.");
      return;
    }
    const studentId = String(vLeagueRefereeStudentIdDraft || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(studentId)) {
      setMainMsg("심판 학번 6자리를 입력해 주세요.");
      return;
    }
    const { data: stu, error: stuErr } = await supabase
      .from("students")
      .select("student_id, name")
      .eq("student_id", studentId)
      .maybeSingle();
    if (stuErr || !stu) {
      setMainMsg("해당 학번 학생을 찾을 수 없습니다.");
      return;
    }
    const studentName = String(stu.name || "").trim();
    if (!studentName) {
      setMainMsg("학생 이름을 찾을 수 없습니다.");
      return;
    }
    if (studentName.length > 20) {
      setMainMsg("심판 이름은 20자 이내여야 합니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    setVLeagueRefereeSaving(true);
    try {
      const exists = (vLeagueReferees || []).some(
        (r) => String(r.student_id || "") === studentId
      );
      if (exists) {
        setMainMsg("이미 등록된 심판입니다.");
        return;
      }
      const { error } = await supabase.from("vleague_referees").insert([
        {
          club_id: club.id,
          student_id: studentId,
          student_name: studentName,
        },
      ]);
      if (error) {
        setMainMsg(`심판 등록 실패: ${error.message}`);
        return;
      }
      setVLeagueRefereeStudentIdDraft("");
      await loadVLeagueRefereeData(club.id);
      setMainMsg("심판이 등록되었습니다.");
    } finally {
      setVLeagueRefereeSaving(false);
    }
  };

  const handleDeleteVLeagueReferee = async (referee) => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("심판 등록 삭제는 관리자(홍준영)만 가능합니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id || !referee?.id) return;
    const studentId = String(referee.student_id || "").trim();
    const studentName = String(referee.student_name || "").trim() || studentId || "해당 심판";
    const ok = window.confirm(
      `${studentName} 심판 등록을 삭제할까요?\n\n- 해당 심판의 경기 배정 기록도 함께 삭제됩니다.`
    );
    if (!ok) return;

    setVLeagueRefereeSaving(true);
    try {
      if (studentId) {
        const { error: assignmentErr } = await supabase
          .from("vleague_referee_assignments")
          .delete()
          .eq("club_id", club.id)
          .eq("student_id", studentId);
        if (assignmentErr) {
          setMainMsg(`심판 배정 삭제 실패: ${assignmentErr.message}`);
          return;
        }
      }
      const { error } = await supabase
        .from("vleague_referees")
        .delete()
        .eq("club_id", club.id)
        .eq("id", referee.id);
      if (error) {
        setMainMsg(`심판 등록 삭제 실패: ${error.message}`);
        return;
      }
      await loadVLeagueRefereeData(club.id);
      if (studentId && String(vLeagueScheduleRefLookupStudentId || "") === studentId) {
        setVLeagueScheduleRefLookupDraft("");
        setVLeagueScheduleRefLookupStudentId("");
      }
      setMainMsg("심판 등록을 삭제했습니다.");
    } finally {
      setVLeagueRefereeSaving(false);
    }
  };

  const handleSaveVLeagueRuleText = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("규칙 수정은 관리자(홍준영)만 가능합니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    const text = String(vLeagueRuleDraft || "").trim();
    if (!text) {
      setMainMsg("규칙 내용을 입력해 주세요.");
      return;
    }
    setVLeagueRuleSaving(true);
    try {
      let { error } = await supabase.from("vleague_rule_settings").upsert(
        {
          club_id: club.id,
          rule_text: text,
          updated_by: currentUser?.name || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "club_id" }
      );
      if (error) {
        setMainMsg(`규칙 저장 실패: ${error.message}`);
        return;
      }
      setVLeagueRuleText(text);
      setMainMsg("V리그 규칙을 저장했습니다.");
    } finally {
      setVLeagueRuleSaving(false);
    }
  };

  const handleAssignVLeagueReferee = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("경기 배정은 관리자(홍준영)만 가능합니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    const targetMatches = (vLeagueCurrentLeagueMatches || []).filter((m) => Boolean(m.id));
    if (targetMatches.length === 0) {
      setMainMsg("배정할 저장된 경기가 없습니다.");
      return;
    }
    const ok = window.confirm(
      `${vLeagueGradeTab === "malgeun" ? "맑은샘" : "고운샘"} 리그 ${targetMatches.length}경기에 심판 2명을 일괄 랜덤 배정할까요?\n\n- 기존 배정(해당 리그 경기에 걸린 배정)은 덮어씁니다.\n- 같은 날짜 중복 배정은 허용되지 않습니다.\n- 본인 학급 경기는 배정되지 않습니다.`
    );
    if (!ok) return;

    setVLeagueRefereeSaving(true);
    try {
      const { data: students, error: stuErr } = await supabase
        .from("students")
        .select("student_id, name");
      if (stuErr || !students) {
        setMainMsg("학생 목록을 불러오지 못했습니다.");
        return;
      }
      const registeredStudentIdSet = new Set(
        (vLeagueReferees || []).map((r) => String(r.student_id || "")).filter(Boolean)
      );
      const targetMatchIds = new Set(targetMatches.map((m) => m.id));
      const usedByDate = new Map(); // ymd -> Set(student_id)
      for (const a of vLeagueRefereeAssignments || []) {
        if (targetMatchIds.has(a.match_id)) continue;
        const am = vLeagueMatchById.get(a.match_id);
        const ymd = String(am?.match_date || "");
        if (!ymd) continue;
        if (!usedByDate.has(ymd)) usedByDate.set(ymd, new Set());
        usedByDate.get(ymd).add(String(a.student_id || ""));
      }

      const shuffle = (arr) => {
        const out = [...arr];
        for (let i = out.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = out[i];
          out[i] = out[j];
          out[j] = tmp;
        }
        return out;
      };

      const roleOrder = ["chief", "assistant1"];
      const payload = [];
      const orderedMatches = [...targetMatches].sort((a, b) => {
        const ad = String(a.match_date || "");
        const bd = String(b.match_date || "");
        if (ad !== bd) return ad.localeCompare(bd);
        return (a.match_no || 0) - (b.match_no || 0);
      });

      for (const match of orderedMatches) {
        const homeClass = normalizeClubName(vleagueClassNameById[match.home_class_id] || "");
        const awayClass = normalizeClubName(vleagueClassNameById[match.away_class_id] || "");
        const ymd = String(match.match_date || "");
        const used = usedByDate.get(ymd) || new Set();
        const eligible = (students || []).filter((s) => {
          const sid = String(s.student_id || "");
          const sname = String(s.name || "").trim();
          if (!/^\d{6}$/.test(sid) || !sname) return false;
          const gradePrefix = sid.slice(0, 2);
          if (vLeagueGradeTab === "malgeun" && gradePrefix !== "05") return false;
          if (vLeagueGradeTab === "goun" && gradePrefix !== "06") return false;
          if (!registeredStudentIdSet.has(sid)) return false;
          const className = formatClassNameFromStudentId(sid);
          if (!className) return false;
          const classNorm = normalizeClubName(className);
          if (classNorm === homeClass || classNorm === awayClass) return false;
          if (ymd && used.has(sid)) return false;
          return true;
        });
        if (eligible.length < 2) {
          setMainMsg(
            `${ymd || "날짜미정"} 경기 배정 실패: 조건을 만족하는 심판 후보가 2명보다 적습니다.`
          );
          return;
        }
        const picked = shuffle(eligible).slice(0, 2);
        picked.forEach((p, idx) => {
          payload.push({
            club_id: club.id,
            match_id: match.id,
            student_id: String(p.student_id),
            student_name: String(p.name || "").trim(),
            assignment_role: roleOrder[idx],
          });
          if (ymd) used.add(String(p.student_id));
        });
        if (ymd) usedByDate.set(ymd, used);
      }

      const { error: delErr } = await supabase
        .from("vleague_referee_assignments")
        .delete()
        .eq("club_id", club.id)
        .in("match_id", Array.from(targetMatchIds));
      if (delErr) {
        setMainMsg(`기존 배정 삭제 실패: ${delErr.message}`);
        return;
      }

      const { error } = await supabase.from("vleague_referee_assignments").insert(payload);
      if (error) {
        setMainMsg(`심판 일괄 배정 실패: ${error.message}`);
        return;
      }
      await loadVLeagueRefereeData(club.id);
      setMainMsg(
        `${vLeagueGradeTab === "malgeun" ? "맑은샘" : "고운샘"} 리그 ${targetMatches.length}경기에 심판을 일괄 랜덤 배정했습니다.`
      );
    } finally {
      setVLeagueRefereeSaving(false);
    }
  };

  const handleDeleteAllVLeagueRefereeAssignments = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("배정 삭제는 관리자(홍준영)만 가능합니다.");
      return;
    }
    const club = getClubByName(page.clubName);
    if (!club?.id) return;
    const ok = window.confirm(
      "심판 배정을 전체 삭제할까요?\n\n- vleague_referee_assignments 데이터가 모두 삭제됩니다."
    );
    if (!ok) return;
    setVLeagueRefereeSaving(true);
    try {
      const { error } = await supabase
        .from("vleague_referee_assignments")
        .delete()
        .eq("club_id", club.id);
      if (error) {
        setMainMsg(`배정 전체 삭제 실패: ${error.message}`);
        return;
      }
      await loadVLeagueRefereeData(club.id);
      setMainMsg("심판 배정을 전체 삭제했습니다.");
    } finally {
      setVLeagueRefereeSaving(false);
    }
  };

  const generateRoundRobin = (teams) => {
    const list = [...(teams || [])];
    if (list.length < 2) return [];
    const hasBye = list.length % 2 === 1;
    if (hasBye) list.push(null);
    const n = list.length;
    const rounds = [];
    const arr = [...list];
    for (let r = 0; r < n - 1; r += 1) {
      const matches = [];
      for (let i = 0; i < n / 2; i += 1) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        if (!a || !b) continue;
        const swap = r % 2 === 1 && i === 0;
        const home = swap ? b : a;
        const away = swap ? a : b;
        matches.push({ home, away });
      }
      rounds.push(matches);
      // circle method rotation (keep first fixed)
      const fixed = arr[0];
      const rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr.splice(0, arr.length, fixed, ...rest);
    }
    return rounds;
  };

  const buildVLeagueDraftFromClasses = (leagueKey) => {
    const { malgeun, goun } = splitVLeagueClassesByGrade(vLeagueClasses || []);
    const teams = (leagueKey === "malgeun" ? malgeun : goun).map((r) => ({
      id: r.id,
      class_name: r.class_name,
    }));
    const rounds = generateRoundRobin(teams);
    const flat = [];
    let globalMatchNo = 1;
    let gamesToday = 0;
    let curDate = vLeagueGenApplyDates
      ? nextPlayableYmd(vLeagueGenStartDate, leagueKey)
      : null;
    for (let r = 0; r < rounds.length; r += 1) {
      const roundNo = r + 1;
      for (let m = 0; m < rounds[r].length; m += 1) {
        const { home, away } = rounds[r][m];
        let matchDate = null;
        if (vLeagueGenApplyDates) {
          const perDay = Math.max(1, Number(vLeagueGenGamesPerDay || 1));
          if (gamesToday >= perDay) {
            curDate = nextPlayableYmd(addDaysYmd(curDate, 1), leagueKey);
            gamesToday = 0;
          }
          matchDate = curDate;
          gamesToday += 1;
        }
        flat.push({
          league: leagueKey,
          round_no: roundNo,
          match_no: globalMatchNo,
          home_class_id: home.id,
          away_class_id: away.id,
          match_date: matchDate,
          status: "scheduled",
          home_score: null,
          away_score: null,
        });
        globalMatchNo += 1;
      }
      if (vLeagueGenApplyDates) {
        // 다음 라운드는 다음날부터 시작되게(가독성)
        curDate = nextPlayableYmd(addDaysYmd(curDate, 1), leagueKey);
        gamesToday = 0;
      }
    }
    const roundGroups = [];
    for (const row of flat) {
      const idx = row.round_no - 1;
      if (!roundGroups[idx]) roundGroups[idx] = { round_no: row.round_no, matches: [] };
      roundGroups[idx].matches.push(row);
    }
    return { league: leagueKey, rounds: roundGroups.filter(Boolean), flat };
  };

  const handleGenerateVLeagueMatches = () => {
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성은 관리자(홍준영)만 가능합니다.");
      return;
    }
    setMainMsg("");
    const leagueKey = vLeagueGradeTab;
    const draft = buildVLeagueDraftFromClasses(leagueKey);
    if (!draft.flat.length) {
      setMainMsg("대진표를 만들 학급이 2개 이상 필요합니다.");
      setVLeagueMatchesDraft(null);
      return;
    }
    setVLeagueMatchesDraft(draft);
    setMainMsg("대진표 초안을 만들었습니다. 저장하거나 일정에 반영해 주세요.");
  };

  const handleSaveVLeagueMatchesToSupabase = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 저장은 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    if (!vLeagueMatchesDraft?.flat?.length) {
      setMainMsg("저장할 대진표 초안이 없습니다. 먼저 자동 생성해 주세요.");
      return;
    }
    setVLeagueSavingMatches(true);
    try {
      // 기존 동일 리그 대진표는 작성자와 무관하게 먼저 삭제
      // (과거 데이터 created_by 값 차이로 중복 누적되는 문제 방지)
      const { error: delErr } = await supabase
        .from("vleague_matches")
        .delete()
        .eq("club_id", club.id)
        .eq("league", vLeagueMatchesDraft.league);
      if (delErr) {
        setMainMsg(`대진표 초기화 실패: ${delErr.message}`);
        return;
      }

      const payload = vLeagueMatchesDraft.flat.map((m) => ({
        club_id: club.id,
        league: m.league,
        round_no: m.round_no,
        match_no: m.match_no,
        match_date: m.match_date,
        home_class_id: m.home_class_id,
        away_class_id: m.away_class_id,
        status: m.status,
        home_score: m.home_score,
        away_score: m.away_score,
        created_by: vLeagueAdminNameNorm,
      }));

      const { error } = await supabase.from("vleague_matches").insert(payload);
      if (error) {
        setMainMsg(`대진표 저장 실패: ${error.message}`);
        return;
      }
      setMainMsg("대진표가 저장되었습니다.");
      setVLeagueMatchesDraft(null);
      await loadVLeagueMatches(club.id);
    } finally {
      setVLeagueSavingMatches(false);
    }
  };

  const handlePushVLeagueMatchesToCalendar = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("일정 반영은 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    const source = vLeagueMatchesDraft?.flat?.length
      ? vLeagueMatchesDraft.flat
      : vLeagueMatches.filter((m) => m.league === vLeagueGradeTab);
    const rows = (source || []).filter((m) => Boolean(m.match_date));
    if (rows.length === 0) {
      setMainMsg("일정에 넣을 날짜가 있는 경기가 없습니다. (날짜 적용을 켜고 생성해 주세요.)");
      return;
    }
    setVLeaguePushingToCalendar(true);
    try {
      const contentRows = rows.map((m) => {
        return {
          club_id: club.id,
          event_date: m.match_date,
          content: formatVLeagueEventContent(m),
          created_by: currentUser?.name || null,
        };
      });
      const { error } = await supabase.from("club_events").insert(contentRows);
      if (error) {
        setMainMsg(`일정 반영 실패: ${error.message}`);
        return;
      }
      setMainMsg("일정에 대진표를 반영했습니다. (일정 탭에서 확인 가능)");
      await loadEventsForMonth(club.id, calendarMonth);
    } finally {
      setVLeaguePushingToCalendar(false);
    }
  };

  const handleSyncVLeagueCalendarEvents = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("일정 정리는 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;

    const rows = (vLeagueMatches || []).filter(
      (m) => m.league === vLeagueGradeTab && Boolean(m.match_date) && Boolean(m.id)
    );
    if (rows.length === 0) {
      setMainMsg("정리할 저장된 대진표가 없습니다. 먼저 대진표를 저장해 주세요.");
      return;
    }

    const ok = window.confirm(
      "선택한 리그의 경기 일정을 정리하고 현재 대진표 기준으로 다시 만들까요?\n\n- 기존 경기 일정(해당 리그)은 삭제됩니다.\n- 중복 일정이 정리됩니다."
    );
    if (!ok) return;

    setVLeagueSyncingCalendar(true);
    try {
      const leagueLabel = vLeagueGradeTab === "malgeun" ? "맑은샘" : "고운샘";
      const leaguePrefix = `[${leagueLabel}]`;
      const matchTokenSet = new Set(
        rows.map((m) => formatVLeagueMatchToken(m.id).trim()).filter(Boolean)
      );

      // 1) 해당 클럽 전체 일정에서 현재 리그 경기 일정만 찾아 삭제
      const { data: allEvents, error: loadErr } = await supabase
        .from("club_events")
        .select("id, content")
        .eq("club_id", club.id);
      if (loadErr) {
        setMainMsg(`기존 일정 조회 실패: ${loadErr.message}`);
        return;
      }

      const deleteIds = (allEvents || [])
        .filter((ev) => {
          const content = String(ev.content || "");
          if (!content.startsWith(leaguePrefix)) return false;
          for (const token of matchTokenSet) {
            if (content.includes(token)) return true;
          }
          // 토큰 없는 과거 형식도 같은 리그면 정리 대상에 포함
          return true;
        })
        .map((ev) => ev.id);

      if (deleteIds.length > 0) {
        const { error: delErr } = await supabase
          .from("club_events")
          .delete()
          .in("id", deleteIds);
        if (delErr) {
          setMainMsg(`기존 일정 삭제 실패: ${delErr.message}`);
          return;
        }
      }

      // 2) 현재 저장된 대진표 기준으로 일정 재생성
      const payload = rows.map((m) => ({
        club_id: club.id,
        event_date: m.match_date,
        content: formatVLeagueEventContent(m),
        created_by: currentUser?.name || null,
      }));
      const { error: insErr } = await supabase.from("club_events").insert(payload);
      if (insErr) {
        setMainMsg(`일정 재생성 실패: ${insErr.message}`);
        return;
      }

      setMainMsg(
        `일정 중복 정리 완료: ${deleteIds.length}건 삭제, ${payload.length}건 재생성했습니다.`
      );
      await loadEventsForMonth(club.id, calendarMonth);
    } finally {
      setVLeagueSyncingCalendar(false);
    }
  };

  const handleDeleteAllVLeagueMatchesFromSupabase = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 전체 삭제는 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    const ok = window.confirm(
      "새샘 V리그 대진표를 Supabase에서 전체 삭제할까요?\n\n- 맑은샘/고운샘 모든 경기(vleague_matches)가 삭제됩니다.\n- 일정에 반영된 V리그 경기(club_events)도 함께 삭제됩니다.\n- 이 작업은 되돌릴 수 없습니다."
    );
    if (!ok) return;

    setVLeagueDeletingMatchesAll(true);
    try {
      const { error } = await supabase
        .from("vleague_matches")
        .delete()
        .eq("club_id", club.id);
      if (error) {
        setMainMsg(`대진표 전체 삭제 실패: ${error.message}`);
        return;
      }
      const { data: allEvents, error: loadEventsErr } = await supabase
        .from("club_events")
        .select("id, content")
        .eq("club_id", club.id);
      if (loadEventsErr) {
        setMainMsg(`일정 조회 실패: ${loadEventsErr.message}`);
        return;
      }
      const vLeagueEventIds = (allEvents || [])
        .filter((ev) => {
          const c = String(ev.content || "");
          return c.startsWith("[맑은샘]") || c.startsWith("[고운샘]");
        })
        .map((ev) => ev.id);
      if (vLeagueEventIds.length > 0) {
        const { error: delEventsErr } = await supabase
          .from("club_events")
          .delete()
          .in("id", vLeagueEventIds);
        if (delEventsErr) {
          setMainMsg(`일정 삭제 실패: ${delEventsErr.message}`);
          return;
        }
      }
      setVLeagueMatchesDraft(null);
      setVLeagueResultDrafts({});
      await loadVLeagueMatches(club.id);
      await loadEventsForMonth(club.id, calendarMonth);
      setMainMsg(
        `새샘 V리그 대진표 전체 삭제 완료: 대진표(vleague_matches)와 일정 ${vLeagueEventIds.length}건(club_events)을 삭제했습니다.`
      );
    } finally {
      setVLeagueDeletingMatchesAll(false);
    }
  };

  const handleSaveVLeagueMatchResult = async (matchRow) => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("경기 결과 입력은 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    if (!matchRow?.id) {
      setMainMsg("저장된 대진표에서만 경기 결과를 입력할 수 있습니다.");
      return;
    }
    const draft = vLeagueResultDrafts[matchRow.id] || {};
    const homeRaw = draft.home ?? matchRow.home_score ?? "";
    const awayRaw = draft.away ?? matchRow.away_score ?? "";
    const winRaw = draft.winScore ?? "";
    const homeScore = Number(homeRaw);
    const awayScore = Number(awayRaw);
    const winScore = Number(winRaw);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      setMainMsg("점수를 숫자로 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(winScore) || winScore <= 0) {
      setMainMsg("경기별 승리 점수를 1 이상 숫자로 입력해 주세요.");
      return;
    }
    if (homeScore < 0 || awayScore < 0) {
      setMainMsg("점수는 0 이상이어야 합니다.");
      return;
    }
    const homeWin = homeScore === winScore && awayScore !== winScore;
    const awayWin = awayScore === winScore && homeScore !== winScore;
    if (!homeWin && !awayWin) {
      setMainMsg("한 팀만 '승리 점수'에 도달해야 결과를 저장할 수 있습니다.");
      return;
    }
    setVLeagueResultSavingId(matchRow.id);
    try {
      const { error } = await supabase
        .from("vleague_matches")
        .update({
          home_score: homeScore,
          away_score: awayScore,
          status: "completed",
        })
        .eq("id", matchRow.id)
        .eq("club_id", club.id);
      if (error) {
        setMainMsg(`경기 결과 저장 실패: ${error.message}`);
        return;
      }
      setMainMsg("경기 결과를 저장했습니다. 순위표가 자동 갱신됩니다.");
      setVLeagueResultDrafts((prev) => {
        const next = { ...prev };
        delete next[matchRow.id];
        return next;
      });
      await loadVLeagueMatches(club.id);
    } finally {
      setVLeagueResultSavingId(null);
    }
  };

  const getMaxMatchDateYmd = (matches) => {
    let max = null;
    for (const m of matches || []) {
      if (!m.match_date) continue;
      if (!max || String(m.match_date) > String(max)) max = m.match_date;
    }
    return max;
  };

  const isDateBlockedByEvents = async (clubId, ymd) => {
    const { data, error } = await supabase
      .from("club_events")
      .select("id")
      .eq("club_id", clubId)
      .eq("event_date", ymd)
      .limit(1);
    if (error) return true;
    return (data || []).length > 0;
  };

  const findNextAvailableDateAfter = async (clubId, startYmd, leagueKey) => {
    let cur = nextPlayableYmd(startYmd, leagueKey);
    for (let i = 0; i < 366; i += 1) {
      if (!cur) return null;
      const blocked = await isDateBlockedByEvents(clubId, cur);
      if (!blocked) return cur;
      cur = nextPlayableYmd(addDaysYmd(cur, 1), leagueKey);
    }
    return cur;
  };

  const getSiblingMatchIds = async (matchRow) => {
    if (!matchRow?.id) return [];
    const home = String(matchRow.home_class_id || "");
    const away = String(matchRow.away_class_id || "");
    let query = supabase
      .from("vleague_matches")
      .select("id, home_class_id, away_class_id")
      .eq("league", String(matchRow.league || ""))
      .eq("round_no", Number(matchRow.round_no || 0))
      .eq("match_no", Number(matchRow.match_no || 0))
      .limit(5000);
    const { data } = await query;
    const ids = (data || [])
      .filter((m) => {
        const h = String(m.home_class_id || "");
        const a = String(m.away_class_id || "");
        return (h === home && a === away) || (h === away && a === home);
      })
      .map((m) => m.id)
      .filter(Boolean);
    return Array.from(new Set(ids.length > 0 ? ids : [matchRow.id]));
  };

  const handlePostponeMatchToEnd = async (matchRow) => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    if (!matchRow?.id) {
      setMainMsg("저장된 대진표에서만 변경할 수 있습니다.");
      return;
    }

    const ok = window.confirm(
      "이 경기를 맨 뒤 날짜로 연기할까요?\n\n- 다른 경기 날짜는 그대로 유지됩니다.\n- 토/일, 제외 날짜(공휴일), 기존 일정이 있는 날짜는 피해서 배정됩니다."
    );
    if (!ok) return;

    setVLeagueMatchPostponingId(matchRow.id);
    try {
      // 현재 리그의 마지막 경기 날짜 다음날부터 탐색
      const sameLeague = vLeagueMatches.filter((m) => m.league === matchRow.league);
      const maxDate = getMaxMatchDateYmd(sameLeague) || matchRow.match_date || toYmd(new Date());
      const start = addDaysYmd(maxDate, 1);
      const nextDate = await findNextAvailableDateAfter(club.id, start, matchRow.league);
      if (!nextDate) {
        setMainMsg("다음 가능한 날짜를 찾지 못했습니다.");
        return;
      }

      // 1) vleague_matches 날짜 업데이트
      const siblingIds = await getSiblingMatchIds(matchRow);
      const { error: upErr } = await supabase
        .from("vleague_matches")
        .update({ match_date: nextDate })
        .in("id", siblingIds);
      if (upErr) {
        setMainMsg(`대진표 날짜 변경 실패: ${upErr.message}`);
        return;
      }
      const { data: verifyRows, error: verifyErr } = await supabase
        .from("vleague_matches")
        .select("id, match_date")
        .in("id", siblingIds);
      if (verifyErr) {
        setMainMsg(`대진표 날짜 변경 확인 실패: ${verifyErr.message}`);
        return;
      }
      const applied = (verifyRows || []).some(
        (r) => String(r?.match_date || "") === String(nextDate)
      );
      if (!applied) {
        setMainMsg(
          "대진표 날짜가 실제로 변경되지 않았습니다. UPDATE 권한(RLS) 또는 대상 경기 중복 데이터를 확인해 주세요."
        );
        return;
      }
      setVLeagueMatches((prev) =>
        (prev || []).map((row) =>
          siblingIds.includes(row.id) ? { ...row, match_date: nextDate } : row
        )
      );

      // 2) 기존 일정(있으면) 삭제 후 새 날짜로 등록
      for (const sid of siblingIds) {
        const token = formatVLeagueMatchToken(sid).trim();
        if (token) {
          await supabase.from("club_events").delete().ilike("content", `%${token}%`);
        }
      }
      const siblingRows = (vLeagueMatches || []).filter((m) => siblingIds.includes(m.id));
      const rowsToInsert = (siblingRows.length > 0 ? siblingRows : [matchRow]).map((row) => ({
        club_id: row.club_id || club.id,
        event_date: nextDate,
        content: formatVLeagueEventContent({ ...row, match_date: nextDate }),
        created_by: currentUser?.name || null,
      }));
      if (rowsToInsert.length > 0) {
        await supabase.from("club_events").insert(rowsToInsert);
      }

      setVLeaguePostponeUndoByMatchId((prev) => ({
        ...prev,
        [matchRow.id]: {
          matchId: matchRow.id,
          fromDate: matchRow.match_date || "",
          toDate: nextDate,
        },
      }));
      setMainMsg(`해당 경기를 ${nextDate}로 연기해 맨 뒤로 보냈습니다.`);
      {
        const vClubIds = getVLeagueClubIds();
        await loadVLeagueMatches(vClubIds.length > 0 ? vClubIds : club.id);
      }
      await loadEventsForMonth(club.id, calendarMonth);
    } finally {
      setVLeagueMatchPostponingId(null);
    }
  };

  const handleUndoPostponedMatch = async (matchRow) => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club || !matchRow?.id) return;
    const undo = vLeaguePostponeUndoByMatchId[matchRow.id];
    if (!undo?.fromDate) {
      setMainMsg("되돌릴 연기 이력이 없습니다.");
      return;
    }
    if (String(matchRow.match_date || "") !== String(undo.toDate || "")) {
      setMainMsg("현재 경기 날짜가 변경되어 되돌릴 수 없습니다.");
      return;
    }

    const ok = window.confirm(`이 경기를 ${undo.fromDate} 날짜로 되돌릴까요?`);
    if (!ok) return;

    setVLeagueUndoingMatchId(matchRow.id);
    try {
      const siblingIds = await getSiblingMatchIds(matchRow);
      const { error: upErr } = await supabase
        .from("vleague_matches")
        .update({ match_date: undo.fromDate })
        .in("id", siblingIds);
      if (upErr) {
        setMainMsg(`경기 되돌리기 실패: ${upErr.message}`);
        return;
      }
      const { data: verifyRows, error: verifyErr } = await supabase
        .from("vleague_matches")
        .select("id, match_date")
        .in("id", siblingIds);
      if (verifyErr) {
        setMainMsg(`경기 되돌리기 확인 실패: ${verifyErr.message}`);
        return;
      }
      const applied = (verifyRows || []).some(
        (r) => String(r?.match_date || "") === String(undo.fromDate)
      );
      if (!applied) {
        setMainMsg(
          "경기 날짜 되돌리기가 실제로 반영되지 않았습니다. UPDATE 권한(RLS) 또는 대상 경기 데이터를 확인해 주세요."
        );
        return;
      }
      setVLeagueMatches((prev) =>
        (prev || []).map((row) =>
          siblingIds.includes(row.id) ? { ...row, match_date: undo.fromDate } : row
        )
      );

      for (const sid of siblingIds) {
        const token = formatVLeagueMatchToken(sid).trim();
        if (token) {
          await supabase.from("club_events").delete().ilike("content", `%${token}%`);
        }
      }
      const siblingRows = (vLeagueMatches || []).filter((m) => siblingIds.includes(m.id));
      const rowsToInsert = (siblingRows.length > 0 ? siblingRows : [matchRow]).map((row) => ({
        club_id: row.club_id || club.id,
        event_date: undo.fromDate,
        content: formatVLeagueEventContent({ ...row, match_date: undo.fromDate }),
        created_by: currentUser?.name || null,
      }));
      if (rowsToInsert.length > 0) {
        await supabase.from("club_events").insert(rowsToInsert);
      }

      setVLeaguePostponeUndoByMatchId((prev) => {
        const next = { ...prev };
        delete next[matchRow.id];
        return next;
      });
      setMainMsg(`연기한 경기를 ${undo.fromDate}로 되돌렸습니다.`);
      {
        const vClubIds = getVLeagueClubIds();
        await loadVLeagueMatches(vClubIds.length > 0 ? vClubIds : club.id);
      }
      await loadEventsForMonth(club.id, calendarMonth);
    } finally {
      setVLeagueUndoingMatchId(null);
    }
  };

  const handleManualRestoreMatchDate = async (matchRow) => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 생성/수정은 관리자만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club || !matchRow?.id) return;
    const undoDate = String(vLeaguePostponeUndoByMatchId[matchRow.id]?.fromDate || "").trim();
    const defaultDate = undoDate || String(matchRow.match_date || "").slice(0, 10);
    const input = window.prompt(
      "복구할 경기 날짜를 입력해 주세요. (YYYY-MM-DD)",
      defaultDate
    );
    if (input == null) return;
    const targetDate = String(input || "").trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
    if (!m) {
      setMainMsg("날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== mo - 1 ||
      dt.getDate() !== d
    ) {
      setMainMsg("유효하지 않은 날짜입니다.");
      return;
    }
    const ok = window.confirm(`이 경기를 ${targetDate} 날짜로 복구할까요?`);
    if (!ok) return;

    setVLeagueManualRestoreMatchId(matchRow.id);
    try {
      const siblingIds = await getSiblingMatchIds(matchRow);
      const { error: upErr } = await supabase
        .from("vleague_matches")
        .update({ match_date: targetDate })
        .in("id", siblingIds);
      if (upErr) {
        setMainMsg(`경기 날짜 복구 실패: ${upErr.message}`);
        return;
      }
      const { data: verifyRows, error: verifyErr } = await supabase
        .from("vleague_matches")
        .select("id, match_date")
        .in("id", siblingIds);
      if (verifyErr) {
        setMainMsg(`경기 날짜 복구 확인 실패: ${verifyErr.message}`);
        return;
      }
      const applied = (verifyRows || []).some(
        (r) => String(r?.match_date || "") === String(targetDate)
      );
      if (!applied) {
        setMainMsg(
          "경기 날짜 복구가 실제로 반영되지 않았습니다. UPDATE 권한(RLS) 또는 대상 경기 데이터를 확인해 주세요."
        );
        return;
      }
      setVLeagueMatches((prev) =>
        (prev || []).map((row) =>
          siblingIds.includes(row.id) ? { ...row, match_date: targetDate } : row
        )
      );

      for (const sid of siblingIds) {
        const token = formatVLeagueMatchToken(sid).trim();
        if (token) {
          await supabase.from("club_events").delete().ilike("content", `%${token}%`);
        }
      }
      const siblingRows = (vLeagueMatches || []).filter((m) => siblingIds.includes(m.id));
      const rowsToInsert = (siblingRows.length > 0 ? siblingRows : [matchRow]).map((row) => ({
        club_id: row.club_id || club.id,
        event_date: targetDate,
        content: formatVLeagueEventContent({ ...row, match_date: targetDate }),
        created_by: currentUser?.name || null,
      }));
      if (rowsToInsert.length > 0) {
        await supabase.from("club_events").insert(rowsToInsert);
      }

      setMainMsg(`해당 경기를 ${targetDate}로 복구했습니다.`);
      {
        const vClubIds = getVLeagueClubIds();
        await loadVLeagueMatches(vClubIds.length > 0 ? vClubIds : club.id);
      }
      await ensureClubEventsLoaded(page.clubName, calendarMonth);
    } finally {
      setVLeagueManualRestoreMatchId(null);
    }
  };

  const handleValidateVLeagueSchedule = async () => {
    setMainMsg("");
    if (!isVLeagueAdmin) {
      setMainMsg("대진표 검증은 관리자(홍준영)만 가능합니다.");
      return;
    }
    if (!page.clubName) return;
    const club = getClubByName(page.clubName);
    if (!club) return;

    setVLeagueValidating(true);
    try {
      const savedMatches = (vLeagueMatches || []).filter((m) => Boolean(m.id));
      if (savedMatches.length === 0) {
        setMainMsg("검증할 저장된 대진표가 없습니다.");
        return;
      }

      const pairKeyFromIds = (a, b) => {
        const x = String(a || "");
        const y = String(b || "");
        return x < y ? `${x}__${y}` : `${y}__${x}`;
      };
      const classNameById = new Map((vLeagueClasses || []).map((c) => [c.id, c.class_name]));

      const pairToMatchRows = new Map();
      for (const m of savedMatches) {
        const key = pairKeyFromIds(m.home_class_id, m.away_class_id);
        if (!pairToMatchRows.has(key)) pairToMatchRows.set(key, []);
        pairToMatchRows.get(key).push(m);
      }
      const duplicatedPairMatches = Array.from(pairToMatchRows.values()).filter(
        (rows) => rows.length > 1
      );

      const { data: allEvents, error: evErr } = await supabase
        .from("club_events")
        .select("id, content")
        .eq("club_id", club.id);
      if (evErr) {
        setMainMsg(`일정 조회 실패: ${evErr.message}`);
        return;
      }
      const vLeagueEvents = (allEvents || []).filter((ev) => {
        const c = String(ev.content || "");
        return c.startsWith("[맑은샘]") || c.startsWith("[고운샘]");
      });

      // 같은 match token(⟦vm:...⟧)이 2번 이상 등장하면 일정 중복
      const tokenToEvents = new Map();
      for (const ev of vLeagueEvents) {
        const m = String(ev.content || "").match(/⟦vm:([^\]]+)⟧/);
        if (!m) continue;
        const token = m[1];
        if (!tokenToEvents.has(token)) tokenToEvents.set(token, []);
        tokenToEvents.get(token).push(ev);
      }
      const duplicatedEventTokens = Array.from(tokenToEvents.entries()).filter(
        ([, rows]) => rows.length > 1
      );

      const duplicatedPairLabels = duplicatedPairMatches.map((rows) => {
        const one = rows[0];
        const a = classNameById.get(one.home_class_id) || "학급";
        const b = classNameById.get(one.away_class_id) || "학급";
        return `${shortClassLabel(a)} vs ${shortClassLabel(b)} (${rows.length}회)`;
      });

      if (duplicatedPairLabels.length === 0 && duplicatedEventTokens.length === 0) {
        setMainMsg("검증 완료: 같은 학급끼리의 중복 경기가 없습니다.");
        return;
      }

      const parts = [];
      if (duplicatedPairLabels.length > 0) {
        parts.push(
          `대진표 중복 ${duplicatedPairLabels.length}건: ${duplicatedPairLabels
            .slice(0, 4)
            .join(", ")}${duplicatedPairLabels.length > 4 ? " ..." : ""}`
        );
      }
      if (duplicatedEventTokens.length > 0) {
        parts.push(`일정 중복 ${duplicatedEventTokens.length}건(같은 경기 토큰 중복)`);
      }
      setMainMsg(`검증 결과: ${parts.join(" / ")}`);
    } finally {
      setVLeagueValidating(false);
    }
  };

  const canEditVLeagueClassNickname = (row) => {
    if (!currentUser || currentUser.role !== "teacher") return false;
    const t = row.homeroom_teacher_name;
    if (!t || !String(t).trim()) return false;
    return (
      normalizeTeacherName(currentUser.name) ===
      normalizeTeacherName(String(t))
    );
  };

  const handleSaveVLeagueNickname = async (row) => {
    const club = getClubByName(page.clubName);
    if (!club || !isVLeagueClub(page.clubName)) return;
    if (!canEditVLeagueClassNickname(row)) {
      setMainMsg("이 학급 별명을 수정할 권한이 없습니다.");
      return;
    }
    const raw =
      vLeagueNickDrafts[row.id] !== undefined
        ? vLeagueNickDrafts[row.id]
        : (row.nickname ?? "");
    const val = String(raw).trim();
    if (val.length > 10) {
      setMainMsg("별명은 10자 이내로 입력해 주세요.");
      return;
    }
    setVLeagueNicknameSavingId(row.id);
    setMainMsg("");
    const { error } = await supabase
      .from("vleague_classes")
      .update({ nickname: val || null })
      .eq("id", row.id)
      .eq("club_id", club.id);
    setVLeagueNicknameSavingId(null);
    if (error) {
      setMainMsg(`별명 저장 실패: ${error.message}`);
      return;
    }
    setVLeagueClasses((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, nickname: val || null } : r
      )
    );
    setVLeagueNickDrafts((prev) => ({ ...prev, [row.id]: val }));
    // 별명 저장 직후 서버 데이터를 다시 읽어 순위표/참가학급에 즉시 반영
    await loadVLeagueClasses(club.id);
    setMainMsg("별명이 저장되었습니다. 순위표에도 바로 반영되었습니다.");
  };

  const getMyStatusForClub = (clubId) => myAppByClubId[clubId]?.status || null;

  const handleSelectClub = async (name) => {
    setSelectedClubName(name);
    setShowVLeagueHomeStandingsPopup(false);
    if (isVLeagueClub(name)) {
      await loadHomeVLeagueTournamentEvents();
      setShowVLeagueHomeTournamentPopup(true);
    } else {
      setShowVLeagueHomeTournamentPopup(false);
    }
    setApplications([]);
    setMainMsg("");
    if (page.type !== "home") setPage({ type: "home", clubName: null });

  };

  const handleApplyClub = async () => {
    setMainMsg("");

    if (!currentUser || currentUser.role !== "student") {
      setMainMsg("학생만 신청할 수 있습니다.");
      return;
    }

    if (isVLeagueClub(selectedClubName)) {
      setMainMsg(
        "새샘 V리그는 신청·승인 없이 바로 입장할 수 있습니다. (종목 페이지 입장하기)"
      );
      return;
    }

    if (clubs.length === 0) {
      const refreshed = await loadClubs();
      if (refreshed.length === 0) {
        setMainMsg(
          "클럽 목록을 아직 불러오지 못했습니다. (Supabase에서 clubs 테이블 RLS가 꺼져있는지 확인해 주세요.)"
        );
        return;
      }
    }

    const clubCandidates = getClubsByName(selectedClubName);
    if (clubCandidates.length === 0) {
      setMainMsg("클럽 정보를 찾을 수 없습니다.");
      return;
    }
    // 같은 종목 행이 여러 개면, 첫 번째(id 기준 정렬)로 고정해서 사용
    const club = [...clubCandidates].sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    )[0];

    const cols = await detectApplicationColumns();
    if (!cols) return;

    // 중복 신청 방지 (기존 신청이 있으면 상태를 가져와서 UI에 반영)
    const { data: existing, error: checkError } = await supabase
      .from("club_applications")
      .select(`id, ${cols.status}`)
      .eq(cols.club_id, club.id)
      .eq(cols.student_id, currentUser.id)
      .maybeSingle();

    if (checkError) {
      setMainMsg(`신청 확인 실패: ${checkError.message}`);
      return;
    }
    if (existing) {
      const status = existing[cols.status] || "pending";
      setMyAppByClubId((prev) => ({
        ...prev,
        [club.id]: { id: existing.id, status },
      }));
      setMainMsg(
        status === "approved"
          ? "이미 승인된 종목입니다."
          : "이미 신청한 종목입니다. (승인 대기중)"
      );
      return;
    }

    const { data: inserted, error } = await supabase
      .from("club_applications")
      .insert([
        {
          [cols.club_id]: club.id,
          [cols.student_id]: currentUser.id,
          [cols.student_name]: currentUser.name,
          [cols.status]: "pending",
        },
      ])
      .select("id")
      .single();

    if (error) {
      setMainMsg(`신청 실패: ${error.message}`);
      return;
    }

    setMyAppByClubId((prev) => ({
      ...prev,
      [club.id]: { id: inserted?.id || "pending", status: "pending" },
    }));
    setMainMsg("신청이 완료되었습니다. (승인 대기중)");
  };

  const handleEnterClub = async (clubName) => {
    setMainMsg("");
    setShowVLeagueHomeStandingsPopup(false);
    setShowVLeagueHomeTournamentPopup(false);
    const club = getClubByName(clubName);
    if (!club) return;

    if (!isVLeagueClub(clubName)) {
      const status = getMyStatusForClub(club.id);
      if (status !== "approved") {
        setMainMsg("승인된 이후에만 종목 페이지에 접속할 수 있습니다.");
        return;
      }
    }

    setPage({ type: "clubMain", clubName });
    setClubTab("schedule");
    setCalendarMonth(monthStart(new Date()));
    setSelectedDate(new Date());
    setEventEditorOpen(false);
    setEventEditorDate("");
    setNewEventContent("");
    if (isVLeagueClub(clubName)) {
      setShowVLeagueRulePopup(true);
      loadVLeagueRuleText(club.id);
    }
    await ensureClubEventsLoaded(clubName, monthStart(new Date()));
    if (!isVLeagueClub(clubName)) {
      await loadApprovedStudents(club.id);
      await loadAttendance(club.id, toYmd(new Date()));
    }
    if (isSportStackingClub(clubName)) {
      loadStackingRecords(club.id, stackingType);
    }
  };

  const goTeacherMain = (clubName) => {
    setApplications([]);
    setMainMsg("");
    setShowVLeagueHomeStandingsPopup(false);
    setShowVLeagueHomeTournamentPopup(false);
    const club = getClubByName(clubName);
    setPage({ type: "clubMain", clubName });
    setClubTab("schedule");
    setCalendarMonth(monthStart(new Date()));
    setSelectedDate(new Date());
    setEventEditorOpen(false);
    setEventEditorDate("");
    setNewEventContent("");
    if (isVLeagueClub(clubName)) {
      setShowVLeagueRulePopup(true);
      if (club) loadVLeagueRuleText(club.id);
    }
    ensureClubEventsLoaded(clubName, monthStart(new Date()));
    if (club && !isVLeagueClub(clubName)) {
      loadApprovedStudents(club.id);
      loadAttendance(club.id, toYmd(new Date()));
    }
  };

  const goTeacherManage = async (clubName) => {
    setMainMsg("");
    const clubCandidates = getClubsByName(clubName);
    if (clubCandidates.length === 0) {
      setMainMsg(
        `클럽 정보를 찾을 수 없습니다. (현재 로드된 clubs: ${clubs.length}개)`
      );
      return;
    }

    const myNameN = normalizeTeacherName(currentUser.name);
    const myClub =
      clubCandidates.find((c) => isTeacherAssignedToClubRow(c, myNameN)) ||
      null;

    if (!myClub) {
      const teachers = clubCandidates
        .map((c) => c.teacher_name)
        .filter(Boolean)
        .join(", ");
      setMainMsg(
        `이 종목의 담당 교사가 아닙니다. (등록된 담당: ${teachers || "미설정"})`
      );
      return;
    }

    setLoadingClubData(true);
    const cols = await detectApplicationColumns();
    if (!cols) {
      setLoadingClubData(false);
      return;
    }
    const { data, error } = await supabase
      .from("club_applications")
      .select(
        `id, ${cols.student_id}, ${cols.student_name}, created_at, ${cols.status}`
      )
      .eq(cols.club_id, myClub.id)
      .order("created_at", { ascending: true });

    setLoadingClubData(false);
    if (error) {
      setMainMsg(`신청 목록 로딩 실패: ${error.message}`);
      return;
    }
    setApplications(data || []);
    setPage({ type: "clubManage", clubName });
  };

  const handleApprove = async (applicationId) => {
    setMainMsg("");
    const cols = await detectApplicationColumns();
    if (!cols) return;
    const { error } = await supabase
      .from("club_applications")
      .update({
        [cols.status]: "approved",
        [cols.approved_at]: new Date().toISOString(),
      })
      .eq("id", applicationId);

    if (error) {
      setMainMsg("승인 처리 중 오류가 발생했습니다.");
      return;
    }

    // 목록 갱신
    setApplications((prev) =>
      prev.map((a) =>
        a.id === applicationId ? { ...a, [cols.status]: "approved" } : a
      )
    );
    setMainMsg("승인 완료");
  };

  const handleReject = async (applicationId) => {
    setMainMsg("");
    const cols = await detectApplicationColumns();
    if (!cols) return;
    const { error } = await supabase
      .from("club_applications")
      .update({
        [cols.status]: "rejected",
        [cols.approved_at]: null,
      })
      .eq("id", applicationId);

    if (error) {
      setMainMsg(`거절 처리 중 오류: ${error.message}`);
      return;
    }

    setApplications((prev) =>
      prev.map((a) =>
        a.id === applicationId ? { ...a, [cols.status]: "rejected" } : a
      )
    );
    setMainMsg("거절 완료");
  };

  const handleReRequest = async (clubName) => {
    setMainMsg("");
    if (!currentUser || currentUser.role !== "student") return;
    const cols = await detectApplicationColumns();
    if (!cols) return;
    const club = getClubByName(clubName);
    if (!club) {
      setMainMsg("클럽 정보를 찾을 수 없습니다.");
      return;
    }

    const existingId = myAppByClubId[club.id]?.id;
    if (!existingId || existingId === "pending") {
      setMainMsg("재승인 요청할 신청 정보를 찾지 못했습니다.");
      return;
    }

    const { error } = await supabase
      .from("club_applications")
      .update({
        [cols.status]: "pending",
        [cols.approved_at]: null,
      })
      .eq("id", existingId);

    if (error) {
      setMainMsg(`재승인 요청 중 오류: ${error.message}`);
      return;
    }

    setMyAppByClubId((prev) => ({
      ...prev,
      [club.id]: { id: existingId, status: "pending" },
    }));
    setMainMsg("재승인 요청이 완료되었습니다. (승인 대기중)");
  };

  const handleStudentSignup = async (e) => {
    e.preventDefault();
    resetErrors();

    if (!isValidStudentId(studentSignupId)) {
      setErrorMsg("학번은 6자리 숫자(예: 060103)만 입력할 수 있습니다.");
      return;
    }
    if (!studentSignupName.trim()) {
      setErrorMsg("이름을 입력해 주세요.");
      return;
    }
    if (!studentSignupPw) {
      setErrorMsg("비밀번호를 입력해 주세요.");
      return;
    }

    // 이미 가입된 학번인지 Supabase에서 확인
    const { data: existing, error: checkError } = await supabase
      .from("students")
      .select("student_id")
      .eq("student_id", studentSignupId)
      .maybeSingle();

    if (checkError) {
      setErrorMsg("회원가입 중 오류가 발생했습니다.");
      return;
    }

    if (existing) {
      setErrorMsg("이미 가입된 학번입니다.");
      return;
    }

    const { error } = await supabase.from("students").insert([
      {
        student_id: studentSignupId,
        name: studentSignupName.trim(),
        password: studentSignupPw,
      },
    ]);

    if (error) {
      setErrorMsg("회원가입에 실패했습니다. 다시 시도해 주세요.");
      return;
    }

    // 가입 완료 후 자동 로그인
    setCurrentUser({
      role: "student",
      name: studentSignupName.trim(),
      id: studentSignupId,
    });

    // 입력값 초기화
    setStudentSignupId("");
    setStudentSignupName("");
    setStudentSignupPw("");
  };

  const handleStudentLogin = async (e) => {
    e.preventDefault();
    resetErrors();

    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("student_id", studentLoginId)
      .eq("password", studentLoginPw)
      .maybeSingle();

    if (error) {
      setErrorMsg("로그인 중 오류가 발생했습니다.");
      return;
    }

    if (!data) {
      setErrorMsg("학번 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    setCurrentUser({
      role: "student",
      name: data.name,
      id: data.student_id,
    });

    setStudentLoginId("");
    setStudentLoginPw("");
  };

  const handleTeacherLoginByCode = async (e) => {
    e.preventDefault();
    resetErrors();

    if (!teacherLoginName.trim()) {
      setErrorMsg("교사 이름을 입력해 주세요.");
      return;
    }

    const teacherNameTrimmed = teacherLoginName.trim();
    const teacherNameNorm = normalizeTeacherName(teacherNameTrimmed);
    const isAdminTeacher = teacherNameNorm === normalizeTeacherName(ADMIN_TEACHER_NAME);
    const expectedCode = isAdminTeacher
      ? ADMIN_TEACHER_JOIN_CODE
      : TEACHER_JOIN_CODE;
    if (teacherCodeLogin !== expectedCode) {
      setErrorMsg(
        isAdminTeacher
          ? "교사 전용 가입 코드가 올바르지 않습니다."
          : "가입 코드가 올바르지 않습니다."
      );
      return;
    }

    // 이미 존재하는 교사면 insert 없이 로그인 처리
    // (과거 중복 데이터가 있어도 로그인 가능하도록 maybeSingle 대신 목록 조회)
    const { data: existingTeachers, error: checkError } = await supabase
      .from("teachers")
      .select("id, name")
      .eq("name", teacherNameTrimmed)
      .limit(1);

    if (checkError) {
      console.error(checkError);
      setErrorMsg(`교사 정보 확인 중 오류: ${checkError.message}`);
      return;
    }

    if (!existingTeachers || existingTeachers.length === 0) {
      const { error: insertError } = await supabase.from("teachers").insert([
        {
          name: teacherNameTrimmed,
        },
      ]);

      if (insertError) {
        const msg = String(insertError.message || "");
        const isRlsInsertBlocked =
          /row-level security/i.test(msg) || /permission denied/i.test(msg);
        if (!isRlsInsertBlocked) {
          console.error(insertError);
          setErrorMsg(`교사 정보 저장 중 오류: ${insertError.message}`);
          return;
        }
        // teachers 신규 insert만 RLS로 막힌 경우에도 로그인은 허용한다.
        // (현재 앱은 이름+코드 기반 인증을 사용하며 teachers insert는 보조 저장 용도)
        console.warn("teachers insert blocked by RLS, continue login:", insertError);
      }
    }

    setCurrentUser({
      role: "teacher",
      name: teacherNameTrimmed,
    });

    setTeacherLoginName("");
    setTeacherCodeLogin("");
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setPage({ type: "home", clubName: null });
    setApplications([]);
    setMainMsg("");
  };

  // 로그인 후 두 번째 화면
  if (currentUser) {
    return (
      <div className="app-root">
        <header className="app-header">
          <div className="app-title">새샘 스포츠클럽</div>
          <div className="header-right">
            <span className="user-info">
              {currentUser.role === "teacher"
                ? normalizeTeacherName(currentUser.name) === normalizeTeacherName("조혜란")
                  ? "교장"
                  : normalizeTeacherName(currentUser.name) ===
                      normalizeTeacherName("권희정")
                    ? "교감"
                    : "교사"
                : "학생"}{" "}
              {currentUser.name}
              {currentUser.id ? ` (${currentUser.id})` : ""}
            </span>
            <button className="logout-btn" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </header>

        <main className={page.type === "home" ? "app-main" : "app-main page-layout"}>
          {page.type !== "home" && (
            <div className="page-header">
              <button
                type="button"
                className="back-btn"
                onClick={() => setPage({ type: "home", clubName: null })}
              >
                ← 메인 화면
              </button>
              <div className="page-title">
                {isVLeagueClub(page.clubName) ? (
                  <span className="page-title-vleague">
                    <span className="page-title-vleague-sub">
                      수준별 교내스포츠리그
                    </span>
                    <span className="page-title-vleague-main">
                      새샘 V리그
                      {page.type === "clubManage" ? " 관리" : ""}
                    </span>
                  </span>
                ) : page.type === "clubManage" ? (
                  `${getClubHeaderTitle(page.clubName)} 관리`
                ) : (
                  getClubHeaderTitle(page.clubName)
                )}
              </div>
            </div>
          )}

          {page.type === "home" && (
            <div className="tabs-container">
              {[
                V_LEAGUE_LABEL,
                "배구",
                "농구",
                "스포츠 스태킹",
                "컬러풀 스포츠",
                "티볼",
                "육상",
              ].map(
                (name) => {
                  const isActive = selectedClubName === name;
                  const club = getClubByName(name);
                  const myStatus =
                    currentUser.role === "student" && club
                      ? getMyStatusForClub(club.id)
                      : null;
                  const tournamentYmd =
                    club?.id && homeTournamentYmdByClubId[club.id]
                      ? homeTournamentYmdByClubId[club.id]
                      : "";
                  const tournamentDateLabel = tournamentYmd
                    ? formatYmdDot(tournamentYmd)
                    : "";
                  const tournamentDdayLabel = tournamentYmd
                    ? formatDdayLabel(tournamentYmd)
                    : "";
                  return (
                    <div
                      key={name}
                      className={
                        "sport-item" +
                        (name === V_LEAGUE_LABEL ? " sport-item--wide" : "")
                      }
                    >
                      <div
                        className={
                          (isActive ? "sport-tab active" : "sport-tab") +
                          (name === V_LEAGUE_LABEL && !isActive
                            ? " sport-tab--vleague-collapsed"
                            : "")
                        }
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectClub(name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectClub(name);
                          }
                        }}
                      >
                        <div
                          className={
                            "sport-tab-title" +
                            (name === V_LEAGUE_LABEL && !isActive
                              ? " sport-tab-title--vleague"
                              : "")
                          }
                        >
                          <span className="sport-icon">
                            {name === "배구" && "🏐"}
                            {name === "농구" && "🏀"}
                            {name === "육상" && "🏃‍♀️"}
                            {name === "컬러풀 스포츠" && "🎨"}
                            {name === "티볼" && "⚾"}
                            {name === V_LEAGUE_LABEL && "🏐"}
                            {name === "스포츠 스태킹" && (
                              <img
                                className="sport-icon-image"
                                src="/sport-stacking-icon.png"
                                alt="스포츠 스태킹 아이콘"
                              />
                            )}
                          </span>
                          <div
                            className={
                              "sport-tab-title-main" +
                              (name === V_LEAGUE_LABEL && !isActive
                                ? " sport-tab-title-main--vleague"
                                : "")
                            }
                          >
                            <span
                              className={
                                "sport-name" +
                                (name === "컬러풀 스포츠"
                                  ? " sport-name--compact"
                                  : "")
                              }
                            >
                              {name}
                            </span>
                            {name === V_LEAGUE_LABEL && !isActive && (
                              <span className="sport-tab-vleague-subline">
                                -수준별 교내스포츠리그-
                              </span>
                            )}
                          </div>
                        </div>
                        {name !== V_LEAGUE_LABEL && name !== "컬러풀 스포츠" && (
                          <div className="sport-tournament-dday" aria-live="polite">
                            {tournamentYmd ? (
                              <span className="sport-tournament-date sport-tournament-date--fixed">
                                {`대회일 ${tournamentDateLabel} · ${tournamentDdayLabel}`}
                              </span>
                            ) : (
                              <span className="sport-tournament-date">대회일 미정</span>
                            )}
                          </div>
                        )}
                        {name === V_LEAGUE_LABEL && isActive && (
                          <>
                            {showVLeagueHomeStandingsPopup && (
                              <div
                                className="vleague-home-standings-overlay"
                                role="dialog"
                                aria-modal="true"
                                aria-label="새샘 V리그 현재 순위표"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowVLeagueHomeStandingsPopup(false);
                                }}
                              >
                                <div
                                  className="vleague-home-standings-modal"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <div className="vleague-home-standings-head">
                                    <div className="vleague-section-title">순위표</div>
                                    {vLeagueStandingsUsesTournament ? (
                                      <p className="vleague-section-desc">
                                        리그전·토너먼트가 모두 종료되어 토너먼트 최종 순위가
                                        반영된 순위표입니다.
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="vleague-grade-tabs">
                                    <button
                                      type="button"
                                      className={
                                        "vleague-grade-tab vleague-grade-tab--malgeun" +
                                        (vLeagueGradeTab === "malgeun" ? " active" : "")
                                      }
                                      onClick={() => setVLeagueGradeTab("malgeun")}
                                    >
                                      맑은샘 리그
                                      <span className="vleague-grade-tab-count">(5학년)</span>
                                    </button>
                                    <button
                                      type="button"
                                      className={
                                        "vleague-grade-tab vleague-grade-tab--goun" +
                                        (vLeagueGradeTab === "goun" ? " active" : "")
                                      }
                                      onClick={() => setVLeagueGradeTab("goun")}
                                    >
                                      고운샘 리그
                                      <span className="vleague-grade-tab-count">(6학년)</span>
                                    </button>
                                  </div>
                                  <div className="vleague-standings-wrap">
                                    {vLeagueComputedStandings.length === 0 ? (
                                      <div className="activity-empty">
                                        순위 데이터가 없습니다. 대진표에서 경기 결과를 입력해
                                        주세요.
                                      </div>
                                    ) : (
                                      <div className="vleague-standings-table-wrap">
                                        <table className="vleague-standings-table">
                                          <thead>
                                            <tr>
                          <th scope="col">
                            <div className="vleague-rank-cell vleague-rank-head-cell">
                              <span className="vleague-rank-note-left">
                                {vLeagueStandingsUsesTournament ? "" : "토너먼트"}
                              </span>
                              <span className="vleague-rank-core">순위</span>
                              <span className="vleague-rank-note-right">승격</span>
                            </div>
                          </th>
                                              <th scope="col">팀(학급)</th>
                                              <th scope="col">승</th>
                                              <th scope="col">패</th>
                                              <th scope="col">승점</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {vLeagueComputedStandings.map((row) => (
                                              <tr key={row.class_id}>
                                                <td>
                                                  <span className="vleague-rank-cell">
                                                    <span
                                                      className={
                                                        "vleague-rank-note-left" +
                                                        (!vLeagueStandingsUsesTournament &&
                                                        row.rank_order <= 4
                                                          ? ""
                                                          : " vleague-rank-note-placeholder")
                                                      }
                                                    >
                                                      {!vLeagueStandingsUsesTournament &&
                                                      row.rank_order <= 4
                                                        ? "토너먼트"
                                                        : ""}
                                                    </span>
                                                    <span className="vleague-rank-core">
                                                      <span
                                                        className={
                                                          "vleague-rank-text" +
                                                          (row.rank_order <= 3
                                                            ? " vleague-rank-text--" + row.rank_order
                                                            : "")
                                                        }
                                                      >
                                                        {row.rank_order}위
                                                      </span>
                                                    </span>
                                                    <span
                                                      className={
                                                        "vleague-rank-note-right" +
                                                        ((vLeagueGradeTab === "malgeun" &&
                                                          row.rank_order >= 1 &&
                                                          row.rank_order <= 3) ||
                                                        (vLeagueGradeTab === "goun" &&
                                                          row.rank_order >= 5 &&
                                                          row.rank_order <= 7)
                                                          ? ""
                                                          : " vleague-rank-note-placeholder")
                                                      }
                                                    >
                                                      {(vLeagueGradeTab === "malgeun" &&
                                                        row.rank_order >= 1 &&
                                                        row.rank_order <= 3) ||
                                                      (vLeagueGradeTab === "goun" &&
                                                        row.rank_order >= 5 &&
                                                        row.rank_order <= 7)
                                                        ? vLeagueGradeTab === "malgeun"
                                                          ? "승격"
                                                          : "강등"
                                                        : ""}
                                                    </span>
                                                  </span>
                                                </td>
                                                <td className="vleague-team-cell">
                                                  {row.team_name}
                                                </td>
                                                <td>{row.wins ?? 0}</td>
                                                <td>{row.losses ?? 0}</td>
                                                <td>{row.points ?? 0}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                  <div className="vleague-home-standings-actions">
                                    <button
                                      type="button"
                                      className="vleague-home-standings-close"
                                      onClick={() => setShowVLeagueHomeStandingsPopup(false)}
                                    >
                                      닫기
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            {showVLeagueHomeTournamentPopup && (
                              <div
                                className="vleague-home-standings-overlay"
                                role="dialog"
                                aria-modal="true"
                                aria-label="새샘 V리그 토너먼트 진행표"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeHomeTournamentPopupToStandings();
                                }}
                              >
                                <div
                                  className="vleague-home-standings-modal vleague-home-tournament-modal"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <div className="vleague-home-standings-head">
                                    <div className="vleague-section-title">토너먼트 진행표</div>
                                  </div>
                                  <div className="vleague-grade-tabs">
                                    <button
                                      type="button"
                                      className={
                                        "vleague-grade-tab vleague-grade-tab--malgeun" +
                                        (vLeagueGradeTab === "malgeun" ? " active" : "")
                                      }
                                      onClick={() => setVLeagueGradeTab("malgeun")}
                                    >
                                      맑은샘 리그
                                    </button>
                                    <button
                                      type="button"
                                      className={
                                        "vleague-grade-tab vleague-grade-tab--goun" +
                                        (vLeagueGradeTab === "goun" ? " active" : "")
                                      }
                                      onClick={() => setVLeagueGradeTab("goun")}
                                    >
                                      고운샘 리그
                                    </button>
                                  </div>
                                  {homeVLeagueTournamentLoading ? (
                                    <div className="cal-loading">불러오는 중...</div>
                                  ) : !homeTournamentBracketRows.hasAny ? (
                                    <div className="activity-empty">
                                      저장된 토너먼트 일정이 없습니다.
                                    </div>
                                  ) : (
                                    (() => {
                                      const [s1a, s1b] = String(
                                        homeTournamentBracketRows.semi1 || ""
                                      )
                                        .split(" vs ")
                                        .map((s) => String(s || "").trim());
                                      const [s2a, s2b] = String(
                                        homeTournamentBracketRows.semi2 || ""
                                      )
                                        .split(" vs ")
                                        .map((s) => String(s || "").trim());
                                      const winners = homeTournamentBracketRows.winners || {};
                                      const losers = homeTournamentBracketRows.losers || {};
                                      const bronzeB1 = homeTournamentBracketRows.bronzeB1 || "-";
                                      const bronzeB2 = homeTournamentBracketRows.bronzeB2 || "-";
                                      const finalF1 = homeTournamentBracketRows.finalF1 || "-";
                                      const finalF2 = homeTournamentBracketRows.finalF2 || "-";
                                      const boxClass = (slot, extra) => {
                                        let cls = "vleague-bracket-box";
                                        if (extra) cls += ` ${extra}`;
                                        if (winners[slot]) cls += " vleague-bracket-box--winner";
                                        if (losers[slot]) cls += " vleague-bracket-box--loser";
                                        if (bracketSparkSlot === slot) {
                                          cls += " vleague-bracket-box--spark";
                                        }
                                        return cls;
                                      };
                                      return (
                                        <div className="vleague-bracket">
                                          <div className="vleague-bracket-final">
                                            <div className="vleague-bracket-final-label">
                                              결승전
                                            </div>
                                            <BracketMatchBox
                                              homeLabel={finalF1}
                                              awayLabel={finalF2}
                                              homeSlot="f1"
                                              awaySlot="f2"
                                              winners={winners}
                                              losers={losers}
                                              sparkSlot={bracketSparkSlot}
                                              className="vleague-bracket-match-box--final"
                                            />
                                          </div>
                                          <svg
                                            className="vleague-bracket-wires"
                                            viewBox="0 0 100 44"
                                            preserveAspectRatio="none"
                                            aria-hidden
                                          >
                                            <path
                                              className="vleague-bracket-wires-base"
                                              d={BRACKET_WIRE_BASE}
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              vectorEffect="non-scaling-stroke"
                                              strokeLinejoin="miter"
                                              strokeLinecap="square"
                                            />
                                            {Object.entries(BRACKET_ADVANCE_PATHS).map(
                                              ([slot, pathD]) =>
                                                winners[slot] ? (
                                                  <path
                                                    key={`advance-${slot}`}
                                                    className={
                                                      "vleague-bracket-wires-advance vleague-bracket-wires-advance--final" +
                                                      (bracketSparkSlot === slot
                                                        ? " vleague-bracket-wires-spark"
                                                        : "")
                                                    }
                                                    d={pathD}
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2.5"
                                                    vectorEffect="non-scaling-stroke"
                                                    strokeLinejoin="miter"
                                                    strokeLinecap="square"
                                                  />
                                                ) : null
                                            )}
                                          </svg>
                                          <div className="vleague-bracket-teams">
                                            <div className="vleague-bracket-pair">
                                              <BracketTeamBox
                                                label={s1a || homeTournamentBracketRows.semi1}
                                                className={boxClass("s1a")}
                                              />
                                              <BracketTeamBox
                                                label={s1b}
                                                className={boxClass("s1b")}
                                              />
                                            </div>
                                            <div className="vleague-bracket-pair">
                                              <BracketTeamBox
                                                label={s2a || homeTournamentBracketRows.semi2}
                                                className={boxClass("s2a")}
                                              />
                                              <BracketTeamBox
                                                label={s2b}
                                                className={boxClass("s2b")}
                                              />
                                            </div>
                                          </div>
                                          <svg
                                            className="vleague-bracket-wires vleague-bracket-wires--down"
                                            viewBox="0 0 100 24"
                                            preserveAspectRatio="none"
                                            aria-hidden
                                          >
                                            <path
                                              className="vleague-bracket-wires-base"
                                              d={homeTournamentBracketRows.downWireBase}
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              vectorEffect="non-scaling-stroke"
                                              strokeLinejoin="miter"
                                              strokeLinecap="square"
                                            />
                                            {Object.entries(
                                              homeTournamentBracketRows.bronzeFeedPaths || {}
                                            ).map(([slot, pathD]) => (
                                              <path
                                                key={`bronze-feed-${slot}`}
                                                className={
                                                  "vleague-bracket-wires-advance vleague-bracket-wires-advance--bronze" +
                                                  (bracketSparkSlot === slot
                                                    ? " vleague-bracket-wires-spark"
                                                    : "")
                                                }
                                                d={pathD}
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                vectorEffect="non-scaling-stroke"
                                                strokeLinejoin="miter"
                                                strokeLinecap="square"
                                              />
                                            ))}
                                          </svg>
                                          <div className="vleague-bracket-bronze">
                                            <div className="vleague-bracket-bronze-label">
                                              3·4위전
                                            </div>
                                            <BracketMatchBox
                                              homeLabel={bronzeB1}
                                              awayLabel={bronzeB2}
                                              homeSlot="b1"
                                              awaySlot="b2"
                                              winners={winners}
                                              losers={losers}
                                              sparkSlot={bracketSparkSlot}
                                              className="vleague-bracket-match-box--bronze"
                                            />
                                          </div>
                                        </div>
                                      );
                                    })()
                                  )}
                                  <div className="vleague-home-standings-actions">
                                    <button
                                      type="button"
                                      className="vleague-home-standings-close"
                                      onClick={closeHomeTournamentPopupToStandings}
                                    >
                                      닫기
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="sport-vleague-board-head">
                              <span className="sport-vleague-board-head-title">
                                오늘 경기
                              </span>
                              <div className="sport-vleague-board-head-list">
                                <span
                                  className={
                                    "sport-vleague-board-head-item sport-vleague-board-head-item--malgeun" +
                                    (String(vLeagueTodayMatches.malgeun || "").trim()
                                      ? " sport-vleague-board-head-item--has-match"
                                      : "")
                                  }
                                >
                                  {String(vLeagueTodayMatches.malgeun || "").trim() ? (
                                    <span
                                      className="sport-vleague-board-head-star"
                                      aria-hidden
                                    >
                                      ★
                                    </span>
                                  ) : null}
                                  {String(vLeagueTodayMatches.malgeun || "").trim() ? (
                                    <HomeHorizontalTicker
                                      key={String(vLeagueTodayMatches.malgeun)}
                                      text={vLeagueTodayMatches.malgeun}
                                      rootClassName="sport-vleague-board-head-item-marquee"
                                      trackClassName="sport-vleague-board-head-item-marquee-track"
                                      segClassName="sport-vleague-board-head-item-marquee-seg"
                                    />
                                  ) : (
                                    <span className="sport-vleague-board-head-item-text">
                                      {vLeagueTodayMatches.malgeun || "[맑은샘] 없음"}
                                    </span>
                                  )}
                                  {vLeagueTodayMatchIds.malgeun ? (
                                    <span className="sport-vleague-board-head-item-ref">
                                      {getRefereeSummaryByMatchId(vLeagueTodayMatchIds.malgeun)}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className={
                                    "sport-vleague-board-head-item sport-vleague-board-head-item--goun" +
                                    (String(vLeagueTodayMatches.goun || "").trim()
                                      ? " sport-vleague-board-head-item--has-match"
                                      : "")
                                  }
                                >
                                  {String(vLeagueTodayMatches.goun || "").trim() ? (
                                    <span
                                      className="sport-vleague-board-head-star"
                                      aria-hidden
                                    >
                                      ★
                                    </span>
                                  ) : null}
                                  {String(vLeagueTodayMatches.goun || "").trim() ? (
                                    <HomeHorizontalTicker
                                      key={String(vLeagueTodayMatches.goun)}
                                      text={vLeagueTodayMatches.goun}
                                      rootClassName="sport-vleague-board-head-item-marquee"
                                      trackClassName="sport-vleague-board-head-item-marquee-track"
                                      segClassName="sport-vleague-board-head-item-marquee-seg"
                                    />
                                  ) : (
                                    <span className="sport-vleague-board-head-item-text">
                                      {vLeagueTodayMatches.goun || "[고운샘] 없음"}
                                    </span>
                                  )}
                                  {vLeagueTodayMatchIds.goun ? (
                                    <span className="sport-vleague-board-head-item-ref">
                                      {getRefereeSummaryByMatchId(vLeagueTodayMatchIds.goun)}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </div>
                            <div className="sport-vleague-board-wrap">
                              <div
                                id="vleague-home-cheer-cap-label"
                                className="sport-vleague-board-top-badge"
                              >
                                <span
                                  className="sport-vleague-board-top-badge-ico"
                                  aria-hidden
                                >
                                  📣
                                </span>
                                <span className="sport-vleague-board-top-badge-txt">
                                  우리반 응원하기
                                </span>
                              </div>
                              <div
                                className="sport-vleague-board"
                                role="region"
                                aria-labelledby="vleague-home-cheer-cap-label"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                              {visibleVLeagueCheerBoard.length === 0 ? (
                                <span className="sport-vleague-board-empty">
                                  {!vLeagueTodayMatches.malgeun &&
                                  !vLeagueTodayMatches.goun
                                    ? "오늘은 경기가 없습니다."
                                    : "아직 응원이 없어요 · 아래에서 첫 응원 남기기"}
                                </span>
                              ) : (
                                <div
                                  className="sport-vleague-board-rotator"
                                  aria-live="polite"
                                  style={
                                    {
                                      "--sport-vleague-slide-h": `${cheerSlidePx}px`,
                                    }
                                  }
                                >
                                  <div
                                    className={
                                      "sport-vleague-board-strip" +
                                      (cheerStripNoTransition
                                        ? " sport-vleague-board-strip--no-transition"
                                        : "")
                                    }
                                    style={{
                                      transform: `translate3d(0, -${
                                        vLeagueCheerBoardIndex * cheerSlidePx
                                      }px, 0)`,
                                      transition: cheerStripNoTransition
                                        ? "none"
                                        : "transform 0.55s cubic-bezier(0.33, 1, 0.35, 1)",
                                    }}
                                  >
                                    {visibleVLeagueCheerBoard.map((row, slideIdx) => {
                                      const cn =
                                        row?.class?.class_name || "학급";
                                      return (
                                        <div
                                          key={row.id}
                                          ref={
                                            slideIdx === 0
                                              ? cheerFirstSlideRef
                                              : undefined
                                          }
                                          className="sport-vleague-board-slide"
                                        >
                                          <div className="sport-vleague-board-line">
                                            <span className="sport-vleague-board-msg">
                                              <span className="sport-vleague-board-cheer-kicker">
                                                응원
                                              </span>
                                              <span className="sport-vleague-board-msg-core">
                                                [{cn}] {row.message}
                                              </span>
                                            </span>
                                            <span
                                              className="sport-vleague-board-author"
                                              title={row.student_name || ""}
                                            >
                                              {formatStudentDisplayName(
                                                row.student_name,
                                                row.student_id
                                              )}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              </div>
                            </div>
                            {showVLeagueCheerEventPanelNow && (
                              <div className="sport-vleague-event-pill">
                                <div className="sport-vleague-event-pill-title">이벤트 당첨</div>
                                <div className="sport-vleague-event-pill-body">
                                  {myClassEventWinnerToday ? (
                                    <>
                                      <span className="sport-vleague-event-pill-date">
                                        {formatYmdKorean(myClassEventWinnerToday.match_date)} 이벤트 당첨
                                      </span>
                                      <span className="sport-vleague-event-pill-name">
                                        {formatStudentDisplayName(
                                          myClassEventWinnerToday.winner_student_name,
                                          myClassEventWinnerToday.winner_student_id
                                        )}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="sport-vleague-event-pill-date">
                                        오늘 자동 추첨 대기 중
                                      </span>
                                      <span className="sport-vleague-event-pill-name">
                                        13:01 이후 당첨자가 표시됩니다
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {currentUser.role === "student" && (
                          <>
                            {isVLeagueClub(name) ? (
                              isActive ? (
                                <div className="vleague-student-actions">
                                  <button
                                    type="button"
                                    className="teacher-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEnterClub(name);
                                    }}
                                  >
                                    종목 페이지 입장하기
                                  </button>
                                  <button
                                    type="button"
                                    className="teacher-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEnterClub(name);
                                      setClubTab("vCheer");
                                    }}
                                  >
                                    응원 메시지 작성하기
                                  </button>
                                </div>
                              ) : null
                            ) : (
                              <>
                                {myStatus === "pending" && (
                                  <div
                                    className={
                                      isActive
                                        ? "status-pill"
                                        : "status-pill hidden"
                                    }
                                    aria-hidden={!isActive}
                                  >
                                    승인 대기중
                                  </div>
                                )}

                                {myStatus === "approved" && (
                                  <button
                                    type="button"
                                    className={
                                      isActive
                                        ? "enter-btn"
                                        : "enter-btn hidden"
                                    }
                                    disabled={!isActive}
                                    tabIndex={isActive ? 0 : -1}
                                    aria-hidden={!isActive}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isActive) return;
                                      handleEnterClub(name);
                                    }}
                                  >
                                    종목 페이지 입장하기
                                  </button>
                                )}

                                {myStatus === "rejected" && (
                                  <div
                                    className={
                                      isActive
                                        ? "reject-wrap"
                                        : "reject-wrap hidden"
                                    }
                                  >
                                    <div className="reject-pill">
                                      승인 거절됨
                                    </div>
                                    <button
                                      type="button"
                                      className="rerequest-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isActive) return;
                                        handleReRequest(name);
                                      }}
                                    >
                                      재승인 요청
                                    </button>
                                  </div>
                                )}

                                {!myStatus && (
                                  <button
                                    type="button"
                                    className={
                                      isActive ? "apply-btn" : "apply-btn hidden"
                                    }
                                    disabled={!isActive}
                                    tabIndex={isActive ? 0 : -1}
                                    aria-hidden={!isActive}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isActive) return;
                                      handleApplyClub();
                                    }}
                                  >
                                    이 종목 신청하기
                                  </button>
                                )}
                              </>
                            )}
                          </>
                        )}

                        {currentUser.role === "teacher" && isActive && (
                          <>
                            {isVLeagueClub(name) ? (
                              <div className="vleague-student-actions">
                                <button
                                  type="button"
                                  className="teacher-btn"
                                  disabled={!isActive}
                                  tabIndex={isActive ? 0 : -1}
                                  aria-hidden={!isActive}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isActive) return;
                                    goTeacherMain(name);
                                  }}
                                >
                                  종목 페이지 입장하기
                                </button>
                                <button
                                  type="button"
                                  className="teacher-btn"
                                  disabled={!isActive}
                                  tabIndex={isActive ? 0 : -1}
                                  aria-hidden={!isActive}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isActive) return;
                                    goTeacherMain(name);
                                    setClubTab("vCheer");
                                  }}
                                >
                                  응원 메시지 작성하기
                                </button>
                              </div>
                            ) : (
                              <div className="teacher-actions">
                                <button
                                  type="button"
                                  className="teacher-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    goTeacherMain(name);
                                  }}
                                >
                                  메인페이지
                                </button>
                                <button
                                  type="button"
                                  className="teacher-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    goTeacherManage(name);
                                  }}
                                >
                                  관리페이지
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}

          {mainMsg && <div className="main-msg">{mainMsg}</div>}

          {page.type === "clubMain" && (
            <div className="club-page">
              <div className="club-page-tabs">
                <button
                  type="button"
                  className={clubTab === "schedule" ? "club-tab active" : "club-tab"}
                  onClick={() => setClubTab("schedule")}
                >
                  일정
                </button>
                {isVLeagueClub(page.clubName) ? (
                  <>
                    <button
                      type="button"
                      className={
                        clubTab === "vClasses" ? "club-tab active" : "club-tab"
                      }
                      onClick={() => setClubTab("vClasses")}
                    >
                      참가 학급
                    </button>
                    <button
                      type="button"
                      className={
                        clubTab === "vMatches" ? "club-tab active" : "club-tab"
                      }
                      onClick={() => setClubTab("vMatches")}
                    >
                      대진표
                    </button>
                    <button
                      type="button"
                      className={
                        clubTab === "vStandings"
                          ? "club-tab active"
                          : "club-tab"
                      }
                      onClick={() => {
                        setMainMsg("");
                        setClubTab("vStandings");
                      }}
                    >
                      순위표
                    </button>
                    {isVLeagueAdmin && (
                      <>
                        <button
                          type="button"
                          className={clubTab === "vTournament" ? "club-tab active" : "club-tab"}
                          onClick={() => {
                            setMainMsg("");
                            setClubTab("vTournament");
                          }}
                        >
                          토너먼트 일정 생성
                        </button>
                        <button
                          type="button"
                          className={clubTab === "vPromotion" ? "club-tab active" : "club-tab"}
                          onClick={() => {
                            setMainMsg("");
                            setClubTab("vPromotion");
                          }}
                        >
                          승강전 일정 생성
                        </button>
                        <button
                          type="button"
                          className={
                            clubTab === "vCheerLookup" ? "club-tab active" : "club-tab"
                          }
                          onClick={() => {
                            setMainMsg("");
                            setClubTab("vCheerLookup");
                          }}
                        >
                          응원 조회
                        </button>
                        <button
                          type="button"
                          className={clubTab === "vReferee" ? "club-tab active" : "club-tab"}
                          onClick={() => {
                            setMainMsg("");
                            setClubTab("vReferee");
                          }}
                        >
                          심판 배정
                        </button>
                        <button
                          type="button"
                          className={clubTab === "vRules" ? "club-tab active" : "club-tab"}
                          onClick={() => {
                            setMainMsg("");
                            setClubTab("vRules");
                          }}
                        >
                          규칙 관리
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {!isVLeagueClub(page.clubName) && (
                      <>
                        <button
                          type="button"
                          className={
                            clubTab === "members" ? "club-tab active" : "club-tab"
                          }
                          onClick={async () => {
                            setClubTab("members");
                            setMembersLoading(true);
                            try {
                              const club = getClubByName(page.clubName);
                              if (!club) return;
                              await loadApprovedStudents(club.id);
                            } finally {
                              setMembersLoading(false);
                            }
                          }}
                        >
                          가입 명단
                        </button>
                        <button
                          type="button"
                          className={
                            clubTab === "attendance" ? "club-tab active" : "club-tab"
                          }
                          onClick={async () => {
                            setClubTab("attendance");
                            setAttendanceLoading(true);
                            const club = getClubByName(page.clubName);
                            if (!club) return;
                            await loadApprovedStudents(club.id);
                            await loadAttendance(club.id, toYmd(selectedDate));
                          }}
                        >
                          출석
                        </button>
                      </>
                    )}
                    {isSportStackingClub(page.clubName) && (
                      <button
                        type="button"
                        className={
                          clubTab === "records" ? "club-tab active" : "club-tab"
                        }
                        onClick={async () => {
                          setClubTab("records");
                          const club = getClubByName(page.clubName);
                          if (!club) return;
                          await loadStackingRecords(club.id, stackingType);
                        }}
                      >
                        기록 등록
                      </button>
                    )}
                  </>
                )}
              </div>

              {clubTab === "schedule" && (
                <div className="club-page-body">
                  <div className="schedule-layout">
                    <div className="calendar-panel">
                      <div className="calendar-head">
                        <button
                          type="button"
                          className="cal-nav"
                          onClick={handleCalendarPrev}
                        >
                          ‹
                        </button>
                        <div className="cal-month">
                          {calendarMonth.getFullYear()}년{" "}
                          {calendarMonth.getMonth() + 1}월
                        </div>
                        <button
                          type="button"
                          className="cal-nav"
                          onClick={handleCalendarNext}
                        >
                          ›
                        </button>
                      </div>
                      {isVLeagueClub(page.clubName) && (
                        <div className="vleague-schedule-tools">
                          <div className="vleague-schedule-filter">
                            <button
                              type="button"
                              className={
                                "vleague-filter-toggle" +
                                (vLeagueScheduleClassFilterEnabled ? " active" : "")
                              }
                              onClick={() =>
                                setVLeagueScheduleClassFilterEnabled((prev) => !prev)
                              }
                            >
                              학급별 조회
                            </button>
                            {vLeagueScheduleClassFilterEnabled && (
                              <div
                                className="vleague-filter-select-wrap"
                                ref={vLeagueScheduleFilterMenuRef}
                              >
                                <button
                                  type="button"
                                  className="vleague-filter-select-btn"
                                  onClick={() =>
                                    setVLeagueScheduleFilterMenuOpen((prev) => !prev)
                                  }
                                >
                                  {vLeagueScheduleClassFilter}
                                </button>
                                {vLeagueScheduleFilterMenuOpen && (
                                  <div className="vleague-filter-select-menu">
                                    {vLeagueScheduleClassFilterOptions.map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        className={
                                          "vleague-filter-select-option" +
                                          (opt === vLeagueScheduleClassFilter ? " active" : "")
                                        }
                                        onClick={() => {
                                          setVLeagueScheduleClassFilter(opt);
                                          setVLeagueScheduleFilterMenuOpen(false);
                                        }}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="vleague-referee-lookup">
                            <span className="vleague-referee-lookup-label">배정심판 조회</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              className="vleague-referee-lookup-input"
                              placeholder="학번 6자리"
                              value={vLeagueScheduleRefLookupDraft}
                              onChange={(e) =>
                                setVLeagueScheduleRefLookupDraft(
                                  e.target.value.replace(/\D/g, "")
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleRunRefereeLookup();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="vleague-ghost"
                              onClick={
                                String(vLeagueScheduleRefLookupStudentId || "").trim()
                                  ? handleResetRefereeLookup
                                  : handleRunRefereeLookup
                              }
                            >
                              {String(vLeagueScheduleRefLookupStudentId || "").trim()
                                ? "원래대로"
                                : "조회"}
                            </button>
                          </div>
                        </div>
                      )}

                      {eventLoading && (
                        <div className="cal-loading">불러오는 중...</div>
                      )}

                      {!eventLoading && (
                        <>
                          <div className="calendar-grid">
                            {["일", "월", "화", "수", "목", "금", "토"].map(
                              (d, idx) => (
                                <div
                                  key={d}
                                  className={
                                    "cal-dow" +
                                    (idx === 0 ? " sunday" : "") +
                                    (idx === 6 ? " saturday" : "")
                                  }
                                >
                                  {d}
                                </div>
                              )
                            )}

                            {(() => {
                              const start = monthStart(calendarMonth);
                              const end = monthEnd(calendarMonth);
                              const firstDow = start.getDay(); // 0-6
                              const daysInMonth = end.getDate();
                              const cells = [];
                              for (let i = 0; i < firstDow; i++) {
                                cells.push(
                                  <div key={`e-${i}`} className="cal-cell empty" />
                                );
                              }
                              for (let day = 1; day <= daysInMonth; day++) {
                                const d = new Date(
                                  calendarMonth.getFullYear(),
                                  calendarMonth.getMonth(),
                                  day
                                );
                                const ymd = toYmd(d);
                                const hasEvent = Boolean(eventsByDate[ymd]?.length);
                                const isHoliday = KOREA_HOLIDAYS_2026.has(ymd);
                                const isClassHighlighted =
                                  isVLeagueClub(page.clubName) &&
                                  vLeagueScheduleClassFilterEnabled &&
                                  vLeagueScheduleHighlightDateSet.has(ymd);
                                const isRefHighlighted =
                                  isVLeagueClub(page.clubName) &&
                                  String(vLeagueScheduleRefLookupStudentId || "").trim().length ===
                                    6 &&
                                  vLeagueScheduleRefLookupDateSet.has(ymd);
                                const isSelected = toYmd(selectedDate) === ymd;
                                const dow = d.getDay();
                                cells.push(
                                  <button
                                    type="button"
                                    key={ymd}
                                    className={
                                      "cal-cell" +
                                      (hasEvent ? " has-event" : "") +
                                      (isClassHighlighted ? " class-highlighted" : "") +
                                      (isRefHighlighted ? " ref-highlighted" : "") +
                                      (isSelected ? " selected" : "") +
                                      (isHoliday ? " holiday" : "") +
                                      (dow === 0 ? " sunday" : "") +
                                      (dow === 6 ? " saturday" : "")
                                    }
                                    onClick={() => handleSelectDay(d)}
                                  >
                                    <div className="cal-daynum">{day}</div>
                                    {hasEvent && <div className="cal-dot" />}
                                  </button>
                                );
                              }
                              return cells;
                            })()}
                          </div>

                          <div className="calendar-legend">
                            <div className="legend-item">
                              <span className="legend-swatch activity" />
                              <span>활동 있음</span>
                            </div>
                            <div className="legend-item">
                              <span className="legend-dot" />
                              <span>기록 있음</span>
                            </div>
                            {isVLeagueClub(page.clubName) && vLeagueScheduleClassFilterEnabled && (
                              <div className="legend-item">
                                <span className="legend-swatch class-highlight" />
                                <span>{vLeagueScheduleClassFilter} 경기일</span>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {canCurrentTeacherEditSchedule(page.clubName) &&
                        !isVLeagueClub(page.clubName) && (
                        <div className="event-add">
                          <div className="event-add-title">
                            교사: 일정 추가 (달력 날짜를 클릭하세요)
                          </div>

                          {eventEditorOpen ? (
                            <>
                              <div className="event-selected-date">
                                선택 날짜: {eventEditorDate}
                              </div>
                              <div className="event-add-row">
                                <input
                                  type="text"
                                  className="event-content"
                                  placeholder="활동 내용 (예: 배구 연습)"
                                  value={newEventContent}
                                  onChange={(e) =>
                                    setNewEventContent(e.target.value)
                                  }
                                />
                                <button
                                  type="button"
                                  className="event-save"
                                  onClick={handleAddEvent}
                                >
                                  확인
                                </button>
                                <button
                                  type="button"
                                  className="event-cancel"
                                  onClick={() => {
                                    setEventEditorOpen(false);
                                    setEventEditorDate("");
                                    setNewEventContent("");
                                  }}
                                >
                                  취소
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="event-add-hint">
                              날짜를 클릭하면 입력창이 열립니다.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="activity-panel">
                      <div className="activity-head">
                        {toYmd(selectedDate)}{" "}
                        {isVLeagueClub(page.clubName) ? "경기 일정" : "활동 기록"}
                      </div>
                      <div className="activity-list">
                        {(() => {
                          const ymd = toYmd(selectedDate);
                          const items = eventsByDate[ymd] || [];
                          const canDeleteForItem = () => {
                            if (isVLeagueClub(page.clubName)) return false;
                            return canCurrentTeacherEditSchedule(page.clubName);
                          };
                          if (items.length === 0) {
                            return (
                              <div className="activity-empty">기록이 없습니다.</div>
                            );
                          }
                          const orderedItems = [...items].sort((a, b) => {
                            const aContent = String(a.content || "");
                            const bContent = String(b.content || "");
                            const rank = (txt) => {
                              if (txt.startsWith("[맑은샘]")) return 0;
                              if (txt.startsWith("[고운샘]")) return 1;
                              return 2;
                            };
                            return rank(aContent) - rank(bContent);
                          });
                          return orderedItems.map((it) => {
                            const content = String(it.content || "");
                            const m = content.match(/⟦vm:([^\]]+)⟧/);
                            const matchId = m?.[1] || null;
                            const refSummary = matchId ? getRefereeSummaryByMatchId(matchId) : "";
                            return (
                              <div key={it.id} className="activity-item">
                                <div className="activity-item-main">
                                  <div className="activity-item-content">
                                    {formatEventContentForDisplay(it.content)}
                                    {refSummary ? (
                                      <div className="activity-item-referee">{refSummary}</div>
                                    ) : null}
                                  </div>
                                  {canDeleteForItem() ? (
                                    <button
                                      type="button"
                                      className="activity-item-delete"
                                      onClick={() => handleDeleteEvent(it.id, ymd)}
                                    >
                                      삭제
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                      <div className="activity-hint">
                        {isVLeagueClub(page.clubName)
                          ? "날짜를 누르면 해당 날짜의 경기 일정이 표시됩니다."
                          : "날짜를 누르면 해당 날짜의 활동 기록이 표시됩니다."}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {clubTab === "members" && !isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="members-head">
                    <div className="members-title">가입 학생 명단</div>
                    <div className="members-count">
                      총 {approvedStudents.length}명
                    </div>
                  </div>
                  <p className="members-hint">
                    이 종목에 승인되어 함께 활동하는 학생입니다. (학생·교사
                    모두 열람 가능)
                  </p>
                  {membersLoading && (
                    <div className="cal-loading">불러오는 중...</div>
                  )}
                  {!membersLoading && (
                    <div className="members-list">
                      {approvedStudents.length === 0 ? (
                        <div className="activity-empty">
                          아직 승인된 학생이 없습니다.
                        </div>
                      ) : (
                        approvedStudents.map((s) => (
                          <div key={s.student_id} className="members-row">
                            <div className="members-homeroom">
                              {formatHomeroom(s.student_id)}
                            </div>
                            <div className="members-name">
                              {formatStudentDisplayName(s.student_name, s.student_id)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {clubTab === "vMatches" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">대진표</div>
                    <p className="vleague-section-desc">
                      {isVLeagueAdmin
                        ? "풀리그전(각 팀 1회) 기준으로 자동 생성하고, 필요하면 일정에 일괄 반영할 수 있습니다."
                        : ""}
                    </p>
                  </div>

                  <div className="vleague-matches-toolbar">
                    <div className="vleague-grade-tabs">
                      <button
                        type="button"
                        className={
                          "vleague-grade-tab vleague-grade-tab--malgeun" +
                          (vLeagueGradeTab === "malgeun" ? " active" : "")
                        }
                        onClick={() => setVLeagueGradeTab("malgeun")}
                      >
                        맑은샘 리그
                        <span className="vleague-grade-tab-count">(5학년)</span>
                      </button>
                      <button
                        type="button"
                        className={
                          "vleague-grade-tab vleague-grade-tab--goun" +
                          (vLeagueGradeTab === "goun" ? " active" : "")
                        }
                        onClick={() => setVLeagueGradeTab("goun")}
                      >
                        고운샘 리그
                        <span className="vleague-grade-tab-count">(6학년)</span>
                      </button>
                    </div>

                    {isVLeagueAdmin ? (
                      <div className="vleague-matches-controls">
                      <div className="vleague-matches-control-row">
                        <label className="vleague-field">
                          <span>시작 날짜</span>
                          <input
                            type="date"
                            value={vLeagueGenStartDate}
                            onChange={(e) => setVLeagueGenStartDate(e.target.value)}
                          />
                        </label>
                        <label className="vleague-field">
                          <span>하루 경기 수</span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={vLeagueGenGamesPerDay}
                            onChange={(e) =>
                              setVLeagueGenGamesPerDay(Number(e.target.value || 1))
                            }
                          />
                        </label>
                        <label className="vleague-check">
                          <input
                            type="checkbox"
                            checked={vLeagueGenApplyDates}
                            onChange={(e) => setVLeagueGenApplyDates(e.target.checked)}
                          />
                          날짜 자동 배정
                        </label>
                      </div>

                      <div className="vleague-matches-control-row">
                        <div className="vleague-exclude-wrap">
                          <button
                            type="button"
                            className="vleague-ghost"
                            onClick={() => setVLeagueExcludeOpen((v) => !v)}
                          >
                            제외 날짜 선택 ({vLeagueGradeTab === "malgeun" ? "맑은샘" : "고운샘"} · {vLeagueCurrentExcludeDates.length})
                          </button>
                          {vLeagueExcludeOpen && (
                            <div className="vleague-exclude-popover">
                              <div className="vleague-exclude-head">
                                <button
                                  type="button"
                                  className="vleague-exclude-nav"
                                  onClick={() =>
                                    setVLeagueExcludeMonth(
                                      (prev) =>
                                        new Date(
                                          prev.getFullYear(),
                                          prev.getMonth() - 1,
                                          1
                                        )
                                    )
                                  }
                                >
                                  ‹
                                </button>
                                <div className="vleague-exclude-month">
                                  {vLeagueExcludeMonth.getFullYear()}년{" "}
                                  {vLeagueExcludeMonth.getMonth() + 1}월
                                </div>
                                <button
                                  type="button"
                                  className="vleague-exclude-nav"
                                  onClick={() =>
                                    setVLeagueExcludeMonth(
                                      (prev) =>
                                        new Date(
                                          prev.getFullYear(),
                                          prev.getMonth() + 1,
                                          1
                                        )
                                    )
                                  }
                                >
                                  ›
                                </button>
                                <button
                                  type="button"
                                  className="vleague-exclude-close"
                                  onClick={() => setVLeagueExcludeOpen(false)}
                                >
                                  닫기
                                </button>
                              </div>
                              <div className="vleague-exclude-grid">
                                {["일", "월", "화", "수", "목", "금", "토"].map(
                                  (d) => (
                                    <div
                                      key={d}
                                      className={
                                        "vleague-exclude-dow" +
                                        (d === "일"
                                          ? " sunday"
                                          : d === "토"
                                            ? " saturday"
                                            : "")
                                      }
                                    >
                                      {d}
                                    </div>
                                  )
                                )}
                                {buildMonthCells(vLeagueExcludeMonth).map(
                                  (cell, idx) => {
                                    if (!cell) {
                                      return (
                                        <div
                                          key={`empty-${idx}`}
                                          className="vleague-exclude-cell empty"
                                        />
                                      );
                                    }
                                    const ymd = toYmd(cell);
                                    const excluded = vLeagueCurrentExcludedDateSet.has(ymd);
                                    const dow = cell.getDay();
                                    return (
                                      <button
                                        key={ymd}
                                        type="button"
                                        className={
                                          "vleague-exclude-cell" +
                                          (dow === 0 ? " sunday" : "") +
                                          (dow === 6 ? " saturday" : "") +
                                          (excluded ? " excluded" : "")
                                        }
                                        onClick={() =>
                                          toggleVLeagueExcludeDate(vLeagueGradeTab, ymd)
                                        }
                                      >
                                        <span className="vleague-exclude-daynum">
                                          {cell.getDate()}
                                        </span>
                                      </button>
                                    );
                                  }
                                )}
                              </div>
                              <div className="vleague-exclude-hint">
                                토/일은 자동 제외됩니다. (공휴일/행사일만 선택해도
                                됩니다.)
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="vleague-matches-control-row">
                        <div className="vleague-seg">
                          <button
                            type="button"
                            className={
                              "vleague-seg-btn" +
                              (vLeagueMatchViewMode === "round" ? " active" : "")
                            }
                            onClick={() => setVLeagueMatchViewMode("round")}
                          >
                            라운드별
                          </button>
                          <button
                            type="button"
                            className={
                              "vleague-seg-btn" +
                              (vLeagueMatchViewMode === "list" ? " active" : "")
                            }
                            onClick={() => setVLeagueMatchViewMode("list")}
                          >
                            전체 목록
                          </button>
                        </div>
                        <div className="vleague-seg">
                          <button
                            type="button"
                            className={
                              "vleague-seg-btn" +
                              (vLeagueMatchFilter === "all" ? " active" : "")
                            }
                            onClick={() => setVLeagueMatchFilter("all")}
                          >
                            전체
                          </button>
                          <button
                            type="button"
                            className={
                              "vleague-seg-btn" +
                              (vLeagueMatchFilter === "scheduled" ? " active" : "")
                            }
                            onClick={() => setVLeagueMatchFilter("scheduled")}
                          >
                            예정
                          </button>
                          <button
                            type="button"
                            className={
                              "vleague-seg-btn" +
                              (vLeagueMatchFilter === "completed" ? " active" : "")
                            }
                            onClick={() => setVLeagueMatchFilter("completed")}
                          >
                            완료
                          </button>
                        </div>
                      </div>

                      <div className="vleague-matches-action-row">
                        <button
                          type="button"
                          className="vleague-primary"
                          onClick={handleGenerateVLeagueMatches}
                        >
                          대진표 자동 생성
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeagueSavingMatches}
                          onClick={handleSaveVLeagueMatchesToSupabase}
                        >
                          {vLeagueSavingMatches ? "저장 중..." : "Supabase에 저장"}
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeaguePushingToCalendar}
                          onClick={handlePushVLeagueMatchesToCalendar}
                        >
                          {vLeaguePushingToCalendar
                            ? "반영 중..."
                            : "일정에 일괄 반영"}
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeagueSyncingCalendar}
                          onClick={handleSyncVLeagueCalendarEvents}
                        >
                          {vLeagueSyncingCalendar
                            ? "정리 중..."
                            : "일정 중복 정리/재생성"}
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeagueDeletingMatchesAll}
                          onClick={handleDeleteAllVLeagueMatchesFromSupabase}
                        >
                          {vLeagueDeletingMatchesAll
                            ? "삭제 중..."
                            : "대진표 전체 삭제(Supabase)"}
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeagueValidating}
                          onClick={handleValidateVLeagueSchedule}
                        >
                          {vLeagueValidating ? "검증 중..." : "대진표 검증"}
                        </button>
                      </div>
                      </div>
                    ) : (
                      <div className="vleague-matches-viewer-note">
                        대진표 생성/수정은 관리자만 가능합니다.
                      </div>
                    )}
                  </div>

                  {(vLeagueMatchesLoading || vLeagueLoading) && (
                    <div className="cal-loading">불러오는 중...</div>
                  )}

                  {!vLeagueMatchesLoading && vLeagueMatchesError && (
                    <div className="activity-empty">
                      대진표 테이블을 불러오지 못했습니다: {vLeagueMatchesError}
                      <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12 }}>
                        Supabase에 <code>vleague_matches</code> 테이블을 만든 뒤 다시
                        시도해 주세요.
                      </div>
                    </div>
                  )}

                  {!vLeagueMatchesLoading && !vLeagueMatchesError && (
                    (() => {
                      const hasSavedMatches = (vLeagueMatches || []).some((m) => Boolean(m?.id));
                      const source =
                        isVLeagueAdmin &&
                        vLeagueMatchesDraft?.flat?.length &&
                        !hasSavedMatches
                          ? vLeagueMatchesDraft.flat
                          : vLeagueMatches;
                      const list = (source || [])
                        .filter((m) => m.league === vLeagueGradeTab)
                        .filter((m) => {
                          if (vLeagueMatchFilter === "all") return true;
                          return m.status === vLeagueMatchFilter;
                        })
                        .sort((a, b) => {
                          if ((a.round_no || 0) !== (b.round_no || 0)) {
                            return (a.round_no || 0) - (b.round_no || 0);
                          }
                          return (a.match_no || 0) - (b.match_no || 0);
                        });

                      if (list.length === 0) {
                        return (
                          <div className="activity-empty">
                            {isVLeagueAdmin
                              ? "아직 대진표가 없습니다. “대진표 자동 생성”을 눌러 만들어 주세요."
                              : "대진표가 작성되지 않았습니다."}
                          </div>
                        );
                      }

                      const renderMatchLine = (m) => {
                        const homeName =
                          vleagueClassNameById[m.home_class_id] || "학급";
                        const awayName =
                          vleagueClassNameById[m.away_class_id] || "학급";
                        const datePart = m.match_date ? `${m.match_date} · ` : "";
                        const scorePart =
                          m.status === "completed" &&
                          m.home_score != null &&
                          m.away_score != null
                            ? ` (${m.home_score}:${m.away_score})`
                            : "";
                        const draft = vLeagueResultDrafts[m.id] || {};
                        const homeInput = draft.home ?? (m.home_score ?? "");
                        const awayInput = draft.away ?? (m.away_score ?? "");
                        const winInput = draft.winScore ?? "";
                        const homeNum = Number(homeInput);
                        const awayNum = Number(awayInput);
                        const winNum = Number(winInput);
                        let winnerLabel = "";
                        if (Number.isFinite(winNum) && winNum > 0) {
                          if (
                            Number.isFinite(homeNum) &&
                            homeNum === winNum &&
                            awayNum !== winNum
                          ) {
                            winnerLabel = `${homeName} 승`;
                          } else if (
                            Number.isFinite(awayNum) &&
                            awayNum === winNum &&
                            homeNum !== winNum
                          ) {
                            winnerLabel = `${awayName} 승`;
                          }
                        }
                        return (
                          <div key={`${m.league}-${m.round_no}-${m.match_no}`} className="vleague-match-row">
                            <div className="vleague-match-left">
                              <div className="vleague-match-title">
                                {homeName} <span className="vleague-vs">vs</span>{" "}
                                {awayName}
                                {scorePart}
                              </div>
                              <div className="vleague-match-meta">
                                {datePart}R{m.round_no} · #{m.match_no}
                              </div>
                            </div>
                            {isVLeagueAdmin && m.id && (
                              <div className="vleague-match-actions">
                                <div className="vleague-result-inputs">
                                  <input
                                    type="number"
                                    min="1"
                                    inputMode="numeric"
                                    className="vleague-score-input vleague-win-input"
                                    value={winInput}
                                    onChange={(e) =>
                                      setVLeagueResultDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: {
                                          home:
                                            prev[m.id]?.home ??
                                            (m.home_score ?? ""),
                                          away:
                                            prev[m.id]?.away ??
                                            (m.away_score ?? ""),
                                          winScore: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="승리점수"
                                    aria-label="승리 점수"
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    className="vleague-score-input"
                                    value={
                                      homeInput
                                    }
                                    onChange={(e) =>
                                      setVLeagueResultDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: {
                                          home: e.target.value,
                                          away:
                                            prev[m.id]?.away ??
                                            (m.away_score ?? ""),
                                          winScore:
                                            prev[m.id]?.winScore ?? "",
                                        },
                                      }))
                                    }
                                    aria-label="홈팀 점수"
                                  />
                                  <span className="vleague-score-sep">:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    className="vleague-score-input"
                                    value={
                                      awayInput
                                    }
                                    onChange={(e) =>
                                      setVLeagueResultDrafts((prev) => ({
                                        ...prev,
                                        [m.id]: {
                                          home:
                                            prev[m.id]?.home ??
                                            (m.home_score ?? ""),
                                          away: e.target.value,
                                          winScore:
                                            prev[m.id]?.winScore ?? "",
                                        },
                                      }))
                                    }
                                    aria-label="원정팀 점수"
                                  />
                                  <div className="vleague-winner-live">
                                    {winnerLabel || "-"}
                                  </div>
                                  <button
                                    type="button"
                                    className="vleague-result-save"
                                    disabled={vLeagueResultSavingId === m.id}
                                    onClick={() => handleSaveVLeagueMatchResult(m)}
                                  >
                                    {vLeagueResultSavingId === m.id
                                      ? "저장 중..."
                                      : "결과 저장"}
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  className="vleague-match-postpone"
                                  disabled={
                                    vLeagueMatchPostponingId === m.id ||
                                    vLeagueUndoingMatchId === m.id ||
                                    vLeagueManualRestoreMatchId === m.id
                                  }
                                  onClick={() => handlePostponeMatchToEnd(m)}
                                >
                                  {vLeagueMatchPostponingId === m.id ? "연기 중..." : "맨 뒤로"}
                                </button>
                                <button
                                  type="button"
                                  className="vleague-match-postpone"
                                  disabled={
                                    vLeagueMatchPostponingId === m.id ||
                                    vLeagueUndoingMatchId === m.id ||
                                    vLeagueManualRestoreMatchId === m.id
                                  }
                                  onClick={() => handleManualRestoreMatchDate(m)}
                                >
                                  {vLeagueManualRestoreMatchId === m.id
                                    ? "복구 중..."
                                    : "날짜 복구"}
                                </button>
                                {vLeaguePostponeUndoByMatchId[m.id]?.fromDate &&
                                  String(vLeaguePostponeUndoByMatchId[m.id]?.toDate || "") ===
                                    String(m.match_date || "") && (
                                    <button
                                      type="button"
                                      className="vleague-postpone-undo-btn"
                                      disabled={
                                        vLeagueMatchPostponingId === m.id ||
                                        vLeagueUndoingMatchId === m.id ||
                                        vLeagueManualRestoreMatchId === m.id
                                      }
                                      onClick={() => handleUndoPostponedMatch(m)}
                                      title="연기 취소"
                                      aria-label="연기 취소"
                                    >
                                      ↶
                                    </button>
                                  )}
                              </div>
                            )}
                            <div
                              className={
                                "vleague-match-badge" +
                                (m.status === "completed"
                                  ? " done"
                                  : " scheduled")
                              }
                            >
                              {m.status === "completed" ? "완료" : "예정"}
                            </div>
                          </div>
                        );
                      };

                      if (vLeagueMatchViewMode === "list") {
                        return <div className="vleague-match-list">{list.map(renderMatchLine)}</div>;
                      }

                      const byRound = {};
                      for (const m of list) {
                        if (!byRound[m.round_no]) byRound[m.round_no] = [];
                        byRound[m.round_no].push(m);
                      }
                      const roundNos = Object.keys(byRound)
                        .map((x) => Number(x))
                        .sort((a, b) => a - b);
                      return (
                        <div className="vleague-round-list">
                          {roundNos.map((rn) => (
                            <details key={rn} className="vleague-round-card" open={rn === 1}>
                              <summary className="vleague-round-head">
                                <span>R{rn}</span>
                                <span className="vleague-round-count">
                                  {byRound[rn].length}경기
                                </span>
                              </summary>
                              <div className="vleague-match-list">
                                {byRound[rn].map(renderMatchLine)}
                              </div>
                            </details>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              )}

              {clubTab === "vClasses" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body vleague-classes-body">
                  <div className="vleague-section-head vleague-section-head--center">
                    <div className="vleague-section-title">참가 학급</div>
                  </div>
                  {vLeagueLoading && (
                    <div className="cal-loading">불러오는 중...</div>
                  )}
                  {!vLeagueLoading &&
                    (vLeagueClasses.length === 0 ? (
                      <div className="vleague-class-list">
                        <div className="activity-empty vleague-empty-box">
                          <p>
                            {vLeagueClassesError
                              ? `데이터를 불러오지 못했습니다: ${vLeagueClassesError}`
                              : "등록된 참가 학급이 없습니다."}
                          </p>
                          <p className="vleague-empty-hint">
                            Supabase에 행이 있는데도 비어 보이면, 대부분{" "}
                            <strong>vleague_classes.club_id</strong>가 이 종목과
                            맞지 않을 때입니다.{" "}
                            <strong>clubs</strong> 테이블에서 이름이{" "}
                            <strong>새샘 V리그</strong>인 행의{" "}
                            <strong>id</strong>와,{" "}
                            <code>vleague_classes</code>의{" "}
                            <strong>club_id</strong>가{" "}
                            <strong>완전히 같아야</strong> 합니다.
                          </p>
                          {(() => {
                            const c = getClubByName(page.clubName);
                            return c?.id ? (
                              <p className="vleague-empty-id">
                                이 앱이 조회에 쓰는 club_id:{" "}
                                <code>{c.id}</code>
                              </p>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    ) : (
                      (() => {
                        const { malgeun, goun, other } =
                          splitVLeagueClassesByGrade(vLeagueClasses);
                        const displayList =
                          vLeagueGradeTab === "malgeun" ? malgeun : goun;
                        const renderRow = (row) => {
                          const nickVal =
                            vLeagueNickDrafts[row.id] !== undefined
                              ? vLeagueNickDrafts[row.id]
                              : (row.nickname ?? "");
                          const canNick = canEditVLeagueClassNickname(row);
                          const wins = Number(row.wins);
                          const losses = Number(row.losses);
                          const rk = row.rank_order;
                          return (
                            <div key={row.id} className="vleague-class-row">
                              <div className="vleague-class-left">
                                <div className="vleague-class-name-cell">
                                  {row.class_name}
                                </div>
                              </div>
                              <div className="vleague-class-nick-block">
                                {canNick ? (
                                  <>
                                    <input
                                      type="text"
                                      className="vleague-nick-input"
                                      placeholder="학급 별명 (10자 이내)"
                                      maxLength={10}
                                      value={nickVal}
                                      onChange={(e) =>
                                        setVLeagueNickDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: e.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="vleague-nick-save"
                                      disabled={
                                        vLeagueNicknameSavingId === row.id
                                      }
                                      onClick={() =>
                                        handleSaveVLeagueNickname(row)
                                      }
                                    >
                                      {vLeagueNicknameSavingId === row.id
                                        ? "저장 중..."
                                        : "저장"}
                                    </button>
                                  </>
                                ) : (
                                  (() => {
                                    const nickText = row.nickname?.trim() ? row.nickname : "—";
                                    const toneClass =
                                      nickText === "—"
                                        ? ""
                                        : getVLeagueNicknameToneClass(row.class_name);
                                    return (
                                      <span
                                        className={
                                          "vleague-nick-readonly" +
                                          (toneClass ? ` ${toneClass}` : "")
                                        }
                                      >
                                        {nickText}
                                      </span>
                                    );
                                  })()
                                )}
                              </div>
                              <div className="vleague-class-stats vleague-class-stats--right">
                                {Number.isFinite(wins) ? wins : 0}승{" "}
                                {Number.isFinite(losses) ? losses : 0}패 ·{" "}
                                {rk != null && rk !== ""
                                  ? `${rk}위`
                                  : "순위 —"}
                              </div>
                            </div>
                          );
                        };
                        return (
                          <>
                            <div className="vleague-grade-tabs">
                              <button
                                type="button"
                                className={
                                  "vleague-grade-tab vleague-grade-tab--malgeun" +
                                  (vLeagueGradeTab === "malgeun"
                                    ? " active"
                                    : "")
                                }
                                onClick={() => setVLeagueGradeTab("malgeun")}
                              >
                                맑은샘 리그
                                <span className="vleague-grade-tab-count">
                                  ({malgeun.length})
                                </span>
                              </button>
                              <button
                                type="button"
                                className={
                                  "vleague-grade-tab vleague-grade-tab--goun" +
                                  (vLeagueGradeTab === "goun" ? " active" : "")
                                }
                                onClick={() => setVLeagueGradeTab("goun")}
                              >
                                고운샘 리그
                                <span className="vleague-grade-tab-count">
                                  ({goun.length})
                                </span>
                              </button>
                            </div>
                            <div className="vleague-class-list">
                              {displayList.length === 0 ? (
                                <div className="activity-empty">
                                  이 리그에 해당하는 학급이 없습니다. (학급명이{" "}
                                  {vLeagueGradeTab === "malgeun"
                                    ? "5학년"
                                    : "6학년"}
                                  으로 시작하는지 확인해 주세요.)
                                </div>
                              ) : (
                                displayList.map((row) => renderRow(row))
                              )}
                            </div>
                            {other.length > 0 && (
                              <div className="vleague-other-wrap">
                                <p className="vleague-other-title">
                                  5학년·6학년으로 자동 분류되지 않은 학급 (
                                  {other.length}개)
                                </p>
                                <div className="vleague-class-list">
                                  {other.map((row) => renderRow(row))}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()
                    ))}
                </div>
              )}

              {clubTab === "vStandings" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body vleague-main-standings-like-popup">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">순위표</div>
                    <p className="vleague-section-desc">
                      {vLeagueStandingsUsesTournament
                        ? "리그전·토너먼트가 모두 종료되어 토너먼트 최종 순위가 반영된 순위표입니다."
                        : "대진표에 입력한 경기 결과를 바탕으로 자동 계산됩니다."}
                    </p>
                  </div>
                  <div className="vleague-grade-tabs">
                    <button
                      type="button"
                      className={
                        "vleague-grade-tab vleague-grade-tab--malgeun" +
                        (vLeagueGradeTab === "malgeun" ? " active" : "")
                      }
                      onClick={() => setVLeagueGradeTab("malgeun")}
                    >
                      맑은샘 리그
                    </button>
                    <button
                      type="button"
                      className={
                        "vleague-grade-tab vleague-grade-tab--goun" +
                        (vLeagueGradeTab === "goun" ? " active" : "")
                      }
                      onClick={() => setVLeagueGradeTab("goun")}
                    >
                      고운샘 리그
                    </button>
                  </div>
                  {vLeagueLoading && (
                    <div className="cal-loading">불러오는 중...</div>
                  )}
                  {!vLeagueLoading && (
                    <div className="vleague-standings-wrap">
                      {vLeagueComputedStandings.length === 0 ? (
                        <div className="activity-empty">
                          순위 데이터가 없습니다. 대진표에서 경기 결과를 입력해
                          주세요.
                        </div>
                      ) : (
                        <div className="vleague-standings-table-wrap">
                          <table className="vleague-standings-table">
                            <thead>
                              <tr>
                      <th scope="col">
                        <div className="vleague-rank-cell vleague-rank-head-cell">
                          <span className="vleague-rank-note-left">
                            {vLeagueStandingsUsesTournament ? "" : "토너먼트"}
                          </span>
                          <span className="vleague-rank-core">순위</span>
                          <span className="vleague-rank-note-right">승격</span>
                        </div>
                      </th>
                                <th scope="col">팀(학급)</th>
                                <th scope="col">승</th>
                                <th scope="col">패</th>
                                <th scope="col">승점</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vLeagueComputedStandings.map((row) => (
                                <tr key={row.class_id}>
                                  <td>
                                    <span className="vleague-rank-cell">
                                      <span
                                        className={
                                          "vleague-rank-note-left" +
                                          (!vLeagueStandingsUsesTournament &&
                                          row.rank_order <= 4
                                            ? ""
                                            : " vleague-rank-note-placeholder")
                                        }
                                      >
                                        {!vLeagueStandingsUsesTournament &&
                                        row.rank_order <= 4
                                          ? "토너먼트"
                                          : ""}
                                      </span>
                                      <span className="vleague-rank-core">
                                        <span
                                          className={
                                            "vleague-rank-text" +
                                            (row.rank_order <= 3
                                              ? " vleague-rank-text--" + row.rank_order
                                              : "")
                                          }
                                        >
                                          {row.rank_order}위
                                        </span>
                                      </span>
                                      <span
                                        className={
                                          "vleague-rank-note-right" +
                                          ((vLeagueGradeTab === "malgeun" &&
                                            row.rank_order >= 1 &&
                                            row.rank_order <= 3) ||
                                          (vLeagueGradeTab === "goun" &&
                                            row.rank_order >= 5 &&
                                            row.rank_order <= 7)
                                            ? ""
                                            : " vleague-rank-note-placeholder")
                                        }
                                      >
                                        {(vLeagueGradeTab === "malgeun" &&
                                          row.rank_order >= 1 &&
                                          row.rank_order <= 3) ||
                                        (vLeagueGradeTab === "goun" &&
                                          row.rank_order >= 5 &&
                                          row.rank_order <= 7)
                                          ? vLeagueGradeTab === "malgeun"
                                            ? "승격"
                                            : "강등"
                                          : ""}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="vleague-team-cell">
                                    {row.team_name}
                                  </td>
                                  <td>{row.wins ?? 0}</td>
                                  <td>{row.losses ?? 0}</td>
                                  <td>{row.points ?? 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {clubTab === "vTournament" && isVLeagueClub(page.clubName) && isVLeagueAdmin && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">토너먼트 일정 생성</div>
                    <p className="vleague-section-desc">
                      리그 순위 1~4위로 준결승 2경기(단판)를 만들고, 준결승
                      결과가 저장되면 패자 2팀의 3·4위전과 승자 2팀의 결승
                      3경기(3판 2선승) 일정을 자동으로 채웁니다.
                    </p>
                  </div>

                  <div className="vleague-grade-tabs">
                    <button
                      type="button"
                      className={
                        "vleague-grade-tab vleague-grade-tab--malgeun" +
                        (vLeagueGradeTab === "malgeun" ? " active" : "")
                      }
                      onClick={() => setVLeagueGradeTab("malgeun")}
                    >
                      맑은샘 리그
                    </button>
                    <button
                      type="button"
                      className={
                        "vleague-grade-tab vleague-grade-tab--goun" +
                        (vLeagueGradeTab === "goun" ? " active" : "")
                      }
                      onClick={() => setVLeagueGradeTab("goun")}
                    >
                      고운샘 리그
                    </button>
                  </div>

                  {isVLeagueAdmin ? (
                    <div className="vleague-matches-controls">
                      <div className="vleague-matches-control-row">
                        <label className="vleague-field">
                          <span>준결승 시작 날짜</span>
                          <input
                            type="date"
                            value={vLeagueTournamentStartDate}
                            onChange={(e) => setVLeagueTournamentStartDate(e.target.value)}
                          />
                        </label>
                        <label className="vleague-field">
                          <span>3·4위전 날짜</span>
                          <input
                            type="date"
                            value={vLeagueTournamentBronzeDate}
                            onChange={(e) =>
                              setVLeagueTournamentBronzeDate(e.target.value)
                            }
                          />
                        </label>
                      </div>
                      <div className="vleague-matches-action-row">
                        <button
                          type="button"
                          className="vleague-primary"
                          onClick={handleGenerateVLeagueTournamentDraft}
                        >
                          토너먼트 일정 생성
                        </button>
                        <button
                          type="button"
                          className="vleague-ghost"
                          disabled={vLeagueTournamentSaving}
                          onClick={handleSaveVLeagueTournamentEvents}
                        >
                          {vLeagueTournamentSaving ? "저장 중..." : "일정에 저장"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="vleague-matches-viewer-note">
                      대진표 생성/수정은 관리자만 가능합니다.
                    </div>
                  )}

                  {vLeagueTournamentDraft.length > 0 && (
                    <div className="vleague-tournament-block">
                      <div className="vleague-tournament-title">생성된 일정 초안</div>
                      <div className="vleague-match-list">
                        {vLeagueTournamentDraft.map((row) => (
                          <div
                            key={`draft-${row.order}`}
                            className="vleague-match-row"
                          >
                            <div className="vleague-match-left">
                              <div className="vleague-match-title">{row.content}</div>
                              <div className="vleague-match-meta">
                                {row.event_date}
                                {row.existingId ? " · 기존 준결승 유지" : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="vleague-tournament-block">
                    <div className="vleague-tournament-title">저장된 토너먼트 일정</div>
                    {vLeagueTournamentLoading ? (
                      <div className="cal-loading">불러오는 중...</div>
                    ) : vLeagueTournamentEvents.length === 0 ? (
                      <div className="activity-empty">저장된 토너먼트 일정이 없습니다.</div>
                    ) : (
                      <div className="vleague-match-list">
                        {vLeagueTournamentEvents.map((row) => {
                          const teams = parseTournamentTeams(row.content);
                          const saved = parseTournamentSavedScore(row.content) || {};
                          const draft = vLeagueTournamentResultDrafts[row.id] || {};
                          const homeInput = draft.home ?? saved.home ?? "";
                          const awayInput = draft.away ?? saved.away ?? "";
                          const winInput = draft.winScore ?? saved.winScore ?? "";
                          const classA = teams ? getTeamClassShortLabel(teams.home) : "";
                          const classB = teams ? getTeamClassShortLabel(teams.away) : "";
                          const homeNum = Number(homeInput);
                          const awayNum = Number(awayInput);
                          const winNum = Number(winInput);
                          let winnerLabel = "";
                          if (teams && Number.isFinite(winNum) && winNum > 0) {
                            if (
                              Number.isFinite(homeNum) &&
                              homeNum === winNum &&
                              awayNum !== winNum
                            ) {
                              winnerLabel = `${classA} 승`;
                            } else if (
                              Number.isFinite(awayNum) &&
                              awayNum === winNum &&
                              homeNum !== winNum
                            ) {
                              winnerLabel = `${classB} 승`;
                            }
                          }
                          const savedScorePart =
                            saved.home != null && saved.away != null
                              ? saved.winScore
                                ? ` (승리${saved.winScore}점 · ${saved.home}:${saved.away})`
                                : ` (${saved.home}:${saved.away})`
                              : "";
                          return (
                            <div key={row.id} className="vleague-match-row">
                              <div className="vleague-match-left">
                                <div className="vleague-match-title">
                                  {formatTeamForResultInput(teams?.home || "")}{" "}
                                  <span className="vleague-vs">vs</span>{" "}
                                  {formatTeamForResultInput(teams?.away || "")}
                                  {savedScorePart}
                                </div>
                                <div className="vleague-match-meta">
                                  {row.event_date}
                                  {parseTournamentMatchInfo(row.content).gameNo
                                    ? ` · ${parseTournamentMatchInfo(row.content).ruleLabel} ${parseTournamentMatchInfo(row.content).gameNo}차전`
                                    : ` · ${parseTournamentMatchInfo(row.content).ruleLabel}`}
                                </div>
                              </div>
                              {isVLeagueAdmin && teams && (
                                <div className="vleague-match-actions">
                                  <div className="vleague-result-inputs">
                                    <input
                                      type="number"
                                      min="1"
                                      inputMode="numeric"
                                      className="vleague-score-input vleague-win-input"
                                      value={winInput}
                                      onChange={(e) =>
                                        setVLeagueTournamentResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: prev[row.id]?.home ?? saved.home ?? "",
                                            away: prev[row.id]?.away ?? saved.away ?? "",
                                            winScore: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="승리점수"
                                      aria-label="승리 점수"
                                    />
                                    <span className="vleague-tournament-class-label">
                                      {classA}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="vleague-score-input"
                                      value={homeInput}
                                      onChange={(e) =>
                                        setVLeagueTournamentResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: e.target.value,
                                            away: prev[row.id]?.away ?? saved.away ?? "",
                                            winScore: prev[row.id]?.winScore ?? saved.winScore ?? "",
                                          },
                                        }))
                                      }
                                      aria-label={`${classA} 점수`}
                                    />
                                    <span className="vleague-score-sep">:</span>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="vleague-score-input"
                                      value={awayInput}
                                      onChange={(e) =>
                                        setVLeagueTournamentResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: prev[row.id]?.home ?? saved.home ?? "",
                                            away: e.target.value,
                                            winScore: prev[row.id]?.winScore ?? saved.winScore ?? "",
                                          },
                                        }))
                                      }
                                      aria-label={`${classB} 점수`}
                                    />
                                    <span className="vleague-tournament-class-label">
                                      {classB}
                                    </span>
                                    <div className="vleague-winner-live">
                                      {winnerLabel || "-"}
                                    </div>
                                    <button
                                      type="button"
                                      className="vleague-result-save"
                                      disabled={vLeagueTournamentResultSavingId === row.id}
                                      onClick={() => handleSaveVLeagueTournamentResult(row)}
                                    >
                                      {vLeagueTournamentResultSavingId === row.id
                                        ? "저장 중..."
                                        : "결과 저장"}
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="vleague-ghost"
                                    disabled={vLeagueTournamentPostponingId === row.id}
                                    onClick={() => handlePostponeVLeagueTournamentEvent(row)}
                                  >
                                    {vLeagueTournamentPostponingId === row.id
                                      ? "이동 중..."
                                      : "뒤로 미루기"}
                                  </button>
                                  <button
                                    type="button"
                                    className="vleague-ghost"
                                    disabled={vLeagueTournamentDeletingId === row.id}
                                    onClick={() => handleDeleteVLeagueTournamentEvent(row)}
                                  >
                                    {vLeagueTournamentDeletingId === row.id
                                      ? "삭제 중..."
                                      : "일정 삭제"}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {clubTab === "vPromotion" && isVLeagueClub(page.clubName) && isVLeagueAdmin && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">승강전 일정 생성</div>
                    <p className="vleague-section-desc">
                      맑은샘·고운샘 리그전과 토너먼트가 모두 끝나 최종 순위가
                      확정되면, 고운샘 5·6·7위와 맑은샘 3·2·1위가 단판 승강전을
                      치릅니다.
                    </p>
                  </div>

                  {!promotionPlayoffReady ? (
                    <div className="vleague-matches-viewer-note">
                      아직 승강전 일정을 만들 수 없습니다. 두 리그의 리그전·토너먼트가
                      모두 종료되어야 합니다.
                    </div>
                  ) : (
                    <div className="vleague-tournament-block">
                      <div className="vleague-tournament-title">승강전 매칭 (최종 순위)</div>
                      <div className="vleague-match-list">
                        {promotionMatchupPreview.map((row) => (
                          <div key={`promo-preview-${row.gameNo}`} className="vleague-match-row">
                            <div className="vleague-match-left">
                              <div className="vleague-match-title">
                                {row.gameNo}경기 · 고운샘 {row.gounRank}위 {row.gounTeamName}{" "}
                                <span className="vleague-vs">vs</span> 맑은샘 {row.malgeunRank}위{" "}
                                {row.malgeunTeamName}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="vleague-matches-controls">
                    <div className="vleague-matches-control-row">
                      <label className="vleague-field">
                        <span>1경기 날짜</span>
                        <input
                          type="date"
                          value={vLeaguePromotionStartDate}
                          onChange={(e) => setVLeaguePromotionStartDate(e.target.value)}
                          disabled={!promotionPlayoffReady}
                        />
                      </label>
                    </div>
                    <div className="vleague-matches-action-row">
                      <button
                        type="button"
                        className="vleague-primary"
                        onClick={handleGenerateVLeaguePromotionDraft}
                        disabled={!promotionPlayoffReady}
                      >
                        승강전 일정 생성
                      </button>
                      <button
                        type="button"
                        className="vleague-ghost"
                        disabled={vLeaguePromotionSaving || !promotionPlayoffReady}
                        onClick={handleSaveVLeaguePromotionEvents}
                      >
                        {vLeaguePromotionSaving ? "저장 중..." : "일정에 저장"}
                      </button>
                    </div>
                  </div>

                  {vLeaguePromotionDraft.length > 0 && (
                    <div className="vleague-tournament-block">
                      <div className="vleague-tournament-title">생성된 일정 초안</div>
                      <div className="vleague-match-list">
                        {vLeaguePromotionDraft.map((row) => (
                          <div key={`promo-draft-${row.order}`} className="vleague-match-row">
                            <div className="vleague-match-left">
                              <div className="vleague-match-title">{row.content}</div>
                              <div className="vleague-match-meta">{row.event_date}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="vleague-tournament-block">
                    <div className="vleague-tournament-title">저장된 승강전 일정</div>
                    {vLeaguePromotionLoading ? (
                      <div className="cal-loading">불러오는 중...</div>
                    ) : vLeaguePromotionEvents.length === 0 ? (
                      <div className="activity-empty">저장된 승강전 일정이 없습니다.</div>
                    ) : (
                      <div className="vleague-match-list">
                        {vLeaguePromotionEvents.map((row) => {
                          const teams = parseTournamentTeams(row.content);
                          const saved = parseTournamentSavedScore(row.content) || {};
                          const draft = vLeaguePromotionResultDrafts[row.id] || {};
                          const homeInput = draft.home ?? saved.home ?? "";
                          const awayInput = draft.away ?? saved.away ?? "";
                          const winInput = draft.winScore ?? saved.winScore ?? "";
                          const classA = teams ? getTeamClassShortLabel(teams.home) : "";
                          const classB = teams ? getTeamClassShortLabel(teams.away) : "";
                          const homeNum = Number(homeInput);
                          const awayNum = Number(awayInput);
                          const winNum = Number(winInput);
                          let winnerLabel = "";
                          if (teams && Number.isFinite(winNum) && winNum > 0) {
                            if (
                              Number.isFinite(homeNum) &&
                              homeNum === winNum &&
                              awayNum !== winNum
                            ) {
                              winnerLabel = `${classA} 승`;
                            } else if (
                              Number.isFinite(awayNum) &&
                              awayNum === winNum &&
                              homeNum !== winNum
                            ) {
                              winnerLabel = `${classB} 승`;
                            }
                          }
                          const savedScorePart =
                            saved.home != null && saved.away != null
                              ? saved.winScore
                                ? ` (승리${saved.winScore}점 · ${saved.home}:${saved.away})`
                                : ` (${saved.home}:${saved.away})`
                              : "";
                          return (
                            <div key={row.id} className="vleague-match-row">
                              <div className="vleague-match-left">
                                <div className="vleague-match-title">
                                  {formatTeamForResultInput(teams?.home || "")}{" "}
                                  <span className="vleague-vs">vs</span>{" "}
                                  {formatTeamForResultInput(teams?.away || "")}
                                  {savedScorePart}
                                </div>
                                <div className="vleague-match-meta">
                                  {row.event_date}
                                  {parseTournamentMatchInfo(row.content).gameNo
                                    ? ` · ${parseTournamentMatchInfo(row.content).ruleLabel} ${parseTournamentMatchInfo(row.content).gameNo}경기`
                                    : ` · ${parseTournamentMatchInfo(row.content).ruleLabel}`}
                                </div>
                              </div>
                              {isVLeagueAdmin && teams && (
                                <div className="vleague-match-actions">
                                  <div className="vleague-result-inputs">
                                    <input
                                      type="number"
                                      min="1"
                                      inputMode="numeric"
                                      className="vleague-score-input vleague-win-input"
                                      value={winInput}
                                      onChange={(e) =>
                                        setVLeaguePromotionResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: prev[row.id]?.home ?? saved.home ?? "",
                                            away: prev[row.id]?.away ?? saved.away ?? "",
                                            winScore: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="승리점수"
                                      aria-label="승리 점수"
                                    />
                                    <span className="vleague-tournament-class-label">
                                      {classA}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="vleague-score-input"
                                      value={homeInput}
                                      onChange={(e) =>
                                        setVLeaguePromotionResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: e.target.value,
                                            away: prev[row.id]?.away ?? saved.away ?? "",
                                            winScore:
                                              prev[row.id]?.winScore ?? saved.winScore ?? "",
                                          },
                                        }))
                                      }
                                      aria-label={`${classA} 점수`}
                                    />
                                    <span className="vleague-score-sep">:</span>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      className="vleague-score-input"
                                      value={awayInput}
                                      onChange={(e) =>
                                        setVLeaguePromotionResultDrafts((prev) => ({
                                          ...prev,
                                          [row.id]: {
                                            home: prev[row.id]?.home ?? saved.home ?? "",
                                            away: e.target.value,
                                            winScore:
                                              prev[row.id]?.winScore ?? saved.winScore ?? "",
                                          },
                                        }))
                                      }
                                      aria-label={`${classB} 점수`}
                                    />
                                    <span className="vleague-tournament-class-label">
                                      {classB}
                                    </span>
                                    <div className="vleague-winner-live">
                                      {winnerLabel || "-"}
                                    </div>
                                    <button
                                      type="button"
                                      className="vleague-result-save"
                                      disabled={vLeaguePromotionResultSavingId === row.id}
                                      onClick={() => handleSaveVLeaguePromotionResult(row)}
                                    >
                                      {vLeaguePromotionResultSavingId === row.id
                                        ? "저장 중..."
                                        : "결과 저장"}
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="vleague-ghost"
                                    disabled={vLeaguePromotionPostponingId === row.id}
                                    onClick={() => handlePostponeVLeaguePromotionEvent(row)}
                                  >
                                    {vLeaguePromotionPostponingId === row.id
                                      ? "이동 중..."
                                      : "뒤로 미루기"}
                                  </button>
                                  <button
                                    type="button"
                                    className="vleague-ghost"
                                    disabled={vLeaguePromotionDeletingId === row.id}
                                    onClick={() => handleDeleteVLeaguePromotionEvent(row)}
                                  >
                                    {vLeaguePromotionDeletingId === row.id
                                      ? "삭제 중..."
                                      : "일정 삭제"}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {clubTab === "vCheerLookup" && isVLeagueClub(page.clubName) && isVLeagueAdmin && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">응원 조회</div>
                    <p className="vleague-section-desc">
                      경기일이{" "}
                      <strong>{formatYmdDot(vLeagueCheerCumulativeMinMatchYmd)}</strong>{" "}
                      이후인 경기에 등록된 응원글만 학급별 누적 등록 횟수에
                      포함됩니다. (오늘·이전 경기 응원은 집계하지 않습니다.)
                    </p>
                  </div>
                  {vLeagueCheerCumulativeLoading ? (
                    <div className="cal-loading">불러오는 중...</div>
                  ) : (
                    <div className="vleague-cheer-lookup-panel">
                      {(["malgeun", "goun"]).map((leagueKey) => {
                        const rows = vLeagueCheerCumulativeSummary[leagueKey] || [];
                        const total = rows.reduce(
                          (sum, row) => sum + (Number(row.total_count) || 0),
                          0
                        );
                        return (
                          <div key={leagueKey} className="vleague-cheer-lookup-group">
                            <div className="vleague-cheer-lookup-group-head">
                              <span>
                                {leagueKey === "malgeun" ? "맑은샘 리그" : "고운샘 리그"}
                              </span>
                              <span className="vleague-cheer-lookup-total">
                                누적 합계 {total}회
                              </span>
                            </div>
                            {rows.length === 0 ? (
                              <div className="activity-empty">참가 학급이 없습니다.</div>
                            ) : (
                              <div className="vleague-cheer-lookup-table-wrap">
                                <table className="vleague-cheer-lookup-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">학급</th>
                                      <th scope="col">누적 등록</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row) => (
                                      <tr key={row.class_id}>
                                        <td>{row.team_name}</td>
                                        <td className="vleague-cheer-lookup-num">
                                          {row.total_count}회
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {clubTab === "vCheer" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">우리반 응원하기</div>
                  </div>
                  <div className="vleague-cheer-layout">
                    <div className="vleague-cheer-wrap">
                      {currentUser.role === "student" ||
                      currentUser.role === "teacher" ? (
                        vLeagueCheerWriterClassRow && canWriteVLeagueCheerNow ? (
                          <>
                            <div className="vleague-cheer-head">
                              {vLeagueCheerWriterClassRow.class_name} 응원 메시지 작성
                              {currentUser.role === "teacher" ? " (담임)" : ""}
                            </div>
                            <div className="vleague-cheer-form">
                              <input
                                type="text"
                                className="vleague-cheer-input"
                                maxLength={25}
                                placeholder="응원 메시지 입력 (25자 이내)"
                                value={vLeagueCheerDraft}
                                onChange={(e) => setVLeagueCheerDraft(e.target.value)}
                              />
                              <button
                                type="button"
                                className="vleague-cheer-save"
                                onClick={handleCreateVLeagueCheer}
                              >
                                등록
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="vleague-cheer-head">
                            {vLeagueCheerWriterClassRow
                              ? "응원 글은 우리 반 경기가 있는 날 기준, 전날 오후 2시부터 당일 오후 1시 전까지만 작성할 수 있습니다."
                              : currentUser.role === "teacher"
                                ? "응원 글은 볼 수 있습니다. 작성은 참가 학급에 담임으로 등록되고, 담임 이름이 로그인 이름과 일치할 때만 가능합니다."
                                : "응원 글은 볼 수 있습니다. 작성은 학번으로 확인된 소속 학급이 V리그 참가 학급으로 등록된 학생만 가능합니다."}
                          </div>
                        )
                      ) : (
                        <div className="vleague-cheer-head">
                          응원 글을 볼 수 없는 계정입니다.
                        </div>
                      )}
                      {vLeagueCheerLoading ? (
                        <div className="cal-loading">응원 글 불러오는 중...</div>
                      ) : visibleVLeagueCheers.length === 0 ? (
                        <div className="activity-empty">등록된 응원 메시지가 없습니다.</div>
                      ) : (
                        <div className="vleague-cheer-list">
                          {visibleVLeagueCheers.map((row) => (
                            <div key={row.id} className="vleague-cheer-item">
                              <div className="vleague-cheer-item-top">
                                <div className="vleague-cheer-msg">{row.message}</div>
                                {canDeleteVLeagueCheer(row) ? (
                                  <button
                                    type="button"
                                    className="activity-item-delete vleague-cheer-delete"
                                    onClick={() => handleDeleteVLeagueCheer(row)}
                                  >
                                    삭제
                                  </button>
                                ) : null}
                              </div>
                              <div className="vleague-cheer-meta">
                                {(vLeagueClasses.find((c) => c.id === row.class_id)?.class_name ||
                                  "학급")}{" "}
                                ·{" "}
                                {formatStudentDisplayName(row.student_name, row.student_id)} ·{" "}
                                {formatDateTimeCompact(row.created_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {showVLeagueCheerEventPanelNow && (
                      <aside className="vleague-event-card" aria-label="이벤트 당첨">
                        <div className="vleague-event-title">이벤트 당첨</div>
                        <div className="vleague-event-sub">
                          숨김 처리된 응원 작성자 중 자동 추첨
                        </div>
                        <div className="vleague-event-time">
                          추첨 가능 시간: 경기 당일 13:01 ~ 14:00
                        </div>
                        <div className="vleague-event-hint">
                          {vLeagueCheerAutoDrawInfo.enabled
                            ? `${formatYmdKorean(vLeagueCheerAutoDrawInfo.drawYmd)} 자동 추첨 시간입니다.`
                            : vLeagueCheerAutoDrawInfo.reason}
                        </div>
                        <div className="vleague-event-result">
                          {myClassEventWinnerToday ? (
                            <>
                              <div className="vleague-event-result-label">오늘의 당첨자</div>
                              <div className="vleague-event-winner-name">
                                {formatStudentDisplayName(
                                  myClassEventWinnerToday.winner_student_name,
                                  myClassEventWinnerToday.winner_student_id
                                )}
                              </div>
                              <div className="vleague-event-winner-meta">
                                {vLeagueCheerWriterClassRow?.class_name || "학급"} ·{" "}
                                {formatYmdKorean(myClassEventWinnerToday.match_date)} 추첨
                              </div>
                            </>
                          ) : (
                            <div className="vleague-event-result-empty">
                              아직 자동 추첨 결과가 없습니다.
                            </div>
                          )}
                        </div>
                      </aside>
                    )}
                  </div>
                </div>
              )}

              {clubTab === "vReferee" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">심판 배정</div>
                    <p className="vleague-section-desc">
                      학생 심판을 등록하고 경기별로 배정합니다. (본인 학급 경기는 배정 불가)
                    </p>
                  </div>

                  {!isVLeagueAdmin ? (
                    <div className="vleague-matches-viewer-note">
                      심판 등록/배정은 관리자만 가능합니다.
                    </div>
                  ) : (
                    <div className="vleague-matches-toolbar">
                      <div className="vleague-grade-tabs">
                        <button
                          type="button"
                          className={
                            "vleague-grade-tab vleague-grade-tab--malgeun" +
                            (vLeagueGradeTab === "malgeun" ? " active" : "")
                          }
                          onClick={() => setVLeagueGradeTab("malgeun")}
                        >
                          맑은샘 리그
                          <span className="vleague-grade-tab-count">(5학년)</span>
                        </button>
                        <button
                          type="button"
                          className={
                            "vleague-grade-tab vleague-grade-tab--goun" +
                            (vLeagueGradeTab === "goun" ? " active" : "")
                          }
                          onClick={() => setVLeagueGradeTab("goun")}
                        >
                          고운샘 리그
                          <span className="vleague-grade-tab-count">(6학년)</span>
                        </button>
                      </div>

                      <div className="vleague-matches-controls">
                        <div className="vleague-matches-control-row">
                          <label className="vleague-field">
                            <span>심판 등록(학번)</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={vLeagueRefereeStudentIdDraft}
                              onChange={(e) =>
                                setVLeagueRefereeStudentIdDraft(
                                  e.target.value.replace(/\D/g, "")
                                )
                              }
                              placeholder="6자리 학번"
                            />
                          </label>
                          <button
                            type="button"
                            className="vleague-ghost"
                            disabled={vLeagueRefereeSaving}
                            onClick={handleRegisterVLeagueReferee}
                          >
                            {vLeagueRefereeSaving ? "저장 중..." : "심판 등록"}
                          </button>
                        </div>

                        <div className="vleague-matches-control-row">
                          <div className="vleague-field vleague-field--compact">
                            <span>대상 경기</span>
                            <div className="vleague-matches-viewer-note">
                              현재 리그 전체 경기 {vLeagueCurrentLeagueMatches.length}건
                            </div>
                          </div>
                          <button
                            type="button"
                            className="vleague-ghost"
                            disabled={vLeagueRefereeSaving}
                            onClick={handleAssignVLeagueReferee}
                          >
                            {vLeagueRefereeSaving
                              ? "배정 중..."
                              : "전체 경기 랜덤 배정(심판 2명)"}
                          </button>
                          <button
                            type="button"
                            className="vleague-ghost"
                            disabled={vLeagueRefereeSaving}
                            onClick={handleDeleteAllVLeagueRefereeAssignments}
                          >
                            {vLeagueRefereeSaving ? "삭제 중..." : "배정 전체 삭제"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {vLeagueRefereeLoading ? (
                    <div className="cal-loading">심판 데이터 불러오는 중...</div>
                  ) : (
                    <>
                      <div className="vleague-section-head" style={{ marginTop: 12 }}>
                        <div className="vleague-section-title">등록 심판</div>
                      </div>
                      <div className="vleague-cheer-list">
                        {vLeagueReferees.length === 0 ? (
                          <div className="activity-empty">등록된 심판이 없습니다.</div>
                        ) : (
                          vLeagueReferees.map((r) => (
                            <div key={r.id} className="vleague-cheer-item">
                              <div className="vleague-cheer-msg">
                                {formatStudentDisplayName(r.student_name, r.student_id)} (
                                {r.student_id || "-"})
                              </div>
                              <div className="vleague-cheer-meta">
                                등록일 · {formatDateTimeCompact(r.created_at)}
                              </div>
                              {isVLeagueAdmin && (
                                <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    className="vleague-ghost"
                                    disabled={vLeagueRefereeSaving}
                                    onClick={() => handleDeleteVLeagueReferee(r)}
                                  >
                                    {vLeagueRefereeSaving ? "삭제 중..." : "등록 삭제"}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      <div className="vleague-section-head" style={{ marginTop: 12 }}>
                        <div className="vleague-section-title">경기 심판 배정</div>
                      </div>
                      <div className="vleague-cheer-list">
                        {vLeagueRefereeAssignments.length === 0 ? (
                          <div className="activity-empty">등록된 심판 배정이 없습니다.</div>
                        ) : (
                          vLeagueRefereeAssignments.map((a) => {
                            const m = vLeagueMatchById.get(a.match_id);
                            const home = shortClassLabel(
                              vleagueClassNameById[m?.home_class_id] || "학급"
                            );
                            const away = shortClassLabel(
                              vleagueClassNameById[m?.away_class_id] || "학급"
                            );
                            const matchText = m
                              ? `${m.match_date || "날짜미정"} · R${m.round_no} · ${home} vs ${away}`
                              : "삭제된 경기";
                            return (
                              <div key={a.id} className="vleague-cheer-item">
                                <div className="vleague-cheer-msg">
                                  [{getRefereeRoleLabel(a.assignment_role)}]{" "}
                                  {formatStudentDisplayName(a.student_name, a.student_id)} (
                                  {a.student_id})
                                </div>
                                <div className="vleague-cheer-meta">{matchText}</div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {clubTab === "vRules" && isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">V리그 규칙 관리</div>
                    <p className="vleague-section-desc">
                      종목 페이지 입장 시 자동 팝업으로 노출됩니다.
                    </p>
                  </div>
                  {vLeagueRuleLoading ? (
                    <div className="cal-loading">규칙 불러오는 중...</div>
                  ) : (
                    <div className="vleague-cheer-wrap">
                      {isVLeagueAdmin ? (
                        <div className="vleague-cheer-form" style={{ flexDirection: "column" }}>
                          <textarea
                            className="vleague-cheer-input"
                            style={{ minHeight: 140, width: "100%", resize: "vertical" }}
                            value={vLeagueRuleDraft}
                            onChange={(e) => setVLeagueRuleDraft(e.target.value)}
                            placeholder="V리그 규칙을 입력하세요."
                          />
                          <button
                            type="button"
                            className="vleague-cheer-save"
                            disabled={vLeagueRuleSaving}
                            onClick={handleSaveVLeagueRuleText}
                          >
                            {vLeagueRuleSaving ? "저장 중..." : "규칙 저장"}
                          </button>
                        </div>
                      ) : (
                        <div className="vleague-cheer-head">
                          {vLeagueRuleText || "등록된 규칙이 없습니다."}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {clubTab === "attendance" &&
                !isVLeagueClub(page.clubName) &&
                !isVLeagueClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="attendance-head">
                    <div className="attendance-title">출석</div>
                    <div className="attendance-date">
                      <span className="attendance-date-label">날짜</span>
                      <input
                        type="date"
                        className="attendance-date-input"
                        value={toYmd(selectedDate)}
                        onChange={async (e) => {
                          const [yy, mm, dd] = e.target.value
                            .split("-")
                            .map(Number);
                          const d = new Date(yy, mm - 1, dd);
                          setSelectedDate(d);
                          const club = getClubByName(page.clubName);
                          if (!club) return;
                          await loadAttendance(club.id, e.target.value);
                        }}
                      />
                    </div>
                    {(() => {
                      const total = approvedStudents.length;
                      const present = approvedStudents.filter(
                        (s) => attendanceByStudentId[s.student_id] === true
                      ).length;
                      return (
                        <div className="attendance-count">
                          {present}/{total}
                        </div>
                      );
                    })()}
                  </div>

                  {attendanceLoading && (
                    <div className="cal-loading">불러오는 중...</div>
                  )}

                  {!attendanceLoading && (
                    <div className="attendance-list">
                      {attendanceLoaded && approvedStudents.length === 0 ? (
                        <div className="activity-empty">
                          승인된 학생이 없습니다.
                        </div>
                      ) : (
                        approvedStudents.map((s) => (
                          <div key={s.student_id} className="attendance-row">
                            <div className="attendance-student">
                              <div className="attendance-homeroom">
                                {formatHomeroom(s.student_id)}
                              </div>
                              <div className="attendance-name">
                                {formatStudentDisplayName(s.student_name, s.student_id)}
                              </div>
                            </div>

                            {currentUser.role === "teacher" ? (
                              <div className="attendance-actions">
                                <button
                                  type="button"
                                  className={
                                    attendanceByStudentId[s.student_id] === true
                                      ? "att-btn present active"
                                      : "att-btn present"
                                  }
                                  onClick={async () => {
                                    const club = getClubByName(page.clubName);
                                    if (!club) return;
                                    await setAttendance(
                                      club.id,
                                      toYmd(selectedDate),
                                      s.student_id,
                                      true
                                    );
                                  }}
                                >
                                  V
                                </button>
                                <button
                                  type="button"
                                  className={
                                    attendanceByStudentId[s.student_id] === false
                                      ? "att-btn absent active"
                                      : "att-btn absent"
                                  }
                                  onClick={async () => {
                                    const club = getClubByName(page.clubName);
                                    if (!club) return;
                                    await setAttendance(
                                      club.id,
                                      toYmd(selectedDate),
                                      s.student_id,
                                      false
                                    );
                                  }}
                                >
                                  X
                                </button>
                              </div>
                            ) : (
                              <div className="attendance-status">
                                {attendanceByStudentId[s.student_id] === true &&
                                  "출석"}
                                {attendanceByStudentId[s.student_id] === false &&
                                  "결석"}
                                {attendanceByStudentId[s.student_id] == null &&
                                  "미체크"}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {clubTab === "records" && isSportStackingClub(page.clubName) && (
                <div className="club-page-body">
                  <div className="records-head">
                    <div className="records-title">기록 등록</div>
                    <div className="records-types">
                      {["3-6-3", "싸이클"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={
                            stackingType === t
                              ? "records-type active"
                              : "records-type"
                          }
                          onClick={async () => {
                            setStackingType(t);
                            const club = getClubByName(page.clubName);
                            if (!club) return;
                            await loadStackingRecords(club.id, t);
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentUser.role === "student" ? (
                    <div className="records-form">
                      <label className="records-label">
                        내 기록(초)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.001"
                          min="0.001"
                          className="records-input"
                          placeholder="예: 12.345"
                          value={stackingTime}
                          onChange={(e) => setStackingTime(e.target.value)}
                        />
                      </label>
                      <label className="records-label">
                        사진 첨부(선택)
                        <input
                          type="file"
                          accept="image/*"
                          className="records-file"
                          onChange={(e) =>
                            setStackingPhoto(e.target.files?.[0] || null)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="records-save"
                        disabled={stackingSaving}
                        onClick={handleSaveStackingRecord}
                      >
                        {stackingSaving ? "저장 중..." : "등록"}
                      </button>
                      <div className="records-hint">
                        초 단위로 소수점 3자리까지 입력할 수 있어요.
                      </div>
                    </div>
                  ) : (
                    <div className="records-hint">
                      교사는 학생이 등록한 기록을 확인할 수 있습니다.
                    </div>
                  )}

                  <div className="records-list">
                    <div className="records-list-title">
                      {stackingType} 기록 (빠른 순)
                    </div>
                    {stackingRecords.length === 0 ? (
                      <div className="activity-empty">등록된 기록이 없습니다.</div>
                    ) : (
                      <div className="records-table">
                        {stackingRecords.map((r, i) => {
                          const rank = i + 1;
                          const medalRow =
                            rank === 1
                              ? "records-row--gold"
                              : rank === 2
                                ? "records-row--silver"
                                : rank === 3
                                  ? "records-row--bronze"
                                  : "";
                          return (
                            <div
                              key={r.id}
                              className={`records-row ${medalRow}`.trim()}
                            >
                              <div className="records-rank-wrap">
                                {rank <= 3 ? (
                                  <span
                                    className={`records-medal records-medal--${rank}`}
                                    aria-label={`${rank}등`}
                                  >
                                    {rank}등
                                  </span>
                                ) : (
                                  <span className="records-rank-num">{rank}</span>
                                )}
                              </div>
                              <div className="records-mid">
                                <div className="records-time">
                                  {formatTimeMs(r.time_ms)}초
                                </div>
                                <div className="records-who">
                                  {formatHomeroom(r.student_id)}{" "}
                                  {formatStudentDisplayName(r.student_name, r.student_id)}
                                  {r.photo_url ? (
                                    <a
                                      className="records-photo-thumb-link"
                                      href={r.photo_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="사진 크게 보기"
                                    >
                                      <img
                                        className="records-photo-thumb"
                                        src={r.photo_url}
                                        alt={`${formatStudentDisplayName(
                                          r.student_name,
                                          r.student_id
                                        )} 기록 사진`}
                                        loading="lazy"
                                      />
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                              {r.photo_url ? (
                                <a
                                  className="records-photo"
                                  href={r.photo_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  사진
                                </a>
                              ) : (
                                <span className="records-photo muted">없음</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {currentUser.role === "teacher" && page.type === "clubManage" && (
            <div className="applications-panel full">
              {loadingClubData && <p>클럽 정보를 불러오는 중입니다...</p>}

              {!loadingClubData && (
                <>
                  <div className="applications-title">
                    {page.clubName} 신청 학생 목록
                  </div>
                  {applications.length === 0 ? (
                    <p className="applications-empty">
                      아직 신청한 학생이 없습니다.
                    </p>
                  ) : (
                    <table className="applications-table">
                      <thead>
                        <tr>
                          <th>학번</th>
                          <th>이름</th>
                          <th>신청 시간</th>
                          <th>상태</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {applications.map((app) => (
                          <tr key={app.id}>
                            <td data-label="학번">{app[appCols.student_id]}</td>
                            <td data-label="이름">
                              {formatStudentDisplayName(
                                app[appCols.student_name],
                                app[appCols.student_id]
                              )}
                            </td>
                            <td data-label="신청 시간">
                              {formatDateTimeCompact(app.created_at)}
                            </td>
                            <td data-label="상태">{app[appCols.status] || "pending"}</td>
                            <td data-label="처리">
                              {((app[appCols.status] || "pending") === "pending") && (
                                <div className="decision-buttons">
                                  <button
                                    type="button"
                                    className="approve-btn"
                                    onClick={() => handleApprove(app.id)}
                                  >
                                    승인
                                  </button>
                                  <button
                                    type="button"
                                    className="reject-btn"
                                    onClick={() => handleReject(app.id)}
                                  >
                                    거절
                                  </button>
                                </div>
                              )}

                              {(app[appCols.status] || "pending") === "approved" && (
                                <span className="approved-label">승인됨</span>
                              )}

                              {(app[appCols.status] || "pending") === "rejected" && (
                                <span className="rejected-label">거절됨</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </main>
        {showVLeagueRulePopup &&
          page.type === "clubMain" &&
          isVLeagueClub(page.clubName) && (
            <div
              className="vleague-rule-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="새샘 V리그 규칙"
            >
              <div className="vleague-rule-modal">
                <div className="vleague-rule-title">새샘 V리그 규칙</div>
                <div className="vleague-rule-body">
                  {vLeagueRuleLoading
                    ? "규칙을 불러오는 중..."
                    : vLeagueRuleText || "등록된 규칙이 없습니다."}
                </div>
                <div className="vleague-rule-actions">
                  <button
                    type="button"
                    className="vleague-ghost"
                    onClick={() => setShowVLeagueRulePopup(false)}
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>
    );
  }

  // 로그인/회원가입 첫 화면
  return (
    <div className="app-root">
      <header className="app-header first-screen">
        <div className="logo-badge">
          <div className="school-logo-frame">
            <img
              className="school-logo-icon"
              src="/saesam-school-logo.png"
              alt="전안새샘초등학교 로고"
            />
          </div>
          <div className="badge-text">
            <span className="badge-subtitle">2026학년도</span>
            <span className="badge-title">새샘 스포츠클럽</span>
          </div>
        </div>
      </header>

      <main className="app-main first-screen-main">
        <div className="auth-card">
          <div className="auth-tabs">
            <button
              className={authTab === "login" ? "auth-tab active" : "auth-tab"}
              onClick={() => {
                resetErrors();
                setAuthTab("login");
              }}
            >
              로그인
            </button>
            <button
              className={authTab === "signup" ? "auth-tab active" : "auth-tab"}
              onClick={() => {
                resetErrors();
                setAuthTab("signup");
              }}
            >
              회원가입
            </button>
          </div>

          {errorMsg && <div className="error-msg">{errorMsg}</div>}

          {authTab === "login" ? (
            <div>
              <div className="role-tabs">
                <button
                  className={
                    loginRole === "student" ? "role-tab active" : "role-tab"
                  }
                  onClick={() => {
                    resetErrors();
                    setLoginRole("student");
                  }}
                >
                  학생
                </button>
                <button
                  className={
                    loginRole === "teacher" ? "role-tab active" : "role-tab"
                  }
                  onClick={() => {
                    resetErrors();
                    setLoginRole("teacher");
                  }}
                >
                  교사
                </button>
              </div>

              {loginRole === "student" ? (
                <form className="form" onSubmit={handleStudentLogin}>
                  <label className="form-label">
                    학번 (6자리)
                    <input
                      type="text"
                      maxLength={6}
                      inputMode="numeric"
                      value={studentLoginId}
                      onChange={(e) =>
                        setStudentLoginId(e.target.value.replace(/\D/g, ""))
                      }
                      className="form-input"
                      placeholder="예) 6학년 1반 3번 -> 060103"
                    />
                  </label>
                  <label className="form-label">
                    비밀번호
                    <div className="form-input-with-toggle">
                      <input
                        type={showStudentLoginPw ? "text" : "password"}
                        value={studentLoginPw}
                        onChange={(e) => setStudentLoginPw(e.target.value)}
                        className="form-input"
                      />
                      <button
                        type="button"
                        className="form-toggle-btn"
                        onClick={() => setShowStudentLoginPw((prev) => !prev)}
                        aria-label={showStudentLoginPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                        title={showStudentLoginPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                      >
                        {showStudentLoginPw ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5c-5.5 0-9.7 4.3-10.9 6 .9 1.4 3.4 4.6 7.1 5.7l-1.9 1.9 1.4 1.4 13-13-1.4-1.4-2.1 2.1c-1.6-.8-3.4-1.2-5.2-1.2zm0 2c1.2 0 2.3.2 3.3.7l-1.7 1.7a4 4 0 0 0-4.9 4.9l-1 1c-2.2-.9-3.9-2.6-4.9-4 1.3-1.7 4.7-4.3 9.2-4.3zm9.8 2.6-2.3 2.3a10.9 10.9 0 0 1-3.2 2.9 9.2 9.2 0 0 1-4.3 1.2l1.7-1.7a4 4 0 0 0 4.5-4.5l1.8-1.8c.6.5 1.2 1 1.8 1.6z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5c-5.5 0-9.7 4.3-10.9 6 1.2 1.8 5.4 7 10.9 7s9.7-5.2 10.9-7C21.7 9.3 17.5 5 12 5zm0 11c-3.5 0-6.4-3.1-7.8-5 1.4-1.9 4.3-5 7.8-5s6.4 3.1 7.8 5c-1.4 1.9-4.3 5-7.8 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>
                  <button type="submit" className="primary-btn">
                    학생 로그인
                  </button>
                </form>
              ) : (
                <form className="form" onSubmit={handleTeacherLoginByCode}>
                  <label className="form-label">
                    교사 이름
                    <input
                      type="text"
                      value={teacherLoginName}
                      onChange={(e) => setTeacherLoginName(e.target.value)}
                      className="form-input"
                    />
                  </label>
                  <label className="form-label">
                    가입 코드
                    <div className="form-input-with-toggle">
                      <input
                        type={showTeacherCodeLogin ? "text" : "password"}
                        value={teacherCodeLogin}
                        onChange={(e) => setTeacherCodeLogin(e.target.value)}
                        className="form-input"
                      />
                      <button
                        type="button"
                        className="form-toggle-btn"
                        onClick={() => setShowTeacherCodeLogin((prev) => !prev)}
                        aria-label={showTeacherCodeLogin ? "가입 코드 숨기기" : "가입 코드 보기"}
                        title={showTeacherCodeLogin ? "가입 코드 숨기기" : "가입 코드 보기"}
                      >
                        {showTeacherCodeLogin ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5c-5.5 0-9.7 4.3-10.9 6 .9 1.4 3.4 4.6 7.1 5.7l-1.9 1.9 1.4 1.4 13-13-1.4-1.4-2.1 2.1c-1.6-.8-3.4-1.2-5.2-1.2zm0 2c1.2 0 2.3.2 3.3.7l-1.7 1.7a4 4 0 0 0-4.9 4.9l-1 1c-2.2-.9-3.9-2.6-4.9-4 1.3-1.7 4.7-4.3 9.2-4.3zm9.8 2.6-2.3 2.3a10.9 10.9 0 0 1-3.2 2.9 9.2 9.2 0 0 1-4.3 1.2l1.7-1.7a4 4 0 0 0 4.5-4.5l1.8-1.8c.6.5 1.2 1 1.8 1.6z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5c-5.5 0-9.7 4.3-10.9 6 1.2 1.8 5.4 7 10.9 7s9.7-5.2 10.9-7C21.7 9.3 17.5 5 12 5zm0 11c-3.5 0-6.4-3.1-7.8-5 1.4-1.9 4.3-5 7.8-5s6.4 3.1 7.8 5c-1.4 1.9-4.3 5-7.8 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>
                  <button type="submit" className="primary-btn">
                    교사 로그인
                  </button>
                  <p className="hint-text">
                    교사는 회원가입 없이 가입 코드를 입력하면 바로 로그인할 수 있습니다.
                  </p>
                </form>
              )}
            </div>
          ) : (
            <div>
              <form className="form" onSubmit={handleStudentSignup}>
                <label className="form-label">
                  학번 (6자리)
                  <input
                    type="text"
                    maxLength={6}
                    inputMode="numeric"
                    value={studentSignupId}
                    onChange={(e) =>
                      setStudentSignupId(e.target.value.replace(/\D/g, ""))
                    }
                    className="form-input"
                    placeholder="예) 6학년 1반 3번 -> 060103"
                  />
                </label>
                <label className="form-label">
                  이름
                  <input
                    type="text"
                    value={studentSignupName}
                    onChange={(e) => setStudentSignupName(e.target.value)}
                    className="form-input"
                  />
                </label>
                <label className="form-label">
                  비밀번호
                  <input
                    type="password"
                    value={studentSignupPw}
                    onChange={(e) => setStudentSignupPw(e.target.value)}
                    className="form-input"
                  />
                </label>
                <button type="submit" className="primary-btn">
                  학생 회원가입
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
      <footer className="auth-version-footer" aria-label="앱 배포 버전">
        {APP_RELEASE_VERSION} ver
      </footer>
    </div>
  );
}

export default App;
