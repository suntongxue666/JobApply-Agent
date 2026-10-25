import type { PageContext } from "../shared/schema";
const origin = "https://www.zhipin.com/";
const injections = new Map<number, Promise<void>>();
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("页面响应超时")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
async function inject(tabId: number) {
  if (injections.has(tabId)) return injections.get(tabId)!;
  const task = (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.startsWith(origin) || tab.incognito)
      throw new Error("只允许连接普通窗口中的 BOSS 页面");
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  })();
  injections.set(tabId, task);
  try {
    await task;
  } finally {
    injections.delete(tabId);
  }
}
export async function pageCall<T>(tabId: number, message: unknown): Promise<T> {
  const type = (message as { type: string }).type;
  const readOnly = ["CONTEXT", "LIST"].includes(type);
  // 页面动作包含授权往返和 DOM 核验，外层期限必须覆盖内部期限。
  const timeout =
    type === "CHAT_PROBE"
      ? 3500
      : readOnly
        ? 3500
        : type === "SEND_GREETING"
          ? 28000
          : type === "OPEN_CHAT"
            ? 20000
            : 16000;
  const send = () =>
    withTimeout(chrome.tabs.sendMessage(tabId, message), timeout);
  let result;
  try {
    result = await send();
  } catch (error) {
    if (!readOnly)
      throw new Error(
        `BOSS 页面操作中断：${error instanceof Error ? error.message : "连接断开"}；请检查页面，勿重复投递`,
      );
    try {
      await inject(tabId);
      result = await send();
    } catch (e) {
      throw new Error(
        `无法连接 BOSS 页面：${e instanceof Error ? e.message : "请刷新页面后重试"}`,
      );
    }
  }
  if (!result && readOnly) {
    await inject(tabId);
    result = await send();
  }
  if (!result?.ok)
    throw new Error(result?.error || "BOSS 页面未响应，请刷新页面后重试");
  return result.data as T;
}
export async function currentPage(
  preferredTabId?: number,
): Promise<{ tabId: number; context: PageContext }> {
  if (
    chrome.permissions?.contains &&
    !(await chrome.permissions.contains({ origins: [origin + "*"] }))
  )
    throw new Error(
      "未允许插件访问 BOSS：请在扩展详情的站点访问权限中允许 https://www.zhipin.com，再刷新 BOSS 页面",
    );
  const [active, tabs] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.tabs.query({ url: origin + "*" }),
  ]);
  const activeId = active[0]?.id;
  const candidates = tabs
    .filter(
      (t) => t.id !== undefined && !t.incognito && t.url?.startsWith(origin),
    )
    .sort((a, b) => {
      const rank = (t: chrome.tabs.Tab) =>
        t.id === activeId
          ? 3
          : t.id === preferredTabId
            ? 2
            : t.windowId === active[0]?.windowId
              ? 1
              : 0;
      return rank(b) - rank(a) || (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });
  if (!candidates.length)
    throw new Error(
      "未找到 BOSS 标签页，请先在此 Chrome 中打开并登录 BOSS 直聘",
    );
  let fallback: { tabId: number; context: PageContext } | undefined,
    lastError = "";
  for (const tab of candidates) {
    try {
      const context = await pageCall<PageContext>(tab.id!, { type: "CONTEXT" });
      const found = { tabId: tab.id!, context };
      if (context.supported && !context.reason) return found;
      if (!fallback || context.loggedIn) fallback = found;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "页面无法访问";
    }
  }
  if (fallback) return fallback;
  throw new Error(lastError || "BOSS 标签页尚未加载完成，请刷新连接");
}
