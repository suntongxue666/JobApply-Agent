import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { db, createRun, cancelRun, applicationKey } from "../src/storage/db";
import {
  prepareDelivery,
  deliver,
  captureCreatedTab,
  authorizeChatOpen,
  authorizeChatSend,
  closeVerifiedTab,
} from "../src/background/delivery";
import { defaults, type Run, type Item } from "../src/shared/schema";
const pageUrl = "https://www.zhipin.com/web/geek/jobs?query=AI",
  chatUrl = "https://www.zhipin.com/web/geek/chat?jobId=job12345";
let run: Run,
  item: Item,
  tabs: Map<number, chrome.tabs.Tab>,
  send: ReturnType<typeof vi.fn>,
  remove: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  run = {
    id: crypto.randomUUID(),
    tabId: 1,
    pageUrl,
    accountScope: "scope",
    config: {
      ...structuredClone(defaults),
      minChars: 20,
      maxChars: 200,
      minScore: 99,
    },
    profile: {
      id: "main",
      text: "相关产品项目经验，负责需求分析与产品上线。",
      facts: [{ id: "fact_1", text: "产品需求分析与上线经历" }],
      version: "1",
      confirmed: true,
    },
    mode: "auto",
    status: "running",
    epoch: 1,
    createdAt: Date.now(),
    heartbeat: Date.now(),
    reason: "",
  };
  item = {
    key: run.id + ":job12345",
    runId: run.id,
    job: {
      id: "job12345",
      url: "https://www.zhipin.com/job_detail/job12345.html",
      title: "产品经理",
      company: "示例科技",
      recruiter: "招聘者甲",
      salary: "20K",
      tags: "",
      jd: "产品需求分析与产品上线职责描述。",
      type: "unknown",
      communicated: false,
    },
    status: "ready",
    reason: "",
    updatedAt: 1,
    evaluation: {
      decision: "reject",
      score: 3,
      matchedEvidenceIds: ["fact_1"],
      strengths: [],
      gaps: ["经验有限"],
      greeting:
        "您好，关注到贵司产品经理岗位，我有产品需求分析与上线经历，希望进一步交流。",
    },
  };
  await createRun(run);
  await db.items.put(item);
  tabs = new Map([
    [
      1,
      {
        id: 1,
        url: pageUrl,
        active: true,
        status: "complete",
      } as chrome.tabs.Tab,
    ],
    [
      2,
      {
        id: 2,
        url: chatUrl,
        active: false,
        status: "complete",
        openerTabId: 1,
      } as chrome.tabs.Tab,
    ],
  ]);
  remove = vi.fn(async (id: number) => {
    tabs.delete(id);
  });
  send = vi.fn(
    async (id: number, msg: { type: string; operationId: string }) => {
      if (msg.type === "CONTEXT")
        return {
          ok: true,
          data: {
            url: id === 1 ? pageUrl : chatUrl,
            accountScope: "scope",
            supported: true,
            reason: "",
          },
        };
      if (msg.type === "OPEN_CHAT") {
        await authorizeChatOpen(msg.operationId, 1);
        await captureCreatedTab(tabs.get(2)!);
        return { ok: true, data: { clicked: true } };
      }
      if (msg.type === "CHAT_READY")
        return { ok: true, data: { url: chatUrl } };
      if (msg.type === "SEND_GREETING") {
        await authorizeChatSend(msg.operationId, id);
        return {
          ok: true,
          data: { verified: true, chatUrl, reason: "目标会话出现留言" },
        };
      }
      return { ok: false, error: "unknown" };
    },
  );
  vi.stubGlobal("chrome", {
    tabs: {
      sendMessage: send,
      get: async (id: number) => {
        if (!tabs.has(id)) throw Error("tab missing");
        return tabs.get(id);
      },
      update: vi.fn(async (id: number) => {
        for (const t of tabs.values()) t.active = t.id === id;
        return tabs.get(id);
      }),
      remove,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("低分/AI reject 仍完成开聊、新 Tab 留言核验、关闭并回列表", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key);
  await deliver(prepared.operationId, run.id, 1);
  expect((await db.items.get(item.key))?.status).toBe("sent_verified");
  expect(
    (await db.applications.get(applicationKey("scope", item.job.id)))?.status,
  ).toBe("verified");
  expect((await db.deliveries.get(prepared.operationId))?.status).toBe(
    "closed",
  );
  expect(remove).toHaveBeenCalledWith(2);
  expect(tabs.get(1)?.active).toBe(true);
  const nextAt = (await db.runs.get(run.id))?.nextDeliveryAt || 0;
  expect(nextAt - Date.now()).toBeGreaterThan(14000);
  expect(nextAt - Date.now()).toBeLessThanOrEqual(30000);
  expect(
    send.mock.calls
      .map(([, m]) => m.type)
      .filter((t) => ["OPEN_CHAT", "SEND_GREETING"].includes(t)),
  ).toEqual(["OPEN_CHAT", "SEND_GREETING"]);
});
it("候选 Tab 不唯一时，不向任何聊天发送，也不关闭用户页面", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key),
    original = send.getMockImplementation()!;
  send.mockImplementation(async (id, msg) => {
    const result = await original(id, msg);
    if (msg.type === "OPEN_CHAT")
      await captureCreatedTab({ id: 3, openerTabId: 1 } as chrome.tabs.Tab);
    return result;
  });
  await expect(deliver(prepared.operationId, run.id, 1)).rejects.toThrow(
    "多个",
  );
  expect(send.mock.calls.some(([, m]) => m.type === "SEND_GREETING")).toBe(
    false,
  );
  expect(remove).not.toHaveBeenCalled();
  expect((await db.items.get(item.key))?.status).toBe("uncertain");
});
it("准备后用户暂停，不点击立即沟通", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key);
  await cancelRun(run.id, "paused", "用户暂停");
  await expect(deliver(prepared.operationId, run.id, 1)).rejects.toThrow(
    "暂停",
  );
  expect(send.mock.calls.some(([, m]) => m.type === "OPEN_CHAT")).toBe(false);
});
it("发送核验丢失时保留聊天 Tab 并禁止后续重发", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key),
    original = send.getMockImplementation()!;
  send.mockImplementation(async (id, msg) => {
    if (msg.type === "SEND_GREETING") {
      await authorizeChatSend(msg.operationId, 2);
      return {
        ok: true,
        data: { verified: false, chatUrl, reason: "点击后超时" },
      };
    }
    return original(id, msg);
  });
  await expect(deliver(prepared.operationId, run.id, 1)).rejects.toThrow(
    "待核查",
  );
  expect(remove).not.toHaveBeenCalled();
  expect((await db.items.get(item.key))?.status).toBe("uncertain");
  await expect(prepareDelivery(run.id, 1, item.key)).rejects.toThrow();
});
it("不能借 operation ID 操作其他会话，发送许可不能重复领取", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key);
  await db.deliveries.update(prepared.operationId, {
    status: "chat_ready",
    chatTabId: 2,
    chatUrl,
    candidates: [2],
  });
  await chrome.tabs.update(2, { active: true });
  await expect(authorizeChatSend(prepared.operationId, 9)).rejects.toThrow();
  await authorizeChatSend(prepared.operationId, 2);
  await expect(authorizeChatSend(prepared.operationId, 2)).rejects.toThrow(
    "失效",
  );
});
it("不会关闭原列表或已经导航离开的用户 Tab", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key);
  await db.deliveries.update(prepared.operationId, {
    status: "verified",
    chatTabId: 1,
    chatUrl: pageUrl,
    candidates: [1],
  });
  await expect(closeVerifiedTab(prepared.operationId)).rejects.toThrow(
    "禁止关闭",
  );
  await db.deliveries.update(prepared.operationId, {
    chatTabId: 2,
    chatUrl,
    candidates: [2],
  });
  tabs.get(2)!.url = "https://example.com/";
  await expect(closeVerifiedTab(prepared.operationId)).rejects.toThrow("改变");
  expect(remove).not.toHaveBeenCalled();
});
it("来自其他 opener 的既有 Tab 不会被关联", async () => {
  const prepared = await prepareDelivery(run.id, 1, item.key);
  await db.deliveries.update(prepared.operationId, { status: "opening" });
  await captureCreatedTab({ id: 9, openerTabId: 8 } as chrome.tabs.Tab);
  expect((await db.deliveries.get(prepared.operationId))?.candidates).toEqual(
    [],
  );
});
it("重复 DELIVER 并发请求也只点击一次，不覆盖已核验记录", async () => {
  const p = await prepareDelivery(run.id, 1, item.key);
  const result = await Promise.allSettled([
    deliver(p.operationId, run.id, 1),
    deliver(p.operationId, run.id, 1),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    send.mock.calls.filter(([, m]) => m.type === "OPEN_CHAT"),
  ).toHaveLength(1);
  expect(
    send.mock.calls.filter(([, m]) => m.type === "SEND_GREETING"),
  ).toHaveLength(1);
  expect((await db.items.get(item.key))?.status).toBe("sent_verified");
});
it("真实后台端口监听器完成开聊和发送的单次授权往返", async () => {
  const p = await prepareDelivery(run.id, 1, item.key);
  await db.deliveries.update(p.operationId, { status: "opening" });
  let accept: (port: chrome.runtime.Port) => void = () => {
    throw new Error("后台未监听");
  };
  let senderTab = 1;
  Object.assign(chrome, {
    storage: {
      local: { setAccessLevel: async () => {} },
      session: { setAccessLevel: async () => {} },
    },
    runtime: {
      id: "self",
      getURL: (path: string) => "chrome-extension://self/" + path,
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onConnect: {
        addListener: (callback: typeof accept) => {
          accept = callback;
        },
      },
      connect: () => {
        const clientMessages = new Set<(data: unknown) => void>();
        const serverMessages = new Set<(data: unknown) => void>();
        const disconnects = new Set<() => void>();
        const messages = (listeners: Set<(data: unknown) => void>) => ({
          addListener: (f: (data: unknown) => void) => listeners.add(f),
          removeListener: (f: (data: unknown) => void) => listeners.delete(f),
        });
        const client = {
          onMessage: messages(clientMessages),
          onDisconnect: {
            addListener: (f: () => void) => disconnects.add(f),
            removeListener: (f: () => void) => disconnects.delete(f),
          },
          postMessage: (data: unknown) => {
            for (const f of serverMessages) f(data);
          },
          disconnect: vi.fn(),
        };
        const server = {
          name: "jobapply-content-v1",
          sender: {
            id: "self",
            tab: tabs.get(senderTab),
            frameId: 0,
            url: tabs.get(senderTab)?.url,
          },
          onMessage: messages(serverMessages),
          postMessage: (data: unknown) => {
            for (const f of clientMessages) f(data);
          },
        };
        accept(server as unknown as chrome.runtime.Port);
        return client;
      },
    },
  });
  Object.assign(chrome.tabs, {
    onCreated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  });
  await import("../src/background/index");
  const { contentRequest } = await import("../src/content/rpc");
  expect(
    await contentRequest({
      type: "AUTHORIZE_OPEN_CHAT",
      operationId: p.operationId,
    }),
  ).toEqual({ authorized: true });
  await expect(
    contentRequest({ type: "AUTHORIZE_OPEN_CHAT", operationId: p.operationId }),
  ).rejects.toThrow("失效");
  await db.deliveries.update(p.operationId, {
    status: "chat_ready",
    chatTabId: 2,
    candidates: [2],
    chatUrl,
  });
  senderTab = 2;
  await chrome.tabs.update(2, { active: true });
  expect(
    await contentRequest({
      type: "AUTHORIZE_CHAT_SEND",
      operationId: p.operationId,
    }),
  ).toEqual({ authorized: true });
  await expect(
    contentRequest({ type: "AUTHORIZE_CHAT_SEND", operationId: p.operationId }),
  ).rejects.toThrow("失效");
  expect(
    (await db.applications.get(applicationKey("scope", item.job.id)))?.status,
  ).toBe("intent");
});
for (const mode of ["same", "child"] as const) {
  it(`独立详情开聊：${mode === "same" ? "本次 Tab 内跳转" : "本次详情另开子 Tab"}，核验后只关闭本次页面`, async () => {
    item.job.openInDetail = true;
    await db.items.put(item);
    const create = vi.fn(async (options: { url: string }) => {
      const detail = {
        id: 3,
        url: options.url,
        active: true,
        status: "complete",
        openerTabId: 1,
      } as chrome.tabs.Tab;
      for (const t of tabs.values()) t.active = false;
      tabs.set(3, detail);
      await captureCreatedTab(detail); // loading_detail 阶段不能误关联为聊天页
      return detail;
    });
    Object.assign(chrome.tabs, { create });
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (id, msg) => {
      if (msg.type === "DETAIL_PAGE") return { ok: true, data: item.job };
      if (msg.type === "OPEN_CHAT") {
        expect(id).toBe(3);
        await authorizeChatOpen(msg.operationId, 3);
        expect((await db.deliveries.get(msg.operationId))?.candidates).toEqual(
          [],
        );
        if (mode === "same") tabs.get(3)!.url = chatUrl;
        else {
          tabs.get(2)!.openerTabId = 3;
          await captureCreatedTab(tabs.get(2)!);
        }
        return { ok: true, data: { clicked: true } };
      }
      return original(id, msg);
    });
    const p = await prepareDelivery(run.id, 1, item.key);
    await deliver(p.operationId, run.id, 1);
    const op = await db.deliveries.get(p.operationId);
    expect(op?.status).toBe("closed");
    expect(op?.chatTabId).toBe(mode === "same" ? 3 : 2);
    expect(remove).toHaveBeenCalledWith(3);
    if (mode === "same") expect(remove).not.toHaveBeenCalledWith(2);
    else expect(remove).toHaveBeenCalledWith(2);
    expect(remove).not.toHaveBeenCalledWith(1);
    expect(tabs.get(1)?.active).toBe(true);
  });
}
it("右侧详情读取失败后的独立读取只取 JD，不点击沟通、不发消息", async () => {
  await db.items.update(item.key, { status: "extracting" });
  Object.assign(chrome.tabs, {
    create: vi.fn(async () => {
      for (const t of tabs.values()) t.active = false;
      const detail = {
        id: 3,
        url: item.job.url,
        active: true,
        status: "complete",
        openerTabId: 1,
      } as chrome.tabs.Tab;
      tabs.set(3, detail);
      return detail;
    }),
  });
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (id, msg) =>
    msg.type === "DETAIL_PAGE"
      ? { ok: true, data: { ...item.job, openInDetail: true } }
      : original(id, msg),
  );
  const { readJobDetail } = await import("../src/background/detail");
  expect((await readJobDetail(run.id, 1, item.key)).openInDetail).toBe(true);
  expect(
    send.mock.calls.some(([, msg]) =>
      ["OPEN_CHAT", "SEND_GREETING"].includes(msg.type),
    ),
  ).toBe(false);
  expect(remove).toHaveBeenCalledWith(3);
  expect(tabs.get(1)?.active).toBe(true);
});
it("详情 URL 不变时关联本次首次沟通弹窗，发送核验后关闭详情并回到列表", async () => {
  item.job.openInDetail = true;
  await db.items.put(item);
  Object.assign(chrome.tabs, {
    create: vi.fn(async (options: { url: string }) => {
      for (const t of tabs.values()) t.active = false;
      const detail = {
        id: 3,
        url: options.url,
        active: true,
        status: "complete",
        openerTabId: 1,
      } as chrome.tabs.Tab;
      tabs.set(3, detail);
      return detail;
    }),
  });
  const original = send.getMockImplementation()!;
  send.mockImplementation(async (id, msg) => {
    if (msg.type === "DETAIL_PAGE") return { ok: true, data: item.job };
    if (msg.type === "OPEN_CHAT") {
      await authorizeChatOpen(msg.operationId, 3);
      return { ok: true, data: { clicked: true } };
    }
    if (msg.type === "CHAT_PROBE")
      return {
        ok: true,
        data: { ready: true, url: item.job.url, mode: "detail_dialog" },
      };
    if (msg.type === "CHAT_READY")
      return { ok: true, data: { url: item.job.url, mode: "detail_dialog" } };
    if (msg.type === "SEND_GREETING") {
      await authorizeChatSend(msg.operationId, 3);
      return {
        ok: true,
        data: {
          verified: true,
          chatUrl: item.job.url,
          reason: "本次弹窗提交成功",
        },
      };
    }
    return original(id, msg);
  });
  const p = await prepareDelivery(run.id, 1, item.key);
  await deliver(p.operationId, run.id, 1);
  expect((await db.deliveries.get(p.operationId))?.chatMode).toBe(
    "detail_dialog",
  );
  expect((await db.items.get(item.key))?.status).toBe("sent_verified");
  expect(remove).toHaveBeenCalledWith(3);
  expect(remove).not.toHaveBeenCalledWith(1);
  expect(remove).not.toHaveBeenCalledWith(2);
  expect(tabs.get(1)?.active).toBe(true);
});
