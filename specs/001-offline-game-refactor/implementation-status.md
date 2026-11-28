# 阶段实施记录 · 《临界》离线工程化重构

**记录日期** — 2026-11-28
**范围** — 已验收任务、T042 中断回收与后续实施交接
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

T005–T009 从阶段 1 验收基线并行开发，经独立审查、独立测试和集成复验后合入 `work`。集成提交 `3f2b899` 通过干净安装、生产构建、98 项 Vitest、2 项 Chromium 端到端和云 WebGL 预检。验收状态记录在 `b2ea2d9`。截至本次交接，49 项中有 10 项完成，即 T001–T009 与 T035。 [任务清单](tasks.md)

| 任务 | 本轮工作 | 当前进度 |
|---|---|---|
| T005 | 主体版本缓存、受控前端包入口及离线就绪判定 | 已验收，`02268b4`。Chromium 验证更新包缺失或损坏时保留现有版本，完整更新后可从已安装入口离线冷启并运行原兼容包。[独立测试](../../tests/acceptance/offline-shell.spec.ts) |
| T006 | SQLite OPFS 独占存储、指定发行版的只读目录及 M05 统一牌表校验 | 已验收，`fc16fb3`。在 `a511a3c` 实测独占接管、事务失败回滚、重复发行拒绝及重启读回，T003 的 10 个构建文件与阶段 1 逐字节一致。 |
| T007 | 玩家协议、版本协商、会话命令队列、授权与可见事件 | 已验收，`ad2cc0b`。16 项协议测试覆盖单端升级、握手拒绝、端口重复绑定、回执去重、授权投影和终局关闭。[独立测试](../../tests/contract/player-protocol.test.ts) |
| T008 | 无界面对局核心、确定性随机输入、暂停与恢复 | 已验收，`8f6fefa`。7 项核心测试覆盖内容哈希、同修订竞争、确认前状态、暂停恢复和随机重放。[独立测试](../../tests/contract/match-core.test.ts) |
| T009 | AI 模型契约、席位适配与过期结果判定 | 已验收，`eb43291`。8 项模型测试覆盖请求关联、过期结果丢弃、终局取消和输出投影。另通过正式协议解析器和玩家接口联验原 AI 席位的 M02。[独立测试](../../tests/contract/ai-model.test.ts) |

## 本次会话验收

`tasks.md` 共 49 项，15 项已验收并标记 `[X]`，34 项待完成。已验收项为 T001–T009、T015、T017–T019、T032 和 T035。独立 Developer、Reviewer、Tester 的实现、审查和测试通过后，由 Lead 合并和更新勾选。阶段 2 尚待 T042、T045、T041。US6 已通过安装链路，正式前端及终版设备联验仍待进行。

| 任务 | 集成与证据 |
|---|---|
| T032 | `64834f9` 集成，`b593534` 标记。4 项真实 Chromium SQLite OPFS 测试覆盖独占写入、冷重启、配额耗尽、确认点缺回执与损坏历史动作。[独立测试](../../tests/acceptance/recovery-store.spec.ts) |
| T015 | `8cc20f8` 集成，`e4fdd97` 标记。17 项独立测试覆盖选择、放弃、响应恢复、去重和公开投影。修复并复验了公开投影泄露随机采样顺序的问题。[结构记录](effect-structure.md) · [独立测试](../../tests/contract/effects.test.ts) |
| T017–T019 | `e920dc7` 集成，`2e18aa7` 标记。独立测试覆盖离线安装与升级、旧实例仍可完成升级前待决策、失败回滚、授权撤销及单次入口绑定。原型入口兼容性通过。[契约测试](../../tests/contract/frontend-package.test.ts) · [浏览器测试](../../tests/acceptance/install-offline.spec.ts) |

`2e18aa7` 对应的集成验收通过生产构建、124 项 Vitest 和 9 项桌面 Chromium 端到端测试。同步后的开发基线另通过云 WebGL 出帧预检。Android 正式复验仍按 T048、T049 执行。

## 会话续接 · T042

独立 Tester 的用量中断发生在补充隐私回归期间。其未提交变更已原样单独提交。T042 在 `tasks.md` 保持 `[ ]`，两条候选分支分别保存，供下个会话从最新 `work` 创建独立工作树后接续。

| 分支 | 检查点 | 接续内容 |
|---|---|---|
| `task/t042-official-rules` | `a27d6124a125d1c99108c390d27701a877445806` | `6129525` 接入正式结算、M02–M04 与 D04。`a27d612` 增加不泄露候选或决策 ID 的公开等待状态。最新提交尚无独立审查或测试通过记录。 |
| `test/t042-rules` | `38c7168428984c84c6af14ef4e0f0ee866b35bf3` | `2c618f3` 集成初始候选 `6129525`。该组合通过 43 项独立测试，覆盖两套旧版 21 个变体与 D04。`38c7168` 保存中断前的 LG-06 公开等待和 LG-08 顺序隔离回归，尚未执行，分支尚未叠加 `a27d612`。 |

`task/t017-acceptance-fixtures` 的原始提交 `a3dd534` 以等价补丁 `38d2b95` 随 T017 已进入 `work`，无需再次交接。T032、T015、T018、T019 及各已验收测试分支的成果均可从 `work` 追溯。

T042 审查仍需处理 LG-08 已选脉冲的结算顺序。按场景 10，先弃置未选卡，再结算已选脉冲的效果，最后弃置该脉冲。原审查对 M03 泄露弃牌抽样顺序的发现已撤回，精确候选的公开弃牌已排序。保留 Tester 的隔离回归以防复发。下一轮由 Developer 核对并修正脉冲弃置时点，由 Reviewer 审查最终候选，由 Tester 合并最终候选到独立测试工作树并补充顺序断言。Lead 在独立审查、独立测试、集成复验全部通过后合并和勾选 T042，再按依赖推进 T045、T041。T042 的合约试验使用测试授权与内存确认记录，尚无从 M01 创建会话的 FR-018 正常业务闭环证据。

> /speckit-implement 从最新 `origin/work` 继续。先读本实施记录、任务清单、计划、数据模型、业务契约和验收指南。接回 `task/t042-official-rules` 与 `test/t042-rules` 的检查点，基于最新 `work` 分别创建独立工作树，保持 Developer、Reviewer、Tester 三角色独立。先修复并复验 T042，再按 `tasks.md` 解锁下游任务。保留 FR-018 首次真实闭环汇报及 T048、T049 Android 实机验收。ACP

在仓库根目录复验合入基线。合入 T042 前，可在独立测试工作树用 `npm test -- tests/contract/legacy-rules.test.ts` 复验对应候选。

```sh
SPECIFY_FEATURE_DIRECTORY=specs/001-offline-game-refactor SPECIFY_FEATURE_NO_PERSIST=1 .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks
npm_config_cache=/tmp/critical-npm-cache npm ci
npm run build
npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --workers=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud
```

## 待验收与后续依赖

- **阶段 2** T032、T015 已验收。T042、T045、T041 继续按任务依赖推进。T005 与 T019 沿用 T004 的桌面入口结论。桌面验证观察到初始不透明 iframe 导航可能绕过 Service Worker。原型由入口响应的 CSP 建立不透明来源，并在核对受控入口、实例标记与来源后才发端口。源站的包入口回退应返回惰性 404。
- **桌面正式验收** 继续通过对应业务任务取得 SC-010 的首版准备、开局、构筑和创建草稿证据，以及 SC-011 的前端包验证证据。
- **Android 最终验收** 由本地 Codex 在正式构建交接后完成。T048 补齐手机 OPFS 证据，T049 完成 Android 安装、断网、文件选择、3D、授权隔离和跨设备文件测试。记录设备版本及实测包体字节，两端通过后确定正式包体上限。

## 云环境配置交接提示词

> 请为本项目后续云会话持久化 Node.js 24 LTS、可运行 WebGL 2 的系统 Chromium，以及会话可写的 npm 缓存配置。当前实测为 Node 24.22.3、npm 11.19.1、Debian Chromium 156.0.8078.79、ANGLE/Vulkan/SwiftShader。以仓库锁文件执行 `npm ci`，再运行 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud`。预期读回绿色中心像素、黑色背景像素并报告 GL 错误为 0。并行的端到端测试可分别设置 `PLAYWRIGHT_PREVIEW_PORT`。
>
> 请把实际环境改动保留为后续云会话的基础，并返回全新会话的复验步骤。待首次代表性真实业务路径通过后按 FR-018 交接。将验证流程持久化为 Skill 前须经维护者明确批准。

## 本地 Codex 验收交接

交接正式构建提交、环境版本、构建与验证命令、HTTPS 静态预览及响应配置、夹具、原型复验入口和已有证据。T003、T004 原型使用各自独立的测试源，T004 的 `/__t004__/entry` 静态回退返回惰性 404。本地按[验收指南](quickstart.md#环境与执行顺序)复跑桌面，再用可访问该 HTTPS 入口的 Android Chrome 实机安装并执行 T048、T049。

## 会话续接 · T042 验收与 T045 未完成检查点

T042 已经由独立 Developer、Reviewer、Tester 验收并合入 `work`。开发候选 `eea75f8` 修正 LG-08 已选脉冲在效果及嵌套结算完成后弃置；独立测试 `5529257` 包含回归断言，在修复前失败、修复后通过。集成后生产构建和 169 项 Vitest 通过，T042 在任务清单中标记完成。实施期间误将旧候选提前合入本地 `work`，随后撤销；独立验收后重新应用并集成，完整历史保留。

T045 **尚未完成，不得勾选或合入**。以下远程分支保留未验收成果，供从最新 `work` 建立独立工作树后继续：

| 分支 | 检查点 | 内容与限制 |
|---|---|---|
| `origin/task/t045-effects` | `799e39e07eb5dc4573740dd757e43d62c687b390` | 两端 129 张旧卡来源清单、部分基础效果和映射、初步覆盖校验；并非发行候选。最近生产构建及现有 169 项测试通过。 |
| `origin/test/t045-independent-20261128-session` | `3e744f71af0b8dd5c45e6037379a4bc09b177a77` | 独立库存、缺失能力拒绝及核心回复测试；针对中间候选的初步验证，尚非 T045 全量验收。 |

粗略清点约 287 个顶层旧规则入口，最终开发检查点仍约 246 个未覆盖，统计须复算；已有候选映射也须逐项核实语义。尚需实现大量效果、触发、选择和顺序，校验牌面限制与每个旧入口，接入正式发行构建，并由独立 Reviewer 和 Tester 完整验收。不要因候选映射存在或现有测试通过而视为完成。FR-018 正常业务闭环和 Android 最终验收仍按既有交接执行。

续接时先按云 Git 工作流同步 `origin/work`，遵守任务依赖和三角色隔离；在独立工作树接回上述检查点。开发候选可用后由 Reviewer 审查完整语义，由 Tester 验证全量旧效果、缺失映射、未知触发器、未实现能力以及结构差异，再集成复验并更新 T045 状态。开发分支复验命令为 `npm_config_cache=/tmp/critical-npm-cache npm ci && npm run build && npm test`。
