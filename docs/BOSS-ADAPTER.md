# BOSS DOM 适配说明

2026-10-25 只读观察到的求职者 Web 搜索结构：

| 目标 | 选择器/标识 |
| --- | --- |
| 列表 | `.job-list-container` / `.rec-job-list` |
| 卡片 | `li.job-card-box` |
| 稳定岗位 ID | `a.job-name` 的 `/job_detail/<id>.html` |
| 卡片公司 | `.boss-name` |
| 薪资 | `.job-salary`；当前观察值含私有区字符，不能按明文数字处理 |
| 卡片标签 | `.tag-list` |
| 详情容器 | `.job-detail-container` |
| 详情正文 | `.job-detail-body .desc`；使用可见文本，避免混入隐藏干扰片段 |
| 详情身份 | `.job-detail-body a.more-job-btn` 的岗位 ID |
| 页面身份 | `a[ka="header-username"]` 的文本与头像；仅本地 hash，不读取 Cookie |

选择器不是平台 API 契约。卡片点击后需等待详情 ID 和标题一致、正文稳定且非空。超时就暂停，不读取前一个岗位的 JD。

v0.2 本次访问聊天页遇到 BOSS 安全验证，尚未稳定观察输入框与消息结构；源码没有伪造聊天选择器，当前仍不执行真实发送。`claimSend` 与相应测试只是后续发送流程的存储基础。

v0.2 在职位卡片挂载 Shadow DOM 状态条与跳过按钮，状态来自后台数据库，不根据按钮点击或页面跳转推定成功。内容脚本采用可销毁的单实例，支持连接时补载，避免重复监听和状态条。

`tests/fixtures/boss-list.html` 根据观察结构制作并脱敏，是合成样本，不是生产页完整快照；页面改版后应重新观察并更新 fixture 与适配测试。


## v0.3 聊天适配与边界

`open-chat.ts` 在已核对 jobId 的详情区按可见文本定位唯一“立即沟通”；点击前需要后台单次许可。`chat.ts` 使用已观察到的 `.chat-content` 容器，并按语义查找唯一 textarea/contenteditable 和可见“发送”控件，不硬编码未经观察的私有消息 API。

必须在聊天 URL 的 jobId 或唯一岗位链接中匹配目标稳定 ID，同时核对标题、公司和可读取的招聘者姓名。不满足条件或布局未知时拒绝发送。真实生产会话尚未完成端到端验收；测试中的 HTML 是合成契约，不代表真实聊天页面快照。

后台只捕获来源 Tab 在本次操作期间打开的唯一子 Tab。发送后只关闭核验成功、URL 未改变、opener 一致的本次 Tab。不会关闭原列表、已有用户聊天页或已导航至其他页面的 Tab。

## v0.3.2 详情与开聊路径

选择列表卡片触发右侧详情，不拦截标题 anchor。只读可见、岗位 ID 与标题匹配的详情；支持 `.job-detail-body .desc` 和 `.job-sec-text`。右侧详情超时才转入本岗独立详情只读分支。独立详情用 URL 岗位 ID + 可见 h1 + JD 核对，并保留站点链接参数。

投递阶段新建独立详情 Tab，重新检查后点击 `a.btn-startchat` / `.op-btn-chat` / `[ka="job_detail_chat"]` 或唯一语义按钮。本次详情页同 Tab 导航聊天与唯一子 Tab 两种分支均有模拟测试；不能关联现有用户会话。后台保留原列表的账号/URL/任务锁约束，只有核验成功的本次页面能自动关闭。

这条路径参考 get_jobs 的 Boss.java / Locators.java 中的页面入口与选择器；BOSS 真实页面并非稳定接口，未声称真实聊天端到端验收完成。

## v0.3.4 首次沟通弹窗

独立详情页点击立即沟通后，BOSS 可能只显示 `.dialog-wrap.startchat-dialog` / `.dialog-container` 中的 `textarea.input-area`，不会导航到聊天 URL。`dialog-binding.ts` 仅绑定本次点击后新出现的唯一可编辑弹窗，保留操作 ID、岗位目标、详情 URL 和初始预填内容；它不根据全页面任意 textarea 猜测会话。

`CHAT_PROBE` 将已绑定弹窗报告给后台，`CHAT_READY` 和 `SEND_GREETING` 都携带 operationId。授权发送时继续核对原列表账号、任务 epoch、详情 Tab 与当前弹窗。新弹窗默认文案只有未被用户修改时才能替换；已有草稿拒绝覆盖。核验成功后只关闭本次详情页，不动搜索列表与已有会话。
