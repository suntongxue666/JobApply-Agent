import { SELECTORS, jobId, text } from "../adapters/boss";
import type { JobMarker } from "../shared/schema";
const colors: Record<string, string> = {
  extracting: "#356da5",
  evaluating: "#8063ab",
  review: "#9a7427",
  sending: "#2f7098",
  opening_chat: "#2f7098",
  sent_verified: "#23704f",
  failed: "#aa5a44",
  uncertain: "#aa5a44",
  skipped: "#7e897e",
  filtered_out: "#7e897e",
  rejected: "#7e897e",
};
export class MarkerLayer {
  private disposed = false;
  private owner = crypto.randomUUID();
  private static ownerAttribute = "data-jobapply-marker-owner";
  private markers = new Map<string, JobMarker>();
  private hosts = new Map<
    Element,
    {
      host: HTMLElement;
      id: string;
      label: HTMLElement;
      button: HTMLButtonElement;
      error: HTMLElement;
    }
  >();
  private observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private onSkip: (jobId: string, title: string) => Promise<void>) {
    // DOM 共享所有权同时覆盖脚本补载、扩展重载后留下的旧节点和多个旧实例。
    document.documentElement.setAttribute(
      MarkerLayer.ownerAttribute,
      this.owner,
    );
    document
      .querySelectorAll(".jobapply-marker-host")
      .forEach((host) => host.remove());
    this.observer = new MutationObserver(() => {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.render();
      }, 120);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.render();
  }
  update(markers: JobMarker[]) {
    this.markers = new Map(markers.map((m) => [m.jobId, m]));
    this.render();
  }
  render() {
    if (this.disposed) return;
    if (
      document.documentElement.getAttribute(MarkerLayer.ownerAttribute) !==
      this.owner
    ) {
      this.dispose();
      return;
    }
    for (const [card, entry] of this.hosts)
      if (
        !card.isConnected ||
        !entry.host.isConnected ||
        jobId(
          card.querySelector(SELECTORS.title)?.getAttribute("href") || "",
        ) !== entry.id
      ) {
        entry.host.remove();
        this.hosts.delete(card);
      }
    for (const card of document.querySelectorAll<HTMLElement>(SELECTORS.card)) {
      const link = card.querySelector(SELECTORS.title),
        id = jobId(link?.getAttribute("href") || "");
      if (!id) continue;
      let entry = this.hosts.get(card);
      for (const stale of card.querySelectorAll(".jobapply-marker-host"))
        if (stale !== entry?.host && stale.closest(SELECTORS.card) === card)
          stale.remove();
      if (!entry) {
        const host = document.createElement("div");
        host.className = "jobapply-marker-host";
        host.dataset.jobId = id;
        host.dataset.owner = this.owner;
        host.style.cssText =
          "position:relative;display:block;width:100%;box-sizing:border-box;margin-top:9px;z-index:2;";
        const shadow = host.attachShadow({ mode: "open" }),
          style = document.createElement("style");
        style.textContent =
          ':host{font:12px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#345743}.bar{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #d5e5d8;border-radius:7px;background:#f4f8f0}.brand{font-size:10px;opacity:.75}.status{flex:1;font-weight:600}button{border:1px solid #bed1bf;border-radius:5px;padding:3px 11px;background:#fff;color:#426b4c;cursor:pointer;font:inherit}button:hover{background:#e9f1e3}button:disabled{opacity:.5;cursor:default}.error{display:block;font-size:10px;color:#a75845}';
        const bar = document.createElement("div");
        bar.className = "bar";
        const brand = document.createElement("span");
        brand.className = "brand";
        brand.textContent = "工作智投";
        const label = document.createElement("span");
        label.className = "status";
        label.setAttribute("role", "status");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "跳过";
        button.setAttribute("aria-label", `跳过 ${text(link)}`);
        const error = document.createElement("span");
        error.className = "error";
        for (const event of ["click", "mousedown", "pointerdown"])
          host.addEventListener(event, (e) => e.stopPropagation());
        button.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          button.disabled = true;
          error.textContent = "";
          try {
            await this.onSkip(id, text(link));
          } catch (err) {
            error.textContent =
              err instanceof Error ? err.message : "跳过失败，请重试";
          } finally {
            button.disabled = false;
            this.render();
          }
        });
        bar.append(brand, label, button);
        shadow.append(style, bar, error);
        card.append(host);
        entry = { host, id, label, button, error };
        this.hosts.set(card, entry);
      }
      const marker = this.markers.get(id),
        label = marker?.label || "未处理";
      if (entry.label.textContent !== label) entry.label.textContent = label;
      const title = marker?.reason || "可单独跳过此岗位";
      if (entry.label.title !== title) entry.label.title = title;
      entry.label.style.color = colors[marker?.status || ""] || "#426b4c";
      entry.button.hidden = marker ? !marker.canSkip : false;
    }
  }
  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    clearTimeout(this.timer);
    for (const { host } of this.hosts.values()) host.remove();
    this.hosts.clear();
    if (
      document.documentElement.getAttribute(MarkerLayer.ownerAttribute) ===
      this.owner
    )
      document.documentElement.removeAttribute(MarkerLayer.ownerAttribute);
  }
}
