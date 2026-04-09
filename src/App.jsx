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

/** 경기일 당일 13:00부터는 응원 글을 화면에서 숨긴다. */
function getVLeagueCheerHideAtForMatchDate(matchDateYmd) {
  const ymd = String(matchDateYmd || "").slice(0, 10);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!parts) return null;
  const y = Number(parts[1]);
  const mo = Number(parts[2]);
  const d = Number(parts[3]);
  return new Date(y, mo - 1, d, 13, 0, 0, 0);
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
 * - 현재 시각은 당일 13:00 이전이어야 한다. (13:00부터 자동 숨김)
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
  const [vLeagueSyncingCalendar, setVLeagueSyncingCalendar] = useState(false);
  const [vLeagueDeletingMatchesAll, setVLeagueDeletingMatchesAll] = useState(false);
  const [vLeagueValidating, setVLeagueValidating] = useState(false);
  const [vLeagueResultDrafts, setVLeagueResultDrafts] = useState({});
  const [vLeagueResultSavingId, setVLeagueResultSavingId] = useState(null);
  const [vLeagueMatchPostponingId, setVLeagueMatchPostponingId] = useState(null);
  const [vLeagueUndoingMatchId, setVLeagueUndoingMatchId] = useState(null);
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
  const [vLeagueCheerBoardIndex, setVLeagueCheerBoardIndex] = useState(0);
  const [vLeagueCheerEventWinners, setVLeagueCheerEventWinners] = useState([]);
  const [cheerStripNoTransition, setCheerStripNoTransition] = useState(false);
  /** 전광판 슬라이드 높이(px) — 첫 슬롯 DOM 측정으로 rotator/transform과 일치 */
  const [cheerSlidePx, setCheerSlidePx] = useState(64);
  const cheerFirstSlideRef = useRef(null);
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
  const [vLeagueReferees, setVLeagueReferees] = useState([]);
  const [vLeagueRefereeAssignments, setVLeagueRefereeAssignments] = useState([]);
  const [vLeagueRefereeLoading, setVLeagueRefereeLoading] = useState(false);
  const [vLeagueRefereeStudentIdDraft, setVLeagueRefereeStudentIdDraft] = useState("");
  const [vLeagueRefereeSaving, setVLeagueRefereeSaving] = useState(false);
  const [vLeagueRuleText, setVLeagueRuleText] = useState("");
  const [vLeagueRuleDraft, setVLeagueRuleDraft] = useState("");
  const [vLeagueRuleLoading, setVLeagueRuleLoading] = useState(false);
  const [vLeagueRuleSaving, setVLeagueRuleSaving] = useState(false);
  const [showVLeagueRulePopup, setShowVLeagueRulePopup] = useState(false);
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

  const [teacherCodeLogin, setTeacherCodeLogin] = useState("");
  const [teacherLoginName, setTeacherLoginName] = useState("");

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

  const formatVLeagueMatchToken = (matchId) =>
    matchId ? ` ⟦vm:${matchId}⟧` : "";

  const formatVLeagueEventContent = (m, clubIdForNameMap) => {
    const homeName = vleagueClassNameById[m.home_class_id] || "학급";
    const awayName = vleagueClassNameById[m.away_class_id] || "학급";
    const leagueLabel = m.league === "malgeun" ? "맑은샘" : "고운샘";
    return `[${leagueLabel}] R${m.round_no} · ${homeName} vs ${awayName}${formatVLeagueMatchToken(
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

  const loadEventsForMonth = async (clubId, monthDate) => {
    setEventLoading(true);
    const start = monthStart(monthDate);
    const end = monthEnd(monthDate);
    const startYmd = toYmd(start);
    const endYmd = toYmd(end);

    const { data, error } = await supabase
      .from("club_events")
      .select("id, event_date, content")
      .eq("club_id", clubId)
      .gte("event_date", startYmd)
      .lte("event_date", endYmd)
      .order("event_date", { ascending: true });

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
    const club = getClubByName(clubName);
    if (!club) return;
    await loadEventsForMonth(club.id, monthDate);
  };

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

        const { error: upErr } = await supabase.storage
          .from("stacking-records")
          .upload(filePath, stackingPhoto, { upsert: false });

        if (upErr) {
          setMainMsg(`사진 업로드 실패: ${upErr.message}`);
          return;
        }

        const { data } = supabase.storage
          .from("stacking-records")
          .getPublicUrl(filePath);
        photoUrl = data?.publicUrl || null;
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
  const loadVLeagueClasses = useCallback(async (clubId) => {
    setVLeagueLoading(true);
    setVLeagueClassesError(null);
    const { data, error } = await supabase
      .from("vleague_classes")
      .select("*")
      .eq("club_id", clubId)
      .order("sort_order", { ascending: true });
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

  const loadVLeagueStandings = async (clubId) => {
    setVLeagueLoading(true);
    const { data, error } = await supabase
      .from("vleague_standings")
      .select("id, rank_order, team_name, wins, losses, points")
      .eq("club_id", clubId)
      .order("rank_order", { ascending: true });
    setVLeagueLoading(false);
    if (error) {
      setMainMsg(`순위표 로딩 실패: ${error.message}`);
      setVLeagueStandings([]);
      return;
    }
    setVLeagueStandings(data || []);
  };

  const loadVLeagueMatches = useCallback(async (clubId) => {
    setVLeagueMatchesLoading(true);
    setVLeagueMatchesError(null);
    let query = supabase
      .from("vleague_matches")
      .select("*")
      .eq("club_id", clubId)
      .order("league", { ascending: true })
      .order("round_no", { ascending: true })
      .order("match_no", { ascending: true });
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
    setVLeagueMatches(data || []);
  }, [isVLeagueAdmin, vLeagueAdminNameNorm]);

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

  const myStudentClassName = useMemo(
    () => formatClassNameFromStudentId(currentUser?.id),
    [currentUser?.id]
  );

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
    const club = getClubByName(page.clubName);
    if (!club) return;
    loadVLeagueClasses(club.id);
  }, [page.type, page.clubName, clubTab, clubs, loadVLeagueClasses]);

  /** 대진표 탭: 기존 대진표 로드 */
  useEffect(() => {
    if (page.type !== "clubMain" || clubTab !== "vMatches") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    loadVLeagueClasses(club.id);
    loadVLeagueMatches(club.id);
  }, [
    page.type,
    page.clubName,
    clubTab,
    clubs,
    loadVLeagueClasses,
    loadVLeagueMatches,
  ]);

  useEffect(() => {
    if (page.type !== "clubMain") return;
    if (!isVLeagueClub(page.clubName)) return;
    const club = getClubByName(page.clubName);
    if (!club) return;
    loadVLeagueClasses(club.id);
    loadVLeagueMatches(club.id);
  }, [page.type, page.clubName, clubs, loadVLeagueClasses, loadVLeagueMatches]);

  const vleagueClassNameById = useMemo(() => {
    const map = {};
    for (const row of vLeagueClasses || []) {
      map[row.id] = row.class_name;
    }
    return map;
  }, [vLeagueClasses]);

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

  const getRefereeRoleLabel = (role) => {
    if (role === "chief") return "주심";
    if (role === "assistant1") return "부심1";
    if (role === "assistant2") return "부심2";
    return "심판";
  };

  const getRefereeSummaryByMatchId = useCallback(
    (matchId) => {
      if (!matchId) return "";
      const rows = vLeagueRefereeAssignmentsByMatch.get(matchId) || [];
      if (rows.length === 0) return "";
      const chief = rows.find((r) => r.assignment_role === "chief")?.student_name || "-";
      const as1 = rows.find((r) => r.assignment_role === "assistant1")?.student_name || "-";
      const as2 = rows.find((r) => r.assignment_role === "assistant2")?.student_name || "-";
      return `주심 ${chief} · 부심 ${as1}, ${as2}`;
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
        const displayName = nickname
          ? `${nickname}(${cls.class_name})`
          : cls.class_name;
        teamMap.set(cls.id, {
          class_id: cls.id,
          team_name: displayName,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
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
      return [...teamMap.values()]
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (a.losses !== b.losses) return a.losses - b.losses;
          return String(a.team_name).localeCompare(String(b.team_name), "ko");
        })
        .map((row, idx) => ({ ...row, rank_order: idx + 1 }));
    },
    [vLeagueClasses, vLeagueMatches]
  );

  const vLeagueComputedStandings = useMemo(() => {
    const classes =
      vLeagueGradeTab === "malgeun"
        ? getComputedStandingsByLeague("malgeun")
        : getComputedStandingsByLeague("goun");
    return classes;
  }, [getComputedStandingsByLeague, vLeagueGradeTab]);

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
    const id = window.setInterval(
      () => setCheerEligibilityTick((t) => t + 1),
      30000
    );
    return () => window.clearInterval(id);
  }, []);

  const loadVLeagueCheers = useCallback(async (clubId, classId = null) => {
    if (!clubId) {
      setVLeagueCheers([]);
      return;
    }
    setVLeagueCheerLoading(true);
    let query = supabase
      .from("vleague_cheers")
      .select("id, message, student_name, created_at, class_id")
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
    const { data: matchRows } = await supabase
      .from("vleague_matches")
      .select("id, home_class_id, away_class_id, match_date, league")
      .in("club_id", clubIds)
      .order("match_date", { ascending: true })
      .limit(400);
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
    const { data: matches, error } = await supabase
      .from("vleague_matches")
      .select("id, home_class_id, away_class_id, match_date, league")
      .in("club_id", clubIds)
      .gte("match_date", ymdYesterday)
      .lte("match_date", ymdTomorrow)
      .order("match_date", { ascending: true })
      .order("match_no", { ascending: true })
      .limit(300);
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
    if (sourceMatches.length === 0) {
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
      const home = shortClassLabel(classMap.get(m.home_class_id) || "학급");
      const away = shortClassLabel(classMap.get(m.away_class_id) || "학급");
      return `[${leagueLabel}] ${home} VS ${away}`;
    };
    setVLeagueTodayMatches({
      malgeun: toMatchText(firstMalgeun, "맑은샘"),
      goun: toMatchText(firstGoun, "고운샘"),
    });
    setVLeagueTodayMatchIds({
      malgeun: firstMalgeun?.id || null,
      goun: firstGoun?.id || null,
    });
  }, [clubs, vLeagueClasses, vLeagueMatches]);

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
    if (!clubId) {
      setVLeagueRuleText("");
      setVLeagueRuleDraft("");
      return;
    }
    setVLeagueRuleLoading(true);
    const { data, error } = await supabase
      .from("vleague_rule_settings")
      .select("rule_text")
      .eq("club_id", clubId)
      .maybeSingle();
    setVLeagueRuleLoading(false);
    if (error) {
      setMainMsg(`V리그 규칙 로딩 실패: ${error.message}`);
      setVLeagueRuleText("");
      setVLeagueRuleDraft("");
      return;
    }
    const txt = String(data?.rule_text || "").trim();
    setVLeagueRuleText(txt);
    setVLeagueRuleDraft(txt);
  }, []);

  useEffect(() => {
    loadVLeagueCheerBoard();
  }, [loadVLeagueCheerBoard]);

  useEffect(() => {
    loadVLeagueCheerEventWinners();
  }, [loadVLeagueCheerEventWinners]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadVLeagueCheerEventWinners();
    }, 60000);
    return () => window.clearInterval(id);
  }, [loadVLeagueCheerEventWinners]);

  useEffect(() => {
    loadVLeagueTodayMatchText();
  }, [loadVLeagueTodayMatchText]);

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
    if (clubTab === "vReferee" || clubTab === "vRules") {
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
      setMainMsg(`응원 글 저장 실패: ${error.message}`);
      return;
    }
    setVLeagueCheerDraft("");
    await loadVLeagueCheers(club.id, vLeagueCheerWriterClassRow.id);
    await loadVLeagueCheerBoard();
    setMainMsg("우리 반 응원 글을 등록했습니다.");
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
      const { error } = await supabase.from("vleague_rule_settings").upsert(
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
      `${vLeagueGradeTab === "malgeun" ? "맑은샘" : "고운샘"} 리그 ${targetMatches.length}경기에 심판 3명(주심1/부심2)을 일괄 랜덤 배정할까요?\n\n- 기존 배정(해당 리그 경기에 걸린 배정)은 덮어씁니다.\n- 같은 날짜 중복 배정은 허용되지 않습니다.`
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

      const roleOrder = ["chief", "assistant1", "assistant2"];
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
          if (!registeredStudentIdSet.has(sid)) return false;
          const className = formatClassNameFromStudentId(sid);
          if (!className) return false;
          const classNorm = normalizeClubName(className);
          if (classNorm === homeClass || classNorm === awayClass) return false;
          if (ymd && used.has(sid)) return false;
          return true;
        });
        if (eligible.length < 3) {
          setMainMsg(
            `${ymd || "날짜미정"} 경기 배정 실패: 조건을 만족하는 심판 후보가 3명보다 적습니다.`
          );
          return;
        }
        const picked = shuffle(eligible).slice(0, 3);
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
      const { error: upErr } = await supabase
        .from("vleague_matches")
        .update({ match_date: nextDate })
        .eq("id", matchRow.id)
        .eq("club_id", club.id);
      if (upErr) {
        setMainMsg(`대진표 날짜 변경 실패: ${upErr.message}`);
        return;
      }

      // 2) 기존 일정(있으면) 삭제 후 새 날짜로 등록
      const token = formatVLeagueMatchToken(matchRow.id).trim();
      if (token) {
        await supabase
          .from("club_events")
          .delete()
          .eq("club_id", club.id)
          .ilike("content", `%${token}%`);
        await supabase.from("club_events").insert([
          {
            club_id: club.id,
            event_date: nextDate,
            content: formatVLeagueEventContent({ ...matchRow, match_date: nextDate }),
            created_by: currentUser?.name || null,
          },
        ]);
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
      await loadVLeagueMatches(club.id);
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
      const { error: upErr } = await supabase
        .from("vleague_matches")
        .update({ match_date: undo.fromDate })
        .eq("id", matchRow.id)
        .eq("club_id", club.id);
      if (upErr) {
        setMainMsg(`경기 되돌리기 실패: ${upErr.message}`);
        return;
      }

      const token = formatVLeagueMatchToken(matchRow.id).trim();
      if (token) {
        await supabase
          .from("club_events")
          .delete()
          .eq("club_id", club.id)
          .ilike("content", `%${token}%`);
        await supabase.from("club_events").insert([
          {
            club_id: club.id,
            event_date: undo.fromDate,
            content: formatVLeagueEventContent({ ...matchRow, match_date: undo.fromDate }),
            created_by: currentUser?.name || null,
          },
        ]);
      }

      setVLeaguePostponeUndoByMatchId((prev) => {
        const next = { ...prev };
        delete next[matchRow.id];
        return next;
      });
      setMainMsg(`연기한 경기를 ${undo.fromDate}로 되돌렸습니다.`);
      await loadVLeagueMatches(club.id);
      await loadEventsForMonth(club.id, calendarMonth);
    } finally {
      setVLeagueUndoingMatchId(null);
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
    await loadApprovedStudents(club.id);
    if (!isVLeagueClub(clubName)) {
      await loadAttendance(club.id, toYmd(new Date()));
    }
    if (isSportStackingClub(clubName)) {
      loadStackingRecords(club.id, stackingType);
    }
  };

  const goTeacherMain = (clubName) => {
    setApplications([]);
    setMainMsg("");
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
    if (club) {
      loadApprovedStudents(club.id);
      if (!isVLeagueClub(clubName)) {
        loadAttendance(club.id, toYmd(new Date()));
      }
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
        console.error(insertError);
        setErrorMsg(`교사 정보 저장 중 오류: ${insertError.message}`);
        return;
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
              {currentUser.role === "teacher" ? "교사" : "학생"}{" "}
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
                        {name === V_LEAGUE_LABEL && isActive && (
                          <>
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
                                  <span className="sport-vleague-board-head-item-text">
                                    {vLeagueTodayMatches.malgeun || "[맑은샘] 없음"}
                                  </span>
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
                                  <span className="sport-vleague-board-head-item-text">
                                    {vLeagueTodayMatches.goun || "[고운샘] 없음"}
                                  </span>
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
                                const isSelected = toYmd(selectedDate) === ymd;
                                const dow = d.getDay();
                                cells.push(
                                  <button
                                    type="button"
                                    key={ymd}
                                    className={
                                      "cal-cell" +
                                      (hasEvent ? " has-event" : "") +
                                      (isSelected ? " selected" : "") +
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
                          if (items.length === 0) {
                            return (
                              <div className="activity-empty">
                                기록이 없습니다.
                              </div>
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
                                {formatEventContentForDisplay(it.content)}
                                {refSummary ? (
                                  <div className="activity-item-referee">{refSummary}</div>
                                ) : null}
                              </div>
                            );
                          });
                        })()}
                      </div>
                      <div className="activity-hint">
                        달력에서 날짜를 누르면 해당 날짜의 기록이 표시됩니다.
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
                      const source = isVLeagueAdmin && vLeagueMatchesDraft?.flat?.length
                        ? vLeagueMatchesDraft.flat
                        : vLeagueMatches;
                      const list = (source || [])
                        .filter((m) => m.league === vLeagueGradeTab)
                        .filter((m) => {
                          if (vLeagueMatchFilter === "all") return true;
                          return m.status === vLeagueMatchFilter;
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
                                    vLeagueUndoingMatchId === m.id
                                  }
                                  onClick={() => handlePostponeMatchToEnd(m)}
                                >
                                  {vLeagueMatchPostponingId === m.id ? "연기 중..." : "맨 뒤로"}
                                </button>
                                {vLeaguePostponeUndoByMatchId[m.id]?.fromDate &&
                                  String(vLeaguePostponeUndoByMatchId[m.id]?.toDate || "") ===
                                    String(m.match_date || "") && (
                                    <button
                                      type="button"
                                      className="vleague-postpone-undo-btn"
                                      disabled={
                                        vLeagueMatchPostponingId === m.id ||
                                        vLeagueUndoingMatchId === m.id
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
                                  <span className="vleague-nick-readonly">
                                    {row.nickname?.trim()
                                      ? row.nickname
                                      : "—"}
                                  </span>
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
                <div className="club-page-body">
                  <div className="vleague-section-head">
                    <div className="vleague-section-title">순위표</div>
                    <p className="vleague-section-desc">
                      대진표에 입력한 경기 결과를 바탕으로 자동 계산됩니다.
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
                                <th scope="col">순위</th>
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
                                    {row.rank_order <= 3 ? (
                                      <span
                                        className={
                                          "vleague-rank-crown vleague-rank-crown--" +
                                          row.rank_order
                                        }
                                      >
                                        <span className="vleague-rank-crown-icon">
                                          {row.rank_order === 1
                                            ? "🥇"
                                            : row.rank_order === 2
                                              ? "🥈"
                                              : "🥉"}
                                        </span>
                                        <span>{row.rank_order}위</span>
                                      </span>
                                    ) : (
                                      row.rank_order
                                    )}
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
                              <div className="vleague-cheer-msg">{row.message}</div>
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
                              : "전체 경기 랜덤 배정(주심1/부심2)"}
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

              {clubTab === "attendance" && !isVLeagueClub(page.clubName) && (
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
                    <input
                      type="password"
                      value={studentLoginPw}
                      onChange={(e) => setStudentLoginPw(e.target.value)}
                      className="form-input"
                    />
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
                    <input
                      type="password"
                      value={teacherCodeLogin}
                      onChange={(e) => setTeacherCodeLogin(e.target.value)}
                      className="form-input"
                    />
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
