(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GreGithub = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const FORMAT = "gre-github-progress-v1", MAX = 5_000_000, REPO = "gre-review-data";
  const encode = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  };
  const decode = (value) => Uint8Array.from(atob(value.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const textBytes = (value) => new TextEncoder().encode(value);
  function validState(state) {
    if (!state || state.version !== 1 || ![3, 4, 5, 6, 7].includes(state.target) || !state.records || typeof state.records !== "object" || Array.isArray(state.records)) return false;
    if (state.studyDayRule !== "local-04:00-v1" || !Array.isArray(state.appliedUpdates) || !state.appliedUpdates.includes("list2-two-to-one-20261001")) return false;
    if (Object.keys(state).some((key) => !["version", "records", "target", "studyDayRule", "appliedUpdates", "list2Repair", "beforeDayUpdate"].includes(key))) return false;
    for (const [id, r] of Object.entries(state.records)) {
      const match = /^(\d+)-(\d+)$/.exec(id);
      if (!match || +match[1] < 1 || +match[1] > 30 || +match[2] < 1 || +match[2] > 50) return false;
      if (!r || !["attempts", "correct", "wrong", "uncertain", "streak"].every((key) => Number.isSafeInteger(r[key]) && r[key] >= 0)) return false;
      if (r.attempts !== r.correct + r.wrong + r.uncertain || !Array.isArray(r.history)) return false;
      if (r.history.some((h) => !h || !["correct", "wrong", "uncertain"].includes(h.grade) || !Number.isFinite(h.at))) return false;
      if (["due", "last", "lastAdvanceDay", "lastRecallDay"].some((key) => r[key] != null && !Number.isFinite(r[key]))) return false;
    }
    return true;
  }
  function config(owner, token) {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner)) throw new Error("GitHub 用户名不正确。");
    if (!/^github_pat_[a-zA-Z0-9_]{20,250}$/.test(token)) throw new Error("请使用只授权私有进度仓库的 Fine-grained 授权码，不要填写 GitHub 密码。");
  }
  function create({ owner, token, fetch: request }) {
    config(owner, token);
    const baseURL = `https://api.github.com/repos/${owner}/${REPO}`;
    let observed = null, branch = null, allowCreate = false;
    async function api(path, options = {}) {
      const response = await request(baseURL + path, {
        ...options, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }
      });
      if (response.status === 401) throw new Error("GitHub 授权已失效。请更新授权；学习记录已保留。");
      if (response.status === 403 || response.status === 429) throw new Error("GitHub 暂时拒绝访问，请检查授权权限或稍后重试。学习记录已保留。");
      return response;
    }
    async function json(response) {
      const raw = await response.text();
      if (raw.length > MAX * 1.5) throw new Error("云端文件过大，未替换本机记录。");
      return JSON.parse(raw);
    }
    async function verify(signal) {
      const response = await api("", { signal });
      if (!response.ok) throw new Error("无法访问私有进度仓库。请确认仓库已创建，且授权只选中了 gre-review-data。");
      const repo = await json(response);
      if (repo.private !== true || repo.full_name?.toLowerCase() !== `${owner}/${REPO}`.toLowerCase()) throw new Error("同步已停止：进度必须放在私有仓库，绝不上传到公开网站仓库。");
      if (typeof repo.default_branch !== "string" || !/^[a-zA-Z0-9._/-]+$/.test(repo.default_branch)) throw new Error("私有仓库尚未初始化，请创建时勾选 README。");
      if (branch && branch !== repo.default_branch) throw new Error("仓库默认分支发生变化，请重新连接；未覆盖任何记录。");
      branch = repo.default_branch;
    }
    async function read(signal) {
      await verify(signal);
      const response = await api(`/contents/progress.json?ref=${encodeURIComponent(branch)}`, { signal });
      if (response.status === 404) { observed = { revision: 0, sha: null }; return { revision: 0, state: null }; }
      if (!response.ok) throw new Error("读取 GitHub 进度失败，未替换本机记录。");
      let file = await json(response);
      if (file.type !== "file" || file.path !== "progress.json" || !/^[a-f0-9]{40,64}$/.test(file.sha) || file.size > MAX) throw new Error("云端进度文件异常，未替换本机记录。");
      const sha = file.sha;
      // Large contents responses omit Base64; the immutable blob keeps data and SHA paired.
      if (file.encoding === "none") {
        const blobResponse = await api(`/git/blobs/${sha}`, { signal });
        if (!blobResponse.ok) throw new Error("读取完整进度失败，未替换本机记录。");
        file = await json(blobResponse);
        if (file.sha !== sha || file.size > MAX) throw new Error("云端进度版本不一致，未替换本机记录。");
      }
      if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error("云端进度格式不正确，未替换本机记录。");
      const bytes = decode(file.content);
      if (bytes.length > MAX) throw new Error("云端文件过大，未替换本机记录。");
      const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (envelope.format !== FORMAT || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1 || !validState(envelope.state)) throw new Error("云端记录校验失败，未替换本机记录。");
      observed = { revision: envelope.revision, sha };
      return { revision: envelope.revision, state: envelope.state };
    }
    async function transport(_url, options) {
      if (options.method === "GET") return Response.json(await read(options.signal));
      if (options.method !== "PUT") throw new Error("不支持此同步操作。");
      const payload = JSON.parse(options.body);
      if (!observed || payload.revision !== observed.revision) return Response.json({}, { status: 409 });
      if (!validState(payload.state)) throw new Error("本机记录校验失败，未上传任何记录。");
      if (!observed.sha && (!allowCreate || !Object.keys(payload.state.records).length)) throw new Error("首次同步请先导入最新备份，再确认上传；不会用空白记录初始化云端。");
      await verify(options.signal);
      const envelope = { format: FORMAT, revision: payload.revision + 1, state: payload.state };
      const bytes = textBytes(JSON.stringify(envelope));
      if (bytes.length > MAX) throw new Error("进度超过同步大小上限，请先导出备份。");
      const previousSHA = observed.sha;
      const response = await api("/contents/progress.json", {
        method: "PUT", signal: options.signal,
        body: JSON.stringify({ message: "Sync GRE learning progress", content: encode(bytes), branch, ...(previousSHA ? { sha: previousSHA } : {}) })
      });
      if (response.status === 409) return Response.json({}, { status: 409 });
      if (response.status === 422) {
        await read(options.signal);
        if (observed.sha !== previousSHA) return Response.json({}, { status: 409 });
        throw new Error("GitHub 未接受这次保存，请稍后重试；本机记录已保留。");
      }
      if (!response.ok) throw new Error("保存 GitHub 进度失败。请确认 Contents 权限是 Read and write；本机记录已保留。");
      const saved = await json(response);
      if (!/^[a-f0-9]{40,64}$/.test(saved.content?.sha)) throw new Error("保存结果异常，本机记录已保留，将重新核对云端。");
      observed = { revision: envelope.revision, sha: saved.content.sha };
      return Response.json({ revision: envelope.revision });
    }
    return { fetch: transport, read, allowInitialization() { allowCreate = true; }, storageKey: `gre-github-sync-v1:${owner.toLowerCase()}/${REPO}` };
  }
  async function key(password, salt) {
    const material = await crypto.subtle.importKey("raw", textBytes(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  function vaultValid(vault) {
    return vault?.version === 1 && vault.repo === REPO && typeof vault.owner === "string" && /^[a-zA-Z0-9-]{1,39}$/.test(vault.owner) && ["salt", "iv", "cipher"].every((name) => typeof vault[name] === "string" && vault[name].length < 2000);
  }
  async function seal(owner, token, password) {
    config(owner, token);
    if (password.length < 8) throw new Error("本机解锁密码至少需要 8 个字符，请勿使用 GitHub 密码。");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const vault = { version: 1, owner, repo: REPO, salt: encode(salt), iv: encode(iv) };
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes(`${owner}/${REPO}`) }, await key(password, salt), textBytes(token));
    vault.cipher = encode(new Uint8Array(cipher));
    return vault;
  }
  async function unseal(vault, password) {
    if (!vaultValid(vault)) throw new Error("同步授权文件格式不正确。");
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(vault.iv), additionalData: textBytes(`${vault.owner}/${REPO}`) }, await key(password, decode(vault.salt)), decode(vault.cipher));
      const token = new TextDecoder().decode(plaintext);
      config(vault.owner, token);
      return token;
    } catch (_) { throw new Error("解锁密码不正确，或授权文件已损坏。学习记录未改变。"); }
  }
  function deviceAuthorization(host = globalThis) {
    async function stored(mode, action) {
      if (!host.indexedDB || !host.crypto?.subtle) throw new Error("此浏览器无法保存保持连接设置，请每次打开时解锁。");
      return new Promise((resolve, reject) => {
        let db = null, transaction = null, done = false;
        const timeout = host.setTimeout(() => finish(new Error("保存设备授权超时，请重试。")), 5000);
        function finish(error, result) {
          if (done) return;
          done = true; host.clearTimeout(timeout);
          if (error && transaction) { try { transaction.abort(); } catch (_) {} }
          db?.close();
          if (error) reject(error); else resolve(result);
        }
        let opening;
        try { opening = host.indexedDB.open("gre-github-device-v1", 1); }
        catch (error) { finish(error); return; }
        opening.onupgradeneeded = () => {
          if (done) { opening.transaction.abort(); return; }
          opening.result.createObjectStore("authorization");
        };
        opening.onerror = () => finish(opening.error || new Error("无法打开设备授权存储。"));
        opening.onsuccess = () => {
          db = opening.result;
          if (done) { db.close(); return; }
          db.onversionchange = () => db.close();
          try {
            transaction = db.transaction("authorization", mode);
            const request = action(transaction.objectStore("authorization"));
            let result;
            request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => finish(null, result);
            transaction.onerror = transaction.onabort = () => finish(transaction.error || new Error("无法保存设备授权。"));
          } catch (error) { finish(error); }
        };
      });
    }
    const binding = (vault) => JSON.stringify([vault.version, vault.owner, vault.repo, vault.salt, vault.iv, vault.cipher]);
    async function remember(vault, token) {
      if (!vaultValid(vault)) throw new Error("同步授权文件格式不正确。");
      config(vault.owner, token);
      const deviceKey = await host.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const iv = host.crypto.getRandomValues(new Uint8Array(12));
      const cipher = await host.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes(binding(vault)) }, deviceKey, textBytes(token));
      // Store a non-exportable device key and ciphertext, never the token or password.
      await stored("readwrite", (store) => store.put({ version: 1, binding: binding(vault), deviceKey, iv: encode(iv), cipher: encode(new Uint8Array(cipher)) }, "active"));
    }
    async function restore(vault) {
      if (!vaultValid(vault)) return null;
      const saved = await stored("readonly", (store) => store.get("active"));
      if (!saved || saved.version !== 1 || saved.binding !== binding(vault)) return null;
      const plaintext = await host.crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(saved.iv), additionalData: textBytes(binding(vault)) }, saved.deviceKey, decode(saved.cipher));
      const token = new TextDecoder().decode(plaintext);
      config(vault.owner, token);
      return token;
    }
    return { remember, restore, forget: () => stored("readwrite", (store) => store.delete("active")) };
  }
  return { create, seal, unseal, vaultValid, validState, deviceAuthorization };
});
