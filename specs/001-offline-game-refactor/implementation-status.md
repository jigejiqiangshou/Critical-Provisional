# 阶段实施记录 · 《临界》离线工程化重构

**记录日期** — 2026-11-28
**范围** — 已验收任务、T045 中断回收与后续实施交接
**依据** — [规格](spec.md)、[计划](plan.md)、[任务清单](tasks.md)、[验收指南](quickstart.md)

## 目标平台

本次重构的设备适配和验收覆盖 Android Chrome 与桌面 Chromium 的已安装 PWA。iOS 适配已移出范围。两类目标设备仍须分别验证安装、断网冷启动、输入、文件选择和渲染。验证范围以 [SC-010](spec.md) 为准。

## 任务与证据

| 任务 | 状态 | 证据与结果 |
|---|---|---|
| T001 · 开发与验证工具链 | 已合并并验收，`68cc225` | 独立审查和测试覆盖干净安装、类型检查、构建、开发服务和三条测试入口。临时用例验证发现范围、空套件失败和连续浏览器运行后预览锁释放。 |
| T002 · 旧版对照 | 已合并并验收，`cd081b9` | [夹具](../../tests/baseline/fixtures.json)和[独立测试](../../tests/baseline/legacy-samples.test.ts)覆盖两份旧版页面的 LG-01 至 LG-09、21 个变体、96 条逐步观测。合并后基线与完整 Vitest 套件各通过 67 项。3D 回响单选的指针点击被画布拦截，方向键选择后可确认。两端内存回放均含认输动作，旧版自动归档均遗漏该动作。 |
| T003 · SQLite OPFS | 已合并并验收，`2d850e5` | 原始提交 `8aeca9a` 已恢复。[桌面复验](../../tests/acceptance/storage-device.md)覆盖 SQLite WASM `3.54.1-build1` 在 Chromium 156 已安装 PWA 中的独占接管、写入、回滚、进程强制终止后断网读回及续写。1024 字节配额下报告空间不足并禁用写入。 |
| T004 · 官方 3D 与第三方包原型 | 已合并并验收，`03c9ccf` | 原始提交 `6eb37d4` 已恢复。[桌面复验](../../tests/acceptance/frontend-device.md)覆盖静态服务关闭后的两次冷启动、两帧像素读回、浏览器文件选择与导入、错误协议拒绝、宿主存储隔离及端口撤销。开发暂定包体上限为已实测的 10,932,804 字节。 |
| T035 · 云端预检 | 已合并并验收，`21000b7` | [预检记录](../../tests/acceptance/cloud-environment.md)包含版本、复验命令和像素断言。Debian 13.7 的系统 Chromium 156 使用 ANGLE/Vulkan/SwiftShader 绘制实际帧。Playwright 管理的 Chromium 159 下载返回 HTTP 403。 |

集成提交 `c1991a8` 可追溯到两份原始原型的完整 Git 对象。独立 Tester 分别复验了集成后的已安装桌面 PWA，生产构建、67 项旧版基线与云 WebGL 预检均通过。Android 结果分别由 T048、T049 记录。T035 覆盖环境预检，FR-018 的首次业务闭环交接仍需对应正式业务入口的通过证据。

## 阶段 2 · 公共基础

T005–T009 从阶段 1 验收基线并行开发，经独立审查、独立测试和集成复验后合入 `work`。集成提交 `3f2b899` 通过干净安装、生产构建、98 项 Vitest、2 项 Chromium 端到端和云 WebGL 预检。验收状态记录在 `b2ea2d9`。该阶段当时验收了 T001–T009 与 T035。 [任务清单](tasks.md)

| 任务 | 本轮工作 | 当前进度 |
|---|---|---|
| T005 | 主体版本缓存、受控前端包入口及离线就绪判定 | 已验收，`02268b4`。Chromium 验证更新包缺失或损坏时保留现有版本，完整更新后可从已安装入口离线冷启并运行原兼容包。[独立测试](../../tests/acceptance/offline-shell.spec.ts) |
| T006 | SQLite OPFS 独占存储、指定发行版的只读目录及 M05 统一牌表校验 | 已验收，`fc16fb3`。在 `a511a3c` 实测独占接管、事务失败回滚、重复发行拒绝及重启读回，T003 的 10 个构建文件与阶段 1 逐字节一致。 |
| T007 | 玩家协议、版本协商、会话命令队列、授权与可见事件 | 已验收，`ad2cc0b`。16 项协议测试覆盖单端升级、握手拒绝、端口重复绑定、回执去重、授权投影和终局关闭。[独立测试](../../tests/contract/player-protocol.test.ts) |
| T008 | 无界面对局核心、确定性随机输入、暂停与恢复 | 已验收，`8f6fefa`。7 项核心测试覆盖内容哈希、同修订竞争、确认前状态、暂停恢复和随机重放。[独立测试](../../tests/contract/match-core.test.ts) |
| T009 | AI 模型契约、席位适配与过期结果判定 | 已验收，`eb43291`。8 项模型测试覆盖请求关联、过期结果丢弃、终局取消和输出投影。另通过正式协议解析器和玩家接口联验原 AI 席位的 M02。[独立测试](../../tests/contract/ai-model.test.ts) |

## 本次会话验收

`tasks.md` 共 49 项，16 项已验收并标记 `[X]`，33 项待完成。已验收项为 T001–T009、T015、T017–T019、T032、T035 和 T042。独立 Developer、Reviewer、Tester 的实现、审查和测试通过后，由 Lead 合并和更新勾选。阶段 2 尚待 T045、T041。US6 已通过安装链路，正式前端及终版设备联验仍待进行。

| 任务 | 集成与证据 |
|---|---|
| T032 | `64834f9` 集成，`b593534` 标记。4 项真实 Chromium SQLite OPFS 测试覆盖独占写入、冷重启、配额耗尽、确认点缺回执与损坏历史动作。[独立测试](../../tests/acceptance/recovery-store.spec.ts) |
| T015 | `8cc20f8` 集成，`e4fdd97` 标记。17 项独立测试覆盖选择、放弃、响应恢复、去重和公开投影。修复并复验了公开投影泄露随机采样顺序的问题。[结构记录](effect-structure.md) · [独立测试](../../tests/contract/effects.test.ts) |
| T017–T019 | `e920dc7` 集成，`2e18aa7` 标记。独立测试覆盖离线安装与升级、旧实例仍可完成升级前待决策、失败回滚、授权撤销及单次入口绑定。原型入口兼容性通过。[契约测试](../../tests/contract/frontend-package.test.ts) · [浏览器测试](../../tests/acceptance/install-offline.spec.ts) |

`2e18aa7` 对应的集成验收通过生产构建、124 项 Vitest 和 9 项桌面 Chromium 端到端测试。同步后的开发基线另通过云 WebGL 出帧预检。Android 正式复验仍按 T048、T049 执行。

## 本次会话 · T042 验收与 T045 中断交接

T042 经独立 Developer、Reviewer、Tester 验收，`4b6aa7b` 合并，`a62d1ec` 标记完成。Developer 修复 LG-08：先弃未选卡，选中脉冲的效果及嵌套结算完成后再弃该脉冲；独立回归验证旧实现失败、新实现通过，并覆盖 LG-06/08 隐私投影。合并后独立验证生产构建、169 项 Vitest 和 9 项 Chromium 端到端测试通过。T042 的合约试验使用测试授权与内存确认记录，尚无从 M01 创建会话的 FR-018 正常业务闭环证据。

T045 已按依赖在 T042 合并后启动，因 Developer 会话用量中断，尚未完成，`tasks.md` 保持 `[ ]`。下列两条分支均为未验收检查点，不得作为已完成任务直接合并：

| 分支 | 检查点 | 内容 |
|---|---|---|
| `agent/t045` | `6553fb7` | 两套运行页面和卡池牌面共 129 张来源清查；部分效果、通用结算、私有选择、时机与来源门禁。最后回收的弃牌区回收、溯源/兑换/回流修改未经审查或测试。 |
| `test/t045-independent` | `4eeda63` | 包含开发候选 `46e6455` 及独立测试，不含开发检查点 `6553fb7`。回收的嵌套代价目标跨暂停恢复回归，`initial-effects-cost.test.ts` 10 项通过。 |

开发分支包含未完整审定的效果，不能按已定义卡数推断迁移覆盖率。Reviewer 已在过程中发现并交回修复：同回合属性及攻击限制、朱厌对核心先击、看牌无候选时不得额外洗牌，以及群伤中的朱雀羽死亡交互过早暂停。后者改为显式登记延迟死亡交互时机，并以双目标、双死亡与恢复样本复验。其余部分仍需对最终检查点重新独立审查和测试。

Tester 曾验证来源一致性（两份游戏页与牌面 129 张）、缺失及重复、来源修改、门禁未知效果和多步骤缺失、部分伤害/回复/护盾/锁定、私有看牌与检索、足额代价及暂停恢复；这些是部分样本证据，不是全卡验收。曾在 `e86836f` 跑通 236 项 Vitest；后续提交及回收的未提交修改均需重新验证。`build:initial` 在未审定时拒绝并核对来源，普通开发构建可运行；T041 的正式资源构建入口尚不存在，未来必须接入并复验门禁。当前仍缺全卡逐入口效果及规则能力、逐条牌面语义及放弃权核验、完整测试与审查、首版构建联验。不得将来源清单、少数测试通过或空审定表误报为 T045 完成。

下次会话先按仓库 Git 启动协议同步 `origin/work`，显式获取上述远程检查点，在最新 `work` 分别创建隔离工作树并保留检查点。由不同 Developer、Reviewer、Tester 接续；先核对最终中断检查点的未完成修改，再逐项实现和审查 T045，复跑旧版样本、结构差异及覆盖阻断。只有独立审查、测试和合并后集成验收均通过，Lead 才更新 T045 状态。依赖关系为 T045 完成后方可实施 T041；FR-018 首次真实业务闭环及 T048、T049 的 Android 实机验收仍需按计划执行。

> /speckit-implement 从最新 `origin/work` 继续。先阅读本实施记录、任务清单、规格、计划、数据模型、业务契约及验收指南。接回 `agent/t045` 与 `test/t045-independent` 的远程检查点，基于最新 `work` 创建独立工作树，由不同 Developer、Reviewer、Tester 分别完成 T045 实现、审查和测试。先核查未验收的中断修改，完成全卡效果、语义及构建覆盖验收，再按依赖推进。保留 FR-018 首次真实闭环汇报及 T048、T049 Android 实机验收。ACP

在仓库根目录复验合入基线。T045 候选请在独立测试工作树安装依赖后运行相应的 `tests/contract/initial-effects*.test.ts`、来源及门禁测试，再运行完整测试和构建。

```sh
SPECIFY_FEATURE_DIRECTORY=specs/001-offline-game-refactor SPECIFY_FEATURE_NO_PERSIST=1 .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks
npm_config_cache=/tmp/critical-npm-cache npm ci
npm run build
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --workers=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud
```

## 待验收与后续依赖

- **阶段 2** T032、T015 已验收。T042 已验收；T045、T041 继续按任务依赖推进。T005 与 T019 沿用 T004 的桌面入口结论。桌面验证观察到初始不透明 iframe 导航可能绕过 Service Worker。原型由入口响应的 CSP 建立不透明来源，并在核对受控入口、实例标记与来源后才发端口。源站的包入口回退应返回惰性 404。
- **桌面正式验收** 继续通过对应业务任务取得 SC-010 的首版准备、开局、构筑和创建草稿证据，以及 SC-011 的前端包验证证据。
- **Android 最终验收** 由本地 Codex 在正式构建交接后完成。T048 补齐手机 OPFS 证据，T049 完成 Android 安装、断网、文件选择、3D、授权隔离和跨设备文件测试。记录设备版本及实测包体字节，两端通过后确定正式包体上限。

## 云环境配置交接提示词

> 请为本项目后续云会话持久化 Node.js 24 LTS、可运行 WebGL 2 的系统 Chromium，以及会话可写的 npm 缓存配置。当前实测为 Node 24.22.3、npm 11.19.1、Debian Chromium 156.0.8078.79、ANGLE/Vulkan/SwiftShader。以仓库锁文件执行 `npm ci`，再运行 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud`。预期读回绿色中心像素、黑色背景像素并报告 GL 错误为 0。并行的端到端测试可分别设置 `PLAYWRIGHT_PREVIEW_PORT`。
>
> 请把实际环境改动保留为后续云会话的基础，并返回全新会话的复验步骤。待首次代表性真实业务路径通过后按 FR-018 交接。将验证流程持久化为 Skill 前须经维护者明确批准。

## 本地 Codex 验收交接

交接正式构建提交、环境版本、构建与验证命令、HTTPS 静态预览及响应配置、夹具、原型复验入口和已有证据。T003、T004 原型使用各自独立的测试源，T004 的 `/__t004__/entry` 静态回退返回惰性 404。本地按[验收指南](quickstart.md#环境与执行顺序)复跑桌面，再用可访问该 HTTPS 入口的 Android Chrome 实机安装并执行 T048、T049。
