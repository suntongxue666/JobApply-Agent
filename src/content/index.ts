import { z } from "zod";
import { jobSchema, type JobMarker } from "../shared/schema";
import { context, loadMore, readDetail, readJobs } from "../adapters/boss";
import { clearDialogBinding } from "../adapters/boss/dialog-binding";
import { inspectChat, probeChat, sendGreeting } from "../adapters/boss/chat";
import { readStandaloneDetail } from "../adapters/boss/detail";
import { openChat } from "../adapters/boss/open-chat";
import { MarkerLayer } from "./markers";
import { contentRequest } from "./rpc";
const targetSchema = z.object({
  jobId: z.string().regex(/^[\w-]{4,100}$/),
  title: z.string().min(1).max(300),
  company: z.string().max(300),
  recruiter: z.string().max(100).optional(),
});
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONTEXT") }),
  z.object({ type: z.literal("LIST") }),
  z.object({
    type: z.literal("DETAIL"),
    job: jobSchema,
    url: z.string(),
    requestId: z.string(),
  }),
  z.object({ type: z.literal("LOAD_MORE"), url: z.string() }),
  z.object({ type: z.literal("ABORT") }),
  z.object({
    type: z.literal("OPEN_CHAT"),
    target: targetSchema,
    url: z.string(),
    operationId: z.string().uuid(),
  }),
  z.object({ type: z.literal("DETAIL_PAGE"), job: jobSchema }),
  z.object({
    type: z.literal("CHAT_PROBE"),
    target: targetSchema,
    operationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("CHAT_READY"),
    target: targetSchema,
    operationId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("SEND_GREETING"),
    target: targetSchema,
    greeting: z.string().min(1).max(1000),
    operationId: z.string().uuid(),
  }),
]);
declare global {
  var __jobApplyContent: { dispose: () => void } | undefined;
}
try {
  globalThis.__jobApplyContent?.dispose();
} catch {
  /* 扩展重载后的旧上下文可能已失效 */
}
let controller: AbortController | undefined,
  disposed = false,
  polling = false;
async function request<T>(message: unknown): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || "插件后台无响应，请刷新连接");
  return reply.data;
}
const layer = new MarkerLayer(async (jobId, title) => {
  const page = await context();
  if (!page.accountScope) throw new Error("未识别登录账号，请先登录");
  await request({
    type: "SKIP_JOB",
    jobId,
    label: title,
    accountScope: page.accountScope,
    pageUrl: location.href,
  });
  await refreshMarkers();
});
async function refreshMarkers() {
  if (disposed || polling) return;
  polling = true;
  try {
    const page = await context();
    if (!page.supported || !page.accountScope) {
      layer.update([]);
      return;
    }
    const markers = await request<JobMarker[]>({
      type: "GET_JOB_MARKERS",
      accountScope: page.accountScope,
      pageUrl: page.url,
    });
    if (!disposed) layer.update(markers);
  } catch {
    /* 后台升级或页面跳转时稍后重试；不触发任何外发动作 */
  } finally {
    polling = false;
  }
}
const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
  raw,
  sender,
  respond,
) => {
  // sender.tab 也可能出现在扩展全屏页消息中；用扩展 ID 和精确来源协议校验。
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url
      ? !sender.url.startsWith(chrome.runtime.getURL(""))
      : sender.tab !== undefined)
  )
    return false;
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) {
    respond({ ok: false, error: "页面命令格式不正确" });
    return false;
  }
  void (async () => {
    const msg = parsed.data;
    if (msg.type === "ABORT") {
      controller?.abort();
      return null;
    }
    if (msg.type === "CONTEXT") return context();
    if (msg.type === "LIST") return readJobs();
    if (msg.type === "CHAT_PROBE")
      return probeChat(msg.target, msg.operationId);
    if (controller) throw new Error("页面已有读取请求");
    controller = new AbortController();
    try {
      if (msg.type === "LOAD_MORE")
        return await loadMore(msg.url, controller.signal);
      if (msg.type === "DETAIL_PAGE")
        return await readStandaloneDetail(msg.job, controller.signal);
      if (msg.type === "OPEN_CHAT") {
        await contentRequest({
          type: "AUTHORIZE_OPEN_CHAT",
          operationId: msg.operationId,
        });
        return await openChat(
          msg.target,
          msg.url,
          controller.signal,
          msg.operationId,
        );
      }
      if (msg.type === "CHAT_READY")
        return await inspectChat(
          msg.target,
          controller.signal,
          msg.operationId,
        );
      if (msg.type === "SEND_GREETING")
        return await sendGreeting(
          msg.target,
          msg.greeting,
          async () => {
            await contentRequest({
              type: "AUTHORIZE_CHAT_SEND",
              operationId: msg.operationId,
            });
          },
          controller.signal,
          msg.operationId,
        );
      return await readDetail(msg.job, msg.url, controller.signal);
    } finally {
      controller = undefined;
    }
  })()
    .then((data) => respond({ ok: true, data }))
    .catch((e) =>
      respond({
        ok: false,
        error: e instanceof Error ? e.message : "页面操作失败",
      }),
    );
  return true;
};
chrome.runtime.onMessage.addListener(listener);
const timer = setInterval(() => void refreshMarkers(), 1200);
void refreshMarkers();
globalThis.__jobApplyContent = {
  dispose: () => {
    disposed = true;
    controller?.abort();
    clearInterval(timer);
    layer.dispose();
    clearDialogBinding();
    chrome.runtime.onMessage.removeListener(listener);
  },
};
