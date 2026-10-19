(() => {
  "use strict";
  const bank = window.GRE_QUESTIONS;
  const API = window.GreQuestionPractice;
  const $ = (id) => document.getElementById(id);
  const baseKey = document.querySelector('meta[name="gre-storage-key"]')?.content || "gre-1500-meaning-review-v1";
  let saveError = "";
  const practice = API.create({ bank, key: `${baseKey}:question-practice-v1`, storage: {
    getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value)
  }, onError(message) { saveError = message; $("question-storage-status").textContent = message; } });
  let screen = practice.read().session ? "practice" : "home";
  const typeLabel = (q) => q.type === "sentence-equivalence" ? "六选二" : "双空填空";
  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function lastResult(record) { return record?.history.at(-1)?.correct; }
  function filtered() {
    const filter = $("question-filter").value, query = $("question-search").value.trim().toLowerCase();
    const { records } = practice.read();
    return bank.filter((q) => (filter === "all" || filter === q.type || filter === "pending" && lastResult(records[q.id]) !== true) && (!query || [q.stem, ...q.groups.flatMap((g) => g.options.map((o) => o.text))].join(" ").toLowerCase().includes(query)));
  }
  function failed(ids = bank.map((q) => q.id)) { const { records } = practice.read(); return ids.filter((id) => lastResult(records[id]) === false); }
  function start(ids) {
    const session = practice.read().session;
    if (session && session.index < session.ids.length && !confirm("开始新一轮会替换当前练习顺序；已提交的答题记录会保留。继续吗？")) return;
    if (!practice.start(ids)) return;
    screen = "practice"; render(); $("question-stem").focus();
  }
  function renderHome() {
    const { records, session } = practice.read();
    const correct = bank.filter((q) => lastResult(records[q.id]) === true).length;
    const metrics = $("question-metrics"); metrics.replaceChildren();
    [[bank.length, "已收录"], [bank.length - correct, "尚未答对"], [Object.values(records).reduce((sum, r) => sum + r.wrong, 0), "累计答错"]].forEach(([value, label]) => {
      const part = el("div"); part.append(el("strong", "", value), el("span", "", label)); metrics.append(part);
    });
    $("question-resume").hidden = !session || session.index >= session.ids.length;
    $("question-retry").disabled = !failed().length;
    const list = $("question-list"), questions = filtered(); list.replaceChildren();
    $("question-start").disabled = !questions.length;
    $("question-list-count").textContent = `${questions.length} 道题`;
    if (!questions.length) list.append(el("p", "empty-state", "没有符合条件的题目。"));
    for (const q of questions) {
      const row = el("div", "question-list-row"), content = el("div", "question-list-content"), record = records[q.id];
      content.append(el("small", "", `题 ${String(q.number).padStart(2, "0")} · ${typeLabel(q)}`), el("strong", "", q.title), el("p", "", q.stem.replace(/\{\{\d+\}\}/g, "______")));
      const actions = el("div", "question-list-actions");
      actions.append(el("span", lastResult(record) === true ? "question-state correct" : "question-state", record ? `${lastResult(record) ? "已答对" : "需重练"} · 错 ${record.wrong} 次` : "待练"));
      const button = el("button", "icon-button"); button.type = "button"; button.title = `练习第 ${q.number} 题`; button.setAttribute("aria-label", button.title);
      const icon = el("i"); icon.dataset.lucide = "arrow-right"; button.append(icon); button.addEventListener("click", () => start([q.id]));
      actions.append(button); row.append(content, actions); list.append(row);
    }
    window.lucide?.createIcons();
  }
  function renderStem(q, selected, submitted) {
    const stem = $("question-stem"); stem.replaceChildren();
    for (const part of q.stem.split(/(\{\{\d+\}\})/)) {
      const match = /^\{\{(\d+)\}\}$/.exec(part);
      if (!match) stem.append(document.createTextNode(part));
      else {
        const index = Number(match[1]) - 1, blank = el("span", "question-blank");
        blank.textContent = submitted ? selected[index].map((id) => q.groups[index].options.find((o) => o.id === id).text).join(" / ") : `(${["i", "ii", "iii"][index]}) ______`;
        stem.append(blank);
      }
    }
  }
  function renderPractice() {
    const { session, records } = practice.read();
    const q = practice.current(), done = !q;
    $("question-done").hidden = !done;
    $("question-form").hidden = done; $("question-stem").hidden = done;
    $("question-feedback").hidden = done || session.result === null;
    $("question-type").textContent = q ? `题 ${String(q.number).padStart(2, "0")} · ${typeLabel(q)}` : "本轮完成";
    $("question-progress").textContent = `${Math.min(session.index + 1, session.ids.length)} / ${session.ids.length}`;
    $("question-progress-bar").style.width = `${(session.index + (session.result !== null ? 1 : 0)) / session.ids.length * 100}%`;
    if (done) {
      const wrong = failed(session.ids);
      $("question-done-summary").textContent = `本轮 ${session.ids.length} 题，答对 ${session.ids.length - wrong.length} 题，待重练 ${wrong.length} 题。`;
      $("question-done-retry").disabled = !wrong.length; return;
    }
    const submitted = session.result !== null;
    renderStem(q, session.selected, submitted);
    const options = $("question-options"); options.replaceChildren(); options.classList.toggle("two-blanks", q.groups.length > 1);
    q.groups.forEach((group, index) => {
      const fieldset = el("fieldset"), legend = el("legend", "", group.label); fieldset.append(legend);
      group.options.forEach((option) => {
        const label = el("label", "question-option"), input = el("input");
        input.type = group.pick === 1 ? "radio" : "checkbox"; input.name = `question-${q.id}-${index}`; input.value = option.id;
        input.checked = session.selected[index].includes(option.id); input.disabled = submitted || group.pick > 1 && session.selected[index].length >= group.pick && !input.checked;
        input.setAttribute("aria-label", `${option.id}. ${option.text}`);
        input.addEventListener("change", () => {
          practice.select(index, option.id); renderPractice();
          // Keep keyboard focus stable after rebuilding the current options.
          $("question-options").querySelector(`input[name="question-${q.id}-${index}"][value="${option.id}"]`)?.focus();
        });
        label.classList.toggle("selected", input.checked);
        if (submitted) { label.classList.toggle("answer-correct", group.answers.includes(option.id)); label.classList.toggle("answer-wrong", input.checked && !group.answers.includes(option.id)); }
        label.append(input, el("span", "option-letter", option.id), el("span", "option-text", option.text));
        if (submitted && group.answers.includes(option.id)) label.append(el("span", "option-mark", "正确"));
        else if (submitted && input.checked) label.append(el("span", "option-mark", "所选"));
        fieldset.append(label);
      });
      options.append(fieldset);
    });
    const chosen = session.selected.reduce((sum, ids) => sum + ids.length, 0), required = q.groups.reduce((sum, g) => sum + g.pick, 0);
    $("question-selection-status").textContent = submitted ? "已提交" : q.type === "sentence-equivalence" ? `已选 ${chosen} / ${required} 项` : `已填 ${chosen} / ${required} 空`;
    $("question-submit").hidden = submitted;
    $("question-submit").disabled = !API.validSelection(q, session.selected, true);
    if (!submitted) return;
    $("question-feedback").dataset.correct = String(session.result);
    $("question-result").textContent = session.result ? "答对了" : "这题再看一遍";
    $("question-answer").textContent = `正确答案：${q.groups.map((g) => g.answers.map((id) => `${id}. ${g.options.find((o) => o.id === id).text}`).join(" + ")).join("；")}`;
    const definitions = $("question-definitions"); definitions.replaceChildren();
    q.groups.flatMap((g) => g.options).forEach((o) => { const line = el("div"); line.append(el("strong", "", `${o.id}. ${o.text}`), el("span", "", o.meaning)); definitions.append(line); });
    $("question-clue").textContent = q.clue; $("question-explanation").textContent = q.explanation; $("question-translation").textContent = q.translation;
    const record = records[q.id]; $("question-record").textContent = `已做 ${record.attempts} 次 · 答错 ${record.wrong} 次`;
    $("question-next").textContent = session.index === session.ids.length - 1 ? "完成本轮" : "下一题";
  }
  function render() {
    $("question-home").hidden = screen !== "home";
    $("question-practice").hidden = screen !== "practice";
    if (screen === "practice" && practice.read().session) renderPractice(); else renderHome();
  }
  $("question-start").addEventListener("click", () => start(filtered().map((q) => q.id)));
  $("question-retry").addEventListener("click", () => start(failed()));
  $("question-resume").addEventListener("click", () => { screen = "practice"; render(); });
  $("question-back").addEventListener("click", () => { screen = "home"; render(); });
  $("question-done-home").addEventListener("click", () => { screen = "home"; render(); });
  $("question-done-retry").addEventListener("click", () => start(failed(practice.read().session.ids)));
  $("question-search").addEventListener("input", renderHome);
  $("question-filter").addEventListener("change", renderHome);
  $("question-form").addEventListener("submit", (event) => { event.preventDefault(); if (practice.submit() === null) return; renderPractice(); $("question-result").focus(); });
  $("question-next").addEventListener("click", () => { if (!practice.next()) return; renderPractice(); (practice.current() ? $("question-stem") : $("question-done-heading")).focus(); });
  $("question-export").addEventListener("click", () => {
    try {
      const content = practice.exportText();
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" })), link = el("a");
      link.href = url; link.download = `GRE错题本备份-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (_) { $("question-storage-status").textContent = "导出失败，请保留当前页面后重试。"; }
  });
  $("question-import").addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 2_000_000) throw new Error("备份文件过大");
      const data = API.validate(JSON.parse(await file.text()), bank);
      if (!confirm("导入将替换本机错题本的做题记录，不影响单词进度。继续吗？")) return;
      saveError = ""; practice.restore(data); screen = data.session ? "practice" : "home"; render();
      if (!saveError) $("question-storage-status").textContent = "错题本备份已导入 · 仅本机保存";
    } catch (error) { $("question-storage-status").textContent = `导入失败：${error.message}`; }
    finally { event.target.value = ""; }
  });
  window.addEventListener("gre-view-change", (event) => { if (event.detail === "questions") render(); });
  render();
})();
