import { beforeEach, it, expect, vi, afterEach } from "vitest";
import { continueRun, execute, startRun } from "../src/core/engine";
import { cancelRun, db, applicationKey } from "../src/storage/db";
import {
  defaults,
  type Evaluation,
  type Job,
  type PageContext,
} from "../src/shared/schema";
const page: PageContext = {
  url: "https://www.zhipin.com/web/geek/jobs?query=AI",
  accountScope: "test-account",
  accountLabel: "测试用户",
  supported: true,
  reason: "",
  conflict: false,
};
const job: Job = {
  id: "job12345",
  url: "https://www.zhipin.com/job_detail/job12345.html",
  title: "AI产品经理",
  company: "示例科技",
  salary: "20-30K",
  tags: "",
  jd: "",
  type: "unknown",
  communicated: false,
};
const evaluation: Evaluation = {
  decision: "pass",
  score: 90,
  matchedEvidenceIds: ["fact_1"],
  strengths: ["相关经验"],
  gaps: [],
  greeting: "测试留言",
};
let pageHandler: ReturnType<typeof vi.fn>,
  modelHandler: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await db.config.put({
    id: "main",
    value: {
      ...defaults,
      limit: 1,
      greetingConfirmed: true,
      consentOrigin: "https://api.deepseek.com",
    },
  });
  await db.profiles.put({
    id: "main",
    text: "测试事实",
    facts: [{ id: "fact_1", text: "测试事实" }],
    version: "1",
    confirmed: true,
  });
  pageHandler = vi.fn(async (_tabId: number, msg: { type: string }) => ({
    ok: true,
    data:
      msg.type === "CONTEXT"
        ? page
        : msg.type === "LIST"
          ? [job]
          : msg.type === "DETAIL"
            ? {
                ...job,
                jd: "负责产品需求分析、产品方案设计、原型设计、上线验证与迭代优化，并与开发和设计协作。",
              }
            : null,
  }));
  modelHandler = vi.fn(async () => ({ ok: true, data: evaluation }));
  vi.stubGlobal("chrome", {
    tabs: { sendMessage: pageHandler, get: async () => ({ active: true }) },
    runtime: {
      sendMessage: async (msg: {
        type: string;
        key: string;
        runId: string;
        operationId: string;
      }) => {
        if (msg.type === "EVALUATE") return modelHandler(msg);
        if (msg.type === "PREPARE_DELIVERY")
          return { ok: true, data: { operationId: msg.key } };
        if (msg.type === "DELIVER") {
          const current = await db.items.get(msg.operationId);
          if (!current) throw new Error("missing");
          await db.items.update(current.key, { status: "sent_verified" });
          await db.applications.put({
            key: applicationKey(page.accountScope, current.job.id),
            runId: msg.runId,
            jobId: current.job.id,
            accountScope: page.accountScope,
            action: "greeting",
            status: "verified",
            text: current.evaluation!.greeting,
            createdAt: Date.now(),
          });
          return { ok: true, data: { verified: true } };
        }
        return { ok: true, data: null };
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("列表经 AI 生成后交给投递流程，记录核验状态", async () => {
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect((await db.runs.get(run.id))?.status).toBe("completed");
  expect((await db.items.toArray())[0].status).toBe("sent_verified");
  expect(await db.applications.count()).toBe(1);
  expect(modelHandler).toHaveBeenCalledTimes(1);
  expect(
    pageHandler.mock.calls.some(
      ([, m]) => !["CONTEXT", "LIST", "DETAIL"].includes(m.type),
    ),
  ).toBe(false);
});
it("硬排除岗位不读取详情、不花费模型调用", async () => {
  const conf = (await db.config.get("main"))!;
  conf.value.filters.companies = ["示例"];
  await db.config.put(conf);
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect((await db.items.toArray())[0].status).toBe("filtered_out");
  expect(modelHandler).not.toHaveBeenCalled();
  expect(pageHandler.mock.calls.some(([, m]) => m.type === "DETAIL")).toBe(
    false,
  );
});
it("模型故障即暂停并保存原因；不会重复请求", async () => {
  modelHandler.mockResolvedValue({ ok: false, error: "模型配额不足" });
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect((await db.runs.get(run.id))?.status).toBe("paused");
  expect((await db.items.toArray())[0].reason).toContain("配额不足");
  expect(modelHandler).toHaveBeenCalledTimes(1);
});
it("取消期间的迟到模型结果不能把岗位重新写成待发送", async () => {
  const run = await startRun(1, page);
  modelHandler.mockImplementation(async () => {
    await cancelRun(run.id, "paused", "用户取消");
    return { ok: true, data: evaluation };
  });
  await execute(run, () => {});
  expect((await db.items.toArray())[0].status).toBe("discovered");
  expect((await db.runs.get(run.id))?.status).toBe("paused");
});
it("切换账号或离开列表时暂停，不读取目标岗位", async () => {
  const run = await startRun(1, page);
  pageHandler.mockResolvedValue({
    ok: true,
    data: { ...page, accountScope: "other-account" },
  });
  await execute(run, () => {});
  expect((await db.runs.get(run.id))?.status).toBe("paused");
  expect(await db.items.count()).toBe(0);
  expect(modelHandler).not.toHaveBeenCalled();
});
it("匹配分数下限不再影响是否投递", async () => {
  modelHandler.mockResolvedValue({
    ok: true,
    data: { ...evaluation, score: 30 },
  });
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect((await db.items.toArray())[0].status).toBe("sent_verified");
});
it("关闭自动循环时只处理一岗并暂停，默认开启则继续队列", async () => {
  const c = (await db.config.get("main"))!;
  c.value.limit = 2;
  await db.config.put(c);
  pageHandler.mockImplementation(
    async (_id: number, msg: { type: string }) => ({
      ok: true,
      data:
        msg.type === "CONTEXT"
          ? page
          : msg.type === "LIST"
            ? [job, { ...job, id: "job99999" }]
            : msg.type === "DETAIL"
              ? {
                  ...job,
                  jd: "负责产品需求分析、产品方案设计、原型设计、上线验证与迭代优化，并与开发和设计协作。",
                }
              : null,
    }),
  );
  const run = await startRun(1, page, false);
  await execute(run, () => {});
  expect((await db.runs.get(run.id))?.status).toBe("paused");
  expect(modelHandler).toHaveBeenCalledTimes(1);
  expect(
    (await db.items.toArray()).filter((i) => i.status === "discovered"),
  ).toHaveLength(1);
});
it("AI 中途跳过只跳过当前岗，迟到结果不覆盖；下一岗继续", async () => {
  const { skipJob } = await import("../src/storage/markers");
  const run = await startRun(1, page);
  modelHandler.mockImplementation(async () => {
    await skipJob(1, run.accountScope, run.pageUrl, job.id, job.title);
    return { ok: true, data: evaluation };
  });
  await execute(run, () => {});
  expect((await db.items.toArray())[0].status).toBe("skipped");
  expect((await db.runs.get(run.id))?.status).toBe("completed");
});
it("仅右侧详情超时才回退独立详情读取，成功后继续本岗投递", async () => {
  const original = pageHandler.getMockImplementation()!;
  pageHandler.mockImplementation(async (id, msg) =>
    msg.type === "DETAIL"
      ? { ok: false, error: "DETAIL_TIMEOUT: 右侧详情读取超时" }
      : original(id, msg),
  );
  const originalRpc = chrome.runtime.sendMessage;
  const calls: string[] = [];
  Object.assign(chrome.runtime, {
    sendMessage: async (msg: { type: string }) => {
      calls.push(msg.type);
      if (msg.type === "READ_JOB_DETAIL")
        return {
          ok: true,
          data: {
            ...job,
            openInDetail: true,
            jd: "负责产品需求分析、产品方案设计、原型设计、上线验证与迭代优化，并与开发和设计协作。",
          },
        };
      return originalRpc(msg);
    },
  });
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect(calls).toContain("READ_JOB_DETAIL");
  expect(calls).toContain("DELIVER");
  expect((await db.items.toArray())[0].status).toBe("sent_verified");
});
it("平台验证和取消不触发独立页回退，不绕过失败原因", async () => {
  const original = pageHandler.getMockImplementation()!;
  pageHandler.mockImplementation(async (id, msg) =>
    msg.type === "DETAIL"
      ? { ok: false, error: "平台验证或访问限制，任务暂停" }
      : original(id, msg),
  );
  const rpc = vi.spyOn(chrome.runtime, "sendMessage");
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect((await db.runs.get(run.id))?.reason).toContain("平台验证");
  expect(rpc).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "READ_JOB_DETAIL" }),
  );
});
it("处理完首批10个职位后自动翻页、合并新职位并去重，末页正确结束", async () => {
  const c = (await db.config.get("main"))!;
  c.value.limit = 30;
  c.value.limitConfigured = true;
  c.value.filters.companies = ["示例"];
  await db.config.put(c);
  let currentUrl = page.url;
  let pageNumber = 1;
  const batch = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...job,
      id: "pagedJob" + (start + i),
    }));
  pageHandler.mockImplementation(async (_id, msg) => ({
    ok: true,
    data:
      msg.type === "CONTEXT"
        ? { ...page, url: currentUrl }
        : msg.type === "LIST"
          ? pageNumber === 1
            ? batch(0, 10)
            : [...batch(10, 3), batch(0, 1)[0]]
          : msg.type === "LOAD_MORE"
            ? pageNumber === 1
              ? {
                  action: "navigate",
                  url: page.url + "&page=2",
                  changed: false,
                }
              : {
                  action: "end",
                  url: currentUrl,
                  changed: false,
                  reason: "末页",
                }
            : null,
  }));
  Object.assign(chrome.tabs, {
    get: async () => ({ active: true, url: currentUrl, status: "complete" }),
    update: vi.fn(async (_id: number, options: { url: string }) => {
      currentUrl = options.url;
      pageNumber = 2;
      return { id: 1, url: currentUrl };
    }),
  });
  const run = await startRun(1, page);
  await execute(run, () => {});
  expect(await db.items.count()).toBe(13);
  expect((await db.runs.get(run.id))?.status).toBe("completed");
  expect((await db.runs.get(run.id))?.pageUrl).toContain("page=2");
  expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
  expect(modelHandler).not.toHaveBeenCalled();
});

it("新任务读取已保存的上限，未自定义时默认为100", async () => {
  const c = (await db.config.get("main"))!;
  c.value.limit = defaults.limit;
  await db.config.put(c);
  expect((await startRun(1, page)).config.limit).toBe(100);
});
it.each([25, 100])(
  "旧10岗任务保存上限%d后继续生效，保留配置与去重记录",
  async (limit) => {
    const c = (await db.config.get("main"))!;
    c.value.limit = 10;
    c.value.limitConfigured = true;
    c.value.filters.companies = ["示例"];
    await db.config.put(c);
    const batch = Array.from({ length: 13 }, (_, index) => ({
      ...job,
      id: `limitJob${index}`,
    }));
    const original = pageHandler.getMockImplementation()!;
    pageHandler.mockImplementation(async (id, msg) =>
      msg.type === "LIST"
        ? { ok: true, data: batch }
        : msg.type === "LOAD_MORE"
          ? { ok: true, data: { action: "end", url: page.url, changed: false } }
          : original(id, msg),
    );
    const run = await startRun(1, page);
    await execute(run, () => {});
    expect(await db.items.count()).toBe(10);
    expect((await db.runs.get(run.id))?.reason).toContain("10 个岗位上限");
    const originalItems = await db.items.toArray();
    // 设置页的保存结果只在继续时更新上限；其他配置仍保留旧任务快照。
    c.value.limit = limit;
    c.value.filters.companies = [];
    await db.config.put(c);
    const resumed = await continueRun(run.id);
    expect(resumed.config.limit).toBe(limit);
    expect(resumed.config.filters.companies).toEqual(["示例"]);
    expect((await db.runs.get(run.id))?.config.limit).toBe(limit);
    await execute(resumed, () => {});
    expect(await db.items.count()).toBe(13);
    for (const item of originalItems)
      expect(await db.items.get(item.key)).toEqual(item);
    expect(modelHandler).not.toHaveBeenCalled();
  },
);
it("保存上限不大于已处理数时明确提示，失败不改变任务或领取锁", async () => {
  const run = await startRun(1, page);
  await execute(run, () => {});
  const before = await db.runs.get(run.id);
  await expect(continueRun(run.id)).rejects.toThrow(
    "请在执行设置保存更大的上限",
  );
  expect(await db.runs.get(run.id)).toEqual(before);
  expect(await db.locks.get("executor")).toBeUndefined();
});
