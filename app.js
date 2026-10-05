(() => {
  "use strict";

  const WORDS = window.GRE_WORDS || [];
  const Scheduler = window.GreScheduler;
  const STORAGE_KEY = document.querySelector('meta[name="gre-storage-key"]')?.content || "gre-1500-meaning-review-v1";
  const WORD_BY_ID = new Map(WORDS.map((word) => [word.id, word]));
  const $ = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const today = () => new Date();
  let storageReady = true;
  let toastTimer;
  const cloudEnabled = !!document.querySelector('meta[name="gre-cloud"][content="enabled"]');
  let cloud = null;
  let cloudBlocked = cloudEnabled;

  function blankState() {
    return { version: 1, target: 5, selected: 1, lastList: 1, audio: { muted: false, source: "dictionary", voiceURI: "" }, records: {}, session: null, studyDayRule: Scheduler.STUDY_DAY_RULE, appliedUpdates: [Scheduler.LIST2_REPAIR] };
  }

  function validSelection(value) {
    return ["all", "daily"].includes(value) || (Number.isInteger(value) && value >= 1 && value <= 30);
  }
  function cleanAudio(value) {
    return { muted: value?.muted === true, source: value?.source === "system" ? "system" : "dictionary", voiceURI: typeof value?.voiceURI === "string" ? value.voiceURI.slice(0, 300) : "" };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") return blankState();
      const state = { ...blankState(), ...parsed };
      state.studyDayRule = parsed.studyDayRule || null;
      state.appliedUpdates = Array.isArray(parsed.appliedUpdates) ? parsed.appliedUpdates : [];
      if (![3, 4, 5, 6, 7].includes(state.target)) state.target = 5;
      if (!validSelection(state.selected)) state.selected = 1;
      if (!validSelection(parsed.lastList) && state.selected !== "daily") state.lastList = state.selected;
      if (!validSelection(state.lastList) || state.lastList === "daily") state.lastList = 1;
      state.audio = cleanAudio(state.audio);
      if (state.session && (!Array.isArray(state.session.ids) || state.session.ids.some((id) => !WORD_BY_ID.has(id)) || !Number.isInteger(state.session.index))) state.session = null;
      return state;
    } catch (error) {
      storageReady = false;
      return blankState();
    }
  }

  const state = loadState();
  const updateResult = Scheduler.upgradeState(state, WORDS, Date.now());
  let currentView = "study";
  let lastSpokenCard = "";
  let voiceSignature = "";
  const pronunciation = window.GrePronunciation.create(window, renderAudio);

  function selectionLabel() {
    return state.selected === "daily" ? "每日复习" : state.selected === "all" ? "全部词表" : `List ${state.selected}`;
  }

  function renderAudio(info) {
    $("audio-on-icon").hidden = state.audio.muted;
    $("audio-off-icon").hidden = !state.audio.muted;
    const toggle = $("mute-audio");
    toggle.setAttribute("aria-pressed", String(state.audio.muted));
    toggle.setAttribute("aria-label", state.audio.muted ? "取消静音" : "静音");
    toggle.title = state.audio.muted ? "取消静音" : "静音";
    toggle.disabled = !info.supported;
    $("replay-word").disabled = !info.supported || state.audio.muted;
    $("replay-word").classList.toggle("playing", info.playing);
    $("audio-enabled").checked = !state.audio.muted;
    $("audio-enabled").disabled = !info.supported;
    const status = $("audio-status");
    status.textContent = !info.supported ? "当前浏览器不支持所选发音来源" : state.audio.muted ? "已静音" : info.message || (info.source === "dictionary" ? "美式词典音频" : info.voice ? "美式英语" : "系统未提供英语（美国）语音");
    status.dataset.playing = String(info.playing);
    status.dataset.error = info.lastError;
    $("voice-status").textContent = info.source === "dictionary" ? "联网 · 有道美式音频；已核对的多音词与 hew to 使用剑桥录音。" : !info.supported ? "当前浏览器不支持语音朗读。" : info.voice ? `${info.voice.name} · en-US${info.voice.localService ? " · 本机语音" : " · 联网语音"}` : "系统未提供英语（美国）语音，可在系统语音设置中添加。";
    $("audio-source").value = state.audio.source;
    $("system-voice-row").hidden = state.audio.source !== "system";
    const attribution = $("audio-attribution");
    attribution.hidden = info.source !== "dictionary" || !info.track;
    if (info.track) {
      attribution.href = info.track.reference;
      attribution.textContent = `${info.track.label}${info.track.ipa ? ` · /${info.track.ipa}/` : ""}`;
    }
    const signature = JSON.stringify(info.voices.map((voice) => [voice.voiceURI, voice.name]));
    if (signature !== voiceSignature || !$("american-voice").options.length) {
      const select = $("american-voice");
      select.replaceChildren();
      select.add(new Option(info.voices.length ? "自动选择美式语音" : "无可用美式语音", ""));
      info.voices.forEach((voice) => select.add(new Option(`${voice.name}${voice.localService ? "（本机）" : "（联网）"}`, voice.voiceURI)));
      voiceSignature = signature;
    }
    $("american-voice").value = info.voices.some((voice) => voice.voiceURI === state.audio.voiceURI) ? state.audio.voiceURI : "";
    $("american-voice").disabled = !info.voices.length;
  }

  function syncWordAudio(force = false) {
    const session = state.session;
    const word = session && WORD_BY_ID.get(session.ids[session.index]);
    if (currentView !== "study" || document.visibilityState === "hidden" || !word || state.audio.muted) {
      if (lastSpokenCard) pronunciation.stop();
      lastSpokenCard = "";
      return;
    }
    const key = `${session.startedAt || "legacy"}:${session.index}:${word.id}`;
    if (!force && key === lastSpokenCard) return;
    lastSpokenCard = key;
    pronunciation.speak(word);
  }

  function setAudioMuted(muted) {
    state.audio.muted = muted;
    pronunciation.setMuted(muted);
    lastSpokenCard = "";
    save();
    syncWordAudio();
  }

  function notify(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function save(sync = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageReady = true;
    } catch (error) {
      storageReady = false;
      $("local-label")?.replaceChildren(document.createTextNode("无法自动保存"));
      notify("浏览器未允许保存记录，请使用导出备份。");
    }
    if (sync) cloud?.changed();
  }

  function pool() {
    if (state.selected === "daily") return WORDS.filter((word) => state.records[word.id]?.attempts);
    return state.selected === "all" ? WORDS : WORDS.filter((word) => word.list === state.selected);
  }

  function summarize(words) {
    const result = { due: 0, fresh: 0, mastered: 0, waiting: 0, seen: 0, wrong: 0, forgotten: 0 };
    const now = today();
    words.forEach((word) => {
      const record = state.records[word.id];
      const kind = Scheduler.status(record, now, state.target);
      result[kind === "new" ? "fresh" : kind] += 1;
      if (record?.attempts) result.seen += 1;
      if (record?.wrong) result.wrong += record.wrong;
      if (record) result.forgotten += (record.wrong || 0) + (record.uncertain || 0);
    });
    return result;
  }

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = String(content);
    return element;
  }

  function renderNavigation() {
    const nav = $("list-nav");
    nav.replaceChildren();
    for (let number = 1; number <= 30; number++) {
      const summary = summarize(WORDS.slice((number - 1) * 50, number * 50));
      const button = node("button", "list-item" + (state.selected === number ? " active" : ""));
      button.type = "button";
      button.dataset.list = String(number);
      button.append(node("span", "", `List ${number}`), node("span", "", summary.due + summary.fresh));
      nav.append(button);
    }
    const allSummary = summarize(WORDS);
    $("daily-due-count").textContent = allSummary.due;
    $("daily-due-count").hidden = !allSummary.due;
    $("all-due-count").textContent = allSummary.due;
    $("all-due-count").parentElement.classList.toggle("active", state.selected === "all");
    const mobile = $("mobile-list");
    if (!mobile.options.length) {
      mobile.add(new Option("全部词表", "all"));
      mobile.add(new Option("每日复习", "daily"));
      for (let number = 1; number <= 30; number++) mobile.add(new Option(`List ${number}`, String(number)));
    }
    mobile.value = String(state.selected);
    renderTabs();
  }

  function renderInsight() {
    const words = pool();
    const summary = summarize(words);
    $("insight-list").textContent = selectionLabel();
    $("insight-due").textContent = summary.due;
    $("insight-new").textContent = summary.fresh;
    $("insight-mastered").textContent = summary.mastered;
    $("mastery-progress").style.width = `${Math.round(summary.mastered / words.length * 100) || 0}%`;
    const stages = $("stage-list");
    stages.replaceChildren();
    const counts = Array(state.target).fill(0);
    words.forEach((word) => {
      const record = state.records[word.id];
      if (record?.streak > 0) counts[Math.min(record.streak, state.target) - 1]++;
    });
    counts.forEach((count, index) => {
      const row = node("div", "stage-row");
      row.append(node("span", "", `${index + 1} / ${state.target}`), node("strong", "", count));
      const track = node("div", "progress-track");
      const bar = node("div");
      bar.style.width = `${Math.round(count / Math.max(words.length, 1) * 100)}%`;
      track.append(bar);
      row.append(track);
      stages.append(row);
    });
    const recent = $("recent-mistakes");
    recent.replaceChildren();
    const wrongWords = WORDS.filter((word) => state.records[word.id]?.wrong || state.records[word.id]?.uncertain).sort((a, b) => lastWrong(b.id) - lastWrong(a.id)).slice(0, 4);
    if (!wrongWords.length) recent.append(node("p", "empty-state", "还没有错词记录。"));
    wrongWords.forEach((word) => {
      const row = node("div", "recent-row");
      const record = state.records[word.id];
      row.append(node("span", "", word.word), node("small", "", record.wrong ? `错 ${record.wrong} 次${record.uncertain ? ` · 不确定 ${record.uncertain} 次` : ""}` : `不确定 ${record.uncertain} 次`));
      recent.append(row);
    });
    renderCurrentWordStat();
  }

  function renderCurrentWordStat() {
    const container = $("current-word-stat");
    container.replaceChildren();
    const id = state.session?.ids[state.session.index];
    if (!id) {
      container.textContent = "开始一轮后，这里会显示这张卡的记录。";
      return;
    }
    const record = state.records[id] || Scheduler.emptyRecord();
    container.append(node("strong", "", `${record.streak} / ${state.target} 次连续正确`), document.createElement("br"), document.createTextNode(`答错 ${record.wrong} 次 · 不确定 ${record.uncertain} 次 · 已作答 ${record.attempts} 次`));
  }

  function showStudyPart(part) {
    $("study-home").hidden = part !== "home";
    $("study-card").hidden = part !== "card";
    $("session-done").hidden = part !== "done";
  }

  function renderStudy() {
    const undoable = !!state.session?.undo?.length;
    $("undo-answer").disabled = !undoable;
    $("undo-done").disabled = !undoable;
    if (state.session && state.session.index < state.session.ids.length) {
      showStudyPart("card");
      const session = state.session;
      const word = WORD_BY_ID.get(session.ids[session.index]);
      $("card-source").textContent = `${session.mode === "daily" ? "每日复习 · " : ""}List ${word.list} · 原序号 ${word.number}`;
      $("card-count").textContent = `${session.index + 1} / ${session.ids.length}`;
      $("card-word").textContent = word.word;
      $("card-meaning").textContent = word.meaning;
      $("answer-panel").hidden = !session.revealed;
      $("recall-prompt").hidden = !!session.revealed;
      $("reveal-answer").hidden = !!session.revealed;
      $("grade-actions").hidden = !session.revealed;
      const firstInRound = !session.ids.slice(0, session.index).includes(word.id);
      $("correct-credit").textContent = Scheduler.canAdvance(state.records[word.id] || Scheduler.emptyRecord(), Date.now(), firstInRound) ? "计入连续正确" : "只巩固，不计进度";
      $("session-progress-text").textContent = `${session.index} / ${session.ids.length}`;
      $("session-progress-bar").style.width = `${Math.round(session.index / session.ids.length * 100)}%`;
      syncWordAudio();
    } else if (state.session) {
      showStudyPart("done");
      $("done-correct").textContent = state.session.scores.correct;
      $("done-uncertain").textContent = state.session.scores.uncertain;
      $("done-wrong").textContent = state.session.scores.wrong;
      syncWordAudio();
    } else {
      showStudyPart("home");
      const summary = summarize(pool());
      const daily = state.selected === "daily";
      $("home-label").textContent = selectionLabel();
      $("home-title").textContent = daily ? summary.due ? "每日复习" : "今日到期词已复习完" : summary.due + summary.fresh ? "今天从这里开始" : "今天的复习已完成";
      $("home-due").textContent = summary.due;
      $("home-new").textContent = daily ? new Set(Scheduler.dailyWords(WORDS, state.records, today(), state.target).map((word) => word.list)).size : summary.fresh;
      $("home-new-label").textContent = daily ? "涵盖 List" : "未见过";
      $("home-mastered").textContent = summary.mastered;
      $("start-session").disabled = !(daily ? summary.due : summary.due + summary.fresh);
      $("home-note").textContent = daily ? summary.due ? "" : "今天没有需要复习的到期词。" : summary.due + summary.fresh ? "先复习到期词，再看新词。每轮只取少量，词义揭晓后由你判断是否真正想起了 PDF 里的含义。" : "已经没有到期词和新词了。之后会按复习日期重新出现。";
      syncWordAudio();
    }
  }

  function lastWrong(id) {
    const history = state.records[id]?.history || [];
    for (let i = history.length - 1; i >= 0; i--) if (["wrong", "uncertain"].includes(history[i].grade)) return history[i].at;
    return 0;
  }

  function wrongWords() {
    const term = $("mistake-search").value.trim().toLowerCase();
    const words = WORDS.filter((word) => (state.records[word.id]?.wrong || state.records[word.id]?.uncertain) && (!term || word.word.toLowerCase().includes(term) || word.meaning.includes(term)));
    const sort = $("mistake-sort").value;
    if (sort === "wrong") words.sort((a, b) => (state.records[b.id].wrong + state.records[b.id].uncertain) - (state.records[a.id].wrong + state.records[a.id].uncertain) || lastWrong(b.id) - lastWrong(a.id));
    if (sort === "recent") words.sort((a, b) => lastWrong(b.id) - lastWrong(a.id));
    if (sort === "list") words.sort((a, b) => a.list - b.list || a.number - b.number);
    return words;
  }

  function renderMistakes() {
    const words = wrongWords();
    $("mistake-total").textContent = `${words.length} 个词`;
    $("practice-mistakes").disabled = words.length === 0;
    const list = $("mistakes-list");
    list.replaceChildren();
    if (!words.length) {
      list.append(node("p", "empty-state", $("mistake-search").value ? "没有符合搜索条件的错词。" : "还没有遗忘或不确定记录。"));
      return;
    }
    words.forEach((word) => {
      const row = node("div", "mistake-row");
      const record = state.records[word.id];
      row.append(node("strong", "", word.word), node("span", "meaning", word.meaning), node("small", "", `List ${word.list} · ${word.number}`), node("span", "wrong-count", `错 ${record.wrong} 次 · 不确定 ${record.uncertain} 次`));
      list.append(row);
    });
  }

  function renderStats() {
    const summary = summarize(WORDS);
    $("stat-seen").textContent = summary.seen;
    $("stat-mastered").textContent = summary.mastered;
    $("stat-due").textContent = summary.due;
    $("stat-wrong").textContent = summary.forgotten;
    const rows = $("list-stats");
    rows.replaceChildren();
    for (let number = 1; number <= 30; number++) {
      const part = summarize(WORDS.slice((number - 1) * 50, number * 50));
      const row = node("div", "list-stat");
      row.append(node("strong", "", `List ${number}`));
      const track = node("div", "progress-track");
      const bar = node("div");
      bar.style.width = `${part.mastered * 2}%`;
      track.append(bar);
      row.append(track, node("span", "", `${part.mastered}/50`));
      rows.append(row);
    }
  }

  function render() {
    $("pane-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(Scheduler.dayStart(today())));
    $("section-label").textContent = selectionLabel();
    $("mastery-target").value = String(state.target);
    renderNavigation();
    renderInsight();
    renderStudy();
    renderMistakes();
    renderStats();
    $("export-before-update").hidden = !state.beforeDayUpdate;
    $("day-update-info").hidden = !state.beforeDayUpdate;
    $("list2-repair-status").textContent = state.list2Repair?.count ? `List 2 已调整 ${state.list2Repair.count} 个词：2 次进度改为 1 次，答题历史与错题次数保留。` : "每日分界已调整到凌晨 4:00，未找到本次需回退的 List 2 进度。";
  }

  function renderTabs() {
    const active = currentView === "study" && state.selected === "daily" ? "daily" : currentView;
    all(".nav-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === active));
  }

  function showView(view) {
    currentView = view;
    renderTabs();
    all(".view").forEach((section) => {
      const active = section.id === `${view}-view`;
      section.classList.toggle("active", active);
      section.hidden = !active;
    });
    if (view === "mistakes") renderMistakes();
    if (view === "stats") renderStats();
    if (view !== "study") { pronunciation.stop(); lastSpokenCard = ""; }
    else syncWordAudio();
  }

  function selectList(value) {
    const selected = ["all", "daily"].includes(value) ? value : Number(value);
    if (!validSelection(selected)) return;
    if (selected === state.selected) { showView("study"); return; }
    if (state.session) notify("已结束上一轮，答题记录已保存。 ");
    state.session = null;
    state.selected = selected;
    if (selected !== "daily") state.lastList = selected;
    save();
    render();
    showView("study");
  }

  function startSession(ids, mode = "normal") {
    if (cloudBlocked) { showView("settings"); notify("请先完成同步或处理记录冲突。"); return; }
    if (!ids.length) return;
    state.session = { ids, index: 0, startedAt: Date.now(), initialCount: ids.length, retries: {}, undo: [], scores: { correct: 0, uncertain: 0, wrong: 0 }, revealed: false, mode };
    save();
    render();
    showView("study");
  }

  function gradeCurrent(grade) {
    if (cloudBlocked) { showView("settings"); notify("请先处理同步冲突，当前卡片已保留。"); return; }
    if (!Scheduler.answer(state, grade, Date.now())) return;
    save();
    render();
  }

  function undoCurrent() {
    if (cloudBlocked) { showView("settings"); notify("请先处理同步冲突。"); return; }
    if (!Scheduler.undoAnswer(state)) return;
    lastSpokenCard = "";
    save(); render(); showView("study");
    notify("已撤回答题，进度和本轮重复已还原。");
  }

  function validateBackup(data) {
    if (!data || data.version !== 1 || !data.records || typeof data.records !== "object") throw new Error("文件不是本应用的备份");
    const records = {};
    for (const [id, record] of Object.entries(data.records)) {
      if (!WORD_BY_ID.has(id) || !record || typeof record !== "object") continue;
      if (!["attempts", "correct", "wrong", "uncertain", "streak"].every((key) => Number.isInteger(record[key]) && record[key] >= 0)) continue;
      if (record.attempts !== record.correct + record.wrong + record.uncertain) continue;
      records[id] = { ...Scheduler.emptyRecord(), ...record, history: Array.isArray(record.history) ? record.history.filter((item) => item && ["correct", "wrong", "uncertain"].includes(item.grade) && Number.isFinite(item.at)).slice(-500) : [] };
    }
    const imported = { ...blankState(), target: [3, 4, 5, 6, 7].includes(data.target) ? data.target : 5, selected: validSelection(data.selected) ? data.selected : 1,
      lastList: validSelection(data.lastList) && data.lastList !== "daily" ? data.lastList : 1, audio: cleanAudio(data.audio), records,
      studyDayRule: data.studyDayRule || null, appliedUpdates: Array.isArray(data.appliedUpdates) ? data.appliedUpdates : [],
      list2Repair: data.list2Repair || null, beforeDayUpdate: data.beforeDayUpdate || null };
    Scheduler.upgradeState(imported, WORDS, Date.now());
    return imported;
  }

  all(".nav-tab").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "daily") selectList("daily");
    else if (view === "study" && state.selected === "daily") selectList(state.lastList);
    else showView(view);
  }));
  $("list-nav").addEventListener("click", (event) => { const button = event.target.closest("[data-list]"); if (button) selectList(button.dataset.list); });
  $("all-due-count").parentElement.addEventListener("click", () => selectList("all"));
  $("mobile-list").addEventListener("change", (event) => selectList(event.target.value));
  $("start-session").addEventListener("click", () => {
    const count = Number($("batch-size").value);
    const daily = state.selected === "daily";
    const ids = daily ? Scheduler.pickDailyQueue(WORDS, state.records, today(), count, state.target) : Scheduler.pickQueue(pool(), state.records, today(), count, state.target);
    startSession(ids, daily ? "daily" : "normal");
  });
  $("replay-word").addEventListener("click", () => syncWordAudio(true));
  $("undo-answer").addEventListener("click", undoCurrent);
  $("undo-done").addEventListener("click", undoCurrent);
  $("mute-audio").addEventListener("click", () => setAudioMuted(!state.audio.muted));
  $("audio-enabled").addEventListener("change", (event) => setAudioMuted(!event.target.checked));
  $("american-voice").addEventListener("change", (event) => { state.audio.voiceURI = event.target.value; save(); pronunciation.setVoice(state.audio.voiceURI); });
  $("audio-source").addEventListener("change", (event) => { state.audio.source = event.target.value; save(); lastSpokenCard = ""; pronunciation.setSource(state.audio.source); syncWordAudio(); });
  $("reveal-answer").addEventListener("click", () => { if (!state.session) return; state.session.revealed = true; save(); renderStudy(); });
  all("[data-grade]").forEach((button) => button.addEventListener("click", () => gradeCurrent(button.dataset.grade)));
  $("end-session").addEventListener("click", () => { state.session = null; save(); render(); });
  $("done-continue").addEventListener("click", () => { state.session = null; save(); render(); });
  $("show-mistakes").addEventListener("click", () => showView("mistakes"));
  $("mistake-search").addEventListener("input", renderMistakes);
  $("mistake-sort").addEventListener("change", renderMistakes);
  $("practice-mistakes").addEventListener("click", () => {
    const ids = wrongWords().slice(0, Number($("batch-size").value)).map((word) => word.id);
    startSession(ids, "mistakes");
  });
  $("mastery-target").addEventListener("change", (event) => {
    if (cloudBlocked) { event.target.value = String(state.target); notify("请先完成同步或处理记录冲突。"); return; }
    state.target = Number(event.target.value); save(); render(); notify(`掌握目标已设为 ${state.target} 次连续正确。`);
  });
  function exportBackup(data, label) {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const date = new Date(Scheduler.dayStart(today()));
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    link.download = `${label}-${day}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  $("export-data").addEventListener("click", () => exportBackup({ ...state, session: null }, "GRE词义复习备份"));
  $("export-before-update").addEventListener("click", () => exportBackup(state.beforeDayUpdate, "GRE规则调整前备份"));
  $("import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("备份文件过大");
      if (cloudBlocked) throw new Error("请先完成同步或处理记录冲突");
      const imported = validateBackup(JSON.parse(await file.text()));
      if (!confirm(cloudEnabled ? "导入会替换本机和云端的学习记录，并同步到其他设备。确定继续吗？" : "导入会替换当前学习记录。确定继续吗？")) return;
      Object.assign(state, imported);
      lastSpokenCard = "";
      pronunciation.stop(); pronunciation.setSource(state.audio.source); pronunciation.setVoice(state.audio.voiceURI); pronunciation.setMuted(state.audio.muted);
      save(); render();
      notify("备份已导入。");
    } catch (error) { notify(`导入失败：${error.message}`); }
    finally { event.target.value = ""; }
  });
  $("reset-data").addEventListener("click", () => {
    if (cloudBlocked) { notify("请先完成同步或处理记录冲突。"); return; }
    if (!confirm(cloudEnabled ? "确定清空本机和云端的答题记录、错词和进度吗？会同步到其他设备。" : "确定清空所有答题记录、错词和进度吗？此操作无法撤销。")) return;
    Object.assign(state, blankState());
    pronunciation.setSource(state.audio.source); pronunciation.setVoice(state.audio.voiceURI); pronunciation.setMuted(state.audio.muted);
    save(); render(); showView("study"); notify("学习记录已清空。");
  });
  document.addEventListener("keydown", (event) => {
    const session = state.session;
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (currentView !== "study" || !session || session.index >= session.ids.length || event.target.closest("input, select, textarea") || event.target.isContentEditable) return;
    if (event.code === "Space" && event.target.closest(".icon-button")) return;
    const grade = { Digit1: "wrong", Numpad1: "wrong", Digit2: "uncertain", Numpad2: "uncertain", Digit3: "correct", Numpad3: "correct" }[event.code];
    if (event.code !== "Space" && !grade) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Space" && !session.revealed) { session.revealed = true; save(); renderStudy(); }
    else if (grade && session.revealed) gradeCurrent(grade);
  });

  window.lucide?.createIcons();
  pronunciation.setSource(state.audio.source);
  pronunciation.setVoice(state.audio.voiceURI);
  pronunciation.setMuted(state.audio.muted);
  render();
  if (cloudEnabled) {
    $("cloud-row").hidden = false;
    $("backup-description").textContent = "进度自动同步；发音偏好、当前练习和撤回留在本机。首次迁移请导入原网页的备份。";
    cloud = window.GreSync.create({
      read: () => window.GreSync.snapshot(state), storage: localStorage, fetch: window.fetch.bind(window),
      apply(shared) {
        const changed = new Set([...Object.keys(state.records), ...Object.keys(shared.records)].filter((id) => JSON.stringify(state.records[id]) !== JSON.stringify(shared.records[id])));
        if (state.session?.undo?.some((item) => changed.has(item.id))) {
          state.session.undo = [];
          notify("另一台设备更新了本轮记录，旧答题不再可撤回。");
        }
        Object.assign(state, shared); save(false); render();
      },
      onStatus(info) {
        cloudBlocked = !info.ready || !!info.conflict.length;
        const label = info.conflict.length ? "同步有冲突" : info.error ? "待同步" : info.busy ? "同步中" : info.pending ? "待同步" : "已同步";
        $("local-label").textContent = storageReady ? label : "无法本机保存";
        $("cloud-status").textContent = info.error || (info.conflict.length ? "相同记录存在不同修改，请选择冲突项。其他词的更新会保留。" : info.busy ? "正在同步进度" : info.pending ? "本机进度等待上传" : "手机与电脑进度已同步");
        $("sync-conflict").hidden = !info.conflict.length;
        $("conflict-detail").textContent = info.conflict.map((id) => WORD_BY_ID.get(id)?.word || ({ target: "掌握目标", beforeDayUpdate: "历史备份" }[id]) || id).join("、");
        $("sync-now").disabled = info.busy || !!info.conflict.length;
        $("email-login").hidden = !document.querySelector('meta[name="gre-auth"]') || !info.error.includes("登录");
        if (info.conflict.length) showView("settings");
        $("export-conflict").hidden = !cloud?.getBackup();
      }
    });
    $("sync-now").addEventListener("click", () => cloud.sync(true));
    $("keep-cloud").addEventListener("click", () => cloud.resolve("remote"));
    $("keep-local").addEventListener("click", () => cloud.resolve("local"));
    $("export-conflict").addEventListener("click", () => { const backup = cloud.getBackup(); if (backup) exportBackup(JSON.parse(backup), "GRE同步冲突备份"); });
    void cloud.sync();
    setInterval(() => { if (document.visibilityState === "visible") void cloud.sync(); }, 10000);
    window.addEventListener("online", () => cloud.sync(true));
    window.addEventListener("gre-auth-refreshed", () => cloud.sync(true));
  }
  if (updateResult.changed) {
    save();
    if (updateResult.repaired) notify(`List 2 已有 ${updateResult.repaired} 个词从 2 次改为 1 次，原记录已备份。`);
  }
  let renderedDay = Scheduler.dayStart(today());
  setInterval(() => {
    const day = Scheduler.dayStart(today());
    if (day !== renderedDay) { renderedDay = day; render(); }
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { renderedDay = Scheduler.dayStart(today()); render(); void cloud?.sync(true); }
    else { pronunciation.stop(); lastSpokenCard = ""; }
  });
  window.addEventListener("pagehide", () => pronunciation.stop());
  if (!storageReady) notify("浏览器未允许保存记录，请使用导出备份。");
})();
