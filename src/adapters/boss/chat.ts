import type { ChatTarget, SendObservation } from "../../shared/schema";
import { boundDialog, canReplacePlatformPreset } from "./dialog-binding";
import { jobId, text, waitUntil } from "./index";
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").trim();
export function visible(element: Element): boolean {
  for (let e: Element | null = element; e; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      e.hasAttribute("hidden")
    )
      return false;
  }
  return true;
}
export function assertNoChallenge() {
  if (
    location.pathname.includes("/verify") ||
    /安全验证|请完成验证|访问受限|操作过于频繁/.test(text(document.body))
  )
    throw new Error("BOSS 要求安全验证或限制访问，任务暂停，请用户自行处理");
}
export function conversationRoot(operationId?: string): HTMLElement {
  assertNoChallenge();
  if (jobId(location.pathname) && operationId) return boundDialog(operationId);
  const roots = [
    ...document.querySelectorAll<HTMLElement>(".chat-content"),
  ].filter(visible);
  if (roots.length !== 1)
    throw new Error("没有识别到唯一的聊天内容区，请选择正确会话");
  return roots[0];
}
export function assertChatTarget(
  target: ChatTarget,
  root?: HTMLElement,
  url = location.href,
  operationId?: string,
) {
  root ??= conversationRoot(operationId);
  const parsed = new URL(url);
  if (
    parsed.origin === "https://www.zhipin.com" &&
    jobId(parsed.pathname) &&
    operationId
  ) {
    if (boundDialog(operationId, target) !== root)
      throw new Error("不是本次职位的对话框");
    return root;
  }
  if (
    parsed.origin !== "https://www.zhipin.com" ||
    parsed.pathname !== "/web/geek/chat"
  )
    throw new Error("不在 BOSS 聊天页");
  const idFromUrl = parsed.searchParams.get("jobId");
  const linkedIds = [
    ...new Set(
      [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]')]
        .filter(visible)
        .map((a) => jobId(a.href))
        .filter(Boolean),
    ),
  ];
  if (
    (idFromUrl && idFromUrl !== target.jobId) ||
    linkedIds.some((id) => id !== target.jobId)
  )
    throw new Error("当前聊天关联了其他岗位，禁止发送");
  if (
    idFromUrl !== target.jobId &&
    !(linkedIds.length === 1 && linkedIds[0] === target.jobId)
  )
    throw new Error("无法从聊天 URL 或岗位链接核对岗位 ID，已停止发送");
  const body = norm(text(root));
  if (
    !target.company ||
    !body.includes(norm(target.title)) ||
    !body.includes(norm(target.company))
  )
    throw new Error("聊天中的职位名称或公司不一致，禁止发送");
  if (target.recruiter && !body.includes(norm(target.recruiter)))
    throw new Error("聊天中的招聘者姓名不一致，禁止发送");
  return root;
}
export function editorIn(root: HTMLElement): HTMLElement {
  const editors = [
    ...root.querySelectorAll<HTMLElement>('textarea,[contenteditable="true"]'),
  ].filter(visible);
  if (editors.length !== 1)
    throw new Error("未识别到唯一可编辑消息框；对方未开放或页面结构变化");
  return editors[0];
}
function editorText(editor: HTMLElement) {
  return editor instanceof HTMLTextAreaElement ? editor.value : text(editor);
}
function sendButton(root: HTMLElement): HTMLElement {
  const nodes = [
    ...root.querySelectorAll<HTMLElement>(
      'button,a,span,div,[role="button"],input[type="submit"]',
    ),
  ].filter(
    (e) =>
      visible(e) &&
      (jobId(location.pathname)
        ? /^(发送|发送招呼|发送消息|开始沟通|立即沟通|确定)$/.test(
            norm(e instanceof HTMLInputElement ? e.value : text(e)),
          )
        : norm(e instanceof HTMLInputElement ? e.value : text(e)) === "发送"),
  );
  const leaves = nodes.filter(
    (n) => !nodes.some((other) => other !== n && n.contains(other)),
  );
  if (leaves.length !== 1)
    throw new Error("未识别到唯一发送按钮，禁止按回车猜测发送");
  for (
    let e: HTMLElement | null = leaves[0];
    e && e !== root;
    e = e.parentElement
  )
    if (
      e.hasAttribute("disabled") ||
      e.getAttribute("aria-disabled") === "true" ||
      e.classList.contains("disabled") ||
      e.classList.contains("btn-disabled")
    )
      throw new Error("发送按钮不可用");
  return leaves[0];
}
export function messageMatches(root: HTMLElement, greeting: string): Element[] {
  const candidates = [...root.querySelectorAll<HTMLElement>("*")].filter(
    (e) =>
      visible(e) &&
      !e.closest('textarea,[contenteditable="true"],button') &&
      norm(text(e)) === norm(greeting),
  );
  return candidates.filter(
    (e) => !candidates.some((other) => other !== e && e.contains(other)),
  );
}
export function probeChat(target: ChatTarget, operationId: string) {
  try {
    const root = assertChatTarget(
      target,
      undefined,
      location.href,
      operationId,
    );
    editorIn(root);
    return {
      ready: true,
      url: location.href,
      mode: jobId(location.pathname)
        ? ("detail_dialog" as const)
        : ("page" as const),
    };
  } catch (error) {
    return {
      ready: false,
      reason: error instanceof Error ? error.message : "对话框尚未就绪",
    };
  }
}
export async function inspectChat(
  target: ChatTarget,
  signal: AbortSignal,
  operationId?: string,
) {
  let reason = "聊天内容尚未出现";
  return waitUntil(
    () => {
      try {
        const root = assertChatTarget(
          target,
          undefined,
          location.href,
          operationId,
        );
        editorIn(root);
        // 新弹窗的发送按钮可能在填写内容后才启用。
        if (!jobId(location.pathname)) sendButton(root);
        return {
          url: location.href,
          mode: jobId(location.pathname)
            ? ("detail_dialog" as const)
            : ("page" as const),
        };
      } catch (error) {
        assertNoChallenge();
        reason = error instanceof Error ? error.message : "聊天内容尚未出现";
        return undefined;
      }
    },
    signal,
    10000,
    true,
    () => `沟通页核对超时：${reason}；未发送个性化招呼语`,
  );
}
export async function sendGreeting(
  target: ChatTarget,
  greeting: string,
  authorize: () => Promise<void>,
  signal: AbortSignal,
  operationId?: string,
): Promise<SendObservation> {
  const root = assertChatTarget(target, undefined, location.href, operationId),
    editor = editorIn(root),
    url = location.href;
  if (!greeting.trim()) throw new Error("个性化招呼语为空");
  if (messageMatches(root, greeting).length)
    throw new Error("历史中已有相同招呼语，禁止自动重复发送");
  if (
    editorText(editor).trim() &&
    !(
      operationId &&
      jobId(location.pathname) &&
      canReplacePlatformPreset(operationId, root, editor)
    )
  )
    throw new Error("聊天框已有用户草稿，未覆盖或发送");
  const previousDraft = editorText(editor);
  const modal = !!(operationId && jobId(location.pathname));
  const successStates = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="status"],[role="alert"],.toast,.toast-success,.ui-toast,.toast-content',
      ),
    ]
      .filter(visible)
      .filter((e) =>
        /^(?:消息)?发送成功[！!。]?$|^打招呼成功[！!。]?$|^招呼已发送[！!。]?$/.test(
          text(e),
        ),
      );
  const oldSuccess = new Map(successStates().map((e) => [e, text(e)]));
  const max = Number(editor.getAttribute("maxlength"));
  if (max > 0 && [...greeting].length > max)
    throw new Error("招呼语超过平台输入框长度限制");
  if (signal.aborted) throw new Error("任务已取消");
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor, greeting);
  } else editor.replaceChildren(document.createTextNode(greeting));
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: greeting,
    }),
  );
  editor.dispatchEvent(new Event("change", { bubbles: true }));
  let clicked = false;
  try {
    await authorize(); // 在不可撤销点击前，后台事务核对任务 epoch、目标 Tab 与单次发送意图。
    if (signal.aborted) throw new Error("任务已取消");
    if (location.href !== url || norm(editorText(editor)) !== norm(greeting))
      throw new Error("会话或草稿已被改变，未发送");
    assertChatTarget(
      target,
      conversationRoot(operationId),
      location.href,
      operationId,
    );
    const button = sendButton(conversationRoot(operationId));
    clicked = true;
    button.click();
    await waitUntil(
      () => {
        if (location.href !== url) {
          if (
            !modal ||
            location.origin !== "https://www.zhipin.com" ||
            location.pathname !== "/web/geek/chat"
          )
            throw new Error("发送后聊天页发生跳转");
          const current = assertChatTarget(target);
          return !editorText(editorIn(current)).trim() &&
            messageMatches(current, greeting).length
            ? true
            : undefined;
        }
        if (modal && (!root.isConnected || !visible(root))) {
          // 弹窗消失本身不等于成功；需观察到本次提交后新出现的明确平台成功反馈。
          if (
            jobId(location.pathname) !== target.jobId ||
            norm(text(document.querySelector("h1"))) !== norm(target.title)
          )
            throw new Error("发送后详情岗位已改变");
          return successStates().some((e) => oldSuccess.get(e) !== text(e))
            ? true
            : undefined;
        }
        const current = assertChatTarget(
          target,
          undefined,
          location.href,
          operationId,
        );
        if (/发送失败|消息发送失败/.test(text(current)))
          throw new Error("页面显示消息发送失败");
        if (
          !editorText(editorIn(current)).trim() &&
          messageMatches(current, greeting).length
        )
          return true;
        return undefined;
      },
      signal,
      10000,
      true,
      () =>
        "发送结果核验超时：未同时看到本次完整留言和输入框清空；结果待核查，禁止自动重发",
    );
    return {
      verified: true,
      reason: modal
        ? "本次招呼语提交后，目标会话出现完整留言或平台给出新的明确发送成功反馈"
        : "目标会话出现本次完整留言，输入框已清空",
      chatUrl: location.href,
    };
  } catch (error) {
    if (!clicked) {
      if (norm(editorText(editor)) === norm(greeting)) {
        if (editor instanceof HTMLTextAreaElement) editor.value = previousDraft;
        else editor.replaceChildren(document.createTextNode(previousDraft));
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
      throw error;
    }
    return {
      verified: false,
      reason: error instanceof Error ? error.message : "发送结果未确认",
      chatUrl: url,
    };
  }
}
