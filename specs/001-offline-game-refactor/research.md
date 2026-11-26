# 技术取舍 · 《临界》离线工程化重构

| 议题 | 选定方案与理由 | 其他方案的代价或适用情形 |
|---|---|---|
| 多端交付 | 静态 HTTPS PWA。用 Service Worker 缓存完整、版本一致的主体，已准备的前端包存在本机。当前启动页面受 Worker 控制且资源齐全后才显示可离线使用。iOS 先从主屏幕图标打开，再在该实例内完成数据和前端准备。 | 本机服务要求手机能连到服务所在设备。原生封装可复用大部分 TypeScript 模块，适合作为浏览器能力不足时的重新评估对象。单 HTML 的本地文件分发需解决安全上下文与持久化。 |
| SQLite 和多窗口 | 官方 SQLite WASM 在专用 Worker 使用 `opfs-sahpool`，原型确定可用版本与 VFS。同源应用在打开 SQLite 前取得全生命周期的 Web Lock，仅允许一个写入实例驱动目录和发布。另一实例提示占用和重试。应用恢复后读取已提交发行。申请持久存储并验证配额错误。 | 其他 OPFS VFS 可在原型中对照，比如需要额外跨源隔离响应头的 VFS。若候选 VFS 在目标设备均无法可靠回读，复审封装交付。 |
| 前端包 | 正式启动器接受本地分享的安装文件，官方 2D 和 3D 同样各自打包。可信宿主独立控权限，iframe 使用不透明来源和定向消息端口。静态离线入口及限制性响应头先在各目标浏览器原型验证。 | 把包内脚本作为主体同源模块运行会赋予完整宿主权限。每个前端单独成为站点会分离离线安装与数据，增加手机启动步骤。 |
| 语言和渲染 | TypeScript 接近旧版的 JavaScript。2D 延续 DOM，3D 沿用 Three.js 和打包资产。用 Vite 构建网页和前端包，Vitest 与 Playwright 共享规则样本。 | 重写规则核心和渲染的语言迁移会提高本轮行为差异的定位成本。 |
| 旧数据边界 | 正式支持新版卡组文件。验证旧网页已有明确文件导出格式的卡组样本后，支持可映射的旧文件并按目标卡池重新校验。旧浏览器私有存储需从旧页面导出。旧回放用于迁移样本和偏差记录。新版格式负责可重放和版本诊断。 | 旧回放可能缺少规则版本或随机结果。兼容测试记录具体来源、支持格式和无法映射的字段。 |
| 续局与历史 | 独立对局 SQLite 数据库在同一事务更新最近快照、追加历史记录并保存回执。首版保留每个确认点快照，便于直接恢复及独立选点复现。 | 如实测体积过大，可在后续评估检查点与增量记录，仍须保证可重建每个已确认状态。 |
| AI 与效果 | 以同版规则解算器驱动受席位可见性约束的束搜索，并保留无解算器模型入口。首版先组合通用效果步骤，若样本显示显著结构差异，再通过统一效果抽象批量迁移。 | 从不同规则实现试算会破坏正式规则一致性。旧 V6 隐藏信息依赖单独记录，并由符合边界的模型替代。 |
| 行为范围 | EVE 验收覆盖独立配置双模型、初始化和公开观战视图。首发卡组文件手动迁移。未完成的卡组编辑保留于当前编辑会话。 | EVE 自动运行控制、账户同步和构筑草稿持久化作为独立功能评估。 |

## 首轮实测问题

- iOS 和 Android 从已安装图标冷启动。先写入发行版并完全关闭应用，断网后读回，随后再试发布和重启。
- 验证同源第二窗口占用提示、关闭后接管、配额失败回滚和 shell 更新后的旧包启动。持久存储授予视浏览器而定，应用内的冷启动验收与主动清理浏览器数据分开记录。
- 在三类目标设备从文件选择器导入第三方包，冷启动验证 TypeScript 构建后的脚本和渲染资源可用。实测 frame 自导航与失效端口的处理、宿主存储隔离及 WebGL。
- 在同机记录旧版、新版的开局耗时、AI 决策耗时和 3D 输入/帧率。以完成连续操作为验收，用实测建立性能记录。

## 参考

- Service Worker 和缓存。[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) · [web.dev](https://web.dev/learn/pwa/caching)
- 主屏幕应用的 iOS 存储隔离与 WebKit 配额及持久存储。[web.dev](https://web.dev/learn/pwa/detection#ios_and_ipados_storage_isolation) · [WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)
- SQLite WASM 的持久化方式和同源 Web Lock。[SQLite](https://sqlite.org/wasm/doc/trunk/persistence.md) · [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- iframe 隔离和消息端口能力模型。[HTML 标准 iframe](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element) · [HTML 标准 MessagePort](https://html.spec.whatwg.org/multipage/web-messaging.html#ports-as-the-basis-of-an-object-capability-model-on-the-web)
