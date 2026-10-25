import { it, expect, vi, afterEach } from "vitest";
import { currentPage, pageCall } from "../src/core/connection";
const context = {
  url: "https://www.zhipin.com/web/geek/jobs",
  supported: true,
  reason: "",
  accountScope: "scope",
  accountLabel: "测试用户",
  conflict: false,
  loggedIn: true,
};
afterEach(() => vi.unstubAllGlobals());
it("设置页是活动 Tab 时，仍连接同一 Chrome 的已登录 BOSS Tab", async () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: context });
  vi.stubGlobal("chrome", {
    tabs: {
      query: async (q: object) =>
        "url" in q
          ? [{ id: 3, url: context.url, windowId: 1 }]
          : [
              {
                id: 9,
                windowId: 1,
                url: "chrome-extension://self/options.html",
              },
            ],
      sendMessage: send,
    },
  });
  expect((await currentPage()).tabId).toBe(3);
  expect(send).toHaveBeenCalledWith(3, { type: "CONTEXT" });
});
it("优先选择当前活动的 BOSS 搜索页，不误选其他窗口", async () => {
  vi.stubGlobal("chrome", {
    tabs: {
      query: async (q: object) =>
        "url" in q
          ? [
              { id: 3, url: context.url, windowId: 2 },
              { id: 4, url: context.url, windowId: 1 },
            ]
          : [{ id: 4, windowId: 1 }],
      sendMessage: async () => ({ ok: true, data: context }),
    },
  });
  expect((await currentPage()).tabId).toBe(4);
});
it("有登录首页和可运行列表时选择列表", async () => {
  vi.stubGlobal("chrome", {
    tabs: {
      query: async (q: object) =>
        "url" in q
          ? [
              { id: 3, url: "https://www.zhipin.com/", windowId: 1 },
              { id: 4, url: context.url, windowId: 1 },
            ]
          : [{ id: 3, windowId: 1 }],
      sendMessage: async (id: number) => ({
        ok: true,
        data:
          id === 3
            ? { ...context, supported: false, reason: "请打开列表" }
            : context,
      }),
    },
  });
  expect((await currentPage()).tabId).toBe(4);
});
it("已打开页面缺少内容脚本时补载一次并重试握手", async () => {
  const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValue({ ok: true, data: context }),
    executeScript = vi.fn().mockResolvedValue([]);
  vi.stubGlobal("chrome", {
    tabs: { sendMessage: send, get: async () => ({ url: context.url }) },
    scripting: { executeScript },
  });
  expect(await pageCall(3, { type: "CONTEXT" })).toEqual(context);
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 3 },
    files: ["content.js"],
  });
  expect(send).toHaveBeenCalledTimes(2);
});
it("无响应的旧脚本会恢复，页面业务错误则直接显示", async () => {
  const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ ok: true, data: context }),
    executeScript = vi.fn().mockResolvedValue([]);
  vi.stubGlobal("chrome", {
    tabs: { sendMessage: send, get: async () => ({ url: context.url }) },
    scripting: { executeScript },
  });
  expect(await pageCall(3, { type: "CONTEXT" })).toEqual(context);
  expect(executeScript).toHaveBeenCalledTimes(1);
  send.mockResolvedValue({ ok: false, error: "需要安全验证" });
  await expect(pageCall(3, { type: "CONTEXT" })).rejects.toThrow("安全验证");
  expect(executeScript).toHaveBeenCalledTimes(1);
});
it("非读取动作中断不自动重放，也不向非 BOSS 页面注入", async () => {
  const executeScript = vi.fn();
  vi.stubGlobal("chrome", {
    tabs: {
      sendMessage: async () => {
        throw new Error("closed");
      },
      get: async () => ({ url: "https://example.com/" }),
    },
    scripting: { executeScript },
  });
  await expect(pageCall(3, { type: "DETAIL" })).rejects.toThrow("操作中断");
  await expect(pageCall(3, { type: "CONTEXT" })).rejects.toThrow("只允许");
  expect(executeScript).not.toHaveBeenCalled();
});
it("找不到 BOSS 标签页时给出明确提示", async () => {
  vi.stubGlobal("chrome", { tabs: { query: async () => [] } });
  await expect(currentPage()).rejects.toThrow("未找到 BOSS 标签页");
});
it("发送外层超时覆盖授权与核验总时长，不在 16 秒误判无响应", async () => {
  vi.useFakeTimers();
  try {
    const send = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, data: { verified: true } }),
            23000,
          ),
        ),
    );
    vi.stubGlobal("chrome", { tabs: { sendMessage: send } });
    const result = pageCall(3, { type: "SEND_GREETING" });
    await vi.advanceTimersByTimeAsync(23000);
    expect(await result).toEqual({ verified: true });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("站点访问被关闭时明确提示，不误报详情数据超时", async () => {
  const query = vi.fn();
  vi.stubGlobal("chrome", {
    permissions: { contains: async () => false },
    tabs: { query },
  });
  await expect(currentPage()).rejects.toThrow("站点访问权限");
  expect(query).not.toHaveBeenCalled();
});
