import { useState } from "react";
import { parseKeywords } from "../core/keywords";
export function KeywordInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const next = parseKeywords([...value, draft].join("\n"));
    if (next.length > 50) return;
    onChange(next);
    setDraft("");
  }
  return (
    <div className={`keyword-editor ${disabled ? "disabled" : ""}`}>
      <div className="keyword-tags">
        {value.map((word) => (
          <span className="keyword-tag" key={word}>
            {word}
            <button
              type="button"
              aria-label={`移除屏蔽词 ${word}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((w) => w !== word))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="添加屏蔽职位名称关键词"
        placeholder="输入屏蔽词，按回车添加"
        value={draft}
        maxLength={80}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) commit();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <span className="keyword-help">任意一个词命中职位名称即跳过</span>
    </div>
  );
}
