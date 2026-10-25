import { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { KeywordInput } from "../src/ui/keywords";
import { parseKeywords } from "../src/core/keywords";
it("回车添加多个关键词，去重保留已添加词；输入法合成回车不提交", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onChange = vi.fn();
  await act(async () =>
    root.render(<KeywordInput value={["兼职"]} onChange={onChange} />),
  );
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "实习");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
  });
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onChange).toHaveBeenCalledWith(["兼职", "实习"]);
  await act(async () => root.unmount());
  host.remove();
});
it("换行、逗号和顿号均可分词；大小写及全角重复词合并", () =>
  expect(parseKeywords("实习，兼职\nAI、ａｉ, 实习")).toEqual([
    "实习",
    "兼职",
    "AI",
  ]));
