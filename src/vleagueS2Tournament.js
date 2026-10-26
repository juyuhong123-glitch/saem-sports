/** 2학기 그룹 대항전 → 토너먼트 (와일드카드~결승) */

export function getS2TournamentMarker(leagueKey) {
  const label = leagueKey === "goun" ? "고운샘" : "맑은샘";
  return `[토너먼트][2학기][${label}]`;
}

export function isS2TournamentContent(content) {
  return String(content || "").includes("[토너먼트][2학기]");
}

function shortClassLabel(className) {
  const s = String(className || "").trim();
  const m = s.match(/^(\d+)\s*학년\s*(\d+)\s*반$/);
  if (!m) return s;
  return `${Number(m[1])}-${Number(m[2])}`;
}

export function formatS2TournamentTeamLabel(team, rank) {
  if (!team) return rank != null ? `${rank}위 미정` : "미정";
  const nick = String(team.nickname || "").trim();
  const cls = shortClassLabel(team.class_name);
  const name = nick ? `${nick}(${cls})` : cls || "학급";
  return rank != null ? `${rank}위 ${name}` : name;
}

export function isVLeagueS2LeagueMatchesComplete(matches, leagueKey) {
  const list = (matches || []).filter((m) => m.league === leagueKey);
  if (list.length === 0) return false;
  return list.every(
    (m) =>
      m.status === "completed" &&
      m.home_score != null &&
      m.away_score != null
  );
}

/**
 * 그룹 합 승점으로 승리/패배 조 확정 후 시드 구성.
 * 패배조 4팀이면 4위 즉시 탈락, 3팀이면 전원 참가.
 */
export function resolveS2TournamentSeeds(progress) {
  if (!progress?.groupA || !progress?.groupB) {
    return { error: "그룹 진행 정보가 없습니다." };
  }
  const aPts = Number(progress.groupA.totalPoints) || 0;
  const bPts = Number(progress.groupB.totalPoints) || 0;
  if (aPts === bPts) {
    return {
      error:
        "그룹 합 승점이 동점이라 승리/패배 조를 확정할 수 없습니다. 리그전을 확인해 주세요.",
    };
  }
  const winnerGroup = aPts > bPts ? progress.groupA : progress.groupB;
  const loserGroup = aPts > bPts ? progress.groupB : progress.groupA;
  const wTeams = [...(winnerGroup.teams || [])];
  const lTeams = [...(loserGroup.teams || [])];
  if (wTeams.length < 4) {
    return {
      error: `승리 조(${winnerGroup.label})에 4팀이 필요합니다. (현재 ${wTeams.length}팀)`,
    };
  }
  if (lTeams.length < 3) {
    return {
      error: `패배 조(${loserGroup.label})에 최소 3팀이 필요합니다. (현재 ${lTeams.length}팀)`,
    };
  }
  const eliminated = lTeams.length >= 4 ? lTeams[3] : null;
  return {
    winnerGroup,
    loserGroup,
    w1: wTeams[0],
    w2: wTeams[1],
    w3: wTeams[2],
    w4: wTeams[3],
    l1: lTeams[0],
    l2: lTeams[1],
    l3: lTeams[2],
    eliminated,
    labels: {
      w1: formatS2TournamentTeamLabel(wTeams[0], 1),
      w2: formatS2TournamentTeamLabel(wTeams[1], 2),
      w3: formatS2TournamentTeamLabel(wTeams[2], 3),
      w4: formatS2TournamentTeamLabel(wTeams[3], 4),
      l1: formatS2TournamentTeamLabel(lTeams[0], 1),
      l2: formatS2TournamentTeamLabel(lTeams[1], 2),
      l3: formatS2TournamentTeamLabel(lTeams[2], 3),
      eliminated: eliminated
        ? formatS2TournamentTeamLabel(eliminated, 4)
        : null,
    },
  };
}

function findEv(events, needle) {
  return (
    (events || []).find((ev) => String(ev.content || "").includes(needle)) ||
    null
  );
}

/** 신규 약어(WC/준PO/PO) + 이전 한글 표기 모두 탐색 */
function findEvAny(events, needles) {
  for (const n of needles) {
    const hit = findEv(events, n);
    if (hit) return hit;
  }
  return null;
}

function getWinnerLoser(content, getSide, getTeams) {
  const side = getSide(content);
  const teams = getTeams(content);
  if (!side || !teams) return null;
  return {
    winner: side === "home" ? teams.home : teams.away,
    loser: side === "home" ? teams.away : teams.home,
    side,
  };
}

/**
 * 단계적 초안 생성 (1학기 토너먼트와 동일한 '생성' 버튼 UX).
 * playoffPick: 'sp1' | 'sp2' — 플레이오프에서 승리조 1위가 고르는 준플 승자
 */
export function buildS2TournamentDraft({
  leagueKey,
  progress,
  existingEvents,
  startDate,
  nextPlayableYmd,
  addDaysYmd,
  playoffPick,
  getWinnerSide,
  getTeams,
}) {
  const marker = getS2TournamentMarker(leagueKey);
  const seeds = resolveS2TournamentSeeds(progress);
  if (seeds.error) {
    return { rows: [], message: seeds.error, needPlayoffPick: false };
  }

  const list = (existingEvents || [])
    .filter((ev) => String(ev.content || "").includes(marker))
    .sort((a, b) =>
      String(a.event_date || "").localeCompare(String(b.event_date || ""))
    );

  const wcEv = findEvAny(list, ["WC전", "와일드카드전"]);
  const sp1Ev = findEvAny(list, ["준PO 1", "준플레이오프 1"]);
  const sp2Ev = findEvAny(list, ["준PO 2", "준플레이오프 2"]);
  const po1Ev = findEvAny(list, ["PO 1", "플레이오프 1"]);
  const po2Ev = findEvAny(list, ["PO 2", "플레이오프 2"]);
  const final1Ev = findEv(list, "결승 1차전");

  const wcResult = wcEv
    ? getWinnerLoser(wcEv.content, getWinnerSide, getTeams)
    : null;
  const sp1Result = sp1Ev
    ? getWinnerLoser(sp1Ev.content, getWinnerSide, getTeams)
    : null;
  const sp2Result = sp2Ev
    ? getWinnerLoser(sp2Ev.content, getWinnerSide, getTeams)
    : null;
  const po1Result = po1Ev
    ? getWinnerLoser(po1Ev.content, getWinnerSide, getTeams)
    : null;
  const po2Result = po2Ev
    ? getWinnerLoser(po2Ev.content, getWinnerSide, getTeams)
    : null;

  const keepExisting = (...evs) => {
    const rows = [];
    for (const ev of evs) {
      if (!ev) continue;
      rows.push({
        order: rows.length + 1,
        event_date: ev.event_date,
        content: ev.content,
        existingId: ev.id,
      });
    }
    return rows;
  };

  // ── 4단계: 플레이오프 완료 → 결승 3판 2선승 ──
  if (po1Result && po2Result) {
    if (final1Ev) {
      return {
        rows: [],
        message: "결승 일정이 이미 있습니다. 필요하면 기존 일정을 확인하세요.",
        needPlayoffPick: false,
      };
    }
    const rows = keepExisting(wcEv, sp1Ev, sp2Ev, po1Ev, po2Ev);
    const finalMatchup = `${po1Result.winner} vs ${po2Result.winner}`;
    let cur = nextPlayableYmd(startDate, leagueKey);
    if (po2Ev?.event_date) {
      cur = nextPlayableYmd(addDaysYmd(po2Ev.event_date, 1), leagueKey);
    }
    for (let game = 1; game <= 3; game += 1) {
      const suffix = game === 3 ? "(필요 시)" : "";
      rows.push({
        order: rows.length + 1,
        event_date: cur,
        content: `${marker} 결승 ${game}차전(3판 2선승)${suffix}: ${finalMatchup}`,
      });
      cur = nextPlayableYmd(addDaysYmd(cur, 1), leagueKey);
    }
    return {
      rows,
      message:
        "PO 결과를 반영해 결승(3판 2선승) 일정 초안을 만들었습니다.",
      needPlayoffPick: false,
    };
  }

  if (po1Ev || po2Ev) {
    return {
      rows: [],
      message:
        "PO 2경기 결과가 모두 저장되어야 결승 일정을 생성할 수 있습니다.",
      needPlayoffPick: false,
    };
  }

  // ── 3단계: 준PO 완료 → PO (1위가 상대 선택) ──
  if (sp1Result && sp2Result) {
    const optSp1 = sp1Result.winner;
    const optSp2 = sp2Result.winner;
    if (playoffPick !== "sp1" && playoffPick !== "sp2") {
      return {
        rows: [],
        message:
          "준PO가 끝났습니다. 승리 조 1위가 맞붙을 준PO 승자를 선택한 뒤 다시 생성해 주세요.",
        needPlayoffPick: true,
        playoffOptions: [
          { value: "sp1", label: optSp1 },
          { value: "sp2", label: optSp2 },
        ],
        seeds,
      };
    }
    const pickSp1 = playoffPick === "sp1";
    const po1Away = pickSp1 ? optSp1 : optSp2;
    const po2Away = pickSp1 ? optSp2 : optSp1;
    const rows = keepExisting(wcEv, sp1Ev, sp2Ev);
    let cur = nextPlayableYmd(startDate, leagueKey);
    const lastSemiDate = [sp1Ev?.event_date, sp2Ev?.event_date]
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    if (lastSemiDate) {
      cur = nextPlayableYmd(addDaysYmd(lastSemiDate, 1), leagueKey);
    }
    rows.push({
      order: rows.length + 1,
      event_date: cur,
      content: `${marker} PO 1(단판): ${seeds.labels.w1} vs ${po1Away}`,
    });
    cur = nextPlayableYmd(addDaysYmd(cur, 1), leagueKey);
    rows.push({
      order: rows.length + 1,
      event_date: cur,
      content: `${marker} PO 2(단판): ${seeds.labels.w2} vs ${po2Away}`,
    });
    return {
      rows,
      message:
        "PO 2경기 일정 초안을 만들었습니다. 결과 저장 후 다시 생성하면 결승이 채워집니다.",
      needPlayoffPick: false,
    };
  }

  if (sp1Ev || sp2Ev) {
    return {
      rows: [],
      message:
        "준PO 2경기 결과가 모두 저장되어야 PO 일정을 생성할 수 있습니다.",
      needPlayoffPick: false,
    };
  }

  // ── 2단계: WC 완료 → 준PO ──
  if (wcResult) {
    const rows = keepExisting(wcEv);
    let cur = nextPlayableYmd(
      addDaysYmd(wcEv.event_date || startDate, 1),
      leagueKey
    );
    rows.push({
      order: rows.length + 1,
      event_date: cur,
      content: `${marker} 준PO 1(단판): ${seeds.labels.w3} vs ${wcResult.winner}`,
    });
    cur = nextPlayableYmd(addDaysYmd(cur, 1), leagueKey);
    rows.push({
      order: rows.length + 1,
      event_date: cur,
      content: `${marker} 준PO 2(단판): ${seeds.labels.w4} vs ${seeds.labels.l1}`,
    });
    return {
      rows,
      message: "WC 결과를 반영해 준PO 2경기 초안을 만들었습니다.",
      needPlayoffPick: false,
    };
  }

  if (wcEv) {
    return {
      rows: [],
      message:
        "WC 결과가 저장된 뒤 다시 생성하면 준PO 일정이 만들어집니다.",
      needPlayoffPick: false,
    };
  }

  // ── 1단계: WC만 먼저 생성 ──
  let cur = nextPlayableYmd(startDate, leagueKey);
  const rows = [
    {
      order: 1,
      event_date: cur,
      content: `${marker} WC전(단판): ${seeds.labels.l2} vs ${seeds.labels.l3}`,
    },
  ];
  const elimNote = seeds.eliminated
    ? ` 패배 조 4위(${seeds.labels.eliminated})는 즉시 탈락.`
    : " 패배 조가 3팀이라 즉시 탈락 없이 전원 참가.";
  return {
    rows,
    message: `WC 일정 초안을 만들었습니다.${elimNote} 결과 저장 후 다시 생성하면 준PO가 이어집니다.`,
    needPlayoffPick: false,
    seeds,
  };
}

/** 홈/팝업용 도식 브라켓 뷰모델 — 저장된(또는 초안) 일정이 있을 때만 대진 표시 */
export function buildS2BracketViewModel({
  events,
  leagueKey,
  progress,
  getWinnerSide,
  getTeams,
}) {
  const marker = getS2TournamentMarker(leagueKey);
  const list = (events || []).filter((ev) =>
    String(ev.content || "").includes(marker)
  );
  const emptySlot = { home: "-", away: "-" };
  const seeds = resolveS2TournamentSeeds(progress);

  // 생성·저장 전이면 시드로 미리 그리지 않음
  if (list.length === 0) {
    return {
      hasAny: false,
      seeds,
      eliminatedLabel: null,
      winnerGroupLabel: null,
      loserGroupLabel: null,
      wc: emptySlot,
      sp1: emptySlot,
      sp2: emptySlot,
      po1: emptySlot,
      po2: emptySlot,
      final: emptySlot,
      winners: {},
      losers: {},
      wireAdvances: {
        wc: false,
        sp1: false,
        sp2: false,
        choiceTop: false,
        po1: false,
        po2: false,
        mergeStem: false,
      },
      live: {
        wc: false,
        sp1: false,
        sp2: false,
        po1: false,
        po2: false,
        final: false,
      },
    };
  }

  const wcEv = findEvAny(list, ["WC전", "와일드카드전"]);
  const sp1Ev = findEvAny(list, ["준PO 1", "준플레이오프 1"]);
  const sp2Ev = findEvAny(list, ["준PO 2", "준플레이오프 2"]);
  const po1Ev = findEvAny(list, ["PO 1", "플레이오프 1"]);
  const po2Ev = findEvAny(list, ["PO 2", "플레이오프 2"]);
  const finalEv = findEv(list, "결승 1차전") || findEv(list, "결승");

  const sideOf = (ev) => (ev ? getWinnerSide(ev.content) : null);
  const teamsOf = (ev, fallbackHome, fallbackAway) => {
    if (ev) {
      const t = getTeams(ev.content);
      if (t) return t;
    }
    return {
      home: fallbackHome || "-",
      away: fallbackAway || "-",
    };
  };

  const labels = seeds.error ? null : seeds.labels;
  const wc = teamsOf(wcEv, labels?.l2, labels?.l3);
  const wcWin = sideOf(wcEv);
  const wcWinnerLabel =
    wcWin === "home"
      ? wc.home
      : wcWin === "away"
        ? wc.away
        : "WC 승자";

  // 준PO: 승리조 3·4위, 패배조 1위는 리그 종료 시점에 확정
  const sp1 = teamsOf(sp1Ev, labels?.w3, wcWinnerLabel);
  const sp2 = teamsOf(sp2Ev, labels?.w4, labels?.l1);
  const sp1Win = sideOf(sp1Ev);
  const sp2Win = sideOf(sp2Ev);

  // PO: 승리조 1·2위는 확정. 상대는 1위 선택·일정 생성 후 채워짐
  const po1 = teamsOf(po1Ev, labels?.w1, "준PO 승자");
  const po2 = teamsOf(po2Ev, labels?.w2, "준PO 승자");
  const po1Win = sideOf(po1Ev);
  const po2Win = sideOf(po2Ev);
  const po1Winner =
    po1Win === "home"
      ? po1.home
      : po1Win === "away"
        ? po1.away
        : "PO 1 승자";
  const po2Winner =
    po2Win === "home"
      ? po2.home
      : po2Win === "away"
        ? po2.away
        : "PO 2 승자";

  const fin = teamsOf(finalEv, po1Winner, po2Winner);
  const finWin = sideOf(finalEv);

  const wcAdv = Boolean(wcWin);
  const sp1Adv = Boolean(sp1Win);
  const sp2Adv = Boolean(sp2Win);
  const po1Adv = Boolean(po1Win);
  const po2Adv = Boolean(po2Win);

  // 결승 3판2선승: 미결과 차전 중 가장 이른 경기
  const unfinishedFinals = list
    .filter((ev) => {
      const c = String(ev.content || "");
      return /결승\s*\d+\s*차전/.test(c) || (/결승/.test(c) && !/준결승/.test(c));
    })
    .filter((ev) => !sideOf(ev))
    .sort((a, b) => {
      const da = String(a.event_date || "");
      const db = String(b.event_date || "");
      if (da !== db) return da < db ? -1 : 1;
      const ga = Number((String(a.content || "").match(/결승\s*(\d+)\s*차전/) || [])[1] || 99);
      const gb = Number((String(b.content || "").match(/결승\s*(\d+)\s*차전/) || [])[1] || 99);
      return ga - gb;
    });
  const nextFinalEv = unfinishedFinals[0] || null;

  /** 하루 1경기: 미결과 일정 중 날짜·라운드 순으로 딱 1개만 live */
  const pending = [
    { key: "wc", ev: wcEv, win: wcWin, order: 1 },
    { key: "sp1", ev: sp1Ev, win: sp1Win, order: 2 },
    { key: "sp2", ev: sp2Ev, win: sp2Win, order: 3 },
    { key: "po1", ev: po1Ev, win: po1Win, order: 4 },
    { key: "po2", ev: po2Ev, win: po2Win, order: 5 },
    { key: "final", ev: nextFinalEv || finalEv, win: nextFinalEv ? null : finWin, order: 6 },
  ]
    .filter((row) => row.ev && !row.win)
    .sort((a, b) => {
      const da = String(a.ev.event_date || "");
      const db = String(b.ev.event_date || "");
      if (da !== db) return da < db ? -1 : 1;
      return a.order - b.order;
    });
  const liveKey = pending[0]?.key || null;

  return {
    hasAny: true,
    seeds,
    eliminatedLabel: seeds.error ? null : seeds.labels?.eliminated || null,
    winnerGroupLabel: seeds.error ? null : seeds.winnerGroup?.label || null,
    loserGroupLabel: seeds.error ? null : seeds.loserGroup?.label || null,
    wc,
    sp1,
    sp2,
    po1,
    po2,
    final: fin,
    winners: {
      wcHome: wcWin === "home",
      wcAway: wcWin === "away",
      sp1Home: sp1Win === "home",
      sp1Away: sp1Win === "away",
      sp2Home: sp2Win === "home",
      sp2Away: sp2Win === "away",
      po1Home: po1Win === "home",
      po1Away: po1Win === "away",
      po2Home: po2Win === "home",
      po2Away: po2Win === "away",
      f1: finWin === "home",
      f2: finWin === "away",
    },
    losers: {
      wcHome: wcWin === "away",
      wcAway: wcWin === "home",
      sp1Home: sp1Win === "away",
      sp1Away: sp1Win === "home",
      sp2Home: sp2Win === "away",
      sp2Away: sp2Win === "home",
      po1Home: po1Win === "away",
      po1Away: po1Win === "home",
      po2Home: po2Win === "away",
      po2Away: po2Win === "home",
      f1: finWin === "away",
      f2: finWin === "home",
    },
    /** 하위 라운드 결과 → 상위 연결선(황금) 표기 */
    wireAdvances: {
      wc: wcAdv,
      sp1: sp1Adv,
      sp2: sp2Adv,
      choiceTop: sp1Adv && sp2Adv,
      po1: po1Adv,
      po2: po2Adv,
      mergeStem: po1Adv && po2Adv,
    },
    /** 다음 예정 1경기만 보라 테두리 (결과 저장 시까지) */
    live: {
      wc: liveKey === "wc",
      sp1: liveKey === "sp1",
      sp2: liveKey === "sp2",
      po1: liveKey === "po1",
      po2: liveKey === "po2",
      final: liveKey === "final",
    },
  };
}
