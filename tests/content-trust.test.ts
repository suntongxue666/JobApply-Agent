import { it, expect, vi, afterEach } from "vitest";
let callbacks: Parameters<typeof chrome.runtime.onMessage.addListener>[0][] =
  [];
afterEach(() => {
  globalThis.__jobApplyContent?.dispose();
  globalThis.__jobApplyContent = undefined;
  callbacks = [];
  vi.unstubAllGlobals();
});
it("扩展全屏页发送的消息即使有 sender.tab 仍能握手；外部来源不能操作页面", async () => {
  document.body.innerHTML = "";
  vi.stubGlobal("chrome", {
    runtime: {
      id: "self",
      getURL: (p: string) => "chrome-extension://self/" + p,
      onMessage: {
        addListener: (f: (typeof callbacks)[number]) => callbacks.push(f),
        removeListener: vi.fn(),
      },
      sendMessage: async () => ({ ok: true, data: [] }),
    },
  });
  await import("../src/content/index");
  const reply = vi.fn();
  const listener = callbacks[0];
  expect(
    listener(
      { type: "CONTEXT" },
      {
        id: "self",
        url: "chrome-extension://self/options.html",
        tab: { id: 9 } as chrome.tabs.Tab,
      },
      reply,
    ),
  ).toBe(true);
  await vi.waitFor(() =>
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true })),
  );
  // Chrome service worker 发出的消息可能没有 sender.url，也没有 sender.tab。
  const workerReply = vi.fn();
  expect(listener({ type: "CONTEXT" }, { id: "self" }, workerReply)).toBe(true);
  await vi.waitFor(() =>
    expect(workerReply).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
    ),
  );
  const contentReply = vi.fn();
  expect(
    listener(
      { type: "CONTEXT" },
      { id: "self", tab: { id: 3 } as chrome.tabs.Tab },
      contentReply,
    ),
  ).toBe(false);
  const rejected = vi.fn();
  expect(
    listener(
      { type: "LIST" },
      { id: "self", url: "https://www.zhipin.com/" },
      rejected,
    ),
  ).toBe(false);
  expect(rejected).not.toHaveBeenCalled();
});
