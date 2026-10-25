import { beforeEach, describe, it, expect } from "vitest";
import {
  db,
  createRun,
  assertRun,
  cancelRun,
  resumeRun,
  claimSend,
  exportRecords,
} from "../src/storage/db";
import {
  defaults,
  credentialFor,
  type Run,
  type Item,
} from "../src/shared/schema";
const makeRun = (id = crypto.randomUUID()): Run => ({
  id,
  tabId: 1,
  pageUrl: "https://www.zhipin.com/web/geek/jobs",
  accountScope: "account-a",
  config: structuredClone(defaults),
  profile: {
    id: "main",
    facts: [{ id: "fact_1", text: "private resume" }],
    text: "private resume",
    version: "1",
    confirmed: true,
  },
  mode: "preview",
  status: "running",
  epoch: 1,
  createdAt: Date.now(),
  heartbeat: Date.now(),
  reason: "",
});
const makeItem = (run: Run): Item => ({
  key: `${run.id}:job123`,
  runId: run.id,
  job: {
    id: "job123",
    url: "https://www.zhipin.com/job_detail/job123.html",
    title: "测试产品经理",
    company: "测试公司",
    salary: "20-30K",
    tags: "",
    jd: "test JD",
    type: "unknown",
    communicated: false,
  },
  status: "review",
  approved: true,
  reason: "",
  updatedAt: Date.now(),
  evaluation: {
    decision: "pass",
    score: 90,
    matchedEvidenceIds: ["fact_1"],
    strengths: [],
    gaps: [],
    greeting: "测试留言",
  },
});
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
describe("任务锁、发送意图与恢复", () => {
  it("两个面板同时创建任务，只能一个获得执行锁", async () => {
    const results = await Promise.allSettled([
      createRun(makeRun()),
      createRun(makeRun()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.runs.count()).toBe(1);
  });
  it("暂停持久化 epoch，旧执行器即使还活着也不能继续", async () => {
    const run = makeRun();
    await createRun(run);
    await cancelRun(run.id, "paused", "test");
    await expect(assertRun(run.id, run.epoch)).rejects.toThrow();
    const resumed = await resumeRun(run.id);
    expect(resumed.epoch).toBeGreaterThan(run.epoch);
    await expect(assertRun(run.id, run.epoch)).rejects.toThrow();
    expect((await assertRun(resumed.id, resumed.epoch)).status).toBe("running");
  });
  it("并发发送领取唯一，文案变更不能绕过去重", async () => {
    const run = makeRun();
    await createRun(run);
    const item = makeItem(run);
    await db.items.put(item);
    const results = await Promise.allSettled([
      claimSend(run.id, 1, item.key, "greeting"),
      claimSend(run.id, 1, item.key, "greeting"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.applications.count()).toBe(1);
    await db.items.update(item.key, {
      status: "review",
      evaluation: { ...item.evaluation!, greeting: "重新生成" },
    });
    await expect(claimSend(run.id, 1, item.key, "greeting")).rejects.toThrow(
      "禁止重复",
    );
  });
  it("点击后中断记录 uncertain，恢复任务不重置发送意图", async () => {
    const run = makeRun();
    await createRun(run);
    const item = makeItem(run);
    await db.items.put(item);
    await claimSend(run.id, 1, item.key, "greeting");
    await cancelRun(run.id, "paused", "模拟中断");
    expect((await db.items.get(item.key))?.status).toBe("uncertain");
    expect((await db.applications.toArray())[0].status).toBe("uncertain");
    await resumeRun(run.id);
    expect((await db.items.get(item.key))?.status).toBe("uncertain");
  });
  it("开聊与留言作为独立动作记录", async () => {
    const run = makeRun();
    await createRun(run);
    const item = makeItem(run);
    await db.items.put(item);
    await claimSend(run.id, 1, item.key, "conversation");
    expect((await db.applications.toArray())[0].action).toBe("conversation");
    expect((await db.items.get(item.key))?.status).toBe("opening_chat");
  });
  it("未审核留言不可领取，停止任务不可领取", async () => {
    const run = makeRun();
    await createRun(run);
    const item = makeItem(run);
    item.approved = false;
    await db.items.put(item);
    await expect(claimSend(run.id, 1, item.key, "greeting")).rejects.toThrow(
      "先审核",
    );
    await cancelRun(run.id, "stopped", "test");
    await expect(
      claimSend(run.id, 1, item.key, "conversation"),
    ).rejects.toThrow();
  });
  it("导出任务摘要不携带完整简历", async () => {
    const run = makeRun();
    await createRun(run);
    const data = await exportRecords();
    expect(JSON.stringify(data)).not.toContain("private resume");
  });
});
it("密钥绑定模型 origin，不能随配置变化泄露给新服务", () => {
  const credential = { value: "secret", origin: "https://a.example" };
  expect(credentialFor(credential, "https://a.example")).toBe("secret");
  expect(credentialFor(credential, "https://b.example")).toBe("");
  expect(credentialFor("legacy-key", "https://a.example")).toBe("");
});
it("旧版配置升级后保留规则，补齐循环和标题屏蔽默认值，并固定 DeepSeek", async () => {
  const { getConfig } = await import("../src/storage/db");
  await db.config.put({
    id: "main",
    value: {
      ...structuredClone(defaults),
      baseUrl: "https://old.example/v1",
      model: "old-model",
      greeting: "用户已保存的独特招呼语",
      version: "old-version",
      filters: { ...defaults.filters, companies: ["示例公司"] },
    },
  });
  const c = await getConfig();
  expect(c.baseUrl).toBe("https://api.deepseek.com");
  expect(c.model).toBe("deepseek-flash");
  expect(c.filters.companies).toEqual(["示例公司"]);
  expect(c.filters.excludeTitles).toEqual([]);
  expect(c.autoLoop).toBe(true);
});
it("默认100并迁移旧版默认10，但保留用户明确设置的上限", async () => {
  const { getConfig } = await import("../src/storage/db");
  await db.config.put({
    id: "main",
    value: { ...defaults, limit: 10, limitConfigured: false },
  });
  expect((await getConfig()).limit).toBe(100);
  await db.config.put({
    id: "main",
    value: { ...defaults, limit: 10, limitConfigured: true },
  });
  expect((await getConfig()).limit).toBe(10);
  await db.config.put({
    id: "main",
    value: { ...defaults, limit: 25, limitConfigured: false },
  });
  expect((await getConfig()).limit).toBe(25);
});

it("继续时拒绝低于已入队数量的上限，待处理岗位不越过新上限", async () => {
  const run = makeRun();
  await createRun(run);
  const item = { ...makeItem(run), status: "discovered" as const };
  await db.items.bulkPut([
    item,
    { ...item, key: `${run.id}:second`, job: { ...item.job, id: "second" } },
  ]);
  await cancelRun(run.id, "paused", "test");
  await expect(resumeRun(run.id, 1)).rejects.toThrow("保存更大的上限");
  expect((await db.runs.get(run.id))?.status).toBe("paused");
  expect(await db.locks.get("executor")).toBeUndefined();
});
