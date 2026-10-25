import { afterEach, expect, it, vi } from "vitest";
import { contentRequest } from "../src/content/rpc";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function channel(reply?: unknown, disconnected = false) {
  const messages = new Set<(data: unknown) => void>();
  const disconnects = new Set<() => void>();
  const postMessage = vi.fn(() =>
    queueMicrotask(() => {
      if (disconnected) for (const f of disconnects) f();
      else if (reply !== undefined) for (const f of messages) f(reply);
    }),
  );
  const port = {
    postMessage,
    disconnect: vi.fn(),
    onMessage: {
      addListener: (f: (data: unknown) => void) => messages.add(f),
      removeListener: (f: (data: unknown) => void) => messages.delete(f),
    },
    onDisconnect: {
      addListener: (f: () => void) => disconnects.add(f),
      removeListener: (f: () => void) => disconnects.delete(f),
    },
  };
  vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port) } });
  return port;
}
it("独立端口收到授权结果后关闭，不使用普通 sendMessage", async () => {
  const port = channel({ ok: true, data: { authorized: true } });
  expect(await contentRequest({ type: "AUTHORIZE_OPEN_CHAT" })).toEqual({
    authorized: true,
  });
  expect(chrome.runtime.connect).toHaveBeenCalledWith({
    name: "jobapply-content-v1",
  });
  expect(port.disconnect).toHaveBeenCalledTimes(1);
});
it("后台拒绝原因保留，不能误报后台无响应", async () => {
  channel({ ok: false, error: "任务已暂停，授权失效" });
  await expect(contentRequest({})).rejects.toThrow("任务已暂停");
});
it("断开不重试请求，也不把空结果当成功", async () => {
  const port = channel(undefined, true);
  await expect(contentRequest({})).rejects.toThrow("连接断开");
  expect(port.postMessage).toHaveBeenCalledTimes(1);
});
it("授权超时释放端口，绝不重放点击", async () => {
  vi.useFakeTimers();
  const port = channel();
  const result = expect(contentRequest({})).rejects.toThrow("授权超时");
  await vi.advanceTimersByTimeAsync(12000);
  await result;
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
});
