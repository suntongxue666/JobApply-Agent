import {
  credentialFor,
  uiMessageSchema,
  contentRequestSchema,
} from "../shared/schema";
import { assertRun, cancelRun, db, getConfig } from "../storage/db";
import { complete, endpoint, evaluate } from "../ai/provider";
import {
  prepareDelivery,
  deliver,
  captureCreatedTab,
  authorizeChatSend,
  authorizeChatOpen,
} from "./delivery";
import { jobMarkers, skipJob } from "../storage/markers";
import { readJobDetail } from "./detail";
const pending = new Map<string, AbortController>();
async function protectStorage() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}
const initialized = protectStorage();
chrome.runtime.onInstalled.addListener(() => {
  void initialized;
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    for (const run of await db.runs.where("status").equals("running").toArray())
      await cancelRun(run.id, "paused", "浏览器重启，等待用户继续");
  })();
});
chrome.tabs.onCreated.addListener((tab) => {
  void captureCreatedTab(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    for (const run of await db.runs.where("status").equals("running").toArray())
      if (run.tabId === tabId) {
        pending.get(run.id)?.abort();
        await cancelRun(run.id, "paused", "目标标签页已关闭");
      }
  })();
});
async function handleContent(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
) {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id === undefined ||
    !sender.url ||
    (sender.frameId !== undefined && sender.frameId !== 0)
  )
    throw new Error("页面消息来源无效");
  const url = new URL(sender.url);
  if (
    url.origin !== "https://www.zhipin.com" ||
    !(
      ["/web/geek/jobs", "/web/geek/chat"].includes(url.pathname) ||
      /^\/job_detail\/[\w-]+\.html$/.test(url.pathname)
    )
  )
    throw new Error("页面不支持投递授权，请返回 BOSS 搜索列表");
  const msg = contentRequestSchema.parse(raw);
  if (msg.type === "AUTHORIZE_OPEN_CHAT")
    return authorizeChatOpen(msg.operationId, sender.tab!.id!);
  if (msg.type === "AUTHORIZE_CHAT_SEND")
    return authorizeChatSend(msg.operationId, sender.tab!.id!);
  if (url.pathname !== "/web/geek/jobs")
    throw new Error("该页面不能读取任务记录");
  const live = await chrome.tabs.get(sender.tab!.id!);
  if (live.url !== msg.pageUrl) throw new Error("页面已导航，请重新读取");
  if (msg.type === "GET_JOB_MARKERS")
    return jobMarkers(msg.accountScope, msg.pageUrl);
  const result = await skipJob(
    sender.tab!.id!,
    msg.accountScope,
    msg.pageUrl,
    msg.jobId,
    msg.label,
  );
  if (result.wasEvaluating && result.runId) pending.get(result.runId)?.abort();
  return null;
}
// 独立端口避免投递授权与扩展页面的普通消息响应竞争；断开时不重放点击。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jobapply-content-v1") return;
  port.onMessage.addListener((raw) => {
    void handleContent(raw, port.sender || {})
      .then((data) => {
        try {
          port.postMessage({ ok: true, data });
        } catch {
          /* 页面已断开 */
        }
      })
      .catch((e) => {
        try {
          port.postMessage({
            ok: false,
            error: e instanceof Error ? e.message : "页面授权失败",
          });
        } catch {
          /* 页面已断开 */
        }
      });
  });
});
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  const trusted =
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    ["panel.html", "options.html"].some((p) => {
      const source = new URL(sender.url!);
      return (
        source.origin === new URL(chrome.runtime.getURL(p)).origin &&
        source.pathname === new URL(chrome.runtime.getURL(p)).pathname
      );
    });
  if (!trusted) {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url)
      return false;
    let url: URL;
    try {
      url = new URL(sender.url);
    } catch {
      return false;
    }
    if (
      url.origin !== "https://www.zhipin.com" ||
      !(
        ["/web/geek/jobs", "/web/geek/chat"].includes(url.pathname) ||
        /^\/job_detail\/[\w-]+\.html$/.test(url.pathname)
      )
    )
      return false;
    const content = contentRequestSchema.safeParse(raw);
    if (!content.success) return false;
    const msg = content.data;

    void handleContent(msg, sender)
      .then((data) => respond({ ok: true, data }))
      .catch((e) =>
        respond({
          ok: false,
          error: e instanceof Error ? e.message : "页面授权失败",
        }),
      );
    return true;
  }
  const parsed = uiMessageSchema.safeParse(raw);
  if (!parsed.success) {
    respond({ ok: false, error: "消息格式不正确" });
    return false;
  }
  void (async () => {
    await initialized;
    const msg = parsed.data;
    if (msg.type === "OPEN_OPTIONS") {
      if (msg.section)
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`options.html#${msg.section}`),
        });
      else await chrome.runtime.openOptionsPage();
      return null;
    }
    if (msg.type === "CANCEL") {
      pending.get(msg.runId)?.abort();
      for (const op of await db.deliveries
        .where("runId")
        .equals(msg.runId)
        .toArray()) {
        if (["closed", "verified", "uncertain"].includes(op.status)) continue;
        for (const tabId of new Set([op.detailTabId, op.chatTabId])) {
          if (tabId !== undefined)
            await chrome.tabs
              .sendMessage(tabId, { type: "ABORT" })
              .catch(() => {});
        }
      }
      return null;
    }
    if (msg.type === "READ_JOB_DETAIL")
      return readJobDetail(msg.runId, msg.epoch, msg.key);
    if (msg.type === "PREPARE_DELIVERY")
      return prepareDelivery(msg.runId, msg.epoch, msg.key);
    if (msg.type === "DELIVER")
      return deliver(msg.operationId, msg.runId, msg.epoch);
    const config = await getConfig();
    const storedKey =
      (await chrome.storage.session.get("credential")).credential ||
      (await chrome.storage.local.get("credential")).credential;
    const key = credentialFor(storedKey, endpoint(config.baseUrl).origin);
    if (msg.type === "TEST_MODEL") {
      await complete(config, key, [
        { role: "user", content: "Reply with OK." },
      ]);
      return { message: "连接成功，模型已响应" };
    }
    const run = await assertRun(msg.runId, msg.epoch);
    if (pending.has(run.id)) throw new Error("任务已有模型请求处理中");
    const item = await db.items.get(msg.key);
    if (
      !item ||
      item.runId !== run.id ||
      item.status !== "evaluating" ||
      item.job.jd.length < 40
    )
      throw new Error("缺少完整岗位信息");
    if (!run.profile.confirmed || !run.profile.facts.length)
      throw new Error("请先确认简历事实");
    const origin = endpoint(run.config.baseUrl).origin;
    const runKey = credentialFor(storedKey, origin);
    if (run.config.consentOrigin !== origin)
      throw new Error("请先在设置页确认模型数据去向");
    const controller = new AbortController();
    pending.set(run.id, controller);
    try {
      const result = await evaluate(
        run.config,
        run.profile,
        item.job,
        runKey,
        controller.signal,
      );
      await assertRun(run.id, msg.epoch);
      return result;
    } finally {
      pending.delete(run.id);
    }
  })()
    .then((data) => respond({ ok: true, data }))
    .catch((e) =>
      respond({
        ok: false,
        error: e instanceof Error ? e.message : "操作失败",
      }),
    );
  return true;
});
