import Dexie, { type Table } from "dexie";
import type {
  Application,
  Block,
  Config,
  EventRecord,
  Item,
  Profile,
  Run,
  PageSkip,
  DeliveryOperation,
} from "../shared/schema";
import { defaults, configSchema } from "../shared/schema";
import { deepseekConfig } from "../shared/deepseek";

class JobApplyDB extends Dexie {
  config!: Table<{ id: "main"; value: Config }, string>;
  profiles!: Table<Profile, string>;
  runs!: Table<Run, string>;
  items!: Table<Item, string>;
  applications!: Table<Application, string>;
  blocks!: Table<Block, string>;
  events!: Table<EventRecord, number>;
  skips!: Table<PageSkip, string>;
  deliveries!: Table<DeliveryOperation, string>;
  locks!: Table<{ id: string; runId: string }, string>;
  constructor(name = "jobapply-agent") {
    super(name);
    this.version(1).stores({
      config: "id",
      profiles: "id",
      runs: "id,status,createdAt",
      items: "key,runId,status",
      applications: "key,runId,accountScope",
      blocks: "id",
      events: "++id,runId,at",
      locks: "id",
    });
    this.version(2).stores({
      skips: "key,accountScope,[accountScope+pageUrl]",
    });
    this.version(3).stores({ deliveries: "id,runId,status,sourceTabId" });
  }
}
export { JobApplyDB };
export const db = new JobApplyDB();
export async function getConfig(): Promise<Config> {
  const saved = (await db.config.get("main"))?.value;
  return configSchema.parse(
    deepseekConfig({
      ...structuredClone(defaults),
      ...saved,
      limit:
        saved?.limit === 10 && !saved.limitConfigured
          ? defaults.limit
          : (saved?.limit ?? defaults.limit),
      greetingConfirmed:
        saved?.greetingConfirmed ??
        (!!saved?.version && saved.greeting !== defaults.greeting),
      filters: { ...defaults.filters, ...saved?.filters },
    }),
  );
}
export async function log(
  runId: string,
  step: string,
  message: string,
  jobId?: string,
) {
  await db.events.add({ runId, step, message, jobId, at: Date.now() });
}
export function applicationKey(
  scope: string,
  jobId: string,
  action = "greeting",
) {
  return `${scope}:boss:${jobId}:${action}`;
}
// 显式运行锁不自动过期接管：失联后必须由用户暂停/停止旧任务并检查发送意图。
export async function createRun(run: Run) {
  await db.transaction("rw", db.runs, db.locks, async () => {
    if (await db.locks.get("executor"))
      throw new Error("已有任务运行中，请先暂停或停止旧任务");
    await db.locks.add({ id: "executor", runId: run.id });
    await db.runs.add(run);
  });
}
export async function assertRun(runId: string, epoch: number): Promise<Run> {
  const [run, lock] = await Promise.all([
    db.runs.get(runId),
    db.locks.get("executor"),
  ]);
  if (
    !run ||
    run.status !== "running" ||
    run.epoch !== epoch ||
    lock?.runId !== runId
  )
    throw new Error("任务已暂停、停止或失去执行权");
  return run;
}
export async function cancelRun(
  runId: string,
  status: "paused" | "stopped" | "blocked" | "completed",
  reason: string,
) {
  await db.transaction(
    "rw",
    db.runs,
    db.locks,
    db.items,
    db.applications,
    async () => {
      const run = await db.runs.get(runId);
      if (!run) return;
      await db.runs.update(runId, {
        status,
        reason,
        epoch: run.epoch + 1,
        heartbeat: Date.now(),
      });
      if ((await db.locks.get("executor"))?.runId === runId)
        await db.locks.delete("executor");
      const apps = await db.applications.where("runId").equals(runId).toArray();
      for (const app of apps.filter((a) => a.status === "intent"))
        await db.applications.update(app.key, { status: "uncertain" });
      const items = await db.items.where("runId").equals(runId).toArray();
      for (const item of items) {
        if (["sending", "opening_chat"].includes(item.status))
          await db.items.update(item.key, {
            status: "uncertain",
            reason: "操作可能已触发，需人工核查",
            updatedAt: Date.now(),
          });
        if (["extracting", "evaluating"].includes(item.status))
          await db.items.update(item.key, {
            status: "discovered",
            reason: "中断后需重新读取",
            updatedAt: Date.now(),
          });
      }
    },
  );
}
export async function resumeRun(runId: string, limit?: number) {
  const savedLimit =
    limit === undefined ? undefined : configSchema.shape.limit.parse(limit);
  return db.transaction("rw", db.runs, db.locks, db.items, async () => {
    const run = await db.runs.get(runId);
    if (!run || !["paused", "blocked", "completed"].includes(run.status))
      throw new Error("任务当前不可继续");
    const lock = await db.locks.get("executor");
    if (lock && lock.runId !== runId) throw new Error("另一个任务正在运行");
    const nextLimit = savedLimit ?? run.config.limit;
    const items = await db.items.where("runId").equals(runId).toArray();
    if (
      items.length > nextLimit ||
      (items.length === nextLimit &&
        !items.some((item) => item.status === "discovered"))
    )
      throw new Error(
        `本轮已处理 ${items.length} 个岗位，已保存上限为 ${nextLimit}；请在执行设置保存更大的上限后继续，或开始新一轮`,
      );
    const next: Run = {
      ...run,
      config: { ...run.config, limit: nextLimit },
      status: "running",
      epoch: run.epoch + 1,
      reason: "",
      heartbeat: Date.now(),
    };
    await db.runs.put(next);
    await db.locks.put({ id: "executor", runId });
    return next;
  });
}
export async function claimSend(
  runId: string,
  epoch: number,
  itemKey: string,
  action: "greeting" | "conversation",
) {
  return db.transaction(
    "rw",
    db.runs,
    db.locks,
    db.items,
    db.applications,
    async () => {
      const run = await assertRun(runId, epoch),
        item = await db.items.get(itemKey);
      if (
        !item ||
        item.runId !== runId ||
        !item.evaluation ||
        !["ready", "review"].includes(item.status)
      )
        throw new Error("此岗位当前不可发送");
      if (action === "greeting" && !item.approved && run.mode !== "auto")
        throw new Error("请先审核留言");
      const key = applicationKey(run.accountScope, item.job.id, action);
      if (await db.applications.get(key))
        throw new Error("此岗位已有发送记录或待核查意图，禁止重复操作");
      const app: Application = {
        key,
        runId,
        jobId: item.job.id,
        accountScope: run.accountScope,
        action,
        status: "intent",
        text: item.evaluation.greeting,
        createdAt: Date.now(),
      };
      await db.applications.add(app);
      await db.items.update(itemKey, {
        status: action === "greeting" ? "sending" : "opening_chat",
        updatedAt: Date.now(),
      });
      return app;
    },
  );
}
export async function exportRecords() {
  const [runs, items, applications, events, blocks] = await Promise.all([
    db.runs.toArray(),
    db.items.toArray(),
    db.applications.toArray(),
    db.events.toArray(),
    db.blocks.toArray(),
  ]);
  // run 内含简历快照，导出只取任务摘要，不泄露完整简历或 Key。
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    runs: runs.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      createdAt: r.createdAt,
      reason: r.reason,
    })),
    items,
    applications,
    events,
    blocks,
  };
}
