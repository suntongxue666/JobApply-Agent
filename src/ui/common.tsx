import { useEffect, useState, type ReactNode } from "react";
export function Header({
  subtitle,
  actions,
}: {
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      <img className="brand-mark" src="icons/icon-128.png" alt="工作智投" />
      <div className="brand">
        <h1>
          工作智投 <small>BETA</small>
        </h1>
        <p>{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function useRefresh(ms = 1500) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setVersion((v) => v + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return [version, () => setVersion((v) => v + 1)] as const;
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : "操作失败，请重试";
}
