# 实现任务 · 《临界》离线工程化重构

依据 [规格](spec.md)、[计划](plan.md)、[数据模型](data-model.md)、[业务契约](contracts/business-interactions.md)、[前端包规范](contracts/frontend-packages.md)和[验收指南](quickstart.md)。标有 [P] 的任务在其前置条件满足后可并行。每个阶段的通过条件由对应验收任务核对。

## 阶段 1 · 项目与验证原型

- [ ] T001 建立 TypeScript、Vite、Vitest、Playwright 工具链及 build/dev/test/test:baseline/test:e2e 命令，配置 `package.json`、`tsconfig.json`、`vite.config.ts` 和 `playwright.config.ts`。
- [ ] T002 [P] 在 `tests/baseline/legacy-samples.test.ts` 及 `tests/baseline/fixtures.json` 按[旧版对照样本](contracts/legacy-samples.md)固定 LG-01–LG-08 的旧版 2D、3D 完整输入及逐步断言，记录旧版差异与页面来源。
- [ ] T003 [P] 在 `tests/acceptance/storage-device.md` 和 `src/deck-catalog/sqlite.worker.ts` 验证 iOS、Android、桌面安装后的 SQLite OPFS 写入、冷重启、独占接管和回滚，固定驱动版本、浏览器起始版本及设备结果。
- [ ] T004 [P] 在 `tests/acceptance/frontend-device.md` 与 `src/clients/frontend-spike.ts` 验证官方 3D 大小、离线准备和渲染能力，以及实机本地文件选择、沙盒入口、消息端口和存储隔离，据采样固定包体上限。

T002–T004 均依赖 T001。若目标手机无法满足关键能力，按 [计划](plan.md#迁移顺序)比较兼容方案并更新决策后进入完整实现。

## 阶段 2 · 公共基础

- [ ] T005 [P] 在 `src/clients/service-worker.ts` 和 `src/clients/offline-ready.ts` 实现版本一致的主体缓存、专用包入口及离线就绪判定，覆盖升级后仍能启动已经安装的兼容包。
- [ ] T006 [P] 在 `src/deck-catalog/sqlite.worker.ts`、`src/deck-catalog/catalog.ts` 和 `src/deck-catalog/schema.sql` 落实独占存储与指定版本的只读目录，按[数据模型](data-model.md)实现 `Card.id`、`Release.id`、`Release.rulesVersion`。
- [ ] T007 [P] 在 `src/match/player-protocol.ts`、`src/match/player-interface.ts` 定义消息 schema、稳定 ID、版本协商、修订、授权和可见事件流，按[数据模型](data-model.md)实现 `CommandReceipt.key`、`CommandReceipt.result`、`View.sequence`、`View.scope`、`FrontendConnection.capability`。
- [ ] T008 [P] 在 `src/match/core.ts` 和 `src/match/rules.ts` 建立无 DOM 的结算入口、随机输入、顺序与暂停恢复，按[数据模型](data-model.md)实现 `Match.revision`、`Match.snapshotRef`、`Decision.id`、`Decision.owner`、`Decision.continuation`。
- [ ] T009 [P] 在 `src/ai-decision/model.ts` 和 `src/clients/ai-player.ts` 定义独立模型契约、适配器及过期判定，按[数据模型](data-model.md)实现 `ModelJob.requestId`、`ModelJob.basis`、`ModelJob.result`。
- [ ] T032 在 `src/match/recovery-store.ts` 与 `src/match/recovery.sql` 按[数据模型](data-model.md)实现 `Recovery.latest`、`Recovery.history`，提供会话初始化、对局确认和续局所用的持久化入口。每次确认以独立对局 SQLite 库的同一事务提交快照、历史与相应命令回执。提交成功后才返回正式回执和发布可见事件，失败保留最近确认状态。
- [ ] T015 [US2] 在 `src/match/effects.ts` 用通用步骤实现带待决策的效果及响应窗口结算，检查同 ID 重试与新 ID 旧决策的不同结果。按 FR-012 记录效果样本的结构差异和触发批量重构的判据，满足时在 `src/deck-catalog/effect-definitions.ts` 批量迁移到统一抽象。
- [ ] T042 在 `src/match/rules.ts` 和 `src/match/player-interface.ts` 将 LG-01–LG-08 对应的开局与换牌、出牌、攻击、进化、技能、回响、回合推进、终焉和胜负判定、百川冰泉全部接入正式结算和玩家协议。把触发、选择及暂停恢复接到 T015 的效果步骤。用 T002 的固定状态和牌表驱动核心初始化与席位命令，核对关键状态、结算顺序和胜负，按既有规格验收已记录的差异。启动器的会话创建联验在 T010、T013 执行。
- [ ] T041 在 `scripts/build-initial-release.ts` 生成首个正式发行版资源并随主体构建打包，记录 `quote/` 中旧版卡牌和预设牌表的来源、稳定卡牌 ID 映射及对应规则版本。在 `src/deck-catalog/initial-release.ts` 从主体本地资源装载，以规则能力、整库数据和引用校验通过为前提，事务写入首个不可变发行版。将首版就绪接到 T005 的离线准备判定。在 `tests/contract/initial-release.test.ts` 验证空存储可读到首版和合法预设、中断回滚、重试不重复发行，且已有数据再次启动后保持原样。

T005–T009 在共同契约确定后可以同时实施，随后合并验证。T005 采用 T004 的入口原型结论，T006 采用 T003 的存储原型结论。T032 依赖 T003、T007、T008。T015 依赖 T002、T007、T008、T032，T042 依赖 T015 及 T002 的样本。T041 依赖 T005、T006、T042，首个发行版通过校验后再联跑 US1。

## 阶段 3 · US1 真人对 AI 初始化（P1）

独立通过条件为提供合法牌表并核对起手和先手。无效牌表及失败模型均无法进入就绪。

- [ ] T010 [US1] 在 `tests/contract/session-start.test.ts` 建立 PVE 初始化、不可用模型、无效牌表与失败清理的验收场景，验证由 T041 准备的首版及预设可从正常入口开局。
- [ ] T011 [US1] 在 `src/match/session.ts` 按[数据模型](data-model.md)实现 `Session.id`、`Session.status` 和 `Seat.binding`，组装牌表、快照、预备的席位适配器和初始投影。创建时经 T032 确认初始状态后公布就绪，失败撤销预备资源。续局时从 T032 直接读取最近确认状态，校验锁定版本和原席位绑定后重新授权连接。
- [ ] T012 [US1] 在 `src/ai-decision/v6.ts`、`src/match/simulation-seed.ts` 和 `tests/contract/ai-isolation.test.ts` 核查旧 V6 的隐藏信息依赖，记录依赖字段及受影响样本。若确认依赖，将其标为待退役，首版正常模型选择仅开放符合席位可见性约束的实现，替代模型通过离线对局验收后由 T044 收尾。通过 M06 交付获准席位的可见种子及锁定版本的正式解算器能力，按[数据模型](data-model.md)落实 `SimulationSeed.fields`，以新束搜索模型和无解算器模型验证正式结算一致性、可见性及迟到决定。实现落在 `src/ai-decision/beam-search.ts` 和 `src/match/solver.ts`。
- [ ] T013 [US1] 在 `src/clients/launcher/match-setup.ts` 与 `tests/acceptance/pve.spec.ts` 接通启动器、测试客户端及官方前端共用的开局和续局入口，验证公开与私有起手分发。经玩家协议提交命令触发待决策，关闭并重新打开宿主后从正常入口读回未结束的对局和原待决策。授权席位重试原命令须取得原回执，再以合法应答继续结算。官方包验收在 US6 联跑。

T011 依赖 T032、T041。T012 依赖 T009、T042。T013 依赖 T011、T012，并跑通 T010 的初始化验收场景。

## 阶段 4 · US2 待决策的暂停和恢复（P1）

独立通过条件为以固定状态验证合法应答后的继续结算，以及无效应答后的暂停状态。

- [ ] T014 [US2] 在 `tests/contract/decision.test.ts` 固定暂停与合法应答样本，以及重复、冲突、过期、越权和非法选择反例。用已用命令 ID 验证 M02 在查找回执前核验连接、会话与席位授权。已撤权连接、错误席位或错误会话均无法查询回执或得知其是否存在，权威状态及待决策维持原样。
- [ ] T016 [US2] 在 `src/clients/official-2d/game.ts` 接入 T042 的正常游戏操作、待决策 UI 和终局反馈，通过统一协议显示候选、交付结果并对照其他可见投影。在 `tests/acceptance/choice-2d.spec.ts` 验证正常操作触发待决策、暂停和继续结算。

## 阶段 5 · US6 前端可选安装与冷启动（P1）

独立通过条件为在手机及电脑导入同一兼容示例包并离线冷启动；无效包被拒绝且旧包仍能运行。

- [ ] T017 [US6] 在 `tests/contract/frontend-package.test.ts` 和 `tests/acceptance/install-offline.spec.ts` 建立离线导入、版本不兼容、存储失败、授权撤销和宿主数据隔离场景。验证断网时从已安装第三方前端条目选择同 ID 新版本，确认来源后才进入候选启动。取消确认保留原活动版，从新装入口导入同一文件须报告 ID 冲突。验证候选在受控入口加载、握手及协议协商成功后才切换为活动版。入口失败、握手超时或协议协商失败时撤销候选端口，上一活动版与仍有效的授权继续可用。
- [ ] T018 [US6] 在 `src/clients/launcher/install.ts` 和 `src/clients/launcher/package-store.ts` 按[数据模型](data-model.md)实现 `FrontendPackage.manifest`、`Installation.key` 和 `Installation.state`，完成导入、验证、更新、回退和卸载。区分新装和指定已安装前端的离线升级入口，升级检查目标 ID、版本及兼容性，取得玩家对文件来源的确认后才交给 T019。
- [ ] T019 [US6] 在 `src/clients/frontend-host.ts` 和 `src/clients/service-worker.ts` 实现受控包入口及消息端口，将权威授权与 iframe 生命周期关联。向 T018 提供候选独立实例的就绪或失败结果，以受控入口、实例握手和协议协商为判据，处理超时及失败候选的端口撤销。
- [ ] T020 [P] [US6] 在 `src/clients/official-3d/game.ts` 迁移 3D 视图，将 T042 的正常游戏操作、待决策和终局反馈接到统一协议，支持触控、鼠标及目标拾取，并加载打包的 Three.js 和本地资产。
- [ ] T021 [P] [US6] 在 `src/clients/launcher/home.ts`、`scripts/build-frontends.ts` 和 `tests/acceptance/frontend-fixture/entry.html` 提供按需安装入口、单独官方包及兼容示例包，记录示例包构建与接入方式。
- [ ] T022 [US6] 在 `tests/acceptance/frontend-device.md` 实机执行 iOS、Android 与桌面冷启动和第三方授权测试。按[首次发行版与空存储验收](quickstart.md#首次发行版与空存储验收)从全新安装验证正常入口可准备官方内容，断网冷启动后用首版、合法预设和 T012 的替代模型联跑 2D、3D 的离线 PVE 及续局。

T020 和 T021 在 T007、T016、T019 的接入契约确定后可并行，T020 使用 T042 的正式规则。T022 依赖 T013、T017–T021 和 T041，文件跨设备场景与 US3 联跑。

## 阶段 6 · US3 卡组编辑与文件迁移（P2）

独立通过条件为保存合法牌表、重启读回且可跨设备导入，错误提交保留原记录。

- [ ] T023 [US3] 在 `tests/acceptance/decks.spec.ts` 建立合法保存、重开、同版及跨版本导入、目标版本缺卡、文件不完整、目标牌表不合法及写失败检查。覆盖目标版本同 ID 的卡面或效果变化。
- [ ] T024 [US3] 在 `src/deck-catalog/decks.ts` 和 `src/deck-catalog/deck-file.ts` 按[数据模型](data-model.md)实现 `Deck.id`、`Deck.releaseId` 和 `Deck.entries`，加入目标发行版完整性与合法性校验、跨发行版稳定 ID 解析、原子写、新版往返及已验证的旧格式映射。
- [ ] T025 [US3] 在 `src/clients/launcher/decks.ts` 交付构筑与文件导入导出，在 `tests/acceptance/deck-transfer.md` 用电脑文件和断网手机验收同版与跨版本迁移，核对保存的目标版本与缺卡诊断。

## 阶段 7 · US4 EVE 初始化（P2）

独立通过条件为两个模型席位就绪和观战只见公开状态，模型失败能定位相关席位。

- [ ] T026 [US4] 在 `tests/acceptance/eve.spec.ts` 建立双模型、失败席位及只读公开视图场景。
- [ ] T027 [US4] 在 `src/clients/launcher/eve.ts` 和 `src/clients/spectator.ts` 用共用会话与协议连接两模型及观战，验证首个自动动作之前的就绪状态。

## 阶段 8 · US5 发布新卡池（P2）

独立通过条件为一次有效事务新增版本，失败不新增，进行中的对局仍使用旧快照。

- [ ] T028 [US5] 在 `tests/contract/release.test.ts` 和 `tests/acceptance/publishing.spec.ts` 验证无效引用、未知效果、中断回滚、成功通知及进行中对局的快照固定。
- [ ] T029 [US5] 在 `src/deck-catalog/drafts.ts`、`src/deck-catalog/publish.ts` 按[数据模型](data-model.md)实现 `Draft.baseRelease`、`Draft.content`，复用 T041 的整库校验，检查跨卡与预设引用及规则能力，事务提交后发布事件。
- [ ] T030 [US5] 在 `src/clients/launcher/catalog-editor.ts` 接入宿主编辑和发布，校验失败保留草稿，成功后版本列表可在重启后读回。

## 阶段 9 · 回放与整体验收

- [ ] T031 [P] 在 `src/match/replay.ts` 和 `tests/contract/replay.test.ts` 按[数据模型](data-model.md)实现 `Replay.versions`、`Replay.inputs`，验证含随机结算的同终局复现、缺版本或记录不完整诊断与旧版限制。
- [ ] T043 在 `src/match/history-reproduce.ts` 接通可信宿主内获准维护者和隔离自动验收的历史复现入口。授权后只读选定确认点、核对规则与卡池版本及记录完整性，在隔离环境还原局面、待决策和截至该点的命令处理结果，并用原输入重跑后续行为。提供未授权、缺确认点、版本不匹配及记录不完整的诊断。
- [ ] T033 在 `tests/acceptance/match-recovery.spec.ts` 验证重连、冷重启、已确认未回复的重试、探珠原候选及决策 ID、迟到 AI 决定和持久化失败。通过 T043 的授权入口独立复现每个确认点并重跑后续结算，核对原对局与历史记录保持原样，覆盖缺少确认点、版本不匹配、记录不完整和未授权的诊断。
- [ ] T044 按 T012 的核查结果执行 FR-006 的条件退役。若旧 V6 依赖真实隐藏信息，在替代模型通过 T022 的离线 PVE 验收后，移除正常模型列表和会话配置仍引用的 V6 路径，验证普通配置无法再选用或启动该路径，并保留旧版样本及偏差记录。
- [ ] T034 在 `tests/acceptance/release-results.md` 完成[验收指南](quickstart.md)的全部离线场景、跨前端协议及设备验证，记录三项澄清反例与旧版样本结果。汇总 T022 的空存储冷启动和开局结果，经 T025、T030 的正常入口补验使用首版离线打开构筑和创建草稿。按[架构边界复核](quickstart.md#架构边界复核)核对总图和受影响层的模块归属、状态所有权、交互方向与语义及关键场景的实际调用。M06 须从 AI 侧追溯到对局侧授权种子及同版正式解算器，且隔离试算不改变正式对局。

## 跨阶段 · US7 云端自主验收（P1）

每类取得首条代表性真实路径的证据后，立即执行 FR-018 的首次汇报和环境交接。完整验收依据 SC-012 和 SC-013。

- [ ] T035 [US7] 在 T001 后配置云端隔离会话、锁定依赖、Playwright Chromium 和 WebGL 出帧预检，在 `tests/acceptance/cloud-environment.md` 记录实际环境、复验入口和预期输出。
- [ ] T036 [US7] 随各层正常入口完成，在 `tests/contract/cloud-layer-acceptance.test.ts` 按验收指南运行四层成功和失败路径，记录不变量、拒绝原因、代理执行证据及维护者手工操作次数。首条路径通过立即交接，最终验证 SC-012、SC-014。
- [ ] T037 [US7] 随 T007、T011、T015 接通 `src/clients/debug/game.ts`，在 `tests/acceptance/debug.spec.ts` 经授权端口验证待决策应答、可见事件与失败反馈。保存复现入口和断言，验证 SC-012、SC-014。
- [ ] T038 [US7] 在 T013、T016、T019、T021 和 T042 接通后，用 `tests/acceptance/cloud-official-2d.spec.ts` 驱动 2D 正式界面，保存动作反馈、终局和对应对局记录，验证 SC-013、SC-014。
- [ ] T039 [US7] 在 T013、T019–T021 和 T042 接通后，用 `tests/acceptance/cloud-official-3d.spec.ts` 驱动 3D 正式界面，保存出帧、镜头、真实拾取、结算及终局证据，验证 SC-013、SC-014。
- [ ] T040 [US7] 在 T036–T039 完成后，用 `tests/acceptance/cloud-cross-client.spec.ts` 对照调试前端、官方 2D 和 3D 的固定场景。在 `tests/acceptance/cloud-results.md` 汇总 SC-012–SC-014 的断言、界面和对局证据、阻塞及各类首报和转交提示词。

## 依赖和分批交付

- 原型和公共基础完成后启动 US1。US2 与 US4 复用 US1 的会话。US6 的安装器可与 US2 并行，官方 2D 的安装联验等待 T016。
- US3 依赖公共目录，可与 US4、US5 并行。US5 中活跃对局快照的验证依赖 US1。三个示例分别可从独立卡组、EVE 初始化夹具和卡池草稿起跑。
- T031 依赖 T042 和已确定的版本契约，可与构筑和发布界面并行。T043 依赖 T031、T032、T041。T033 依赖 T013、T016、T043，T044 依赖 T012 和 T022。T034 在 T022、T025、T030、T033、T044 完成后汇总离线、旧版对照、恢复及退役结果，并完成架构边界复核。
- 先交付可验收的竖切片 US1、US2、US6 的官方 2D 与第三方包，包含初始发行版准备和未结束对局的持久化续局。正式首版还包含官方 3D、US3–US5、终局回放与独立历史复现。
