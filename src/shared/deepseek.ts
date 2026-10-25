// 2026-10-25：按 DeepSeek 官方 Chat Completions 文档配置。
export const DEEPSEEK = {
  origin: "https://api.deepseek.com",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
} as const;
export function deepseekConfig<T extends { baseUrl: string; model: string }>(
  config: T,
): T {
  return { ...config, baseUrl: DEEPSEEK.baseUrl, model: DEEPSEEK.model };
}
