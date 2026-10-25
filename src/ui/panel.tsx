import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import {
  type Block,
  type Item,
  type PageContext,
  type Run,
  labels,
  rpc,
} from "../shared/schema";
import { cancelRun, db, exportRecords, getConfig } from "../storage/db";
import {
  continueRun,
  currentPage,
  execute,
  startRun,
  stopRun,
} from "../core/engine";
import { setupStatus, setupReady, type SetupStatus } from "../core/setup";
import { DeliveryIntervalControl } from "./delivery-interval";
import { deliveryIntervals, type DeliveryInterval } from "../shared/interval";
import { KeywordInput } from "./keywords";
import { parseKeywords } from "../core/keywords";
import { DEEPSEEK } from "../shared/deepseek";
import { skipJob } from "../storage/markers";
import { csvCell } from "../core/privacy";
import { Header, Notice, download, message, useRefresh } from "./common";

const runLabel = {
  running: "正在投递",
  paused: "已暂停",
  stopped: "已停止",
  completed: "本轮处理完成",
  blocked: "需要处理",
};
function Panel() {
  const [version, refresh] = useRefresh(),
    [page, setPage] = useState<{ tabId: number; context: PageContext } | null>(
      null,
    ),
    [run, setRun] = useState<Run | null>(null),
    [runs, setRuns] = useState<Run[]>([]),
    [items, setItems] = useState<Item[]>([]),
    [blocks, setBlocks] = useState<Block[]>([]);
  const [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [view, setView] = useState<"jobs" | "records" | "blocks">("jobs"),
    [confirm, setConfirm] = useState(false),
    [limit, setLimit] = useState(100),
    [filter, setFilter] = useState("all"),
    [busy, setBusy] = useState(false),
    [connecting, setConnecting] = useState(false),
    [setup, setSetup] = useState<SetupStatus>({
      resume: false,
      greeting: false,
      model: false,
    }),
    [autoLoop, setAutoLoop] = useState(true),
    [intervalEnabled, setIntervalEnabled] = useState(true),
    [intervalRange, setIntervalRange] = useState<DeliveryInterval>("15-30"),
    [titleWords, setTitleWords] = useState<string[]>([]),
    [titleBlockEnabled, setTitleBlockEnabled] = useState(true);
  const executing = useRef(false),
    mounted = useRef(true),
    selected = useRef<string | null>(null),
    connectingRef = useRef(false),
    pageRef = useRef<number | undefined>(undefined),
    loadedSettings = useRef(false),
    optionsDirty = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const all = (await db.runs.toArray()).sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        setRuns(all);
        const current =
          all.find((r) => r.id === selected.current) || all[0] || null;
        setRun(current);
        setItems(
          current
            ? (await db.items.where("runId").equals(current.id).toArray()).sort(
                (a, b) => (a.order ?? 0) - (b.order ?? 0),
              )
            : [],
        );
        setBlocks(await db.blocks.toArray());
        const config = await getConfig();
        setLimit(config.limit);
        const [profile, session, local] = await Promise.all([
          db.profiles.get("main"),
          chrome.storage.session.get("credential"),
          chrome.storage.local.get("credential"),
        ]);
        setSetup(
          setupStatus(config, profile, session.credential || local.credential),
        );
        if (!loadedSettings.current || !optionsDirty.current) {
          setAutoLoop(config.autoLoop);
          setIntervalEnabled(config.deliveryIntervalEnabled);
          setIntervalRange(config.deliveryInterval);
          setTitleWords(config.filters.excludeTitles);
          setTitleBlockEnabled(config.filters.titleBlockEnabled);
          loadedSettings.current = true;
        }
      } catch (e) {
        setError(message(e));
      }
    })();
  }, [version]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }
  function launch(next: Run) {
    if (executing.current) throw new Error("当前面板已有任务执行中");
    selected.current = next.id;
    setRun(next);
    executing.current = true;
    void execute(next, () => {
      if (mounted.current) refresh();
    }).finally(() => {
      executing.current = false;
      refresh();
    });
  }
  async function connect(quiet = false) {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const result = await currentPage(pageRef.current);
      pageRef.current = result.tabId;
      setPage(result);
      if (result.context.reason) {
        if (!quiet) setError(result.context.reason);
      } else if (!quiet) {
        setError("");
        setInfo(`已连接 ${result.context.accountLabel} 的 BOSS 搜索列表`);
      }
    } catch (e) {
      setPage(null);
      if (!quiet) setError(message(e));
    } finally {
      connectingRef.current = false;
      if (mounted.current) setConnecting(false);
    }
  }
  useEffect(() => {
    void connect(true);
    const activated = () => void connect(true),
      updated = (
        _id: number,
        info: chrome.tabs.OnUpdatedInfo,
        tab: chrome.tabs.Tab,
      ) => {
        if (
          (info.status === "complete" || !!info.url) &&
          tab.url?.startsWith("https://www.zhipin.com/")
        )
          void connect(true);
      };
    const heartbeat = setInterval(() => void connect(true), 5000);
    chrome.tabs.onActivated?.addListener(activated);
    chrome.tabs.onUpdated?.addListener(updated);
    return () => {
      clearInterval(heartbeat);
      chrome.tabs.onActivated?.removeListener(activated);
      chrome.tabs.onUpdated?.removeListener(updated);
    };
  }, []);
  async function prepare() {
    if (!setupReady(setup)) throw new Error("请先完成上方 3 项必填设置");
    const result = await currentPage(pageRef.current);
    setPage(result);
    pageRef.current = result.tabId;
    if (result.context.reason) throw new Error(result.context.reason);
    if (!result.context.supported)
      throw new Error("请先打开 BOSS 职位搜索列表");
    const config = await getConfig();
    config.filters.excludeTitles = parseKeywords(titleWords.join("\n"));
    config.filters.titleBlockEnabled = titleBlockEnabled;
    config.autoLoop = autoLoop;
    config.deliveryIntervalEnabled = intervalEnabled;
    config.deliveryInterval = intervalRange;
    config.version = crypto.randomUUID();
    await db.config.put({ id: "main", value: config });
    optionsDirty.current = false;
    setConfirm(true);
  }
  async function begin() {
    if (!page) return;
    setConfirm(false);
    await chrome.tabs.update(page.tabId, { active: true });
    launch(await startRun(page.tabId, page.context, autoLoop));
  }
  async function recover() {
    if (!run) return;
    if (run.status === "running") {
      await stopRun(run);
      setInfo("旧执行已暂停，请核对页面后点击继续。");
      return;
    }
    launch(await continueRun(run.id));
  }
  const shown = items.filter((i) => filter === "all" || i.status === filter);
  const count = (...statuses: string[]) =>
    items.filter((i) => statuses.includes(i.status)).length;
  return (
    <div className="panel-shell">
      <Header
        subtitle="每一次投递，智能还个性"
        actions={
          <button
            aria-label="打开设置"
            className="icon-button"
            onClick={() =>
              void action(async () => {
                await rpc({ type: "OPEN_OPTIONS" });
              })
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9.5 3-.6 2.1-1.5.9-2.1-.5-2.5 4.3 1.5 1.6v1.7l-1.5 1.6 2.5 4.3 2.1-.5 1.5.9.6 2.1h5l.6-2.1 1.5-.9 2.1.5 2.5-4.3-1.5-1.6v-1.7l1.5-1.6-2.5-4.3-2.1.5-1.5-.9L14.5 3z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        }
      />
      <div className="panel-body">
        <div className="connection">
          <span
            className={`dot ${page?.context.loggedIn || page?.context.supported ? "live" : ""}`}
          />
          <span>
            {page?.context.supported
              ? "BOSS直聘 搜索列表已连接"
              : page?.context.loggedIn
                ? "已登录 BOSS · 请打开职位列表"
                : connecting
                  ? "正在查找 BOSS 标签页…"
                  : "未连接 BOSS"}
          </span>
          <button
            className="text-button"
            disabled={connecting}
            onClick={() => void connect(false)}
          >
            {connecting ? "连接中…" : "刷新连接"}
          </button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}
        {page?.context.conflict && (
          <Notice tone="error">
            检测到其他 Boss Agent。请停用其他自动化扩展并刷新 BOSS 页面。
          </Notice>
        )}
        <section className="setup-card" aria-label="完善我的设置">
          <div className="setup-heading">
            <h3>
              完善我的设置{" "}
              <small>
                必填 {Object.values(setup).filter(Boolean).length}/3
              </small>
            </h3>
          </div>
          {(
            [
              ["resume", "简历与事实", setup.resume],
              ["greeting", "招呼语偏好", setup.greeting],
              ["model", "AI 服务 · DeepSeek", setup.model],
            ] as const
          ).map(([section, title, ready]) => (
            <button
              key={section}
              className="setup-row"
              onClick={() =>
                void action(async () => {
                  await rpc({ type: "OPEN_OPTIONS", section });
                })
              }
            >
              <span className={`setup-check ${ready ? "done" : ""}`}>
                {ready ? "✓" : "○"}
              </span>
              <span>
                {title} <em>*</em>
              </span>
              <small>{ready ? "已添加" : "待设置"}</small>
              <b>↗</b>
            </button>
          ))}
        </section>
        <section className="hero">
          <div className="hero-grid" />
          <p className="eyebrow">A BETTER FIRST CONVERSATION</p>
          <h2>
            智能生成招呼语，
            <br />
            自动投递新工作。
          </h2>
          <p>读取当前列表 · 匹配真实经历 · 草拟专属招呼语</p>
          <button
            className="primary start-delivery"
            disabled={busy || executing.current || run?.status === "running"}
            onClick={() => void action(prepare)}
          >
            开始投递 <span>↗</span>
          </button>
          {run && (
            <div className="run-status">
              <div>
                <strong>
                  <span
                    className={`dot ${run.status === "running" ? "live" : ""}`}
                  />
                  {run.status === "running" &&
                  (run.nextDeliveryAt || 0) > Date.now()
                    ? "间隔等待中"
                    : runLabel[run.status]}
                </strong>
                <small>
                  {run.status === "running" &&
                  (run.nextDeliveryAt || 0) > Date.now()
                    ? `约 ${Math.ceil((run.nextDeliveryAt! - Date.now()) / 1000)} 秒后继续，请保持侧栏和列表打开`
                    : run.reason || "请保持侧栏和目标列表打开"}
                </small>
              </div>
              <div className="row">
                {run.status === "running" ? (
                  <button
                    className="secondary compact"
                    onClick={() =>
                      void action(async () => {
                        await stopRun(run);
                      })
                    }
                  >
                    暂停
                  </button>
                ) : (
                  ["paused", "blocked", "completed"].includes(run.status) && (
                    <button
                      className="run-resume"
                      disabled={busy || executing.current}
                      onClick={() => void action(recover)}
                    >
                      继续
                    </button>
                  )
                )}
                {!["stopped", "completed"].includes(run.status) && (
                  <button
                    className="run-stop"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await stopRun(run, "stopped");
                      })
                    }
                  >
                    停止
                  </button>
                )}
              </div>
              {run.status === "running" && !executing.current && (
                <button
                  className="text-button"
                  onClick={() => void action(recover)}
                >
                  恢复失联任务（先暂停）
                </button>
              )}
            </div>
          )}
          <div className="delivery-options">
            <label className="check">
              <input
                type="checkbox"
                checked={autoLoop}
                disabled={run?.status === "running"}
                onChange={(e) => {
                  optionsDirty.current = true;
                  setAutoLoop(e.target.checked);
                }}
              />
              自动循环投放
            </label>
            <DeliveryIntervalControl
              enabled={intervalEnabled}
              range={intervalRange}
              disabled={run?.status === "running"}
              onChange={(enabled, range) => {
                optionsDirty.current = true;
                setIntervalEnabled(enabled);
                setIntervalRange(range);
              }}
            />
            <label className="check title-block-toggle">
              <input
                type="checkbox"
                checked={titleBlockEnabled}
                disabled={run?.status === "running"}
                onChange={(e) => {
                  optionsDirty.current = true;
                  setTitleBlockEnabled(e.target.checked);
                }}
              />
              屏蔽职位名称关键词
            </label>
            <KeywordInput
              value={titleWords}
              disabled={!titleBlockEnabled || run?.status === "running"}
              onChange={(words) => {
                optionsDirty.current = true;
                setTitleWords(words);
              }}
            />
          </div>
          <small>
            本次最多 {limit} 个岗位 · {autoLoop ? "自动循环" : "逐岗暂停"} ·
            生成个性化招呼语后自动发送
          </small>
          <small className="delivery-stage">
            核验发送后关闭本次聊天 Tab，回到列表继续。
          </small>
        </section>
        <div className="stats">
          <div>
            <b>{items.length}</b>
            <span>已发现</span>
          </div>
          <div>
            <b>{count("filtered_out", "rejected")}</b>
            <span>已排除</span>
          </div>
          <div>
            <b>{count("review", "ready")}</b>
            <span>待审核</span>
          </div>
          <div>
            <b>{count("sent_verified")}</b>
            <span>投递确认</span>
          </div>
        </div>
        <div className="tabs">
          <button
            className={view === "jobs" ? "active" : ""}
            onClick={() => setView("jobs")}
          >
            岗位工作台
          </button>
          <button
            className={view === "records" ? "active" : ""}
            onClick={() => setView("records")}
          >
            任务记录
          </button>
          <button
            className={view === "blocks" ? "active" : ""}
            onClick={() => setView("blocks")}
          >
            屏蔽 {blocks.length || ""}
          </button>
        </div>
        {view === "jobs" && (
          <>
            {!!items.length && (
              <div className="list-toolbar">
                <span>{shown.length} 个岗位</span>
                <select
                  aria-label="筛选记录状态"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!items.length ? (
              <div className="empty-state">
                <div>⌕</div>
                <h3>让合适的机会浮现</h3>
                <p>
                  先在设置中导入简历、配置 AI，
                  <br />
                  再回到 BOSS 搜索列表开始分析。
                </p>
              </div>
            ) : (
              shown.map((item) => (
                <JobCard
                  key={`${item.key}:${item.updatedAt}`}
                  item={item}
                  act={action}
                  refresh={refresh}
                />
              ))
            )}
            <Notice>
              AI
              评分仅供参考，不影响投递。只按用户设置的屏蔽与筛选条件跳过岗位；仅发送招呼语，不自动发送附件、联系方式或后续回复。
            </Notice>
          </>
        )}
        {view === "records" && (
          <>
            <div className="section-title">
              <h3>本地任务记录</h3>
              <div className="row">
                <button
                  className="secondary compact"
                  onClick={() =>
                    void action(async () =>
                      download(
                        "jobapply-records.json",
                        JSON.stringify(await exportRecords(), null, 2),
                      ),
                    )
                  }
                >
                  JSON
                </button>
                <button
                  className="secondary compact"
                  onClick={() =>
                    void action(async () => {
                      const data = await db.items.toArray();
                      download(
                        "jobapply-records.csv",
                        "\uFEFF" +
                          [
                            ["任务", "岗位", "公司", "状态", "原因", "招呼语"],
                            ...data.map((i) => [
                              i.runId,
                              i.job.title,
                              i.job.company,
                              labels[i.status],
                              i.reason,
                              i.evaluation?.greeting || "",
                            ]),
                          ]
                            .map((row) => row.map(csvCell).join(","))
                            .join("\r\n"),
                        "text/csv;charset=utf-8",
                      );
                    })
                  }
                >
                  CSV
                </button>
              </div>
            </div>
            {runs.length === 0 ? (
              <p className="muted">还没有任务记录。</p>
            ) : (
              runs.map((r) => (
                <button
                  className="record-row"
                  key={r.id}
                  onClick={() => {
                    selected.current = r.id;
                    setView("jobs");
                    refresh();
                  }}
                >
                  <span>
                    {new Date(r.createdAt).toLocaleString("zh-CN")}
                    <small>{r.reason || "当前列表分析"}</small>
                  </span>
                  <b>{runLabel[r.status]}</b>
                </button>
              ))
            )}
            <Notice>
              导出包含岗位、留言和结果，不包含 API Key 与完整简历。
            </Notice>
          </>
        )}
        {view === "blocks" && (
          <>
            <h3>已屏蔽的岗位</h3>
            {blocks.length === 0 ? (
              <p className="muted">点击岗位卡片上的“屏蔽岗位”添加。</p>
            ) : (
              blocks.map((b) => (
                <div className="record-row" key={b.id}>
                  <span>{b.label}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      void action(async () => {
                        await db.blocks.delete(b.id);
                        setInfo("已解除屏蔽，仅影响后续处理。");
                      })
                    }
                  >
                    解除
                  </button>
                </div>
              ))
            )}
            <p className="muted">
              公司黑名单在设置页管理。单岗屏蔽在后续任务中持续生效。
            </p>
          </>
        )}
        <footer className="panel-footer">
          JOBAPPLY AGENT <span>本地存储 · 由你掌控</span>
        </footer>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="确认本次投递"
          >
            <p className="eyebrow">BEFORE YOU START</p>
            <h2>确认本次投递</h2>
            <p>当前 BOSS 列表，最多 {limit} 个岗位。</p>
            <Snapshot />
            <Notice>
              将向设置中的 AI 服务发送脱敏事实、岗位 JD
              和招呼语。确认后将打开本岗独立详情，点击“立即沟通”，在本次 Tab
              或其新开的聊天 Tab 向对应招聘者发送个性化留言；核验后关闭本次页面
              并返回列表继续。开聊可能另触发 BOSS 默认招呼语。请保持侧栏打开。
            </Notice>
            <div className="row">
              <button className="secondary" onClick={() => setConfirm(false)}>
                返回
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void action(begin)}
              >
                确认并开始
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Snapshot() {
  const [summary, setSummary] = useState("");
  useEffect(() => {
    void getConfig()
      .then((c) =>
        setSummary(
          `模型：DeepSeek ${c.model} · ${new URL(c.baseUrl).origin}\n投递间隔：${c.deliveryIntervalEnabled ? deliveryIntervals[c.deliveryInterval].label : "关闭"}\n标题关键词：${c.filters.include.join("、") || "不限"}\n职位名称屏蔽：${c.filters.excludeTitles.join("、") || "无"}\n排除词：${c.filters.exclude.join("、") || "无"}\n公司屏蔽：${c.filters.companies.join("、") || "无"}\n薪资：${c.filters.salaryMin}–${c.filters.salaryMax || "不限"} 元/${{ month: "月", year: "年", day: "天", hour: "小时" }[c.filters.salaryUnit]}`,
        ),
      )
      .catch(() => setSummary("请先完善 AI 配置。"));
  }, []);
  return <pre className="snapshot">{summary}</pre>;
}
function JobCard({
  item,
  act,
  refresh,
}: {
  item: Item;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState(item.evaluation?.greeting || ""),
    [edit, setEdit] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <article className="job-card">
      <div className="job-card-top">
        <span className={`status-pill ${item.status}`}>
          {labels[item.status]}
        </span>
        {item.evaluation && (
          <span className="score">
            {item.evaluation.score}
            <small>匹配参考</small>
          </span>
        )}
      </div>
      <h3>
        <a href={item.job.url} target="_blank" rel="noreferrer">
          {item.job.title} <span>↗</span>
        </a>
      </h3>
      <p className="company">
        {item.job.company || "公司待确认"}{" "}
        <span>
          ·{" "}
          {/[\ue000-\uf8ff]/.test(item.job.salary)
            ? "薪资待核对"
            : item.job.salary || "薪资未知"}
        </span>
      </p>
      {item.reason && <p className="reason">{item.reason}</p>}
      {item.evaluation && (
        <>
          <div className="evidence">
            {item.evaluation.strengths.map((s, i) => (
              <span key={i}>↗ {s}</span>
            ))}
            <small>
              简历证据：{item.evaluation.matchedEvidenceIds.join("、") || "无"}
            </small>
          </div>
          {edit ? (
            <textarea
              aria-label="编辑招呼语"
              rows={6}
              maxLength={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <blockquote>{draft}</blockquote>
          )}
          <div className="row wrap">
            {edit ? (
              <button
                className="secondary compact"
                onClick={() =>
                  void act(async () => {
                    if (!draft.trim()) throw new Error("招呼语不能为空");
                    await db.items.update(item.key, {
                      evaluation: {
                        ...item.evaluation!,
                        greeting: draft.trim(),
                      },
                      approved: true,
                      updatedAt: Date.now(),
                    });
                    setEdit(false);
                    refresh();
                  })
                }
              >
                保存文案
              </button>
            ) : (
              <button
                className="secondary compact"
                onClick={() => setEdit(true)}
              >
                编辑文案
              </button>
            )}
            <button
              className="primary compact"
              onClick={() =>
                void act(async () => {
                  await navigator.clipboard.writeText(draft);
                  setCopied(true);
                })
              }
            >
              {copied ? "已复制" : "复制招呼语"}
            </button>
          </div>
        </>
      )}
      {item.job.jd && (
        <details>
          <summary>查看岗位 JD</summary>
          <pre>{item.job.jd}</pre>
        </details>
      )}
      {item.status === "failed" && (
        <button
          className="secondary compact"
          onClick={() =>
            void act(async () => {
              const current = await db.runs.get(item.runId);
              if (current?.status === "running")
                throw new Error("请先暂停任务");
              await db.items.update(item.key, {
                status: "discovered",
                reason: "等待重新处理",
                evaluation: undefined,
                updatedAt: Date.now(),
              });
              refresh();
            })
          }
        >
          重试此岗位（再点击继续）
        </button>
      )}
      {![
        "sent_verified",
        "sending",
        "opening_chat",
        "uncertain",
        "skipped",
      ].includes(item.status) && (
        <button
          className="secondary compact"
          onClick={() =>
            void act(async () => {
              const task = await db.runs.get(item.runId);
              if (!task) throw new Error("任务不存在");
              await skipJob(
                task.tabId,
                task.accountScope,
                task.pageUrl,
                item.job.id,
                item.job.title,
              );
              refresh();
            })
          }
        >
          跳过
        </button>
      )}
      <div className="job-actions">
        <button
          className="text-button"
          onClick={() =>
            void act(async () => {
              await db.blocks.put({
                id: item.job.id,
                label: `${item.job.title} · ${item.job.company}`,
                at: Date.now(),
              });
              refresh();
            })
          }
        >
          屏蔽岗位
        </button>
        <button
          className="text-button"
          onClick={() =>
            void act(async () => {
              const config = await getConfig();
              if (!item.job.company) throw new Error("缺少公司名称");
              config.filters.companies = [
                ...new Set([...config.filters.companies, item.job.company]),
              ];
              config.version = crypto.randomUUID();
              await db.config.put({ id: "main", value: config });
            })
          }
        >
          屏蔽公司（新任务生效）
        </button>
      </div>
    </article>
  );
}
createRoot(document.getElementById("root")!).render(<Panel />);
