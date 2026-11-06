(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GreCustomWords = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const normalize = (text) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  function validate(data) {
    if (data?.format !== "gre-custom-words-v1" || !Array.isArray(data.words) || data.words.length > 5000 || !data.records || typeof data.records !== "object" || Array.isArray(data.records)) throw new Error("不是有效的自建生词备份");
    const ids = new Set(), names = new Set();
    const words = data.words.map((w) => {
      if (!w || !/^custom-[a-zA-Z0-9-]{1,100}$/.test(w.id) || ids.has(w.id) || typeof w.word !== "string" || !w.word.trim() || w.word.length > 160 || typeof w.meaning !== "string" || !w.meaning.trim() || w.meaning.length > 2000 || typeof w.note !== "string" || w.note.length > 3000 || typeof w.archived !== "boolean") throw new Error("生词内容或编号不正确");
      const name = normalize(w.word); if (names.has(name)) throw new Error("备份包含重复单词");
      ids.add(w.id); names.add(name); return { id: w.id, word: w.word.trim(), meaning: w.meaning.trim(), note: w.note, archived: w.archived };
    });
    const records = {};
    for (const [id, r] of Object.entries(data.records)) {
      if (!ids.has(id) || !r || !["attempts", "correct", "wrong", "uncertain", "streak"].every((k) => Number.isSafeInteger(r[k]) && r[k] >= 0) || r.attempts !== r.correct + r.wrong + r.uncertain || !Array.isArray(r.history) || r.history.length > 500 || r.history.some((h) => !h || !Number.isFinite(h.at) || !["correct", "wrong", "uncertain"].includes(h.grade)) || ["last", "due", "lastAdvanceDay", "lastRecallDay"].some((k) => r[k] != null && !Number.isFinite(r[k]))) throw new Error("复习记录校验失败，未替换现有记录");
      records[id] = clone(r);
    }
    const target = [3, 4, 5, 6, 7].includes(data.target) ? data.target : 5;
    return { format: "gre-custom-words-v1", words, records, target, session: null, muted: data.muted !== false };
  }
  function create({ storage, key, scheduler, uuid, onError = () => {} }) {
    let state = { format: "gre-custom-words-v1", words: [], records: {}, target: 5, session: null, muted: true }, blocked = false, lastSaved = null;
    try {
      const raw = storage.getItem(key);
      lastSaved = raw;
      if (raw) {
        const parsed = JSON.parse(raw); state = validate(parsed);
        // Resume only queues whose words and current position are still valid.
        const s = parsed.session, active = new Set(state.words.filter((w) => !w.archived).map((w) => w.id));
        if (s && Array.isArray(s.ids) && s.ids.length <= 20000 && s.ids.every((id) => active.has(id)) && Number.isInteger(s.index) && s.index >= 0 && s.index <= s.ids.length && ["correct", "wrong", "uncertain"].every((g) => Number.isSafeInteger(s.scores?.[g]) && s.scores[g] >= 0)) state.session = { ...s, undo: [] };
      }
    } catch (_) { blocked = true; onError("原始数据读取异常，已暂停写入。请先导出原始备份，再导入有效备份。"); }
    function save() {
      if (blocked) throw new Error("原始记录读取异常，已暂停写入，请先导出备份");
      if (storage.getItem(key) !== lastSaved) throw new Error("另一页面更新了自建生词。请先导出当前页面备份，再刷新；未覆盖另一页面的记录。");
      try { const raw = JSON.stringify(state); storage.setItem(key, raw); lastSaved = raw; }
      catch (_) { onError("无法自动保存，请保留页面并立即导出备份。"); }
    }
    function upsert(input, id) {
      if (blocked) throw new Error("请先导出原始备份并修复数据");
      const word = String(input.word || "").trim().replace(/\s+/g, " "), meaning = String(input.meaning || "").trim(), note = String(input.note || "").trim();
      if (!word || !meaning) throw new Error("请填写单词和中文释义");
      if (word.length > 160 || meaning.length > 2000 || note.length > 3000) throw new Error("输入内容过长");
      if (state.words.some((w) => w.id !== id && normalize(w.word) === normalize(word))) throw new Error("这个词已在自建生词中（含归档），请编辑原条目");
      let existing = state.words.find((w) => w.id === id);
      if (id && !existing) throw new Error("未找到要编辑的单词");
      if (!existing) {
        if (state.words.length >= 5000) throw new Error("生词已达 5000 条，请先导出整理");
        existing = { id: `custom-${uuid()}`, archived: false }; state.words.push(existing);
      }
      Object.assign(existing, { word, meaning, note }); save(); return existing.id;
    }
    return { read: () => clone(state), upsert,
      archive(id, archived) { const w = state.words.find((w) => w.id === id); if (!w) return; w.archived = !!archived; state.session = null; save(); },
      start(count, now, zone, all = false) {
        const active = state.words.filter((w) => !w.archived);
        if (all) for (let i = active.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [active[i], active[j]] = [active[j], active[i]]; }
        const ids = all ? active.slice(0, count).map((w) => w.id) : scheduler.pickQueue(active, state.records, now, count, state.target, Math.random, zone);
        if (!ids.length) return false;
        state.session = { ids, index: 0, revealed: false, startedAt: now, initialCount: ids.length, retries: {}, undo: [], scores: { correct: 0, wrong: 0, uncertain: 0 } }; save(); return true;
      },
      reveal() { if (state.session) { state.session.revealed = true; save(); } },
      answer(grade, now, zone) { const result = scheduler.answer(state, grade, now, zone); if (result) { for (const r of Object.values(state.records)) r.history = r.history.slice(-500); save(); } return result; },
      undo() { const result = scheduler.undoAnswer(state); if (result) save(); return result; },
      end() { state.session = null; save(); },
      mute(value) { state.muted = !!value; save(); },
      target(value) { if (![3, 4, 5, 6, 7].includes(value)) return; state.target = value; save(); },
      import(data) { const next = validate(data); lastSaved = storage.getItem(key); state = next; blocked = false; save(); },
      exportText() { return blocked ? storage.getItem(key) : JSON.stringify({ ...state, session: null, exportedAt: new Date().toISOString() }, null, 2); }
    };
  }
  return { create, validate, normalize };
});
