// @vitest-environment-options {"url":"https://www.zhipin.com/web/geek/chat"}
import { beforeEach, it, expect, vi } from "vitest";
import {
  assertChatTarget,
  sendGreeting,
  messageMatches,
} from "../src/adapters/boss/chat";
const target = {
  jobId: "job12345",
  title: "产品经理",
  company: "示例科技",
  recruiter: "招聘者甲",
};
const greeting =
  "您好，看到贵司产品经理岗位关注需求分析，我有相关产品项目经历，希望进一步了解岗位。";
beforeEach(() => {
  history.replaceState(null, "", "/web/geek/chat");
  document.body.innerHTML =
    '<div class="chat-content"><div><a href="/job_detail/job12345.html">产品经理</a><span>示例科技 · 招聘者甲</span></div><div id="messages"></div><textarea></textarea><button>发送</button></div>';
});
function mockOrigin() {
  return "https://www.zhipin.com/web/geek/chat";
}
it("岗位 ID、公司和招聘者共同核对，不凭开聊按钮猜测目标", () => {
  const root = document.querySelector<HTMLElement>(".chat-content")!;
  expect(assertChatTarget(target, root, mockOrigin())).toBe(root);
  for (const patch of [
    { jobId: "other-job" },
    { company: "其他公司" },
    { recruiter: "另一招聘者" },
  ])
    expect(() =>
      assertChatTarget({ ...target, ...patch }, root, mockOrigin()),
    ).toThrow();
  root.querySelector("a")!.remove();
  expect(() => assertChatTarget(target, root, mockOrigin())).toThrow("岗位 ID");
});
it("URL 中岗位 ID 冲突时，即使正文名称相同也不发送", () =>
  expect(() =>
    assertChatTarget(
      target,
      document.querySelector<HTMLElement>(".chat-content")!,
      mockOrigin() + "?jobId=other-job",
    ),
  ).toThrow("其他岗位"));
it("原有草稿不覆盖、不发送", async () => {
  const editor = document.querySelector("textarea")!;
  editor.value = "用户尚未发送的草稿";

  const { sendGreeting: sender } = await import("../src/adapters/boss/chat");
  await expect(
    sender(target, greeting, vi.fn(), new AbortController().signal),
  ).rejects.toThrow();
  expect(editor.value).toBe("用户尚未发送的草稿");
});
it("历史同文案只能识别为已有消息，不能作为新投递结果", () => {
  const root = document.querySelector<HTMLElement>(".chat-content")!,
    msg = document.createElement("div");
  msg.textContent = greeting;
  root.querySelector("#messages")!.append(msg);
  expect(messageMatches(root, greeting)).toHaveLength(1);
  expect(root.querySelector("textarea")!.value).toBe("");
});
