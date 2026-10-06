(() => {
  "use strict";
  if (!document.querySelector('meta[name="gre-deployment"][content="github-pages"]')) return;
  const $ = (id) => document.getElementById(id), API = window.GreGithub;
  const VAULT_KEY = "gre-github-authorization-v1";
  const device = API.deviceAuthorization(window);
  let vault = null, connected = false, connecting = false, remembered = false, activeToken = "", authorizationEpoch = 0;
  try { vault = JSON.parse(localStorage.getItem(VAULT_KEY)); } catch (_) {}
  if (!API.vaultValid(vault)) vault = null;
  $("local-label").textContent = vault ? "待解锁同步" : "仅本机保存";
  $("cloud-row").hidden = false;
  $("cloud-status").textContent = vault ? "同步授权已加密保存。解锁后连接私有进度仓库；未解锁时记录仍在本机。" : "尚未连接 GitHub 私有进度仓库。本机学习记录仍会保存。";
  $("sync-now").hidden = true;
  $("email-login").hidden = true;
  $("backup-description").textContent = "首次迁移请导入今天的最新备份。连接后手机与电脑共用 GitHub 私有进度仓库；旧网址记录不会被删除。";

  const notice = $("pages-import-notice");
  const refresh = () => { notice.hidden = Number($("stat-seen").textContent) > 0; };
  refresh();
  new MutationObserver(refresh).observe($("stat-seen"), { childList: true, subtree: true, characterData: true });
  if (!notice.hidden) document.querySelector('.nav-tab[data-view="settings"]').click();
  function renderAuthorization() {
    $("github-owner").value = vault?.owner || "NengxinMou";
    $("github-token-row").hidden = !!vault;
    $("github-connect").textContent = vault ? "解锁并同步" : "连接私有仓库";
    $("github-export-auth").hidden = !vault;
    $("github-forget-auth").hidden = !vault;
    $("github-auth-form").hidden = connected;
    $("github-import-auth-label").hidden = connected;
  }
  renderAuthorization();
  async function preflight(transport) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try { return await transport.read(controller.signal); }
    finally { clearTimeout(timeout); }
  }
  function errorText(error) {
    return error.name === "AbortError" ? "连接超时。学习记录仍在本机，请稍后重试。" : /[\u3400-\u9fff]/.test(error.message) ? error.message : "网络暂不可用。学习记录仍在本机，请稍后重试。";
  }
  function connectedMessage() {
    return remembered ? "此设备已保持连接，打开网页后自动同步。解锁密码未保存。" : "已连接，网页开着时自动同步；关闭后需重新解锁。";
  }
  async function setRemembered(value) {
    const checkbox = $("github-remember"); checkbox.disabled = true;
    try {
      if (value) await device.remember(vault, activeToken);
      else if (remembered) await device.forget();
      remembered = value;
      $("github-auth-status").textContent = connectedMessage();
    } catch (_) {
      $("github-auth-status").textContent = "当前连接仍可自动同步，但保持连接设置未能保存，请重试。";
    } finally { checkbox.checked = remembered; checkbox.disabled = false; }
  }
  async function connect(token, sealed, automatic = false, epoch = authorizationEpoch) {
    const transport = API.create({ owner: sealed.owner, token, fetch: window.fetch.bind(window) });
    const remote = await preflight(transport);
    if (epoch !== authorizationEpoch) return false;
    if (!remote.state) {
      if (automatic) throw new Error("私有仓库没有进度，已暂停自动连接。请手动解锁并确认备份，不会自动上传空白或旧记录。");
      const count = Number($("stat-seen").textContent);
      if (!count) throw new Error("私有仓库还没有进度。请先导入今天的最新备份，再连接；不会上传空白记录。");
      if (!confirm(`私有仓库尚无学习进度。本机有 ${count} 个已学习单词。确认本机已导入最新备份，并将这些记录上传到你的 GitHub 私有仓库吗？`)) {
        $("github-auth-status").textContent = "首次上传已取消，本机和旧网址记录未改变。"; return false;
      }
      transport.allowInitialization();
    }
    localStorage.setItem(VAULT_KEY, JSON.stringify(sealed));
    vault = sealed; connected = true; activeToken = token;
    $("github-token").value = ""; $("github-password").value = "";
    renderAuthorization();
    $("github-auth-status").textContent = connectedMessage();
    $("sync-now").hidden = false;
    window.dispatchEvent(new CustomEvent("gre-sync-connect", { detail: { fetch: transport.fetch, storageKey: transport.storageKey, changeDelayMs: 1500, pollMs: 30000 } }));
    if (!automatic) await setRemembered($("github-remember").checked);
    return true;
  }
  $("github-auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (connected || connecting) return;
    connecting = true;
    const button = $("github-connect"); button.disabled = true;
    $("github-auth-status").textContent = "正在核对私有仓库…";
    try {
      const password = $("github-password").value;
      const owner = vault?.owner || $("github-owner").value.trim();
      const token = vault ? await API.unseal(vault, password) : $("github-token").value.trim();
      const sealed = vault || await API.seal(owner, token, password);
      await connect(token, sealed);
    } catch (error) {
      $("github-auth-status").textContent = errorText(error);
    } finally { connecting = false; button.disabled = false; $("github-password").value = ""; }
  });
  $("github-remember").addEventListener("change", () => {
    if (connected) void setRemembered($("github-remember").checked);
  });
  $("github-forget-auth").addEventListener("click", async () => {
    if (!confirm("移除这台设备的同步授权？学习记录和私有仓库都不会删除。若有待同步记录，请先导出备份。")) return;
    authorizationEpoch++;
    localStorage.removeItem(VAULT_KEY);
    try { await device.forget(); } catch (_) {}
    window.location.reload();
  });
  $("github-export-auth").addEventListener("click", () => {
    if (!vault) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(vault)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "GRE同步授权-加密.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  $("github-import-auth").addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 5000) throw new Error("请选择加密同步授权文件，不是学习进度备份。");
      const imported = JSON.parse(await file.text());
      if (!API.vaultValid(imported)) throw new Error("请选择加密同步授权文件，不是学习进度备份。");
      // Imported credentials remain inactive until the password and private repository are verified.
      authorizationEpoch++;
      vault = imported; renderAuthorization();
      $("github-auth-status").textContent = "授权文件已读取。输入原设备设置的本机解锁密码后连接。";
    } catch (error) { $("github-auth-status").textContent = /[\u3400-\u9fff]/.test(error.message) ? error.message : "无法读取授权文件；学习记录未改变。"; }
    finally { event.target.value = ""; }
  });
  async function restoreConnection() {
    if (!vault || connected || connecting) return;
    const sealed = vault, epoch = authorizationEpoch;
    connecting = true; $("github-connect").disabled = true; $("github-remember").disabled = true;
    try {
      const token = await device.restore(sealed);
      if (!token || epoch !== authorizationEpoch) return;
      remembered = true; $("github-remember").checked = true;
      $("local-label").textContent = "正在自动连接";
      $("github-auth-status").textContent = "正在恢复此设备的同步连接…";
      await connect(token, sealed, true, epoch);
    } catch (error) {
      if (epoch !== authorizationEpoch) return;
      $("local-label").textContent = "待解锁同步";
      $("github-auth-status").textContent = "自动连接未完成，可手动解锁重试。" + errorText(error);
    } finally { connecting = false; $("github-connect").disabled = false; $("github-remember").disabled = false; }
  }
  window.addEventListener("online", () => { void restoreConnection(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void restoreConnection(); });
  void restoreConnection();
})();
