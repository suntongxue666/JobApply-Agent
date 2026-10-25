import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { closeSettingsPage } from "../src/ui/close-settings";
beforeEach(() => {
  history.replaceState(null, "", "/options.html");
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => new URL(path, location.origin).href },
    tabs: {
      getCurrent: vi.fn(async () => ({ id: 7 })),
      remove: vi.fn(async () => {}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("通过当前 Tab API 只关闭设置页，不依赖活动标签页查询", async () => {
  await closeSettingsPage();
  expect(chrome.tabs.remove).toHaveBeenCalledExactlyOnceWith(7);
});
it("不能从插件其他页面触发关闭", async () => {
  history.replaceState(null, "", "/panel.html");
  await expect(closeSettingsPage()).rejects.toThrow("只能从设置页面");
  expect(chrome.tabs.remove).not.toHaveBeenCalled();
});
it("没有当前设置 Tab 时明确报错，不猜测要关闭的页面", async () => {
  vi.mocked(chrome.tabs.getCurrent).mockResolvedValue(undefined);
  await expect(closeSettingsPage()).rejects.toThrow("未找到当前设置 Tab");
  expect(chrome.tabs.remove).not.toHaveBeenCalled();
});
