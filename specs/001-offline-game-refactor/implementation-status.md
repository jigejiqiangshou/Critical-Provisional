# 阶段实施记录 · 《临界》离线工程化重构

**记录日期** — 2026-11-27
**范围** — 阶段 1 验收、阶段 2 实施进度与跨阶段 T035
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

## 会话续接 · T032

T032 的 Developer、Reviewer、Tester 已分派，三名 Agent 均在产出候选前中断。Developer 建立了 `task/t032-recovery-store` 并核对了对局核心、玩家接口和现有 SQLite Worker。该分支停在 `b2ea2d9`，与当时的 `work` 相同，工作树干净。Tester 尚未写入测试，Reviewer 尚未出具报告。

T005–T009 的实现和独立测试分支均可从 `work` 追溯。当前会话没有需另行发布的任务提交。唯一不在 `work` 历史中的本地分支 `archive/work-8702d40` 是启动时保留的主分支快照，对应 `origin/main` 的 `8702d40`，与本次实施无关。

> /speckit-implement 从最新 `origin/work` 继续。先读本实施记录、任务清单、计划、数据模型和验收指南。T001–T009 与 T035 已验收。T032 从最新 `work` 建独立开发分支和工作树，由三名不同的 Agent 分别实现、审查、测试。Lead 负责调度、集成和标记任务。T032 通过后依次按 `tasks.md` 解锁 T015、T042、T045、T041。保留 FR-018 的首次业务闭环汇报及 T048/T049 的本地 Android 最终验收。

T032 接入 [玩家接口](../../src/match/player-interface.ts)的 `PlayerCommandStore` 和[对局核心](../../src/match/core.ts)的持久化状态。独立测试应从正式存储入口验证真实 SQLite OPFS 的排他写入、会话初始化、确认失败保留旧状态、快照与回执同事务提交、拒绝摘要的确认点范围、重启后读取回执和已确认终局结果。首个满足 FR-018 条件的正常业务路径取得证据后，按[验收指南](quickstart.md#证据首次通过与交接)即时汇报。

在仓库根目录复验已合入基线。当前预期为 98 项 Vitest、2 项 Chromium 端到端及 WebGL 预检通过。

```sh
SPECIFY_FEATURE_DIRECTORY=specs/001-offline-game-refactor SPECIFY_FEATURE_NO_PERSIST=1 .specify/scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks
npm_config_cache=/tmp/critical-npm-cache npm ci
npm run test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/acceptance/offline-shell.spec.ts --workers=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud
```

## 待验收与后续依赖

- **阶段 2** T032 的前置任务已验收。T015、T042、T045、T041 继续按任务依赖推进。T005 与 T019 沿用 T004 的桌面入口结论。桌面验证观察到初始不透明 iframe 导航可能绕过 Service Worker。原型由入口响应的 CSP 建立不透明来源，并在核对受控入口、实例标记与来源后才发端口。源站的包入口回退应返回惰性 404。
- **桌面正式验收** 继续通过对应业务任务取得 SC-010 的首版准备、开局、构筑和创建草稿证据，以及 SC-011 的前端包验证证据。
- **Android 最终验收** 由本地 Codex 在正式构建交接后完成。T048 补齐手机 OPFS 证据，T049 完成 Android 安装、断网、文件选择、3D、授权隔离和跨设备文件测试。记录设备版本及实测包体字节，两端通过后确定正式包体上限。

## 云环境配置交接提示词

> 请为本项目后续云会话持久化 Node.js 24 LTS、可运行 WebGL 2 的系统 Chromium，以及会话可写的 npm 缓存配置。当前实测为 Node 24.22.3、npm 11.19.1、Debian Chromium 156.0.8078.79、ANGLE/Vulkan/SwiftShader。以仓库锁文件执行 `npm ci`，再运行 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud`。预期读回绿色中心像素、黑色背景像素并报告 GL 错误为 0。并行的端到端测试可分别设置 `PLAYWRIGHT_PREVIEW_PORT`。
>
> 请把实际环境改动保留为后续云会话的基础，并返回全新会话的复验步骤。待首次代表性真实业务路径通过后按 FR-018 交接。将验证流程持久化为 Skill 前须经维护者明确批准。

## 本地 Codex 验收交接

交接正式构建提交、环境版本、构建与验证命令、HTTPS 静态预览及响应配置、夹具、原型复验入口和已有证据。T003、T004 原型使用各自独立的测试源，T004 的 `/__t004__/entry` 静态回退返回惰性 404。本地按[验收指南](quickstart.md#环境与执行顺序)复跑桌面，再用可访问该 HTTPS 入口的 Android Chrome 实机安装并执行 T048、T049。
