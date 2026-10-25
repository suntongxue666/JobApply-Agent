import { z } from "zod";
import { DEEPSEEK } from "./deepseek";

export const filtersSchema = z
  .object({
    include: z.array(z.string().max(80)).max(50),
    excludeTitles: z.array(z.string().max(80)).max(50).default([]),
    titleBlockEnabled: z.boolean().default(true),
    includeMode: z.enum(["any", "all"]),
    exclude: z.array(z.string().max(80)).max(50),
    excludeScope: z.enum(["title", "company", "jd", "all"]),
    companies: z.array(z.string().max(100)).max(100),
    companyMode: z.enum(["contains", "exact"]),
    jobType: z.enum(["any", "fulltime", "parttime", "intern"]),
    salaryMin: z.number().min(0),
    salaryMax: z.number().min(0),
    salaryUnit: z.enum(["month", "year", "day", "hour"]),
    salaryMode: z.enum(["overlap", "contained"]),
    unknownSalary: z.enum(["review", "skip"]),
  })
  .refine(
    (v) => !v.salaryMax || v.salaryMax >= v.salaryMin,
    "最高薪资不能小于最低薪资",
  );
export const configSchema = z
  .object({
    baseUrl: z.string().max(300),
    model: z.string().max(100),
    greeting: z.string().max(3000),
    greetingConfirmed: z.boolean().default(false),
    autoLoop: z.boolean().default(true),
    deliveryIntervalEnabled: z.boolean().default(true),
    deliveryInterval: z
      .enum(["15-30", "31-60", "60-120", "121-180"])
      .default("15-30"),
    tone: z.string().max(100),
    minChars: z.number().int().min(10).max(500),
    maxChars: z.number().int().min(20).max(1000),
    filters: filtersSchema,
    limit: z.number().int().min(1).max(100),
    limitConfigured: z.boolean().default(false),
    minScore: z.number().int().min(0).max(100),
    consentOrigin: z.string(),
    version: z.string(),
  })
  .refine((v) => v.minChars <= v.maxChars, "最小字数不能大于最大字数");
export type Config = z.infer<typeof configSchema>;
export type Filters = z.infer<typeof filtersSchema>;
export const defaults: Config = {
  baseUrl: DEEPSEEK.baseUrl,
  model: DEEPSEEK.model,
  greetingConfirmed: false,
  autoLoop: true,
  deliveryIntervalEnabled: true,
  deliveryInterval: "15-30",
  greeting: "您好，我对这个岗位很感兴趣，希望结合我的相关经历进一步交流。",
  tone: "简洁、自然、专业",
  minChars: 80,
  maxChars: 150,
  limit: 100,
  limitConfigured: false,
  minScore: 80,
  consentOrigin: "",
  version: "",
  filters: {
    include: [],
    includeMode: "any",
    excludeTitles: [],
    titleBlockEnabled: true,
    exclude: [],
    excludeScope: "all",
    companies: [],
    companyMode: "contains",
    jobType: "any",
    salaryMin: 0,
    salaryMax: 0,
    salaryUnit: "month",
    salaryMode: "overlap",
    unknownSalary: "review",
  },
};
export const jobSchema = z.object({
  openInDetail: z.boolean().optional(),
  id: z.string().regex(/^[\w-]{4,100}$/),
  url: z.string().max(1000),
  title: z.string().min(1).max(300),
  company: z.string().max(300),
  recruiter: z.string().max(100).optional(),
  salary: z.string().max(200),
  tags: z.string().max(1000),
  jd: z.string().max(25000),
  communicated: z.boolean(),
  type: z.enum(["unknown", "fulltime", "parttime", "intern"]),
});
export type Job = z.infer<typeof jobSchema>;
export const evaluationSchema = z.object({
  decision: z.enum(["pass", "review", "reject"]),
  score: z.number().min(0).max(100),
  matchedEvidenceIds: z.array(z.string()).max(10),
  strengths: z.array(z.string().max(300)).max(5),
  gaps: z.array(z.string().max(300)).max(5),
  greeting: z.string().max(1000),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export interface Fact {
  id: string;
  text: string;
}
export interface Profile {
  id: "main";
  facts: Fact[];
  text: string;
  version: string;
  confirmed: boolean;
}
export type ItemStatus =
  | "discovered"
  | "extracting"
  | "filtered_out"
  | "evaluating"
  | "rejected"
  | "review"
  | "ready"
  | "opening_chat"
  | "sending"
  | "sent_verified"
  | "uncertain"
  | "failed"
  | "skipped";
export interface Item {
  order?: number;
  key: string;
  runId: string;
  job: Job;
  status: ItemStatus;
  reason: string;
  evaluation?: Evaluation;
  approved?: boolean;
  updatedAt: number;
}
export interface Run {
  id: string;
  tabId: number;
  pageUrl: string;
  accountScope: string;
  config: Config;
  profile: Profile;
  mode: "preview" | "auto";
  status: "running" | "paused" | "stopped" | "completed" | "blocked";
  epoch: number;
  createdAt: number;
  heartbeat: number;
  nextDeliveryAt?: number;
  reason: string;
}
export interface Application {
  key: string;
  runId: string;
  jobId: string;
  accountScope: string;
  action: "greeting" | "conversation";
  status: "intent" | "verified" | "uncertain";
  text: string;
  createdAt: number;
  verifiedAt?: number;
}
export interface PageContext {
  url: string;
  accountScope: string;
  accountLabel: string;
  supported: boolean;
  reason: string;
  conflict: boolean;
  loggedIn?: boolean;
}
export interface EventRecord {
  id?: number;
  runId: string;
  jobId?: string;
  step: string;
  message: string;
  at: number;
}
export interface Block {
  id: string;
  label: string;
  at: number;
}
export const uiMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("READ_JOB_DETAIL"),
    runId: z.string().uuid(),
    epoch: z.number().int(),
    key: z.string(),
  }),
  z.object({ type: z.literal("TEST_MODEL") }),
  z.object({
    type: z.literal("EVALUATE"),
    runId: z.string().uuid(),
    key: z.string(),
    epoch: z.number().int(),
  }),
  z.object({ type: z.literal("CANCEL"), runId: z.string().uuid() }),
  z.object({
    type: z.literal("PREPARE_DELIVERY"),
    runId: z.string().uuid(),
    epoch: z.number().int(),
    key: z.string(),
  }),
  z.object({
    type: z.literal("DELIVER"),
    runId: z.string().uuid(),
    epoch: z.number().int(),
    operationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("OPEN_OPTIONS"),
    section: z
      .enum(["resume", "greeting", "model", "filters", "execution", "data"])
      .optional(),
  }),
]);
export type UiMessage = z.infer<typeof uiMessageSchema>;
export async function rpc<T>(message: UiMessage): Promise<T> {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw new Error(result?.error || "后台未响应，请重新加载扩展");
  return result.data as T;
}
export const labels: Record<ItemStatus, string> = {
  discovered: "等待读取",
  extracting: "正在读取 JD",
  filtered_out: "规则排除",
  evaluating: "AI 分析",
  rejected: "AI 不匹配",
  review: "留言待审",
  ready: "待发送",
  opening_chat: "发起沟通",
  sending: "正在发送",
  sent_verified: "留言已确认",
  uncertain: "结果待核查",
  failed: "失败",
  skipped: "已跳过",
};

export interface Credential {
  value: string;
  origin: string;
}
export function credentialFor(raw: unknown, origin: string): string {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("value" in raw) ||
    !("origin" in raw) ||
    typeof raw.value !== "string" ||
    raw.origin !== origin
  )
    return "";
  return raw.value;
}

export interface JobMarker {
  jobId: string;
  status: ItemStatus;
  label: string;
  reason: string;
  canSkip: boolean;
}
export interface PageSkip {
  key: string;
  accountScope: string;
  pageUrl: string;
  jobId: string;
  label: string;
  createdAt: number;
}
export const contentRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("AUTHORIZE_CHAT_SEND"),
    operationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("AUTHORIZE_OPEN_CHAT"),
    operationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("GET_JOB_MARKERS"),
    accountScope: z.string().min(1).max(128),
    pageUrl: z.string().max(2000),
  }),
  z.object({
    type: z.literal("SKIP_JOB"),
    accountScope: z.string().min(1).max(128),
    pageUrl: z.string().max(2000),
    jobId: z.string().regex(/^[\w-]{4,100}$/),
    label: z.string().max(600),
  }),
]);

export interface DeliveryOperation {
  id: string;
  runId: string;
  itemKey: string;
  jobId: string;
  epoch: number;
  sourceTabId: number;
  detailUrl?: string;
  detailTabId?: number;
  accountScope: string;
  status:
    | "armed"
    | "opening"
    | "loading_detail"
    | "chat_ready"
    | "send_intent"
    | "clicked"
    | "verified"
    | "uncertain"
    | "closed";
  createdAt: number;
  openAuthorizedAt?: number;
  chatTabId?: number;
  chatUrl?: string;
  chatMode?: "page" | "detail_dialog";
  candidates: number[];
  text: string;
  clickedAt?: number;
  error?: string;
}
export interface ChatTarget {
  jobId: string;
  title: string;
  company: string;
  recruiter?: string;
}
export interface SendObservation {
  verified: boolean;
  reason: string;
  chatUrl: string;
}
