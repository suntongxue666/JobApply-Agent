import type { Evaluation, Item, Job, PageContext, Run } from "../shared/schema";
import { rpc } from "../shared/schema";
import {
  applicationKey,
  assertRun,
  cancelRun,
  createRun,
  db,
  getConfig,
  log,
  resumeRun,
} from "../storage/db";
import { filterJob } from "./rules";
import { endpoint } from "../ai/provider";
import { sameSearchScope, type LoadMoreResult } from "../shared/search-scope";
import { isSkipped } from "../storage/markers";

import { pageCall, currentPage } from "./connection";
export { pageCall, currentPage } from "./connection";
export async function startRun(
  tabId: number,
  context: PageContext,
  autoLoop?: boolean,
): Promise<Run> {
  if (!context.supported || context.reason)
    throw new Error(context.reason || "不支持当前页面");
  if (context.conflict)
    throw new Error("请先停用其他 Boss Agent 扩展并刷新页面，避免同时操作");
  if (!context.accountScope)
    throw new Error("无法可靠识别账号，请重新登录后刷新");
  const config = await getConfig(),
    profile = await db.profiles.get("main");
  if (!profile?.confirmed || !profile.facts.length)
    throw new Error("请先在设置中确认简历事实");
  if (config.consentOrigin !== endpoint(config.baseUrl).origin)
    throw new Error("请在设置中确认模型数据去向");
  if (!config.greetingConfirmed || !config.greeting.trim())
    throw new Error("请先在设置中保存招呼语偏好");
  const run: Run = {
    id: crypto.randomUUID(),
    tabId,
    pageUrl: context.url,
    accountScope: context.accountScope,
    config: { ...config, autoLoop: autoLoop ?? config.autoLoop },
    profile,
    mode: "auto",
    status: "running",
    epoch: 1,
    createdAt: Date.now(),
    heartbeat: Date.now(),
    reason: "",
  };
  await createRun(run);
  await log(run.id, "start", "开始按用户规则自动发送个性化招呼语");
  return run;
}
export async function stopRun(
  run: Run,
  status: "paused" | "stopped" = "paused",
) {
  await cancelRun(
    run.id,
    status,
    status === "paused" ? "用户暂停" : "用户停止",
  );
  await Promise.allSettled([
    rpc({ type: "CANCEL", runId: run.id }),
    pageCall(run.tabId, { type: "ABORT" }),
  ]);
}
export async function checkPage(run: Run) {
  await assertRun(run.id, run.epoch);
  const page = await pageCall<PageContext>(run.tabId, { type: "CONTEXT" });
  if (
    !page.supported ||
    page.url !== run.pageUrl ||
    page.accountScope !== run.accountScope ||
    page.conflict
  )
    throw new Error(
      page.conflict
        ? "检测到其他自动化扩展，请停用后再试"
        : "页面、搜索条件或账号发生变化，请检查后继续",
    );
  // 不在后台标签页操作，避免用户误切会话。
  const tab = await chrome.tabs.get(run.tabId);
  if (!tab.active) throw new Error("目标标签页不在前台，任务已暂停");
}
async function guardedUpdate(run: Run, key: string, changes: Partial<Item>) {
  await db.transaction("rw", db.runs, db.locks, db.items, async () => {
    await assertRun(run.id, run.epoch);
    const item = await db.items.get(key);
    if (item?.status === "skipped") return;
    await db.items.update(key, { ...changes, updatedAt: Date.now() });
  });
}
async function skipIfNeeded(run: Run, key: string, jobId: string) {
  if (await isSkipped(run.accountScope, run.pageUrl, jobId)) {
    await guardedUpdate(run, key, {
      status: "skipped",
      reason: "用户跳过此岗位",
    });
    return true;
  }
  return false;
}
export async function waitForDeliverySlot(
  run: Run,
  onChange: () => void = () => {},
) {
  let lastHeartbeat = 0;
  while (true) {
    const current = await assertRun(run.id, run.epoch);
    const remaining = (current.nextDeliveryAt || 0) - Date.now();
    if (remaining <= 0) return;
    if (Date.now() - lastHeartbeat >= 1000) {
      await checkPage(run);
      await db.runs.update(run.id, { heartbeat: Date.now() });
      lastHeartbeat = Date.now();
      onChange();
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(250, remaining)),
    );
  }
}
export async function processItem(
  run: Run,
  item: Item,
  onChange: () => void = () => {},
) {
  await checkPage(run);
  if (await skipIfNeeded(run, item.key, item.job.id)) return;
  const blocked = !!(await db.blocks.get(item.job.id));
  const duplicate = await db.applications.get(
    applicationKey(run.accountScope, item.job.id),
  );
  if (duplicate) {
    await guardedUpdate(run, item.key, {
      status: "filtered_out",
      reason: "已有留言记录或待核查意图",
    });
    return;
  }
  const early = filterJob(
    item.job,
    {
      ...run.config.filters,
      jobType: "any",
      salaryMin: 0,
      salaryMax: 0,
      exclude:
        run.config.filters.excludeScope === "jd" ||
        run.config.filters.excludeScope === "all"
          ? []
          : run.config.filters.exclude,
    },
    blocked,
  );
  if (early.decision === "reject") {
    await guardedUpdate(run, item.key, {
      status: "filtered_out",
      reason: early.reasons.join("；"),
    });
    return;
  }
  await waitForDeliverySlot(run, onChange);
  await checkPage(run);
  if (await skipIfNeeded(run, item.key, item.job.id)) return;
  await guardedUpdate(run, item.key, { status: "extracting", reason: "" });
  let job: Job;
  try {
    job = await pageCall<Job>(run.tabId, {
      type: "DETAIL",
      job: item.job,
      url: run.pageUrl,
      requestId: crypto.randomUUID(),
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("DETAIL_TIMEOUT:")
    )
      throw error;
    await assertRun(run.id, run.epoch);
    if (await skipIfNeeded(run, item.key, item.job.id)) return;
    job = await rpc<Job>({
      type: "READ_JOB_DETAIL",
      runId: run.id,
      epoch: run.epoch,
      key: item.key,
    });
  }
  await checkPage(run);
  if (job.id !== item.job.id)
    throw new Error("详情返回的岗位 ID 不一致，已暂停");
  if (await skipIfNeeded(run, item.key, item.job.id)) return;
  const verdict = filterJob(
    job,
    run.config.filters,
    !!(await db.blocks.get(job.id)),
  );
  await guardedUpdate(run, item.key, {
    job,
    status: verdict.decision === "reject" ? "filtered_out" : "evaluating",
    reason: verdict.reasons.join("；"),
  });
  if (verdict.decision === "reject") return;
  const evaluation = await rpc<Evaluation>({
    type: "EVALUATE",
    runId: run.id,
    key: item.key,
    epoch: run.epoch,
  });
  await checkPage(run);
  if (await skipIfNeeded(run, item.key, item.job.id)) return;
  // AI 分数、匹配决定与 gaps 只作展示，不参与投递资格判断。
  await guardedUpdate(run, item.key, {
    evaluation,
    status: "ready",
    reason: verdict.reasons.join("；"),
  });
  await log(
    run.id,
    "greeting_ready",
    "个性化招呼语已生成；AI 分数不影响投递",
    job.id,
  );
  if (await skipIfNeeded(run, item.key, item.job.id)) return;
  const prepared = await rpc<{ operationId: string }>({
    type: "PREPARE_DELIVERY",
    runId: run.id,
    epoch: run.epoch,
    key: item.key,
  });
  await rpc({
    type: "DELIVER",
    runId: run.id,
    epoch: run.epoch,
    operationId: prepared.operationId,
  });
}
export async function adoptListPage(
  run: Run,
  expectedScopeUrl: string,
): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await assertRun(run.id, run.epoch);
    const tab = await chrome.tabs.get(run.tabId);
    if (!tab.active) throw new Error("列表 Tab 已切换到后台，停止加载更多");
    if (tab.url && !sameSearchScope(tab.url, expectedScopeUrl))
      throw new Error("翻页时搜索条件或页面地址已改变");
    if (!tab.status || tab.status === "complete") {
      const page = await pageCall<PageContext>(run.tabId, { type: "CONTEXT" });
      if (
        !sameSearchScope(page.url, expectedScopeUrl) ||
        page.conflict ||
        (page.accountScope && page.accountScope !== run.accountScope)
      )
        throw new Error("翻页时搜索条件、账号或自动化环境已改变");
      if (/验证|受限|频繁/.test(page.reason || ""))
        throw new Error(page.reason);
      if (
        page.supported &&
        !page.reason &&
        page.accountScope === run.accountScope
      ) {
        await db.transaction("rw", db.runs, db.locks, async () => {
          await assertRun(run.id, run.epoch);
          await db.runs.update(run.id, {
            pageUrl: page.url,
            heartbeat: Date.now(),
          });
        });
        run.pageUrl = page.url;
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("加载下一页超时，请检查职位列表后继续");
}
export async function execute(run: Run, onChange: () => void): Promise<void> {
  let emptyLoads = 0,
    completionReason = "本轮投递结束；只统计已核验的个性化招呼语";
  try {
    while (true) {
      await checkPage(run);
      await db.runs.update(run.id, { heartbeat: Date.now() });
      let items = await db.items.where("runId").equals(run.id).toArray();
      if (items.length < run.config.limit) {
        const visible = await pageCall<Job[]>(run.tabId, { type: "LIST" });
        const known = new Set(items.map((i) => i.job.id));
        const fresh = visible
          .filter((j) => !known.has(j.id))
          .slice(0, run.config.limit - items.length);
        if (fresh.length) {
          await db.transaction("rw", db.items, db.runs, db.locks, async () => {
            await assertRun(run.id, run.epoch);
            await db.items.bulkPut(
              fresh.map((job, index) => ({
                order: items.length + index,
                key: `${run.id}:${job.id}`,
                runId: run.id,
                job,
                status: "discovered" as const,
                reason: "",
                updatedAt: Date.now(),
              })),
            );
          });
          emptyLoads = 0;
          items = await db.items.where("runId").equals(run.id).toArray();
        }
      }
      items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const next = items.find((i) => i.status === "discovered");
      if (!next) {
        if (items.length >= run.config.limit) {
          completionReason = `已达到本轮 ${run.config.limit} 个岗位上限；可在执行设置保存更大的上限后点击继续`;
          break;
        }
        if (emptyLoads >= 3) {
          completionReason = "连续加载后未再发现新岗位，本轮结束";
          break;
        }
        await log(run.id, "loading_more", "当前批次已处理，正在滚动加载或翻页");
        let loaded: LoadMoreResult | null;
        try {
          loaded = await pageCall<LoadMoreResult>(run.tabId, {
            type: "LOAD_MORE",
            url: run.pageUrl,
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith("BOSS 页面操作中断")
          )
            throw error;
          // 页面按钮可能触发整页刷新；只恢复同一搜索范围的只读握手，不重放翻页动作。
          await adoptListPage(run, run.pageUrl);
          loaded = { action: "next_page", changed: true, url: run.pageUrl };
        }
        if (loaded?.action === "end") {
          completionReason = loaded.reason || "职位列表已到末页";
          break;
        }
        if (loaded?.action === "navigate") {
          if (!sameSearchScope(loaded.url, run.pageUrl))
            throw new Error("下一页链接改变了搜索条件，未导航");
          await checkPage(run);
          const scopeUrl = run.pageUrl;
          await chrome.tabs.update(run.tabId, {
            url: loaded.url,
            active: true,
          });
          await adoptListPage(run, scopeUrl);
        } else await adoptListPage(run, run.pageUrl);
        emptyLoads++;
        onChange();
        continue;
      }
      try {
        await processItem(run, next, onChange);
      } catch (e) {
        await assertRun(run.id, run.epoch);
        if (await skipIfNeeded(run, next.key, next.job.id)) {
          onChange();
          continue;
        }
        const latest = await db.items.get(next.key);
        if (latest && ["uncertain", "sent_verified"].includes(latest.status))
          throw e;
        await guardedUpdate(run, next.key, {
          status: "failed",
          reason: e instanceof Error ? e.message : "处理失败",
        });
        throw e; // 首个结构、模型或上下文错误即暂停，避免连续错误请求。
      }
      onChange();
      if (!run.config.autoLoop) {
        await cancelRun(
          run.id,
          "paused",
          "本岗已处理；自动循环已关闭，点击继续处理下一岗",
        );
        return;
      }
    }
    await cancelRun(run.id, "completed", completionReason);
  } catch (e) {
    const current = await db.runs.get(run.id);
    if (current?.status === "running" && current.epoch === run.epoch)
      await cancelRun(
        run.id,
        "paused",
        e instanceof Error ? e.message : "任务中断",
      );
  } finally {
    onChange();
  }
}
export async function continueRun(id: string) {
  const old = await db.runs.get(id);
  if (!old) throw new Error("任务不存在");
  if (old.mode !== "auto")
    throw new Error("旧任务仅授权分析，请重新开始任务并确认发送个性化招呼语");
  const page = await pageCall<PageContext>(old.tabId, { type: "CONTEXT" });
  if (page.url !== old.pageUrl || page.accountScope !== old.accountScope)
    throw new Error("请恢复任务原来的列表和账号，或停止后新建任务");
  const config = await getConfig();
  return resumeRun(id, config.limit);
}
