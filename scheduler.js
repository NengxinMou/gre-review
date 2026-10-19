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
  const DEFAULT_TIME_ZONE = "Asia/Shanghai";
  const formatters = new Map();
  const dayCache = new Map();

  function normalizeTimeZone(value) {
    if (typeof value !== "string" || !value || value.length > 100) return null;
    try { return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone; }
    catch (_) { return null; }
  }

  function zonedParts(value, timeZone) {
    if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }));
    return Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  }

  function utcValue(parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  }

  function shiftCalendar(parts, days) {
    const date = new Date(utcValue(parts));
    date.setUTCDate(date.getUTCDate() + days);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() };
  }

  function wallTime(parts, timeZone) {
    const target = utcValue(parts);
    let instant = target;
    // Resolve the offset at the destination date, including DST changes.
    for (let i = 0; i < 5; i++) {
      const adjustment = target - utcValue(zonedParts(instant, timeZone));
      if (!adjustment) return instant;
      instant += adjustment;
    }
    throw new RangeError("Selected local time does not exist in this time zone");
  }

  function dayStart(value, timeZone = DEFAULT_TIME_ZONE) {
    const key = `${timeZone}:${Math.floor(new Date(value).getTime() / 1000)}`;
    if (dayCache.has(key)) return dayCache.get(key);
    const local = zonedParts(value, timeZone);
    const date = local.hour < 4 ? shiftCalendar(local, -1) : local;
    const result = wallTime({ ...date, hour: 4, minute: 0, second: 0 }, timeZone);
    if (dayCache.size >= 4096) dayCache.clear();
    dayCache.set(key, result);
    return result;
  }

  function addDays(value, days, timeZone = DEFAULT_TIME_ZONE) {
    const local = zonedParts(value, timeZone);
    return wallTime(shiftCalendar(local, days), timeZone) + new Date(value).getUTCMilliseconds();
  }

  function dateKey(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = zonedParts(dayStart(value, timeZone), timeZone);
    return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  }

  function emptyRecord() {
    return { attempts: 0, correct: 0, wrong: 0, uncertain: 0, streak: 0, due: null, last: null, lastAdvanceDay: null, lastRecallDay: null, history: [] };
  }

  function canAdvance(record, now, firstInRound = true, timeZone = DEFAULT_TIME_ZONE) {
    const studyDay = dayStart(now, timeZone);
    const previousRecallDay = Number.isFinite(record.last) ? dayStart(record.last, timeZone) : Number.isFinite(record.lastRecallDay) ? dayStart(record.lastRecallDay, timeZone) : null;
    const creditedToday = (record.history || []).some((entry) => entry.masteryCredit === true && dayStart(entry.at, timeZone) === studyDay);
    return firstInRound && previousRecallDay !== studyDay && !creditedToday && record.lastAdvanceDay !== studyDay;
  }

  function outcome(record, grade, now, target = 5, firstInRound = true, timeZone = DEFAULT_TIME_ZONE) {
    const next = { ...emptyRecord(), ...record };
    const studyDay = dayStart(now, timeZone);
    const eligible = canAdvance(record, now, firstInRound, timeZone);
    next.history = [...(record.history || [])];
    next.attempts += 1;
    next.last = now;
    next.lastRecallDay = studyDay;
    if (grade === "correct") {
      next.correct += 1;
      if (eligible) {
        next.streak = Math.min(next.streak + 1, target);
        next.lastAdvanceDay = studyDay;
      }
      next.due = next.streak >= target ? null : addDays(studyDay, INTERVALS[Math.min(Math.max(next.streak - 1, 0), INTERVALS.length - 1)], timeZone);
    } else if (grade === "wrong" || grade === "uncertain") {
      next[grade] += 1;
      next.streak = 0;
      next.due = addDays(studyDay, 1, timeZone);
    } else {
      throw new Error("Unknown grade: " + grade);
    }
    next.history.push({ at: now, grade, masteryCredit: grade === "correct" && eligible });
    return next;
  }

  function answer(state, grade, now, timeZone = DEFAULT_TIME_ZONE) {
    const session = state.session;
    if (!session?.revealed || session.index >= session.ids.length) return false;
    if (!["correct", "wrong", "uncertain"].includes(grade)) return false;
    const id = session.ids[session.index];
    session.undo = session.undo || [];
    // Save only the changed record and queue state, never nested undo stacks.
    session.undo.push({ id, record: state.records[id] ? JSON.parse(JSON.stringify(state.records[id])) : null,
      ids: [...session.ids], index: session.index, retries: { ...(session.retries || {}) }, scores: { ...session.scores } });
    const firstInRound = !session.ids.slice(0, session.index).includes(id);
    state.records[id] = outcome(state.records[id] || emptyRecord(), grade, now, state.target, firstInRound, timeZone);
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

  function dueAt(record, timeZone = DEFAULT_TIME_ZONE) {
    // Reinterpret the existing interval without rewriting records made in another zone.
    if (!Number.isFinite(record?.due) || !Number.isFinite(record.last)) return record?.due;
    const interval = INTERVALS[Math.min(Math.max(record.streak - 1, 0), INTERVALS.length - 1)];
    return addDays(dayStart(record.last, timeZone), interval, timeZone);
  }

  function status(record, now, target = 5, timeZone = DEFAULT_TIME_ZONE) {
    if (!record || !record.attempts) return "new";
    if (record.streak >= target) return "mastered";
    return dueAt(record, timeZone) <= dayStart(now, timeZone) ? "due" : "waiting";
  }

  function pickQueue(words, records, now, count, target, random = Math.random, timeZone = DEFAULT_TIME_ZONE) {
    const due = [];
    const fresh = [];
    for (const word of words) {
      const kind = status(records[word.id], now, target, timeZone);
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

  function dailyWords(words, records, now, target = 5, timeZone = DEFAULT_TIME_ZONE) {
    return words.filter((word) => status(records[word.id], now, target, timeZone) === "due");
  }

  function pickDailyQueue(words, records, now, count, target = 5, random = Math.random, timeZone = DEFAULT_TIME_ZONE) {
    const remaining = dailyWords(words, records, now, target, timeZone);
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

  function upgradeState(state, words, now, timeZone = DEFAULT_TIME_ZONE) {
    const needsDay = state.studyDayRule !== STUDY_DAY_RULE;
    const needsRepair = !state.appliedUpdates?.includes(LIST2_REPAIR);
    if (!needsDay && !needsRepair) return { changed: false, repaired: 0 };
    const repairTimes = new Map();
    if (needsRepair) {
      for (const word of words) {
        const record = state.records[word.id];
        if (word.list !== 2 || record?.streak !== 2) continue;
        const advance = (record.history || []).find((entry) => {
          const date = zonedParts(entry.at, timeZone);
          const originalDay = wallTime({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
          return entry.grade === "correct" && (needsDay ? originalDay : dayStart(entry.at, timeZone)) === record.lastAdvanceDay;
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
          const date = zonedParts(record.due, timeZone);
          record.due = wallTime({ ...date, hour: 4, minute: 0, second: 0 }, timeZone);
        }
        if (Number.isFinite(record.lastAdvanceDay)) {
          // Use the original advancing answer, not a later same-day retry.
          const answer = (record.history || []).find((entry) => {
            const date = zonedParts(entry.at, timeZone);
            const midnight = wallTime({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
            return entry.grade === "correct" && midnight === record.lastAdvanceDay;
          });
          record.lastAdvanceDay = dayStart(answer ? answer.at : record.lastAdvanceDay + 4 * 3600000, timeZone);
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
        record.lastAdvanceDay = dayStart(last, timeZone);
        record.due = addDays(dayStart(last, timeZone), 1, timeZone);
        repaired++;
      }
      state.appliedUpdates = [...(state.appliedUpdates || []), LIST2_REPAIR];
      state.list2Repair = { at: now, count: repaired };
    }
    return { changed: true, repaired };
  }

  return { DAY, STUDY_DAY_RULE, LIST2_REPAIR, REPAIR_CUTOFF, DEFAULT_TIME_ZONE, normalizeTimeZone, dayStart, addDays, dateKey, dueAt, emptyRecord, canAdvance, outcome, answer, undoAnswer, status, pickQueue, dailyWords, pickDailyQueue, scheduleRetries, upgradeState };
});
