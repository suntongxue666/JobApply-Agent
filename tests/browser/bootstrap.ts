// 仅用于本地界面 QA，不打包进扩展，也不模拟真实 BOSS 投递成功。
import { db } from "../../src/storage/db";
import { defaults } from "../../src/shared/schema";
const area = (name: string) => ({
  get: async (key: string) => ({
    [key]: JSON.parse(sessionStorage.getItem(`${name}:${key}`) || "null"),
  }),
  set: async (value: Record<string, unknown>) => {
    for (const [key, v] of Object.entries(value))
      sessionStorage.setItem(`${name}:${key}`, JSON.stringify(v));
  },
  remove: async (key: string) => {
    sessionStorage.removeItem(`${name}:${key}`);
  },
  setAccessLevel: async () => {},
});
Object.defineProperty(globalThis, "chrome", {
  value: {
    runtime: {
      getURL: (path: string) => new URL(path, location.href).href,
      sendMessage: async (msg: { type: string; section?: string }) => {
        if (msg.type === "OPEN_OPTIONS") {
          location.href =
            "/options.html" + (msg.section ? "#" + msg.section : "");
          return { ok: true };
        }
        return { ok: false, error: "界面预览不调用真实模型" };
      },
    },
    storage: { local: area("local"), session: area("session") },
    permissions: { request: async () => false },
    tabs: {
      query: async () => [],
      getCurrent: async () => ({ id: 0 }),
      remove: async (id: number) => {
        if (id !== 0 || location.pathname !== "/options.html")
          throw new Error("演示只允许关闭当前设置页");
        window.close();
      },
    },
  },
});
const runId = "00000000-0000-4000-8000-000000000001";
if (!(await db.runs.get(runId))) {
  const config = {
    ...defaults,
    greetingConfirmed: true,
    consentOrigin: "https://api.deepseek.com",
  };
  await db.config.put({ id: "main", value: config });
  const profile = {
    id: "main" as const,
    text: "演示：负责产品需求分析、原型设计及产品上线。",
    facts: [{ id: "fact_1", text: "负责产品需求分析、原型设计及产品上线。" }],
    version: "demo",
    confirmed: true,
  };
  await db.profiles.put(profile);
  await db.runs.put({
    id: runId,
    tabId: 0,
    pageUrl: "https://www.zhipin.com/web/geek/jobs",
    accountScope: "demo",
    config,
    profile,
    mode: "preview",
    status: "completed",
    epoch: 2,
    createdAt: Date.now(),
    heartbeat: Date.now(),
    reason: "演示任务 · 未连接真实 BOSS",
  });
  await db.items.put({
    key: runId + ":demo123",
    runId,
    job: {
      id: "demo123",
      url: "https://www.zhipin.com/",
      title: "AI 产品经理 · Agent 方向",
      company: "示例科技（演示）",
      salary: "20–35K · 14薪",
      tags: "本科 · 3–5年",
      jd: "演示岗位：负责 AI 产品需求分析、产品方案设计与上线验证，推进团队协同。",
      type: "unknown",
      communicated: false,
    },
    status: "review",
    reason: "需确认行业经验要求",
    updatedAt: Date.now(),
    evaluation: {
      decision: "review",
      score: 86,
      matchedEvidenceIds: ["fact_1"],
      strengths: ["具备产品需求分析与上线经历"],
      gaps: ["行业经验需要进一步确认"],
      greeting:
        "您好，关注到贵司 AI 产品经理岗位需要推进需求分析、产品方案与上线验证。我有产品需求分析、原型设计及上线经历，希望结合过往项目经验，进一步了解团队的 Agent 产品方向与业务需求。",
    },
  });
}
if (new URLSearchParams(location.search).get("demo") === "paused") {
  await db.runs.update(runId, {
    status: "paused",
    reason: "演示已暂停 · 可继续或停止本次任务",
  });
}
const banner = document.createElement("div");
banner.textContent = "界面预览 · 演示数据，不连接 BOSS、不发送消息";
banner.style.cssText =
  "padding:10px;text-align:center;background:#fff0cc;color:#846a30;font:12px sans-serif;";
document.body.prepend(banner);
await import(
  /* @vite-ignore */ new URL(
    location.pathname.includes("options") ? "options.js" : "panel.js",
    location.href,
  ).href
);
