(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreQuestionPractice = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const blank = () => ({ version: 1, records: {}, session: null });
  function validSelection(question, selected, complete = false) {
    return Array.isArray(selected) && selected.length === question.groups.length && question.groups.every((group, index) => {
      const ids = selected[index];
      return Array.isArray(ids) && new Set(ids).size === ids.length && ids.length <= group.pick && (!complete || ids.length === group.pick) && ids.every((id) => group.options.some((option) => option.id === id));
    });
  }
  function grade(question, selected) {
    if (!validSelection(question, selected, true)) return null;
    return question.groups.every((group, index) => group.answers.length === selected[index].length && group.answers.every((id) => selected[index].includes(id)));
  }
  function validate(data, bank) {
    if (!data || data.version !== 1 || !data.records || typeof data.records !== "object" || Array.isArray(data.records)) throw new Error("不是有效的错题本备份");
    const byId = new Map(bank.map((q) => [q.id, q]));
    const result = blank();
    for (const [id, record] of Object.entries(data.records)) {
      if (!byId.has(id)) continue;
      if (!record || !["attempts", "correct", "wrong"].every((key) => Number.isSafeInteger(record[key]) && record[key] >= 0) || record.attempts !== record.correct + record.wrong || !Array.isArray(record.history) || record.history.length > 500 || record.history.length > record.attempts || record.attempts < 1) throw new Error("错题本记录不完整，未替换现有记录");
      if (!record.history.length || record.history.some((h) => !h || !Number.isFinite(h.at) || h.at < 0 || typeof h.correct !== "boolean" || grade(byId.get(id), h.selected) !== h.correct)) throw new Error("错题本答题记录校验失败");
      result.records[id] = copy({ attempts: record.attempts, correct: record.correct, wrong: record.wrong, history: record.history });
    }
    const session = data.session;
    if (session && Array.isArray(session.ids) && session.ids.length && session.ids.every((id) => byId.has(id)) && new Set(session.ids).size === session.ids.length && Number.isInteger(session.index) && session.index >= 0 && session.index <= session.ids.length) {
      const question = byId.get(session.ids[session.index]);
      if (!question || validSelection(question, session.selected)) {
        const submitted = !!question && typeof session.result === "boolean" && grade(question, session.selected) === session.result;
        result.session = { ids: [...session.ids], index: session.index, selected: question ? copy(session.selected) : [], result: submitted ? session.result : null };
      }
    }
    return result;
  }
  function create({ bank, storage, key, random = Math.random, now = Date.now, onError = () => {} }) {
    const byId = new Map(bank.map((q) => [q.id, q]));
    let state = blank(), readBlocked = false;
    try {
      const raw = storage.getItem(key);
      if (raw) state = validate(JSON.parse(raw), bank);
    } catch (_) { readBlocked = true; onError("错题本记录暂时无法读取，未改动原始数据。请先导出本机原始备份。"); }
    function save() {
      if (readBlocked) { onError("原始记录读取异常，已暂停写入。请先导出原始备份，或导入有效备份。"); return false; }
      try { storage.setItem(key, JSON.stringify(state)); return true; }
      catch (_) { onError("错题本无法自动保存，请立即导出备份；本次作答暂留在页面中。"); return false; }
    }
    function current() { return byId.get(state.session?.ids[state.session.index]) || null; }
    function start(ids) {
      const queue = [...new Set(ids)].filter((id) => byId.has(id));
      if (!queue.length) return false;
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      state.session = { ids: queue, index: 0, selected: byId.get(queue[0]).groups.map(() => []), result: null };
      save(); return true;
    }
    function select(groupIndex, id) {
      const question = current(), session = state.session;
      const group = question?.groups[groupIndex];
      if (!group || session.result !== null || !group.options.some((o) => o.id === id)) return false;
      const selected = session.selected[groupIndex];
      if (group.pick === 1) session.selected[groupIndex] = [id];
      else if (selected.includes(id)) session.selected[groupIndex] = selected.filter((value) => value !== id);
      else if (selected.length < group.pick) selected.push(id);
      else return false;
      save(); return true;
    }
    function submit() {
      const question = current(), session = state.session;
      if (!question || session.result !== null) return null;
      const result = grade(question, session.selected);
      if (result === null) return null;
      const record = state.records[question.id] ||= { attempts: 0, correct: 0, wrong: 0, history: [] };
      record.attempts++; record[result ? "correct" : "wrong"]++;
      record.history.push({ at: now(), correct: result, selected: copy(session.selected) });
      record.history = record.history.slice(-500);
      session.result = result;
      save(); return result;
    }
    function next() {
      if (!current() || state.session.result === null) return false;
      state.session.index++;
      state.session.result = null;
      state.session.selected = current()?.groups.map(() => []) || [];
      save(); return true;
    }
    return { current, start, select, submit, next,
      read: () => copy(state),
      restore(data) { const imported = validate(data, bank); state = imported; readBlocked = false; save(); },
      exportText() { return readBlocked ? storage.getItem(key) : JSON.stringify({ ...state, exportedAt: new Date(now()).toISOString() }, null, 2); }
    };
  }
  return { create, validate, grade, validSelection };
});
