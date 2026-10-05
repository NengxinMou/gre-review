(() => {
  "use strict";
  if (!document.querySelector('meta[name="gre-deployment"][content="github-pages"]')) return;
  const $ = (id) => document.getElementById(id);
  $("local-label").textContent = "仅本机保存";
  $("local-label").title = "此版本尚未接入跨设备同步";
  $("cloud-row").hidden = false;
  $("cloud-status").textContent = "尚未启用跨设备同步。手机和电脑的记录分别保存在各自浏览器中。";
  $("sync-now").hidden = true;
  $("email-login").hidden = true;
  $("backup-description").textContent = "此网址与旧网址的记录互不影响。首次迁移请导入今天的备份；切换设备前请导出最新备份。";

  const notice = $("pages-import-notice");
  const refresh = () => { notice.hidden = Number($("stat-seen").textContent) > 0; };
  refresh();
  new MutationObserver(refresh).observe($("stat-seen"), { childList: true, subtree: true, characterData: true });
  if (!notice.hidden) document.querySelector('.nav-tab[data-view="settings"]').click();
})();
