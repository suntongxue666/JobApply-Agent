export function redact(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已移除]")
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[电话已移除]")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "[证件已移除]")
    .replace(
      /(?:住址|家庭地址|通讯地址|身份证|微信|手机|联系电话)\s*[:：][^\n]*/g,
      "[私人字段已移除]",
    );
}
export async function hash(text: string): Promise<string> {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(data)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function csvCell(v: unknown): string {
  let text = String(v ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
