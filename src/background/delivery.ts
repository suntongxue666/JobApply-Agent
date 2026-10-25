import { db, assertRun, applicationKey, claimSend, log } from "../storage/db";
import { waitForDetailTab } from "./detail";
import { detailUrl } from "../adapters/boss/detail";
import { isSkipped } from "../storage/markers";
import { pageCall } from "../core/connection";
import { deliveryIntervalMs } from "../shared/interval";
import { validateEvaluation } from "../ai/provider";
import type {
  DeliveryOperation,
  ChatTarget,
  SendObservation,
  Job,
} from "../shared/schema";
function target(job: {
  id: string;
  title: string;
  company: string;
  recruiter?: string;
}): ChatTarget {
  return {
    jobId: job.id,
    title: job.title,
    company: job.company,
    recruiter: job.recruiter,
  };
}
export async function prepareDelivery(
  runId: string,
  epoch: number,
  key: string,
) {
  return db.transaction(
    "rw",
    [
      db.runs,
      db.locks,
      db.items,
      db.applications,
      db.deliveries,
      db.skips,
      db.blocks,
    ],
    async () => {
      const run = await assertRun(runId, epoch),
        item = await db.items.get(key);
      if (
        run.mode !== "auto" ||
        !item ||
        item.runId !== runId ||
        item.status !== "ready" ||
        !item.evaluation
      )
        throw new Error("岗位尚未准备好，不能发起沟通");
      if (
        (await isSkipped(run.accountScope, run.pageUrl, item.job.id)) ||
        (await db.blocks.get(item.job.id))
      )
        throw new Error("用户已跳过或屏蔽此岗位");
      validateEvaluation(
        JSON.stringify(item.evaluation),
        run.config,
        run.profile,
        item.job,
      );
      await claimSend(runId, epoch, key, "conversation");
      const op: DeliveryOperation = {
        id: crypto.randomUUID(),
        runId,
        itemKey: key,
        jobId: item.job.id,
        epoch,
        sourceTabId: run.tabId,
        detailUrl: item.job.openInDetail
          ? detailUrl(item.job.url, item.job.id)
          : undefined,
        accountScope: run.accountScope,
        status: "armed",
        createdAt: Date.now(),
        candidates: [],
        text: item.evaluation.greeting,
      };
      await db.deliveries.add(op);
      return { operationId: op.id };
    },
  );
}
export async function captureCreatedTab(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  await db.transaction("rw", db.deliveries, async () => {
    const operations = await db.deliveries
      .where("status")
      .equals("opening")
      .toArray();
    for (const op of operations.filter(
      (o) =>
        (o.detailTabId ?? o.sourceTabId) === tab.openerTabId &&
        Date.now() - o.createdAt < 20000,
    )) {
      const candidates = [...new Set([...op.candidates, tab.id!])];
      await db.deliveries.update(op.id, {
        candidates,
        chatTabId: candidates.length === 1 ? tab.id : undefined,
      });
    }
  });
}
async function sourceStillMatches(op: DeliveryOperation) {
  const run = await assertRun(op.runId, op.epoch),
    page = await pageCall<{
      url: string;
      accountScope: string;
      supported: boolean;
      reason: string;
      conflict?: boolean;
    }>(op.sourceTabId, { type: "CONTEXT" });
  if (
    !page.supported ||
    page.reason ||
    page.conflict ||
    page.url !== run.pageUrl ||
    page.accountScope !== run.accountScope
  )
    throw new Error("搜索页或账号已改变，停止当前沟通");
  return run;
}
export async function authorizeChatOpen(
  operationId: string,
  senderTabId: number,
) {
  const op = await db.deliveries.get(operationId);
  if (!op || (op.detailTabId ?? op.sourceTabId) !== senderTabId)
    throw new Error("不是本次岗位列表，未授权点击");
  await sourceStillMatches(op);
  if (op.detailTabId !== undefined) {
    const detail = await chrome.tabs.get(op.detailTabId);
    if (
      !detail.active ||
      detail.url !== op.detailUrl ||
      detail.openerTabId !== op.sourceTabId
    )
      throw new Error("独立详情 Tab 已切换或导航，未授权开聊");
  }
  return db.transaction(
    "rw",
    [db.runs, db.locks, db.deliveries, db.items, db.skips, db.blocks],
    async () => {
      await assertRun(op.runId, op.epoch);
      const current = await db.deliveries.get(op.id),
        item = await db.items.get(op.itemKey),
        run = await db.runs.get(op.runId);
      if (
        current?.status !== "opening" ||
        current.openAuthorizedAt ||
        item?.status !== "opening_chat" ||
        !run
      )
        throw new Error("沟通点击授权已失效，禁止重复点击");
      if (
        (await isSkipped(op.accountScope, run.pageUrl, op.jobId)) ||
        (await db.blocks.get(op.jobId))
      )
        throw new Error("岗位已跳过或屏蔽");
      await db.deliveries.update(op.id, { openAuthorizedAt: Date.now() });
      return { authorized: true };
    },
  );
}
export async function authorizeChatSend(
  operationId: string,
  senderTabId: number,
) {
  const op = await db.deliveries.get(operationId);
  if (!op) throw new Error("发送操作不存在");
  const chat = await chrome.tabs.get(senderTabId);
  if (!chat.active || chat.url !== op.chatUrl)
    throw new Error("聊天 Tab 不在前台或已导航，未发送");
  await sourceStillMatches(op);
  return db.transaction(
    "rw",
    [
      db.runs,
      db.locks,
      db.items,
      db.applications,
      db.deliveries,
      db.skips,
      db.blocks,
    ],
    async () => {
      const current = await db.deliveries.get(operationId),
        run = await assertRun(op.runId, op.epoch),
        item = await db.items.get(op.itemKey);
      if (
        !current ||
        current.status !== "chat_ready" ||
        current.chatTabId !== senderTabId ||
        current.candidates.length !== 1 ||
        !item ||
        item.status !== "opening_chat"
      )
        throw new Error("会话或发送授权已失效，禁止重复发送");
      if (
        (await isSkipped(run.accountScope, run.pageUrl, op.jobId)) ||
        (await db.blocks.get(op.jobId))
      )
        throw new Error("用户已跳过或屏蔽此岗位");
      if (item.evaluation?.greeting !== op.text)
        throw new Error("招呼语版本已改变，未发送");
      const key = applicationKey(run.accountScope, op.jobId);
      if (await db.applications.get(key))
        throw new Error("已有发送记录或待核查意图，禁止重发");
      await db.applications.add({
        key,
        runId: run.id,
        jobId: op.jobId,
        accountScope: run.accountScope,
        action: "greeting",
        text: op.text,
        status: "intent",
        createdAt: Date.now(),
      });
      await db.deliveries.update(op.id, {
        status: "clicked",
        clickedAt: Date.now(),
      });
      await db.items.update(op.itemKey, {
        status: "sending",
        updatedAt: Date.now(),
      });
      return { authorized: true };
    },
  );
}
async function recordOutcome(
  op: DeliveryOperation,
  observation: SendObservation,
) {
  await db.transaction(
    "rw",
    [db.items, db.applications, db.deliveries, db.runs],
    async () => {
      const key = applicationKey(op.accountScope, op.jobId),
        record = await db.applications.get(key);
      if (observation.verified && !record)
        throw new Error("没有发送意图，不能记为发送成功");
      if (observation.verified && record?.status !== "verified") {
        const run = await db.runs.get(op.runId);
        if (run) {
          const delay = deliveryIntervalMs(run.config);
          await db.runs.update(run.id, {
            nextDeliveryAt: delay ? Date.now() + delay : undefined,
          });
        }
      }
      if (record)
        await db.applications.update(key, {
          status: observation.verified ? "verified" : "uncertain",
          verifiedAt: observation.verified ? Date.now() : undefined,
        });
      await db.items.update(op.itemKey, {
        status: observation.verified ? "sent_verified" : "uncertain",
        reason: observation.reason,
        updatedAt: Date.now(),
      });
      await db.deliveries.update(op.id, {
        status: observation.verified ? "verified" : "uncertain",
        chatUrl: observation.chatUrl,
        error: observation.verified ? undefined : observation.reason,
      });
    },
  );
}
export async function closeVerifiedTab(operationId: string) {
  const op = await db.deliveries.get(operationId);
  if (
    !op ||
    op.status !== "verified" ||
    op.chatTabId === undefined ||
    op.candidates.length !== 1 ||
    op.chatTabId === op.sourceTabId
  )
    throw new Error("不是本次已核验的独立聊天 Tab，禁止关闭");
  const tab = await chrome.tabs.get(op.chatTabId);
  if (
    tab.url !== op.chatUrl ||
    !(
      tab.url?.startsWith("https://www.zhipin.com/web/geek/chat") ||
      (op.chatMode === "detail_dialog" &&
        op.chatTabId === op.detailTabId &&
        tab.url === op.detailUrl)
    ) ||
    tab.openerTabId !==
      (op.chatTabId === op.detailTabId
        ? op.sourceTabId
        : (op.detailTabId ?? op.sourceTabId))
  )
    throw new Error("聊天 Tab 已改变，未自动关闭");
  await chrome.tabs.remove(op.chatTabId);
  if (op.detailTabId !== undefined && op.detailTabId !== op.chatTabId) {
    const detail = await chrome.tabs.get(op.detailTabId).catch(() => undefined);
    if (
      detail &&
      detail.url === op.detailUrl &&
      detail.openerTabId === op.sourceTabId
    )
      await chrome.tabs.remove(op.detailTabId);
  }
  await db.deliveries.update(op.id, { status: "closed" });
  await chrome.tabs.update(op.sourceTabId, { active: true });
}
async function waitForChild(op: DeliveryOperation, job: Job) {
  let detailReason = "详情页尚未出现可编辑对话框";
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await assertRun(op.runId, op.epoch);
    const current = await db.deliveries.get(op.id);
    if (current?.candidates.length && current.candidates.length > 1)
      throw new Error("同时打开了多个子 Tab，无法确认归属，已停止");
    // 独立详情点击立即沟通既可能新开子页，也可能在本次详情 Tab 内导航。
    if (current?.detailTabId !== undefined) {
      const owned = await chrome.tabs.get(current.detailTabId);
      if (
        owned.url?.startsWith("https://www.zhipin.com/web/geek/chat") &&
        owned.status === "complete"
      ) {
        if (
          current.candidates.length &&
          !current.candidates.includes(current.detailTabId)
        )
          throw new Error("详情和子 Tab 同时进入聊天，无法唯一关联");
        await db.deliveries.update(op.id, {
          candidates: [owned.id!],
          chatTabId: owned.id,
        });
        return owned;
      }
    }
    if (current?.detailTabId !== undefined && !current.candidates.length) {
      const detail = await chrome.tabs.get(current.detailTabId);
      if (detail.url === current.detailUrl && detail.status === "complete") {
        const probe = await pageCall<{
          ready: boolean;
          url?: string;
          mode?: "page" | "detail_dialog";
          reason?: string;
        }>(detail.id!, {
          type: "CHAT_PROBE",
          target: target(job),
          operationId: op.id,
        });
        detailReason = probe.reason || detailReason;
        if (
          probe.ready &&
          probe.mode === "detail_dialog" &&
          probe.url === current.detailUrl
        ) {
          const claimed = await db.transaction(
            "rw",
            db.deliveries,
            async () => {
              const latest = await db.deliveries.get(op.id);
              if (latest?.status !== "opening" || latest.candidates.length)
                return false;
              await db.deliveries.update(op.id, {
                candidates: [detail.id!],
                chatTabId: detail.id,
                chatMode: "detail_dialog",
              });
              return true;
            },
          );
          if (claimed) return detail;
        }
      }
    }
    if (current?.chatTabId !== undefined) {
      const tab = await chrome.tabs.get(current.chatTabId);
      if (tab.url?.startsWith("https://www.zhipin.com/web/passport"))
        throw new Error("BOSS 登录或安全验证阻断，请自行处理");
      if (
        tab.url?.startsWith("https://www.zhipin.com/web/geek/chat") &&
        tab.status === "complete"
      )
        return tab;
      if (
        tab.url &&
        !tab.url.startsWith("https://www.zhipin.com/") &&
        tab.url !== "about:blank"
      )
        throw new Error("新 Tab 跳转到非 BOSS 站点，未发送");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `立即沟通后未找到本次聊天页面或首次沟通弹窗：${detailReason}；未发送，不会选择其他已有会话`,
  );
}
export async function deliver(
  operationId: string,
  runId: string,
  epoch: number,
) {
  const op = await db.transaction(
    "rw",
    [db.runs, db.locks, db.deliveries],
    async () => {
      await assertRun(runId, epoch);
      const op = await db.deliveries.get(operationId);
      if (
        !op ||
        op.runId !== runId ||
        op.epoch !== epoch ||
        op.status !== "armed"
      )
        throw new Error("沟通操作已执行或身份不一致，禁止重放");
      await db.deliveries.update(op.id, {
        status: op.detailUrl ? "loading_detail" : "opening",
      });
      return op;
    },
  );
  const item = await db.items.get(op.itemKey);
  if (!item) throw new Error("岗位记录不存在");
  try {
    await sourceStillMatches(op);
    let openTabId = op.sourceTabId,
      openUrl = (await db.runs.get(runId))!.pageUrl;
    if (op.detailUrl) {
      const detail = await chrome.tabs.create({
        url: op.detailUrl,
        active: true,
        openerTabId: op.sourceTabId,
      });
      if (detail.id === undefined) throw new Error("无法创建本次岗位详情 Tab");
      op.detailTabId = detail.id;
      await db.deliveries.update(op.id, { detailTabId: detail.id });
      await waitForDetailTab(detail.id, op.detailUrl, runId, epoch);
      await pageCall(detail.id, { type: "CONTEXT" });
      // 不根据标题猜测目标；独立页再次核对 URL、职位标题和 JD。
      const currentJob = await pageCall<import("../shared/schema").Job>(
        detail.id,
        { type: "DETAIL_PAGE", job: item.job },
      );
      if (currentJob.communicated)
        throw new Error("独立详情显示已沟通，未重复发起沟通");
      if (currentJob.id !== item.job.id)
        throw new Error("独立详情返回了其他岗位，未发起沟通");
      op.detailUrl = detailUrl(currentJob.url, item.job.id);
      await sourceStillMatches(op);
      await db.deliveries.update(op.id, {
        status: "opening",
        createdAt: Date.now(),
        detailUrl: op.detailUrl,
      });
      openTabId = detail.id;
      openUrl = op.detailUrl;
    }
    await log(
      runId,
      "opening_chat",
      "目标详情已就绪，准备点击立即沟通",
      op.jobId,
    );
    await pageCall(openTabId, {
      type: "OPEN_CHAT",
      target: target(item.job),
      url: openUrl,
      operationId,
    });
    const tab = await waitForChild(op, item.job);
    await chrome.tabs.update(tab.id!, { active: true });
    // 等待新页的正常内容脚本，必要时只补载读取握手，不重放点击。
    await pageCall(tab.id!, { type: "CONTEXT" });
    const session = await pageCall<{
      url: string;
      mode?: "page" | "detail_dialog";
    }>(tab.id!, {
      type: "CHAT_READY",
      operationId,
      target: target(item.job),
    });
    await sourceStillMatches(op);
    await db.transaction("rw", db.deliveries, db.applications, async () => {
      const latest = await db.deliveries.get(op.id);
      if (latest?.candidates.length !== 1 || latest.chatTabId !== tab.id)
        throw new Error("聊天 Tab 关联不唯一");
      await db.deliveries.update(op.id, {
        status: "chat_ready",
        chatUrl: session.url,
        chatMode: session.mode || "page",
      });
      await db.applications.update(
        applicationKey(op.accountScope, op.jobId, "conversation"),
        { status: "verified", verifiedAt: Date.now() },
      );
    });
    const result = await pageCall<SendObservation>(tab.id!, {
      type: "SEND_GREETING",
      operationId,
      target: target(item.job),
      greeting: op.text,
    });
    await recordOutcome(op, result);
    if (!result.verified)
      throw new Error("留言结果待核查，已暂停，禁止自动重发");
    // 核验完成后才关闭；失败时保留该页供用户核查。
    try {
      await closeVerifiedTab(op.id);
    } catch (error) {
      await log(
        runId,
        "close_tab",
        error instanceof Error ? error.message : "聊天页关闭失败",
        op.jobId,
      );
      throw error;
    }
    await log(
      runId,
      "sent_verified",
      "个性化招呼语已核验，已返回列表",
      op.jobId,
    );
    return { verified: true };
  } catch (error) {
    const latest = await db.deliveries.get(op.id);
    if (!latest || !["verified", "closed"].includes(latest.status)) {
      await recordOutcome(op, {
        verified: false,
        reason: error instanceof Error ? error.message : "沟通流程中断",
        chatUrl: latest?.chatUrl || "",
      });
      await db.applications.update(
        applicationKey(op.accountScope, op.jobId, "conversation"),
        { status: "uncertain" },
      );
    }
    throw error;
  }
}
