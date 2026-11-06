(() => {
  "use strict";
  const $ = (id) => document.getElementById(id), S = window.GreScheduler;
  const base = document.querySelector('meta[name="gre-storage-key"]')?.content || "gre-1500-meaning-review-v1";
  const key = `${base}:custom-words-v1`;
  let active = false, editing = null, screen = "home", spoken = "";
  function message(text) { $("custom-status").textContent = text; }
  const model = window.GreCustomWords.create({ storage: { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }, key, scheduler: S, uuid: () => crypto.randomUUID(), onError: message });
  const audio = window.GrePronunciation.create(window, (info) => { $("custom-audio-status").textContent = info.message || (model.read().muted ? "已静音" : "美式词典音频"); });
  function zone() { try { return S.normalizeTimeZone(localStorage.getItem(`${base}:study-time-zone-v1`)) || S.DEFAULT_TIME_ZONE; } catch (_) { return S.DEFAULT_TIME_ZONE; } }
  function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  function run(fn) { try { fn(); } catch (error) { message(error.message); } }
  function button(icon, label, handler) { const b = node("button", undefined, "icon-button"), i = node("i"); i.dataset.lucide = icon; b.type = "button"; b.title = label; b.setAttribute("aria-label", label); b.append(i); b.onclick = () => run(handler); return b; }
  function openForm(word) {
    editing = word?.id || null; $("custom-form").hidden = false; $("custom-form-title").textContent = word ? "编辑生词（保留进度）" : "添加生词";
    $("custom-word").value = word?.word || ""; $("custom-meaning").value = word?.meaning || ""; $("custom-note").value = word?.note || ""; $("custom-word").focus();
  }
  function renderHome() {
    const state = model.read(), words = state.words.filter((w) => !w.archived), now = Date.now(), tz = zone();
    const counts = { new: 0, due: 0, mastered: 0, waiting: 0 }; words.forEach((w) => counts[S.status(state.records[w.id], now, state.target, tz)]++);
    const metrics = $("custom-metrics"); metrics.replaceChildren();
    [[words.length, "在背生词"], [counts.new + counts.due, "新词 / 到期"], [counts.mastered, "已掌握"]].forEach(([n, title]) => { const d = node("div"); d.append(node("strong", n), node("span", title)); metrics.append(d); });
    $("custom-start").disabled = !(counts.new + counts.due); $("custom-all").disabled = !words.length; $("custom-resume").hidden = !state.session;
    $("custom-target").value = String(state.target);
    const query = $("custom-search").value.trim().toLowerCase(), filter = $("custom-filter").value;
    const list = state.words.filter((w) => {
      if (w.archived !== (filter === "archived")) return false;
      const r = state.records[w.id], status = S.status(r, now, state.target, tz);
      return (filter !== "due" || ["new", "due"].includes(status)) && (filter !== "mistakes" || r?.wrong || r?.uncertain) && (!query || `${w.word} ${w.meaning} ${w.note}`.toLowerCase().includes(query));
    });
    const container = $("custom-list"); container.replaceChildren();
    if (!list.length) container.append(node("p", words.length || filter !== "active" ? "没有符合条件的生词。" : "还没有自建生词。", "empty-state"));
    list.slice().reverse().forEach((w) => {
      const row = node("div", undefined, "question-list-row"), content = node("div", undefined, "question-list-content"), r = state.records[w.id];
      content.append(node("strong", w.word), node("p", w.meaning)); if (w.note) content.append(node("small", w.note));
      const status = S.status(r, now, state.target, tz); content.append(node("p", `${({ new: "新词", due: "到期", waiting: "等待复习", mastered: "已掌握" })[status]} · 连续 ${r?.streak || 0}/${state.target} · 忘了 ${r?.wrong || 0} · 不确定 ${r?.uncertain || 0}`, "custom-record"));
      const tools = node("div", undefined, "question-list-actions"); tools.append(button("pencil", `编辑 ${w.word}`, () => openForm(w)), button(w.archived ? "archive-restore" : "archive", `${w.archived ? "恢复" : "归档"} ${w.word}`, () => { if (!confirm(w.archived ? "恢复这个词到复习队列？" : "归档后停止复习，保留释义和历史，可随时恢复。继续吗？")) return; model.archive(w.id, !w.archived); render(); }));
      row.append(content, tools); container.append(row);
    }); window.lucide?.createIcons();
  }
  function renderPractice() {
    const state = model.read(), session = state.session, w = session && state.words.find((w) => w.id === session.ids[session.index]);
    $("custom-undo").disabled = !session?.undo?.length;
    $("custom-muted").checked = state.muted; audio.setMuted(state.muted);
    if (!w) {
      audio.stop(); spoken = ""; $("custom-progress").textContent = "本轮完成"; $("custom-card-word").textContent = "这一轮完成了";
      $("custom-answer").hidden = true; $("custom-reveal").hidden = true; $("custom-grades").hidden = true;
      $("custom-card-stat").textContent = session ? `记住 ${session.scores.correct} · 不确定 ${session.scores.uncertain} · 忘了 ${session.scores.wrong}` : ""; return;
    }
    $("custom-progress").textContent = `${session.index + 1} / ${session.ids.length}`; $("custom-card-word").textContent = w.word;
    $("custom-card-meaning").textContent = w.meaning; $("custom-card-note").textContent = w.note;
    $("custom-answer").hidden = !session.revealed; $("custom-reveal").hidden = session.revealed; $("custom-grades").hidden = !session.revealed;
    const r = state.records[w.id] || S.emptyRecord();
    $("custom-credit").textContent = S.canAdvance(r, Date.now(), !session.ids.slice(0, session.index).includes(w.id), zone()) ? "计入连续正确" : "只巩固，不计进度";
    $("custom-card-stat").textContent = `连续 ${r.streak}/${state.target} · 忘了 ${r.wrong} · 不确定 ${r.uncertain}`;
    const token = `${session.startedAt}:${session.index}:${w.word}`;
    if (active && spoken !== token) { spoken = token; audio.speak(w); }
  }
  function render() { $("custom-home").hidden = screen !== "home"; $("custom-practice").hidden = screen !== "practice"; if (screen === "practice") renderPractice(); else { audio.stop(); spoken = ""; renderHome(); } }
  function start(all) { if (model.read().session && !confirm("替换未结束的练习？已提交记录会保留。")) return; if (model.start(Number($("custom-count").value), Date.now(), zone(), all)) { screen = "practice"; render(); } }
  $("custom-add").onclick = () => openForm(); $("custom-cancel").onclick = () => { $("custom-form").hidden = true; editing = null; };
  $("custom-form").onsubmit = (event) => { event.preventDefault(); run(() => { model.upsert({ word: $("custom-word").value, meaning: $("custom-meaning").value, note: $("custom-note").value }, editing); $("custom-form").hidden = true; editing = null; render(); }); };
  $("custom-start").onclick = () => run(() => start(false)); $("custom-all").onclick = () => run(() => start(true));
  $("custom-resume").onclick = () => { screen = "practice"; render(); }; $("custom-back").onclick = () => { screen = "home"; render(); };
  $("custom-search").oninput = renderHome; $("custom-filter").onchange = renderHome;
  $("custom-reveal").onclick = () => run(() => { model.reveal(); renderPractice(); });
  document.querySelectorAll("[data-custom-grade]").forEach((b) => b.onclick = () => run(() => { model.answer(b.dataset.customGrade, Date.now(), zone()); renderPractice(); }));
  $("custom-undo").onclick = () => run(() => { if (model.undo()) { spoken = ""; renderPractice(); } });
  $("custom-end").onclick = () => run(() => { model.end(); screen = "home"; render(); });
  $("custom-target").onchange = (event) => run(() => { model.target(Number(event.target.value)); renderHome(); });
  $("custom-muted").onchange = (event) => run(() => { model.mute(event.target.checked); spoken = ""; renderPractice(); });
  $("custom-replay").onclick = () => { spoken = ""; renderPractice(); };
  $("custom-export").onclick = () => run(() => { const url = URL.createObjectURL(new Blob([model.exportText()], { type: "application/json" })), a = node("a"); a.href = url; a.download = `GRE自建生词-${S.dateKey(Date.now(), zone())}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); });
  $("custom-import").onchange = async (event) => { try { const f = event.target.files[0]; if (!f) return; if (f.size > 5000000) throw new Error("备份文件过大"); const data = window.GreCustomWords.validate(JSON.parse(await f.text())); if (!confirm("替换本机自建生词和其复习进度？原 1500 词与错题本不会改变。建议先导出备份。")) return; model.import(data); screen = "home"; render(); } catch (e) { message(`导入失败：${e.message}`); } finally { event.target.value = ""; } };
  window.addEventListener("gre-view-change", (event) => { active = event.detail === "custom"; if (active) render(); else { audio.stop(); spoken = ""; } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { audio.stop(); spoken = ""; } else if (active) render(); });
  window.addEventListener("pagehide", () => audio.stop());
  setInterval(() => { if (active && screen === "home" && document.visibilityState === "visible") renderHome(); }, 30000);
  document.addEventListener("keydown", (event) => {
    if (!active || screen !== "practice" || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest("input,textarea,select,.icon-button") || event.target.isContentEditable) return;
    const s = model.read().session; if (!s || s.index >= s.ids.length) return;
    const grade = { Digit1: "wrong", Numpad1: "wrong", Digit2: "uncertain", Numpad2: "uncertain", Digit3: "correct", Numpad3: "correct" }[event.code];
    if (event.code === "Space" && !s.revealed) { event.preventDefault(); $("custom-reveal").click(); }
    else if (grade && s.revealed) { event.preventDefault(); document.querySelector(`[data-custom-grade="${grade}"]`).click(); }
  });
  render();
})();
