import type { Job } from "../shared/schema";

const units = "%|年|个月|月|天|小时|个|项|人|倍|次|家|款|台|元";
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function chineseInteger(raw: string): number {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (!/[十百千万亿]/.test(raw)) {
    if (raw.length > 1 && !(raw.length === 4 && /[零〇]/.test(raw)))
      return Number.NaN;
    return Number([...raw].map((c) => digits[c]).join(""));
  }
  if (/[百千万亿][一二两三四五六七八九]$/.test(raw)) return Number.NaN;
  let total = 0,
    section = 0,
    digit = 0;
  for (const c of raw) {
    if (c in digits) digit = digits[c];
    else if (c === "万" || c === "亿") {
      section += digit;
      if (c === "亿") {
        total = (total + section) * 1e8;
        section = 0;
      } else {
        total += (section || 1) * 1e4;
        section = 0;
      }
      digit = 0;
    } else {
      section += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[c] || 1);
      digit = 0;
    }
  }
  return total + section + digit;
}

function claims(s: string): { key: string; text: string }[] {
  const value = normalize(s).replace(
    /(?:一次|一个)(?=交流|沟通|面试|机会)/g,
    "",
  );
  const chinese =
    "[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二两三四五六七八九]+)?";
  const pattern = new RegExp(
    `(?<![\\d.])\\d+(?:\\.\\d+)?(?:万|亿)?(?:${units})?|${chinese}(?:${units})`,
    "g",
  );
  return [...value.matchAll(pattern)].map(([text]) => {
    const arabic = text.match(/^(\d+(?:\.\d+)?)(万|亿)?(.*)$/);
    if (arabic) {
      const scale = arabic[2] === "万" ? 1e4 : arabic[2] === "亿" ? 1e8 : 1;
      return { text, key: `${Number(arabic[1]) * scale}:${arabic[3]}` };
    }
    const chineseMatch = text.match(new RegExp(`^(${chinese})(${units})$`))!;
    const [integer, decimal] = chineseMatch[1].split("点");
    const fractional = decimal
      ? [...decimal]
          .map((c) => "零一二三四五六七八九".indexOf(c === "〇" ? "零" : c))
          .join("")
      : "0";
    const amount = chineseInteger(integer) + Number(`0.${fractional}`);
    return {
      text,
      key: Number.isFinite(amount)
        ? `${amount}:${chineseMatch[2]}`
        : `raw:${text}`,
    };
  });
}

export function unsupportedNumbers(
  greeting: string,
  evidence: string,
  job?: Pick<Job, "title" | "company">,
): string[] {
  let message = normalize(greeting);
  // 仅豁免明确作为岗位/公司名称引用的完整文本，不将 JD 中的数字当成个人经历证据。
  if (job?.title) {
    const title = escape(normalize(job.title));
    message = message.replace(
      new RegExp(
        `(?:[“「"]${title}[”」"]|(?:贵司的?|应聘)${title})(?=岗位|职位)`,
        "g",
      ),
      "该岗位",
    );
  }
  if (job?.company) {
    const company = escape(normalize(job.company));
    message = message.replace(
      new RegExp(`[“「"]${company}[”」"](?=公司|团队|的|您好)`, "g"),
      "贵司",
    );
  }
  const supported = new Set(claims(evidence).map((claim) => claim.key));
  return [
    ...new Set(
      claims(message)
        .filter((claim) => !supported.has(claim.key))
        .map((claim) => claim.text),
    ),
  ];
}

export class GreetingNumberError extends Error {
  constructor(public readonly numbers: string[]) {
    super(
      `AI 留言中的数字（${numbers.slice(0, 8).join("、")}）没有对应的已引用简历事实，本岗尚未发送`,
    );
    this.name = "GreetingNumberError";
  }
}
