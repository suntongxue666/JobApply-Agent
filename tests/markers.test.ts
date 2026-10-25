import { beforeEach, it, expect, vi, afterEach } from "vitest";
import { db, createRun, applicationKey } from "../src/storage/db";
import { jobMarkers, skipJob, isSkipped } from "../src/storage/markers";
import { defaults, type Run, type Item } from "../src/shared/schema";
import { MarkerLayer } from "../src/content/markers";
import { readFileSync } from "node:fs";
const run: Run = {
  id: crypto.randomUUID(),
  tabId: 4,
  pageUrl: "https://www.zhipin.com/web/geek/jobs",
  accountScope: "account-a",
  config: structuredClone(defaults),
  profile: {
    id: "main",
    text: "已确认的测试简历内容，仅用于测试，符合事实。",
    facts: [{ id: "a", text: "产品经验" }],
    version: "1",
    confirmed: true,
  },
  mode: "preview",
  status: "running",
  epoch: 1,
  createdAt: 1,
  heartbeat: 1,
  reason: "",
};
const item: Item = {
  key: run.id + ":job123",
  runId: run.id,
  job: {
    id: "job123",
    url: "",
    title: "产品经理",
    company: "示例科技",
    salary: "20K",
    jd: "",
    tags: "",
    type: "unknown",
    communicated: false,
  },
  status: "evaluating",
  reason: "",
  updatedAt: 1,
};
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  document.body.innerHTML = "";
});
afterEach(() => vi.restoreAllMocks());
it("跳过已排队岗位会立即改状态，且只作用于当前账号与列表", async () => {
  await createRun(run);
  await db.items.put(item);
  const result = await skipJob(
    4,
    run.accountScope,
    run.pageUrl,
    item.job.id,
    item.job.title,
  );
  expect(result.wasEvaluating).toBe(true);
  expect((await db.items.get(item.key))?.status).toBe("skipped");
  expect(await isSkipped(run.accountScope, run.pageUrl, item.job.id)).toBe(
    true,
  );
  expect(await isSkipped("other", run.pageUrl, item.job.id)).toBe(false);
  expect(
    await isSkipped(run.accountScope, run.pageUrl + "?query=x", item.job.id),
  ).toBe(false);
});
it("未启动任务也能先跳过列表上的单岗", async () => {
  await skipJob(4, run.accountScope, run.pageUrl, "job999", "实习产品经理");
  expect((await jobMarkers(run.accountScope, run.pageUrl))[0].label).toBe(
    "已跳过",
  );
});
it("仅有准备完成/待审核记录，不能显示投递成功", async () => {
  await createRun(run);
  await db.items.put({ ...item, status: "review" });
  const markers = await jobMarkers(run.accountScope, run.pageUrl);
  expect(markers[0].label).toBe("留言待审");
  expect(markers[0].status).not.toBe("sent_verified");
});
it("真实核验记录优先，未确认意图只显示待核查", async () => {
  await createRun(run);
  await db.items.put(item);
  const key = applicationKey(run.accountScope, item.job.id);
  await db.applications.put({
    key,
    runId: run.id,
    jobId: item.job.id,
    accountScope: run.accountScope,
    action: "greeting",
    status: "intent",
    text: "测试",
    createdAt: 1,
  });
  expect((await jobMarkers(run.accountScope, run.pageUrl))[0].label).toContain(
    "待核查",
  );
  await db.applications.update(key, { status: "verified" });
  expect((await jobMarkers(run.accountScope, run.pageUrl))[0].label).toBe(
    "投递已完成",
  );
  expect((await jobMarkers(run.accountScope, run.pageUrl))[0].canSkip).toBe(
    false,
  );
});
it("已经发送或结果不确定的岗位不能撤销成跳过", async () => {
  await createRun(run);
  await db.items.put({ ...item, status: "uncertain" });
  await expect(
    skipJob(4, run.accountScope, run.pageUrl, item.job.id, item.job.title),
  ).rejects.toThrow("不能撤销");
});
it("状态浮层渲染、跳过点击不冒泡到 BOSS 卡片，重复挂载不累积", async () => {
  document.body.innerHTML = readFileSync(
    "tests/fixtures/boss-list.html",
    "utf8",
  );
  const card = document.querySelector(".job-card-box")!,
    bubbled = vi.fn(),
    skip = vi.fn().mockResolvedValue(undefined);
  card.addEventListener("click", bubbled);
  const layer = new MarkerLayer(skip);
  layer.update([
    {
      jobId: "testjob001",
      status: "extracting",
      label: "正在读取 JD",
      reason: "",
      canSkip: true,
    },
  ]);
  layer.render();
  expect(card.querySelectorAll(".jobapply-marker-host")).toHaveLength(1);
  const root = card.querySelector(".jobapply-marker-host")!.shadowRoot!;
  expect(root.textContent).toContain("正在读取 JD");
  root.querySelector("button")!.click();
  await Promise.resolve();
  expect(skip).toHaveBeenCalledWith("testjob001", "AI 产品经理");
  expect(bubbled).not.toHaveBeenCalled();
  layer.dispose();
  expect(card.querySelector(".jobapply-marker-host")).toBeNull();
});
it("清除扩展重载残留的四个旧浮层，每个职位只保留一个", () => {
  document.body.innerHTML = readFileSync(
    "tests/fixtures/boss-list.html",
    "utf8",
  );
  const card = document.querySelector(".job-card-box")!;
  for (let i = 0; i < 4; i++)
    card.insertAdjacentHTML(
      "beforeend",
      '<div class="jobapply-marker-host">未处理</div>',
    );
  const layer = new MarkerLayer(async () => {});
  layer.render();
  expect(card.querySelectorAll(".jobapply-marker-host")).toHaveLength(1);
  layer.dispose();
});
it("四个活动实例争用时仅最新实例绘制，旧实例不会再次追加", () => {
  document.body.innerHTML = readFileSync(
    "tests/fixtures/boss-list.html",
    "utf8",
  );
  const layers = Array.from(
    { length: 4 },
    () => new MarkerLayer(async () => {}),
  );
  for (const layer of layers) layer.render();
  for (const card of document.querySelectorAll(".job-card-box"))
    expect(card.querySelectorAll(".jobapply-marker-host")).toHaveLength(1);
  for (const layer of layers) layer.dispose();
});
it("虚拟列表克隆节点和标识被移除后，重新挂载仍只生成一份", () => {
  document.body.innerHTML = readFileSync(
    "tests/fixtures/boss-list.html",
    "utf8",
  );
  const layer = new MarkerLayer(async () => {});
  const card = document.querySelector(".job-card-box")!;
  const clone = card.cloneNode(true) as HTMLElement;
  document.querySelector("ul")!.append(clone);
  layer.render();
  expect(clone.querySelectorAll(".jobapply-marker-host")).toHaveLength(1);
  card.querySelector(".jobapply-marker-host")!.remove();
  layer.render();
  expect(card.querySelectorAll(".jobapply-marker-host")).toHaveLength(1);
  layer.dispose();
});
it("同一搜索的分页共享跳过状态，不扩散到其他搜索", async () => {
  const first = run.pageUrl + "?query=AI&page=1",
    second = run.pageUrl + "?page=2&query=AI";
  await skipJob(4, run.accountScope, first, "job999", "产品经理");
  expect(await isSkipped(run.accountScope, second, "job999")).toBe(true);
  expect(
    (await jobMarkers(run.accountScope, second)).some(
      (m) => m.jobId === "job999",
    ),
  ).toBe(true);
  expect(
    await isSkipped(
      run.accountScope,
      run.pageUrl + "?query=Java&page=2",
      "job999",
    ),
  ).toBe(false);
});
