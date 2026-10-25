import type { ChatTarget } from "../../shared/schema";
import { jobId, text } from "./index";
import { visible } from "./chat";
const selector = ".dialog-wrap.startchat-dialog,.dialog-container";
const same = (a: ChatTarget, b: ChatTarget) =>
  a.jobId === b.jobId &&
  a.title === b.title &&
  a.company === b.company &&
  a.recruiter === b.recruiter;
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
export function firstContactDialogs(): HTMLElement[] {
  const roots = [...document.querySelectorAll<HTMLElement>(selector)].filter(
    (e) =>
      visible(e) &&
      [
        ...e.querySelectorAll(
          'textarea.input-area,textarea,[contenteditable="true"]',
        ),
      ].some(visible),
  );
  return roots.filter(
    (root) => !roots.some((other) => other !== root && root.contains(other)),
  );
}
let binding:
  | {
      id: string;
      target: ChatTarget;
      url: string;
      at: number;
      before: Set<HTMLElement>;
      root?: HTMLElement;
      initial: string;
      userEdited: boolean;
      observer: MutationObserver;
      cleanup?: () => void;
    }
  | undefined;
const editorValue = (editor: HTMLElement) =>
  editor instanceof HTMLTextAreaElement ? editor.value : text(editor);
function bindNewDialog() {
  const current = binding;
  if (!current || current.root) return;
  const roots = firstContactDialogs().filter((e) => !current.before.has(e));
  if (roots.length !== 1) return;
  const editor = roots[0].querySelector<HTMLElement>(
    'textarea.input-area,textarea,[contenteditable="true"]',
  );
  if (!editor) return;
  current.root = roots[0];
  current.initial = editorValue(editor);
  const onInput = (event: Event) => {
    if (event.isTrusted) current.userEdited = true;
  };
  roots[0].addEventListener("input", onInput, true);
  current.cleanup = () => roots[0].removeEventListener("input", onInput, true);
}
export function clearDialogBinding() {
  binding?.observer.disconnect();
  binding?.cleanup?.();
  binding = undefined;
}
export function beginDialogBinding(id: string, target: ChatTarget) {
  clearDialogBinding();
  if (jobId(location.pathname) !== target.jobId) return; // 仅绑定本岗独立详情，不绑定列表上原有会话。
  const before = new Set(firstContactDialogs());
  if (before.size) throw new Error("详情页已有可编辑对话框，请先处理草稿");
  const observer = new MutationObserver(bindNewDialog);
  binding = {
    id,
    target: { ...target },
    url: location.href,
    at: Date.now(),
    before,
    initial: "",
    userEdited: false,
    observer,
  };
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });
}
export function boundDialog(id: string, target?: ChatTarget): HTMLElement {
  bindNewDialog();
  const current = binding;
  if (
    !current ||
    current.id !== id ||
    (target && !same(current.target, target)) ||
    Date.now() - current.at > 60000
  )
    throw new Error("没有本次立即沟通的弹窗绑定，未发送");
  if (
    location.href !== current.url ||
    jobId(location.pathname) !== current.target.jobId ||
    norm(text(document.querySelector("h1"))) !== norm(current.target.title)
  )
    throw new Error("弹窗所属岗位或页面已改变，未发送");
  const roots = firstContactDialogs();
  if (
    !current.root ||
    roots.length !== 1 ||
    roots[0] !== current.root ||
    !current.root.isConnected
  )
    throw new Error("未找到本次唯一的首次沟通弹窗");
  if (current.userEdited)
    throw new Error("首次沟通弹窗已由用户编辑，未覆盖或发送");
  return current.root;
}
export function canReplacePlatformPreset(
  id: string,
  root: HTMLElement,
  editor: HTMLElement,
) {
  return (
    boundDialog(id) === root &&
    binding?.initial === editorValue(editor) &&
    !binding.userEdited
  );
}
