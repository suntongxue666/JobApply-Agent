// 授权是单次操作：端口断开/超时只报告结果，绝不重试外发请求。
export function contentRequest<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: "jobapply-content-v1" });
    } catch {
      reject(new Error("插件连接已失效，请重新加载插件并刷新 BOSS 页面"));
      return;
    }
    let done = false;
    const finish = (error?: Error, value?: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      try {
        port.disconnect();
      } catch {
        /* 扩展重载后端口可能已失效 */
      }
      error ? reject(error) : resolve(value as T);
    };
    const onMessage = (
      reply: { ok?: boolean; data?: T; error?: string } | null,
    ) => {
      if (reply?.ok === true) finish(undefined, reply.data);
      else
        finish(new Error(reply?.error || "后台授权响应格式错误，未继续操作"));
    };
    const onDisconnect = () => {
      // Chrome 要求读取 lastError；不要把内部错误误报成已投递。
      const detail = chrome.runtime.lastError?.message;
      finish(
        new Error(
          detail
            ? `后台授权连接断开：${detail}`
            : "后台授权连接断开，请重新加载插件并刷新 BOSS 页面",
        ),
      );
    };
    const timer = setTimeout(
      () =>
        finish(new Error("后台授权超时，已停止；请检查本次岗位，勿重复投递")),
      12000,
    );
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    try {
      port.postMessage(message);
    } catch {
      finish(new Error("后台授权请求未送达，已停止操作"));
    }
  });
}
