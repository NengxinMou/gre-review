(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreScheduler = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DAY = 86400000;
  const INTERVALS = [1, 2, 4, 7];
  const STUDY_DAY_RULE = "local-04:00-v1";
  const LIST2_REPAIR = "list2-two-to-one-20261001";
  const REPAIR_CUTOFF = Date.parse("2026-10-01T00:06:32+08:00");

  function dayStart(value) {
    const date = new Date(value);
    if (date.getHours() < 4) date.setDate(date.getDate() - 1);
    date.setHours(4, 0, 0, 0);
    return date.getTime();
  }

  function addDays(value, days) {
    const date = new Date(value);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }

  function emptyRecord() {
    return { attempts: 0, correct: 0, wrong: 0, uncertain: 0, streak: 0, due: null, last: null, lastAdvanceDay: null, lastRecallDay: null, history: [] };
  }

  function canAdvance(record, now, firstInRound = true) {
    const studyDay = dayStart(now);
    const previousRecallDay = Number.isFinite(record.lastRecallDay) ? record.lastRecallDay : Number.isFinite(record.last) ? dayStart(record.last) : null;
    return firstInRound && previousRecallDay !== studyDay && record.lastAdvanceDay !== studyDay;
  }

  function outcome(record, grade, now, target = 5, firstInRound = true) {
    const next = { ...emptyRecord(), ...record };
    const studyDay = dayStart(now);
    const eligible = canAdvance(record, now, firstInRound);
    next.history = [...(record.history || [])];
    next.attempts += 1;
    next.last = now;
    next.lastRecallDay = studyDay;
    if (grade === "correct") {
      next.correct += 1;
      if (eligible) {
        next.streak = Math.min(next.streak + 1, target);
        next.lastAdvanceDay = dayStart(now);
      }
      next.due = next.streak >= target ? null : addDays(dayStart(now), INTERVALS[Math.min(Math.max(next.streak - 1, 0), INTERVALS.length - 1)]);
    } else if (grade === "wrong" || grade === "uncertain") {
      next[grade] += 1;
      next.streak = 0;
      next.due = addDays(dayStart(now), 1);
    } else {
      throw new Error("Unknown grade: " + grade);
    }
    next.history.push({ at: now, grade, masteryCredit: grade === "correct" && eligible });
    return next;
  }

  function answer(state, grade, now) {
    const session = state.session;
    if (!session?.revealed || session.index >= session.ids.length) return false;
    if (!["correct", "wrong", "uncertain"].includes(grade)) return false;
    const id = session.ids[session.index];
    session.undo = session.undo || [];
    // Save only the changed record and queue state, never nested undo stacks.
    session.undo.push({ id, record: state.records[id] ? JSON.parse(JSON.stringify(state.records[id])) : null,
      ids: [...session.ids], index: session.index, retries: { ...(session.retries || {}) }, scores: { ...session.scores } });
    const firstInRound = !session.ids.slice(0, session.index).includes(id);
    state.records[id] = outcome(state.records[id] || emptyRecord(), grade, now, state.target, firstInRound);
    session.scores[grade]++;
    scheduleRetries(session, id, grade);
    session.index++;
    session.revealed = false;
    return true;
  }

  function undoAnswer(state) {
    const session = state.session;
    const previous = session?.undo?.pop();
    if (!previous) return false;
    if (previous.record) state.records[previous.id] = previous.record;
    else delete state.records[previous.id];
    Object.assign(session, { ids: previous.ids, index: previous.index, retries: previous.retries, scores: previous.scores, revealed: true });
    return true;
  }

  function status(record, now, target = 5) {
    if (!record || !record.attempts) return "new";
    if (record.streak >= target) return "mastered";
    return record.due <= dayStart(now) ? "due" : "waiting";
  }

  function pickQueue(words, records, now, count, target, random = Math.random) {
    const due = [];
    const fresh = [];
    for (const word of words) {
      const kind = status(records[word.id], now, target);
      if (kind === "due") due.push(word);
      if (kind === "new") fresh.push(word);
    }
    const shuffle = (list) => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    };
    return [...shuffle(due), ...shuffle(fresh)].slice(0, count).map((word) => word.id);
  }

  function dailyWords(words, records, now, target = 5) {
    return words.filter((word) => status(records[word.id], now, target) === "due");
  }

  function pickDailyQueue(words, records, now, count, target = 5, random = Math.random) {
    const remaining = dailyWords(words, records, now, target);
    const result = [];
    let lastList = null;
    // Randomize across Lists as well as words, without fabricating missing groups.
    while (remaining.length && result.length < count) {
      let candidates = remaining.map((word, index) => ({ word, index })).filter(({ word }) => word.list !== lastList);
      if (!candidates.length) candidates = remaining.map((word, index) => ({ word, index }));
      const { word, index } = candidates[Math.floor(random() * candidates.length)];
      remaining.splice(index, 1);
      result.push(word.id);
      lastList = word.list;
    }
    return result;
  }

  function scheduleRetries(session, id, grade) {
    const desired = grade === "wrong" ? 3 : grade === "uncertain" ? 1 : 0;
    session.retries = session.retries || {};
    // A failed retry replaces the remaining work, rather than hitting a lifetime cap.
    if (desired) session.ids = [...session.ids.slice(0, session.index + 1), ...session.ids.slice(session.index + 1).filter((word) => word !== id)];
    const seen = new Set(session.ids.slice(0, session.index + 1));
    const remaining = session.ids.slice(session.index + 1).filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });
    const gaps = [3, Math.max(6, Math.ceil(remaining.length * 0.6)), Infinity];
    for (let count = 0; count < desired; count++) {
      const anchor = remaining[gaps[count]];
      const position = anchor ? session.ids.indexOf(anchor, session.index + 1) : session.ids.length;
      session.ids.splice(position, 0, id);
    }
    spreadPendingRetries(session);
    session.retries[id] = session.ids.slice(session.index + 1).filter((word) => word === id).length;
  }

  function spreadPendingRetries(session) {
    const prefix = session.ids.slice(0, session.index + 1);
    const seen = new Set();
    const lastSeen = new Map();
    let consecutiveRetries = 0;
    prefix.forEach((id, index) => {
      consecutiveRetries = seen.has(id) ? consecutiveRetries + 1 : 0;
      seen.add(id);
      lastSeen.set(id, index);
    });
    const pending = session.ids.slice(session.index + 1).map((id) => {
      const first = !seen.has(id);
      seen.add(id);
      return { id, first };
    });
    const spaced = [];
    // Never let a cluster of retries hold up the round's first appearances.
    while (pending.length) {
      const position = prefix.length + spaced.length;
      const gap = (item) => position - (lastSeen.get(item.id) ?? -Infinity) - 1;
      const nextFirst = pending.findIndex((item) => item.first);
      let next = 0;
      if (!pending[0].first && nextFirst >= 0 && (consecutiveRetries >= 1 || gap(pending[0]) < 3)) next = nextFirst;
      else if (nextFirst < 0 && gap(pending[0]) < 3) {
        // At the tail, prefer a less-recent word when a full gap is impossible.
        for (let index = 1; index < pending.length; index++) {
          if (gap(pending[index]) > gap(pending[next])) next = index;
          if (gap(pending[next]) >= 3) break;
        }
      }
      const [item] = pending.splice(next, 1);
      spaced.push(item.id);
      lastSeen.set(item.id, position);
      consecutiveRetries = item.first ? 0 : consecutiveRetries + 1;
    }
    session.ids = [...prefix, ...spaced];
  }

  function upgradeState(state, words, now) {
    const needsDay = state.studyDayRule !== STUDY_DAY_RULE;
    const needsRepair = !state.appliedUpdates?.includes(LIST2_REPAIR);
    if (!needsDay && !needsRepair) return { changed: false, repaired: 0 };
    const repairTimes = new Map();
    if (needsRepair) {
      for (const word of words) {
        const record = state.records[word.id];
        if (word.list !== 2 || record?.streak !== 2) continue;
        const advance = (record.history || []).find((entry) => {
          const date = new Date(entry.at);
          const originalDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
          return entry.grade === "correct" && (needsDay ? originalDay : dayStart(entry.at)) === record.lastAdvanceDay;
        });
        const at = advance ? advance.at : record.last;
        if (Number.isFinite(at) && at <= REPAIR_CUTOFF) repairTimes.set(word.id, at);
      }
    }
    if (!state.beforeDayUpdate) {
      state.beforeDayUpdate = JSON.parse(JSON.stringify({ version: 1, target: state.target, selected: state.selected, records: state.records, session: state.session, studyDayRule: state.studyDayRule || null, appliedUpdates: state.appliedUpdates || [] }));
    }
    if (needsDay) {
      for (const record of Object.values(state.records)) {
        if (Number.isFinite(record.due)) {
          const date = new Date(record.due);
          date.setHours(4, 0, 0, 0);
          record.due = date.getTime();
        }
        if (Number.isFinite(record.lastAdvanceDay)) {
          // Use the original advancing answer, not a later same-day retry.
          const answer = (record.history || []).find((entry) => {
            const date = new Date(entry.at);
            const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
            return entry.grade === "correct" && midnight === record.lastAdvanceDay;
          });
          record.lastAdvanceDay = dayStart(answer ? answer.at : record.lastAdvanceDay + 4 * 3600000);
        }
      }
      state.studyDayRule = STUDY_DAY_RULE;
    }
    let repaired = 0;
    if (needsRepair) {
      for (const word of words) {
        const record = state.records[word.id];
        if (word.list !== 2 || record?.streak !== 2) continue;
        const last = repairTimes.get(word.id);
        if (!Number.isFinite(last)) continue;
        record.streak = 1;
        record.lastAdvanceDay = dayStart(last);
        record.due = addDays(dayStart(last), 1);
        repaired++;
      }
      state.appliedUpdates = [...(state.appliedUpdates || []), LIST2_REPAIR];
      state.list2Repair = { at: now, count: repaired };
    }
    return { changed: true, repaired };
  }

  return { DAY, STUDY_DAY_RULE, LIST2_REPAIR, REPAIR_CUTOFF, dayStart, addDays, emptyRecord, canAdvance, outcome, answer, undoAnswer, status, pickQueue, dailyWords, pickDailyQueue, scheduleRetries, upgradeState };
});
