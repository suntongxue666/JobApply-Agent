import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { deliveryIntervalMs, deliveryIntervals } from "../src/shared/interval";
import { defaults, type Run } from "../src/shared/schema";
import {
  db,
  createRun,
  cancelRun,
  resumeRun,
  getConfig,
} from "../src/storage/db";
import { waitForDeliverySlot } from "../src/core/engine";
let run: Run;
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  run = {
    id: crypto.randomUUID(),
    tabId: 1,
    pageUrl: "https://www.zhipin.com/web/geek/jobs",
    accountScope: "scope",
    config: structuredClone(defaults),
    profile: {
      id: "main",
      text: "事实",
      facts: [{ id: "fact_1", text: "产品经历" }],
      confirmed: true,
      version: "1",
    },
    mode: "auto",
    status: "running",
    epoch: 1,
    createdAt: Date.now(),
    heartbeat: Date.now(),
    reason: "",
  };
  await createRun(run);
  vi.stubGlobal("chrome", {
    tabs: {
      get: async () => ({ active: true }),
      sendMessage: async () => ({
        ok: true,
        data: {
          url: run.pageUrl,
          accountScope: run.accountScope,
          supported: true,
          conflict: false,
        },
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(Object.entries(deliveryIntervals))(
  "间隔 %s 的边界都在所选范围，关闭时不等待",
  (range, limits) => {
    const config = {
      deliveryIntervalEnabled: true,
      deliveryInterval: range as keyof typeof deliveryIntervals,
    };
    expect(deliveryIntervalMs(config, () => 0)).toBe(limits.min * 1000);
    expect(deliveryIntervalMs(config, () => 0.999999)).toBe(limits.max * 1000);
    expect(
      deliveryIntervalMs({ ...config, deliveryIntervalEnabled: false }),
    ).toBe(0);
  },
);
it("旧设置自动补齐默认启用及 15-30 秒范围", async () => {
  const config = { ...defaults } as Partial<typeof defaults>;
  delete config.deliveryIntervalEnabled;
  delete config.deliveryInterval;
  await db.config.put({ id: "main", value: config as typeof defaults });
  expect(await getConfig()).toEqual(
    expect.objectContaining({
      deliveryIntervalEnabled: true,
      deliveryInterval: "15-30",
    }),
  );
});
it("等待到持久化的截止时间才放行，不到时间不读取下一岗", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  await db.runs.update(run.id, { nextDeliveryAt: Date.now() + 15000 });
  const changed = vi.fn();
  let completed = false;
  const pending = waitForDeliverySlot(run, changed).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  expect(completed).toBe(false);
  vi.setSystemTime(Date.now() + 14000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(completed).toBe(false);
  vi.setSystemTime(Date.now() + 1000);
  await pending;
  expect(completed).toBe(true);
});
it("暂停及时中断，继续任务仍保留原有剩余等待", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  const deadline = Date.now() + 30000;
  await db.runs.update(run.id, { nextDeliveryAt: deadline });
  const changed = vi.fn();
  const pending = expect(waitForDeliverySlot(run, changed)).rejects.toThrow(
    "暂停",
  );
  await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  await cancelRun(run.id, "paused", "暂停");
  await pending;
  const resumed = await resumeRun(run.id);
  expect(resumed.nextDeliveryAt).toBe(deadline);
  vi.setSystemTime(deadline);
  await expect(waitForDeliverySlot(resumed)).resolves.toBeUndefined();
});
