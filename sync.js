(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreSync = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const KEY = "gre-cloud-sync-v1";
  const fields = ["target", "studyDayRule", "appliedUpdates", "list2Repair", "beforeDayUpdate"];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function errorMessage(error, phase) {
    const step = ({ read: "读取云端", merge: "合并记录", cache: "保存本机同步缓存", upload: "上传进度" })[phase] || "同步";
    if (["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error?.name)) return `${step}失败：浏览器保存空间不足。请先导出学习备份，不要清除网站数据。`;
    if (error?.name === "SecurityError") return `${step}失败：浏览器禁止保存数据。请检查是否使用了无痕浏览或限制网站存储。`;
    if (error?.name === "AbortError") return `${step}超时；本机记录保留，可点击重试。`;
    if (typeof error?.message === "string" && /[\u3400-\u9fff]/.test(error.message)) return `${step}失败：${error.message}`;
    if (error?.name === "SyntaxError") return `${step}失败：收到的数据无法解析，未继续上传。请重试；持续出现时需要检查网页或云端文件格式。`;
    const kind = ["TypeError", "ReferenceError", "RangeError", "InvalidStateError"].includes(error?.name) ? `（${error.name}）` : "";
    return `${step}失败：网页处理异常${kind}。本机记录保留，请反馈这条完整提示。`;
  }
  function snapshot(state) {
    const result = { version: 1, records: clone(state.records) };
    fields.forEach((key) => { result[key] = state[key] ?? null; });
    return result;
  }
  function merge(base, local, remote) {
    const result = { version: 1, records: {} }, conflicts = [];
    function choose(key, before, here, there) {
      if (same(here, there) || same(before, there)) return here;
      if (same(before, here)) return there;
      conflicts.push(key);
      return here;
    }
    const ids = new Set([...Object.keys(base?.records || {}), ...Object.keys(local.records), ...Object.keys(remote.records)]);
    ids.forEach((id) => {
      const value = choose(id, base?.records?.[id], local.records[id], remote.records[id]);
      if (value !== undefined) result.records[id] = clone(value);
    });
    fields.forEach((key) => { result[key] = choose(key, base?.[key], local[key], remote[key]); });
    return { value: result, conflicts };
  }

  function create({ read, apply, storage, fetch: request, onStatus, storageKey = KEY, changeDelayMs = 0, validateMerged = () => [], requestTimeoutMs = 15000 }) {
    const timeoutMs = Number.isFinite(requestTimeoutMs) ? Math.min(60000, Math.max(1000, requestTimeoutMs)) : 15000;
    const conflictKey = storageKey === KEY ? "gre-cloud-conflict-backup-v1" : `${storageKey}:conflict`;
    let changeTimer;
    let base = null, revision = 0, busy = false, again = false, conflict = null;
    let ready = false, error = "", retryAt = 0, phase = "read";
    try {
      const saved = JSON.parse(storage.getItem(storageKey));
      if (saved?.base?.version === 1 && Number.isInteger(saved.revision)) { base = saved.base; revision = saved.revision; ready = true; }
    } catch (_) {}
    function status() {
      onStatus({ busy, ready, error, conflict: conflict?.conflicts || [], pending: !base || !same(read(), base) });
    }
    function persist() { storage.setItem(storageKey, JSON.stringify({ revision, base })); }
    async function call(method, body) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await request("/api/progress", { method, credentials: "same-origin", cache: "no-store", redirect: "manual", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) throw new Error("登录已失效，请重新打开网址登录。本机记录已保留。");
        if (response.status === 409) return { conflict: true };
        if (!response.ok) throw new Error("同步暂不可用，记录仍保存在本机。");
        const result = await response.json();
        if (!Number.isInteger(result.revision) || (result.state && result.state.version !== 1)) throw new Error("同步响应异常，未替换本机记录。");
        return result;
      } finally { clearTimeout(timeout); }
    }
    async function sync(force = false) {
      clearTimeout(changeTimer);
      if (conflict) { status(); return; }
      if (busy) { again = true; return; }
      if (!force && Date.now() < retryAt) return;
      busy = true; error = ""; status();
      try {
        phase = "read";
        const remote = await call("GET");
        phase = "merge";
        const local = read();
        if (remote.state) {
          const merged = !base && !Object.keys(local.records).length
            ? { value: clone(remote.state), conflicts: [] } : merge(base, local, remote.state);
          merged.conflicts = [...new Set([...merged.conflicts, ...validateMerged(merged.value)])];
          if (merged.conflicts.length) {
            conflict = { ...merged, local: clone(local), remote: remote.state, revision: remote.revision };
            ready = true; return;
          }
          apply(merged.value);
          base = clone(remote.state); revision = remote.revision;
          phase = "cache";
          persist();
        } else if (revision !== 0) {
          throw new Error("云端记录暂不可读，未覆盖或清空任何记录。");
        }
        ready = true;
        const payload = read();
        if (!remote.state || !same(payload, base)) {
          phase = "upload";
          const result = await call("PUT", { revision, state: payload });
          if (result.conflict) { again = true; return; }
          base = clone(payload); revision = result.revision; phase = "cache"; persist();
          if (!same(read(), base)) again = true;
        }
        retryAt = 0;
      } catch (e) {
        error = errorMessage(e, phase);
        ready = true; retryAt = Date.now() + 10000;
      }
      finally {
        busy = false; status();
        if (again && !conflict && !error) { again = false; void sync(); }
      }
    }
    async function resolve(preference) {
      if (!conflict || busy || !["local", "remote"].includes(preference)) return;
      // Retain both sides before an explicit choice. Only conflicting fields use the chosen side.
      try { storage.setItem(conflictKey, JSON.stringify({ at: Date.now(), ...conflict })); }
      catch (_) { error = "无法保存冲突备份，请先导出本机记录。"; status(); return; }
      const chosen = clone(conflict.value);
      for (const key of conflict.conflicts) {
        const side = conflict[preference];
        if (fields.includes(key)) chosen[key] = side[key];
        else if (side.records[key] === undefined) delete chosen.records[key];
        else chosen.records[key] = clone(side.records[key]);
      }
      apply(chosen);
      base = clone(conflict.remote); revision = conflict.revision;
      conflict = null;
      persist();
      await sync(true);
    }
    status();
    return { sync, resolve, changed() {
      status();
      if (busy) again = true;
      else if (changeDelayMs) { clearTimeout(changeTimer); changeTimer = setTimeout(() => void sync(), changeDelayMs); }
      else void sync();
    }, getBackup() { return storage.getItem(conflictKey); } };
  }
  return { snapshot, merge, create, errorMessage };
});
