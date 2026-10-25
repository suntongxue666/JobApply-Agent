import { assertRun, db, log } from "../storage/db";
import { pageCall } from "../core/connection";
import { detailUrl } from "../adapters/boss/detail";
import type { Job, PageContext } from "../shared/schema";
export async function waitForDetailTab(
  tabId: number,
  expectedUrl: string,
  runId: string,
  epoch: number,
) {
  const expected = new URL(expectedUrl);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await assertRun(runId, epoch);
    const tab = await chrome.tabs.get(tabId);
    if (
      tab.url?.startsWith("https://www.zhipin.com/web/passport") ||
      tab.url?.includes("/verify")
    )
      throw new Error("独立详情页要求登录或验证，请自行处理");
    if (
      tab.url &&
      tab.url !== "about:blank" &&
      new URL(tab.url).origin !== expected.origin
    )
      throw new Error("独立详情页跳转到其他站点");
    if (
      tab.status === "complete" &&
      tab.url &&
      new URL(tab.url).pathname === expected.pathname
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("独立详情页加载超时，尚未点击立即沟通");
}
export async function readJobDetail(
  runId: string,
  epoch: number,
  key: string,
): Promise<Job> {
  const run = await assertRun(runId, epoch),
    item = await db.items.get(key);
  if (!item || item.runId !== runId || item.status !== "extracting")
    throw new Error("详情读取任务已失效");
  const source = await pageCall<PageContext>(run.tabId, { type: "CONTEXT" });
  if (
    source.url !== run.pageUrl ||
    source.accountScope !== run.accountScope ||
    !source.supported ||
    source.conflict
  )
    throw new Error("搜索列表或账号已改变，未打开详情");
  const url = detailUrl(item.job.url, item.job.id);
  const tab = await chrome.tabs.create({
    url,
    active: true,
    openerTabId: run.tabId,
  });
  if (tab.id === undefined) throw new Error("未能创建岗位详情 Tab");
  try {
    await waitForDetailTab(tab.id, url, runId, epoch);
    await pageCall(tab.id, { type: "CONTEXT" });
    const job = await pageCall<Job>(tab.id, {
      type: "DETAIL_PAGE",
      job: item.job,
    });
    await assertRun(runId, epoch);
    await log(
      runId,
      "detail_fallback",
      "右侧详情不可读，已从目标独立详情页读取；尚未发起沟通",
      item.job.id,
    );
    return job;
  } finally {
    // 只清理本次创建且仍停留在该岗位详情的 Tab，不关闭被用户导航走的页面。
    const current = await chrome.tabs.get(tab.id).catch(() => undefined);
    const owned =
      current?.url &&
      new URL(current.url).origin === "https://www.zhipin.com" &&
      new URL(current.url).pathname === new URL(url).pathname &&
      current.openerTabId === run.tabId;
    if (owned) await chrome.tabs.remove(tab.id);
    if (owned && current?.active)
      await chrome.tabs.update(run.tabId, { active: true });
  }
}
