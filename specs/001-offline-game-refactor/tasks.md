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

T005–T009 在共同契约确定后可以同时实施，随后合并验证。T005 采用 T004 的入口原型结论，T006 采用 T003 的存储原型结论。

## 阶段 3 · US1 真人对 AI 初始化（P1）

独立通过条件为提供合法牌表并核对起手和先手。无效牌表及失败模型均无法进入就绪。

- [ ] T010 [US1] 在 `tests/contract/session-start.test.ts` 建立 PVE 初始化、不可用模型、无效牌表与失败清理的验收场景。
- [ ] T011 [US1] 在 `src/match/session.ts` 按[数据模型](data-model.md)实现 `Session.id`、`Session.status` 和 `Seat.binding`，组装牌表、快照、预备的席位适配器和初始投影，失败撤销预备资源。
- [ ] T012 [US1] 在 `src/ai-decision/v6.ts`、`src/match/simulation-seed.ts` 和 `tests/contract/ai-isolation.test.ts` 识别旧 V6 的隐藏信息依赖并记录偏差。实现席位可见种子和同版解算器，按[数据模型](data-model.md)落实 `SimulationSeed.fields`，以新束搜索模型和无解算器模型验证正式结算一致性、可见性及迟到决定。实现落在 `src/ai-decision/beam-search.ts` 和 `src/match/solver.ts`。
- [ ] T013 [US1] 在 `src/clients/launcher/match-setup.ts` 与 `tests/acceptance/pve.spec.ts` 接通启动器、测试客户端及官方前端的共用对局入口，验证公开与私有起手分发。官方包验收在 US6 联跑。

## 阶段 4 · US2 待决策的暂停和恢复（P1）

独立通过条件为以固定状态验证合法应答后的继续结算，以及无效应答后的暂停状态。

- [ ] T014 [US2] 在 `tests/contract/decision.test.ts` 固定暂停与合法应答样本，以及重复、冲突、过期、越权和非法选择反例。
- [ ] T015 [US2] 在 `src/match/effects.ts` 用通用步骤实现带待决策的效果及响应窗口结算，检查同 ID 重试与新 ID 旧决策的不同结果。按 FR-012 记录效果样本的结构差异和触发批量重构的判据，满足时在 `src/deck-catalog/effect-definitions.ts` 批量迁移到统一抽象。
- [ ] T016 [US2] 在 `src/clients/official-2d/game.ts` 和 `tests/acceptance/choice-2d.spec.ts` 迁移 2D 决策 UI，通过统一协议显示候选、交付结果并对照其他可见投影。

## 阶段 5 · US6 前端可选安装与冷启动（P1）

独立通过条件为在手机及电脑导入同一兼容示例包并离线冷启动；无效包被拒绝且旧包仍能运行。

- [ ] T017 [US6] 在 `tests/contract/frontend-package.test.ts` 和 `tests/acceptance/install-offline.spec.ts` 建立离线导入、版本不兼容、存储失败、授权撤销和宿主数据隔离场景。
- [ ] T018 [US6] 在 `src/clients/launcher/install.ts` 和 `src/clients/launcher/package-store.ts` 按[数据模型](data-model.md)实现 `FrontendPackage.manifest`、`Installation.key` 和 `Installation.state`，完成导入、验证、更新、回退和卸载。
- [ ] T019 [US6] 在 `src/clients/frontend-host.ts` 和 `src/clients/service-worker.ts` 实现受控包入口及消息端口，将权威授权与 iframe 生命周期关联。
- [ ] T020 [P] [US6] 在 `src/clients/official-3d/game.ts` 迁移 3D 视图，支持触控和鼠标，并加载打包的 Three.js 和本地资产。
- [ ] T021 [P] [US6] 在 `src/clients/launcher/home.ts`、`scripts/build-frontends.ts` 和 `tests/acceptance/frontend-fixture/entry.html` 提供按需安装入口、单独官方包及兼容示例包，记录示例包构建与接入方式。
- [ ] T022 [US6] 在 `tests/acceptance/frontend-device.md` 实机执行 iOS、Android 与桌面冷启动和第三方授权测试，并联跑 2D、3D PVE 验收。

T020 和 T021 在 T007、T016 与 T019 的接入契约确定后可并行。T022 依赖 T018–T021，文件跨设备场景与 US3 联跑。

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
- [ ] T029 [US5] 在 `src/deck-catalog/drafts.ts`、`src/deck-catalog/publish.ts` 按[数据模型](data-model.md)实现 `Draft.baseRelease`、`Draft.content`，整份检查跨卡与预设引用及规则能力，事务提交后发布事件。
- [ ] T030 [US5] 在 `src/clients/launcher/catalog-editor.ts` 接入宿主编辑和发布，校验失败保留草稿，成功后版本列表可在重启后读回。

## 阶段 9 · 回放与整体验收

- [ ] T031 [P] 在 `src/match/replay.ts` 和 `tests/contract/replay.test.ts` 按[数据模型](data-model.md)实现 `Replay.versions`、`Replay.inputs`，验证含随机结算的同终局复现、缺版本或记录不完整诊断与旧版限制。
- [ ] T032 [P] 在 `src/match/recovery-store.ts` 与 `src/match/recovery.sql` 按[数据模型](data-model.md)实现 `Recovery.latest`、`Recovery.history`，同事务提交快照、历史和命令回执，初始化时直接续局。
- [ ] T033 在 `tests/acceptance/match-recovery.spec.ts` 验证重连、冷重启、已确认未回复的重试、探珠原候选及决策 ID、迟到 AI 决定、持久化失败和独立逐确认点复现。覆盖缺少确认点、版本不匹配、记录不完整和未授权的诊断。
- [ ] T034 在 `tests/acceptance/release-results.md` 完成 [验收指南](quickstart.md)的全部离线场景、跨前端协议及设备验证，记录三项澄清反例与旧版样本结果。

## 跨阶段 · US7 云端自主验收（P1）

每类取得首条代表性真实路径的证据后，立即执行 FR-018 的首次汇报和环境交接。完整验收依据 SC-012 和 SC-013。

- [ ] T035 [US7] 在 T001 后配置云端隔离会话、锁定依赖、Playwright Chromium 和 WebGL 出帧预检，在 `tests/acceptance/cloud-environment.md` 记录实际环境、复验入口和预期输出。
- [ ] T036 [US7] 随各层正常入口完成，在 `tests/contract/cloud-layer-acceptance.test.ts` 按验收指南运行四层成功和失败路径，记录不变量、拒绝原因、代理执行证据及维护者手工操作次数。首条路径通过立即交接，最终验证 SC-012、SC-014。
- [ ] T037 [US7] 随 T007、T011、T015 接通 `src/clients/debug/game.ts`，在 `tests/acceptance/debug.spec.ts` 经授权端口验证待决策应答、可见事件与失败反馈。保存复现入口和断言，验证 SC-012、SC-014。
- [ ] T038 [US7] 在 T016、T019、T021 接通后，用 `tests/acceptance/cloud-official-2d.spec.ts` 驱动 2D 正式界面，保存动作反馈、终局和对应对局记录，验证 SC-013、SC-014。
- [ ] T039 [US7] 在 T020、T021 接通后，用 `tests/acceptance/cloud-official-3d.spec.ts` 驱动 3D 正式界面，保存出帧、镜头、真实拾取、结算及终局证据，验证 SC-013、SC-014。
- [ ] T040 [US7] 在 T036–T039 完成后，用 `tests/acceptance/cloud-cross-client.spec.ts` 对照调试前端、官方 2D 和 3D 的固定场景。在 `tests/acceptance/cloud-results.md` 汇总 SC-012–SC-014 的断言、界面和对局证据、阻塞及各类首报和转交提示词。

## 依赖和分批交付

- 原型和公共基础完成后启动 US1。US2 与 US4 复用 US1 的会话。US6 的安装器可与 US2 并行，官方 2D 的安装联验等待 T016。
- US3 依赖公共目录，可与 US4、US5 并行。US5 中活跃对局快照的验证依赖 US1。三个示例分别可从独立卡组、EVE 初始化夹具和卡池草稿起跑。
- T031 依赖核心和已确定的版本契约，可与构筑和发布界面并行。T032 与 T031 可在公共契约稳定后并行，T033 依赖两者及 US2。T034 汇总此前结果。
- 先交付可验收的竖切片 US1、US2、US6 的官方 2D 与第三方包。正式首版还包含官方 3D、US3–US5、回放、续局与独立历史复现。
