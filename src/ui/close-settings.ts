export async function closeSettingsPage() {
  const expected = new URL(chrome.runtime.getURL("options.html"));
  const current = new URL(location.href);
  if (
    current.protocol !== expected.protocol ||
    current.host !== expected.host ||
    current.pathname !== expected.pathname
  )
    throw new Error("只能从设置页面关闭当前设置 Tab");
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined)
    throw new Error("未找到当前设置 Tab，请使用浏览器关闭此页面");
  await chrome.tabs.remove(tab.id);
}
