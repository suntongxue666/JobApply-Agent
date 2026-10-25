import { sameSearchScope, searchScopeUrl } from "../shared/search-scope";
import { db } from "./db";
import { labels, type JobMarker } from "../shared/schema";
export function skipKey(scope: string, pageUrl: string, jobId: string) {
  return JSON.stringify([scope, searchScopeUrl(pageUrl), jobId]);
}
export async function isSkipped(scope: string, pageUrl: string, jobId: string) {
  return (
    !!(await db.skips.get(skipKey(scope, pageUrl, jobId))) ||
    !!(await db.skips
      .where("accountScope")
      .equals(scope)
      .filter(
        (skip) =>
          skip.jobId === jobId && sameSearchScope(skip.pageUrl, pageUrl),
      )
      .first())
  );
}
export async function skipJob(
  tabId: number,
  accountScope: string,
  pageUrl: string,
  jobId: string,
  label: string,
) {
  return db.transaction("rw", db.runs, db.items, db.skips, async () => {
    const run = (await db.runs.toArray())
      .filter(
        (r) =>
          r.tabId === tabId &&
          r.accountScope === accountScope &&
          sameSearchScope(r.pageUrl, pageUrl),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const item = run ? await db.items.get(`${run.id}:${jobId}`) : undefined;
    if (
      item &&
      ["sending", "opening_chat", "sent_verified", "uncertain"].includes(
        item.status,
      )
    )
      throw new Error("该岗位已触发沟通或等待核查，不能撤销为跳过");
    await db.skips.put({
      key: skipKey(accountScope, pageUrl, jobId),
      accountScope,
      pageUrl: searchScopeUrl(pageUrl),
      jobId,
      label,
      createdAt: Date.now(),
    });
    if (item)
      await db.items.update(item.key, {
        status: "skipped",
        reason: "用户跳过此岗位",
        updatedAt: Date.now(),
      });
    return { runId: run?.id, wasEvaluating: item?.status === "evaluating" };
  });
}
export async function jobMarkers(
  accountScope: string,
  pageUrl: string,
): Promise<JobMarker[]> {
  const runs = (await db.runs.toArray())
    .filter(
      (r) =>
        r.accountScope === accountScope && sameSearchScope(r.pageUrl, pageUrl),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const map = new Map<string, JobMarker>();
  for (const run of runs)
    for (const item of await db.items.where("runId").equals(run.id).toArray())
      map.set(item.job.id, {
        jobId: item.job.id,
        status: item.status,
        label: labels[item.status],
        reason: item.reason,
        canSkip: ![
          "opening_chat",
          "sending",
          "sent_verified",
          "uncertain",
          "skipped",
        ].includes(item.status),
      });
  for (const skip of await db.skips
    .where("accountScope")
    .equals(accountScope)
    .filter((skip) => sameSearchScope(skip.pageUrl, pageUrl))
    .toArray())
    map.set(skip.jobId, {
      jobId: skip.jobId,
      status: "skipped",
      label: "已跳过",
      reason: "用户跳过此岗位",
      canSkip: false,
    });
  // 真实核验通过的外发记录拥有最高优先级，不会被“分析完成”覆盖。
  for (const app of await db.applications
    .where("accountScope")
    .equals(accountScope)
    .toArray()) {
    if (app.action !== "greeting") continue;
    map.set(app.jobId, {
      jobId: app.jobId,
      status: app.status === "verified" ? "sent_verified" : "uncertain",
      label: app.status === "verified" ? "投递已完成" : "投递结果待核查",
      reason:
        app.status === "verified"
          ? "个性化留言已在目标会话核验"
          : "禁止自动重发，请核查目标会话",
      canSkip: false,
    });
  }
  return [...map.values()];
}
