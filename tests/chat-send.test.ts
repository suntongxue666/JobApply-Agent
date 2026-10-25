// @vitest-environment-options {"url":"https://www.zhipin.com/web/geek/chat"}
import { beforeEach, it, expect, vi } from "vitest";
import { sendGreeting } from "../src/adapters/boss/chat";
const target = {
  jobId: "job12345",
  title: "产品经理",
  company: "示例科技",
  recruiter: "招聘者甲",
};
const greeting =
  "您好，看到贵司产品经理岗位关注需求分析，我有相关产品项目经历，希望进一步了解岗位。";
beforeEach(() => {
  document.body.innerHTML =
    '<div class="chat-content"><a href="/job_detail/job12345.html">产品经理</a><p>示例科技 · 招聘者甲</p><div id="messages"></div><textarea></textarea><button>发送</button></div>';
});
it("授权后才点击发送，目标消息出现且编辑器清空才核验成功", async () => {
  const order: string[] = [];
  document.querySelector("button")!.addEventListener("click", () => {
    order.push("click");
    const msg = document.createElement("div");
    msg.textContent = document.querySelector("textarea")!.value;
    document.querySelector("#messages")!.append(msg);
    document.querySelector("textarea")!.value = "";
  });
  const result = await sendGreeting(
    target,
    greeting,
    async () => {
      order.push("authorized");
    },
    new AbortController().signal,
  );
  expect(result.verified).toBe(true);
  expect(order).toEqual(["authorized", "click"]);
});
it("暂停发生在最终授权前，不发送且清理插件自己填写的草稿", async () => {
  const click = vi.fn(),
    controller = new AbortController();
  document.querySelector("button")!.addEventListener("click", click);
  await expect(
    sendGreeting(
      target,
      greeting,
      async () => {
        controller.abort();
      },
      controller.signal,
    ),
  ).rejects.toThrow("取消");
  expect(click).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")!.value).toBe("");
});
it("点击后中断必须 uncertain，不能盲目重发或报告成功", async () => {
  const controller = new AbortController();
  document
    .querySelector("button")!
    .addEventListener("click", () => controller.abort());
  const result = await sendGreeting(
    target,
    greeting,
    async () => {},
    controller.signal,
  );
  expect(result.verified).toBe(false);
});
it("未匹配到岗位 ID 时，哪怕招聘者名字一样也不点击", async () => {
  document.querySelector("a")!.href = "/job_detail/different-job.html";
  const click = vi.fn();
  document.querySelector("button")!.addEventListener("click", click);
  await expect(
    sendGreeting(target, greeting, vi.fn(), new AbortController().signal),
  ).rejects.toThrow("其他岗位");
  expect(click).not.toHaveBeenCalled();
});
