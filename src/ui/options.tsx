import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  configSchema,
  defaults,
  credentialFor,
  rpc,
  type Config,
  type Profile,
} from "../shared/schema";
import { db, exportRecords, getConfig } from "../storage/db";
import { DEEPSEEK } from "../shared/deepseek";
import { redact } from "../core/privacy";
import { parseResume } from "../resume/parse";
import { DeliveryIntervalControl } from "./delivery-interval";
import { KeywordInput } from "./keywords";
import { closeSettingsPage } from "./close-settings";
import { Field, Header, Notice, download, message } from "./common";

const words = (s: string) =>
  s
    .split(/[\n,，]/)
    .map((v) => v.trim())
    .filter(Boolean);
function Options() {
  const [section, setSection] = useState(() =>
      ["resume", "greeting", "model", "filters", "execution", "data"].includes(
        location.hash.slice(1),
      )
        ? location.hash.slice(1)
        : "resume",
    ),
    [config, setConfig] = useState<Config>(structuredClone(defaults)),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false);
  const [resume, setResume] = useState(""),
    [factText, setFactText] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const [c, p, session, local] = await Promise.all([
          getConfig(),
          db.profiles.get("main"),
          chrome.storage.session.get("credential"),
          chrome.storage.local.get("credential"),
        ]);
        setConfig(c);
        setHasKey(
          !!credentialFor(
            session.credential || local.credential,
            DEEPSEEK.origin,
          ),
        );
        if (p) {
          setResume(p.text);
          setFactText(p.facts.map((f) => f.text).join("\n"));
          setConfirmed(p.confirmed);
        }
        setLoaded(true);
      } catch (e) {
        setError(message(e));
      }
    })();
  }, []);
  useEffect(() => {
    const change = () => {
      const next = location.hash.slice(1);
      if (
        [
          "resume",
          "greeting",
          "model",
          "filters",
          "execution",
          "data",
        ].includes(next)
      )
        setSection(next);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const update = <K extends keyof Config>(k: K, v: Config[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));
  const filter = <K extends keyof Config["filters"]>(
    k: K,
    v: Config["filters"][K],
  ) => setConfig((c) => ({ ...c, filters: { ...c.filters, [k]: v } }));
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if ((await db.runs.where("status").equals("running").count()) > 0)
      throw new Error("请先暂停正在运行的任务再修改配置");
    const validated = configSchema.safeParse({
      ...config,
      limitConfigured: true,
      baseUrl: DEEPSEEK.baseUrl,
      model: DEEPSEEK.model,
      greetingConfirmed:
        config.greetingConfirmed ||
        (section === "greeting" && !!config.greeting.trim()),
      filters: {
        ...config.filters,
        include: words(config.filters.include.join("\n")),
        excludeTitles: words(config.filters.excludeTitles.join("\n")),
        exclude: words(config.filters.exclude.join("\n")),
        companies: words(config.filters.companies.join("\n")),
      },
      version: crypto.randomUUID(),
    });
    if (!validated.success)
      throw new Error(
        validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("；"),
      );
    const c = validated.data;
    const factLines = factText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (confirmed && (resume.trim().length < 20 || !factLines.length))
      throw new Error("请填写简历和至少一条确认事实");
    const p: Profile = {
      id: "main",
      text: resume.trim(),
      facts: factLines.map((text, index) => ({
        id: `fact_${index + 1}`,
        text,
      })),
      version: crypto.randomUUID(),
      confirmed,
    };

    await Promise.all([
      chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
      chrome.storage.session.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      }),
    ]);
    const oldCredential =
      (await chrome.storage.session.get("credential")).credential ||
      (await chrome.storage.local.get("credential")).credential;
    const origin = DEEPSEEK.origin;
    const nextKey = key.trim() || credentialFor(oldCredential, origin);
    // 只在用户显式保存时改变存储方式，UI 不读取已有密钥到输入框。
    if (!nextKey && oldCredential) {
      await Promise.all([
        chrome.storage.local.remove("credential"),
        chrome.storage.session.remove("credential"),
      ]);
      setHasKey(false);
    }
    if (nextKey) {
      await chrome.storage.local.set({
        credential: { value: nextKey, origin },
      });
      await chrome.storage.session.remove("credential");
      setHasKey(true);
    }
    c.consentOrigin = nextKey ? DEEPSEEK.origin : "";
    await db.transaction("rw", db.config, db.profiles, async () => {
      await db.config.put({ id: "main", value: c });
      await db.profiles.put(p);
    });
    setConfig(c);
    setKey("");
    setStatus(
      "设置已保存；岗位上限在新任务或点击继续时生效，其他设置用于新任务。",
    );
  }
  return (
    <div className="options-shell">
      <Header
        subtitle="把经历变成有针对性的第一句话"
        actions={
          <div className="settings-header-actions">
            <span className="local-badge">本地优先 · 无自建后端</span>
            <button
              className="settings-close"
              aria-label="关闭设置页面"
              title="关闭设置页面"
              disabled={busy}
              onClick={() => void action(closeSettingsPage)}
            >
              X
            </button>
          </div>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav">
          <p className="eyebrow">工作空间设置</p>
          {[
            ["resume", "01", "简历与事实"],
            ["greeting", "02", "招呼语偏好"],
            ["model", "03", "AI 服务"],
            ["filters", "04", "筛选与屏蔽"],
            ["execution", "05", "执行设置"],
            ["data", "06", "本地数据"],
          ].map(([id, n, title]) => (
            <button
              className={section === id ? "selected" : ""}
              onClick={() => {
                setSection(id);
                location.hash = id;
              }}
              key={id}
            >
              <span>{n}</span>
              {title}
              {["resume", "greeting", "model"].includes(id) && (
                <span className="required-badge">必填</span>
              )}
            </button>
          ))}
          <div className="nav-note">
            首期支持 BOSS Web
            <br />
            v0.3 · 招呼语自动投递
          </div>
        </nav>
        <main className="settings-main">
          {error && <Notice tone="error">{error}</Notice>}
          {status && <Notice tone="success">{status}</Notice>}
          {!loaded ? (
            <p>正在读取本地设置…</p>
          ) : (
            <>
              {section === "resume" && (
                <>
                  <p className="eyebrow">YOUR EXPERIENCE</p>
                  <h2>
                    从你的真实经历开始{" "}
                    <span className="required-badge">必填</span>
                  </h2>
                  <p className="muted">
                    文件在浏览器本地解析。确认后的事实会用于 AI
                    分析，原始文件不会上传到 BOSS。
                  </p>
                  <div className="upload-box">
                    <strong>导入你的简历</strong>
                    <p>PDF（文本型）/ DOCX / TXT / Markdown，最大 10 MB</p>
                    <input
                      aria-label="上传简历"
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void action(async () => {
                            const text = await parseResume(file);
                            setResume(text);
                            setConfirmed(false);
                            setStatus("已提取文本，请核对后整理事实。");
                          });
                        e.target.value = "";
                      }}
                    />
                  </div>
                  <Field label="简历文本" hint="可直接粘贴；修改后需重新确认。">
                    <textarea
                      rows={12}
                      value={resume}
                      maxLength={50000}
                      onChange={(e) => {
                        setResume(e.target.value);
                        setConfirmed(false);
                      }}
                      placeholder="粘贴工作经历、项目、技能与教育背景…"
                    />
                  </Field>
                  <div className="row">
                    <button
                      className="secondary"
                      onClick={() => {
                        setFactText(
                          resume
                            .split(/\n/)
                            .map((v) => v.trim())
                            .filter((v) => v.length >= 8)
                            .join("\n"),
                        );
                        setConfirmed(false);
                      }}
                    >
                      将简历各行整理为待核对事实
                    </button>
                  </div>
                  <Field
                    label="已核对事实（每行一条）"
                    hint="保留角色、项目、时间、成果及口径；只写真实经历，缺失信息不补齐。"
                  >
                    <textarea
                      rows={10}
                      value={factText}
                      maxLength={40000}
                      onChange={(e) => {
                        setFactText(e.target.value);
                        setConfirmed(false);
                      }}
                      placeholder="例如：在某项目担任产品经理，负责需求分析和产品上线。"
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已核对上述事实，允许它们用于个性化留言生成。
                  </label>
                  <details>
                    <summary>查看将发给模型的事实文本（自动脱敏后）</summary>
                    <pre>{redact(factText) || "尚未填写事实"}</pre>
                  </details>
                </>
              )}
              {section === "greeting" && (
                <>
                  <p className="eyebrow">SAY HELLO, YOUR WAY</p>
                  <h2>
                    保留你的表达方式{" "}
                    <span className="required-badge">必填</span>
                  </h2>
                  <p className="muted">
                    原始招呼语用于语气与重点参考。AI 结合每份岗位
                    JD，选取相关经历重新草拟。
                  </p>
                  <Field
                    label={
                      <span className="greeting-label">
                        原始打招呼内容
                        <span className="greeting-label-note">
                          （根据原始内容和职位信息，智能生成个性化打招呼内容）
                        </span>
                      </span>
                    }
                  >
                    <textarea
                      rows={7}
                      maxLength={3000}
                      value={config.greeting}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          greeting: e.target.value,
                          greetingConfirmed: false,
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label="表达偏好"
                    hint="例如：简洁自然、保留结尾邀请交流，不使用夸张表述。"
                  >
                    <input
                      value={config.tone}
                      maxLength={100}
                      onChange={(e) => update("tone", e.target.value)}
                    />
                  </Field>
                  <div className="two-cols">
                    <Field label="最少字符">
                      <input
                        type="number"
                        min={10}
                        max={500}
                        value={config.minChars}
                        onChange={(e) => update("minChars", +e.target.value)}
                      />
                    </Field>
                    <Field label="最多字符">
                      <input
                        type="number"
                        min={20}
                        max={1000}
                        value={config.maxChars}
                        onChange={(e) => update("maxChars", +e.target.value)}
                      />
                    </Field>
                  </div>
                  <Notice>
                    字符数包含标点。联系方式、陌生链接、无法追溯的数字和模型自述会被本地校验拦截。
                  </Notice>
                </>
              )}
              {section === "model" && (
                <>
                  <p className="eyebrow">DEEPSEEK AI</p>
                  <h2>
                    AI 服务 <span className="required-badge">必填</span>
                  </h2>
                  <p className="muted">
                    已为你配置好 DeepSeek 官方接口和模型，只需填写 API Key。
                  </p>
                  <div className="provider-card">
                    <b>DeepSeek</b>
                    <span>官方 API · 自动配置</span>
                  </div>
                  <Field
                    label="DeepSeek API Key"
                    hint={
                      hasKey
                        ? "已添加密钥，留空保留，输入新值替换。"
                        : "密钥仅保存在此浏览器，不会出现在 BOSS 页面、日志或导出中。"
                    }
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={
                        hasKey
                          ? "已保存 · 输入新 Key 可替换"
                          : "输入 DeepSeek API Key"
                      }
                    />
                  </Field>
                  <p className="muted">
                    保存并使用后，岗位 JD、脱敏简历事实和招呼语将发送至 DeepSeek
                    官方服务。
                    <a
                      href="https://platform.deepseek.com/api_keys"
                      target="_blank"
                      rel="noreferrer"
                    >
                      获取 API Key ↗
                    </a>
                  </p>
                  <div className="row wrap">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await save();
                          const result = await rpc<{ message: string }>({
                            type: "TEST_MODEL",
                          });
                          setStatus(result.message);
                        })
                      }
                    >
                      保存并测试连接
                    </button>
                    <button
                      className="text-button"
                      disabled={busy || !hasKey}
                      onClick={() =>
                        void action(async () => {
                          await Promise.all([
                            chrome.storage.local.remove("credential"),
                            chrome.storage.session.remove("credential"),
                          ]);
                          setHasKey(false);
                          setKey("");
                          setStatus("DeepSeek 密钥已移除");
                        })
                      }
                    >
                      移除密钥
                    </button>
                  </div>
                  <Notice>
                    无需填写模型名称、接口地址或单独授权域名。连接测试只发送简短测试文本，不包含简历；使用费用由
                    DeepSeek 收取。
                  </Notice>
                </>
              )}
              {section === "filters" && (
                <>
                  <p className="eyebrow">FOCUS ON THE RIGHT FIT</p>
                  <h2>让列表更贴近你的目标</h2>
                  <p className="muted">
                    这些规则只筛选 BOSS
                    当前搜索结果，不会修改网站搜索条件。多个词以换行或逗号分隔。
                  </p>
                  <label className="check title-block-toggle">
                    <input
                      type="checkbox"
                      checked={config.filters.titleBlockEnabled}
                      onChange={(e) =>
                        filter("titleBlockEnabled", e.target.checked)
                      }
                    />
                    屏蔽职位名称关键词
                  </label>
                  <KeywordInput
                    value={config.filters.excludeTitles}
                    disabled={!config.filters.titleBlockEnabled}
                    onChange={(words) => filter("excludeTitles", words)}
                  />
                  <Field label="标题包含关键词">
                    <textarea
                      rows={2}
                      value={config.filters.include.join("\n")}
                      onChange={(e) =>
                        filter("include", e.target.value.split("\n"))
                      }
                      onBlur={() =>
                        filter(
                          "include",
                          words(config.filters.include.join("\n")),
                        )
                      }
                    />
                  </Field>
                  <Field label="包含方式">
                    <select
                      value={config.filters.includeMode}
                      onChange={(e) =>
                        filter("includeMode", e.target.value as "any" | "all")
                      }
                    >
                      <option value="any">任意命中</option>
                      <option value="all">全部命中</option>
                    </select>
                  </Field>
                  <Field label="排除关键词">
                    <textarea
                      rows={2}
                      value={config.filters.exclude.join("\n")}
                      onChange={(e) =>
                        filter("exclude", e.target.value.split("\n"))
                      }
                      onBlur={() =>
                        filter(
                          "exclude",
                          words(config.filters.exclude.join("\n")),
                        )
                      }
                    />
                  </Field>
                  <Field label="排除范围">
                    <select
                      value={config.filters.excludeScope}
                      onChange={(e) =>
                        filter(
                          "excludeScope",
                          e.target.value as Config["filters"]["excludeScope"],
                        )
                      }
                    >
                      <option value="all">标题、公司与 JD</option>
                      <option value="title">标题</option>
                      <option value="company">公司</option>
                      <option value="jd">JD</option>
                    </select>
                  </Field>
                  <Field label="公司黑名单">
                    <textarea
                      rows={3}
                      value={config.filters.companies.join("\n")}
                      onChange={(e) =>
                        filter("companies", e.target.value.split("\n"))
                      }
                      onBlur={() =>
                        filter(
                          "companies",
                          words(config.filters.companies.join("\n")),
                        )
                      }
                    />
                  </Field>
                  <div className="two-cols">
                    <Field label="公司匹配">
                      <select
                        value={config.filters.companyMode}
                        onChange={(e) =>
                          filter(
                            "companyMode",
                            e.target.value as "exact" | "contains",
                          )
                        }
                      >
                        <option value="contains">名称包含</option>
                        <option value="exact">完全一致</option>
                      </select>
                    </Field>
                    <Field label="岗位性质">
                      <select
                        value={config.filters.jobType}
                        onChange={(e) =>
                          filter(
                            "jobType",
                            e.target.value as Config["filters"]["jobType"],
                          )
                        }
                      >
                        <option value="any">不限</option>
                        <option value="fulltime">全职</option>
                        <option value="parttime">兼职</option>
                        <option value="intern">实习</option>
                      </select>
                    </Field>
                  </div>
                  <div className="two-cols">
                    <Field label="最低薪资（元，0 为不限）">
                      <input
                        type="number"
                        min={0}
                        value={config.filters.salaryMin}
                        onChange={(e) => filter("salaryMin", +e.target.value)}
                      />
                    </Field>
                    <Field label="最高薪资（元，0 为不限）">
                      <input
                        type="number"
                        min={0}
                        value={config.filters.salaryMax}
                        onChange={(e) => filter("salaryMax", +e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="two-cols">
                    <Field label="薪资单位">
                      <select
                        value={config.filters.salaryUnit}
                        onChange={(e) =>
                          filter(
                            "salaryUnit",
                            e.target.value as Config["filters"]["salaryUnit"],
                          )
                        }
                      >
                        <option value="month">元 / 月</option>
                        <option value="year">元 / 年</option>
                        <option value="day">元 / 天</option>
                        <option value="hour">元 / 小时</option>
                      </select>
                    </Field>
                    <Field label="区间判断">
                      <select
                        value={config.filters.salaryMode}
                        onChange={(e) =>
                          filter(
                            "salaryMode",
                            e.target.value as "overlap" | "contained",
                          )
                        }
                      >
                        <option value="overlap">与期望区间重叠</option>
                        <option value="contained">完全处于期望区间内</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="未知薪资或单位不符">
                    <select
                      value={config.filters.unknownSalary}
                      onChange={(e) =>
                        filter(
                          "unknownSalary",
                          e.target.value as "review" | "skip",
                        )
                      }
                    >
                      <option value="review">进入人工审核</option>
                      <option value="skip">直接跳过</option>
                    </select>
                  </Field>
                  <Notice>
                    薪资混淆字体不会猜测转换；面议、缺失或无法解析时按上方规则处理。日薪、时薪、年薪不强行折算月薪。
                  </Notice>
                </>
              )}
              {section === "execution" && (
                <>
                  <p className="eyebrow">YOU STAY IN CONTROL</p>
                  <h2>设置本次投递的边界</h2>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={config.autoLoop}
                      onChange={(e) => update("autoLoop", e.target.checked)}
                    />
                    自动循环投放（默认开启）
                  </label>
                  <DeliveryIntervalControl
                    enabled={config.deliveryIntervalEnabled}
                    range={config.deliveryInterval}
                    onChange={(enabled, range) => {
                      setConfig((current) => ({
                        ...current,
                        deliveryIntervalEnabled: enabled,
                        deliveryInterval: range,
                      }));
                    }}
                  />
                  <Field label="单次最多处理岗位数（1–100）">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={config.limit}
                      onChange={(e) => update("limit", +e.target.value)}
                    />
                  </Field>
                  <Notice>
                    AI
                    分数和匹配建议只展示，不影响投递。按用户设置筛选岗位后发送个性化招呼语；核验后关闭本次聊天
                    Tab，返回搜索列表。关闭循环时每处理一岗暂停。不会自动发送简历附件、联系方式或后续回复。
                  </Notice>
                </>
              )}
              {section === "data" && (
                <>
                  <p className="eyebrow">YOUR DATA</p>
                  <h2>管理本地记录</h2>
                  <p className="muted">
                    任务记录保存在扩展本地。导出文件包含岗位与留言，不包含完整简历和密钥。
                  </p>
                  <div className="row wrap">
                    <button
                      className="secondary"
                      onClick={() =>
                        void action(async () =>
                          download(
                            "jobapply-records.json",
                            JSON.stringify(await exportRecords(), null, 2),
                          ),
                        )
                      }
                    >
                      导出任务记录
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          if (
                            await db.runs
                              .where("status")
                              .equals("running")
                              .count()
                          )
                            throw new Error("请先在侧栏停止任务");
                          if (
                            !window.confirm(
                              "清空本扩展的简历、设置、密钥、任务和屏蔽记录？此操作不可撤销。",
                            )
                          )
                            return;
                          await db.transaction("rw", db.tables, async () => {
                            for (const table of db.tables) await table.clear();
                          });
                          await Promise.all([
                            chrome.storage.local.remove("credential"),
                            chrome.storage.session.remove("credential"),
                          ]);
                          setConfig(structuredClone(defaults));
                          setResume("");
                          setFactText("");
                          setConfirmed(false);
                          setHasKey(false);
                          setKey("");
                          setStatus("本机数据已清空");
                        })
                      }
                    >
                      清空本机数据
                    </button>
                  </div>
                </>
              )}
              <footer className="save-bar">
                <span>{confirmed ? "简历事实已确认" : "简历事实待确认"}</span>
                <div className="save-bar-actions">
                  <button
                    className="primary save-settings"
                    disabled={busy}
                    onClick={() => void action(save)}
                  >
                    {busy ? "处理中…" : "保存设置"}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action(closeSettingsPage)}
                  >
                    关闭页面
                  </button>
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
