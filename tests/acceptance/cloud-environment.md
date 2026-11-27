# 云端环境预检 · T035

在独立的 Codex Cloud 会话中检出需要验收的提交，使用 Node.js 24 LTS 和仓库的 `package-lock.json`。预检经 Vite 构建预览打开宿主页面，在一次动画帧回调后用 WebGL 2 绘制绿色三角形并读取中心与背景像素。预览绑定 `127.0.0.1`，由系统分配空闲端口，浏览器及预览服务在命令结束时关闭。云端环境仅配置 SSH 入口，这条回环路径可在会话内直接复验。

## 实测环境

| 项目 | 实测值 |
|---|---|
| 系统 | Debian 13.7 (trixie), x86_64 |
| 工具链 | Node.js `24.22.3`、npm `11.19.1`、TypeScript `6.0.3`、Vite `8.4.0`、Vitest `5.1.2`、Playwright `1.65.1` |
| 浏览器 | 无头 Debian Chromium `156.0.8078.79`，`chromium` 和 `chromium-common` 包均为 `156.0.8078.79-1~deb13u1` |
| 图形后端 | WebGL 2.0 (OpenGL ES 3.0 Chromium)，ANGLE / Vulkan 1.3.0 / SwiftShader Device (Subzero)，软件渲染 |

Playwright `1.65.1` 下载的 Chrome for Testing 版本为 `159.0.8154.6`（Chromium 构建 `v1255`）。本次环境访问 `cdn.playwright.dev` 收到 HTTP `403 Domain forbidden`，实际预检使用系统 Chromium `/usr/bin/chromium`。云端会话若缺少该包，可通过环境的系统软件包安装机制从 Debian 软件源安装 `chromium` 及其依赖。换用浏览器或环境后重新运行预检并记录输出中的版本和渲染后端。

## 复验入口

在当前受限云端会话中使用系统 Chromium。

```sh
npm_config_cache=/tmp/critical-npm-cache npm ci
chromium --version
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run preflight:cloud
```

Playwright 可访问其下载源时，使用锁定版本对应的受管理浏览器。浏览器所需的系统库由运行环境提供。

```sh
npm_config_cache=/tmp/critical-npm-cache npm ci
export PLAYWRIGHT_BROWSERS_PATH=/tmp/critical-playwright
npm_config_cache=/tmp/critical-npm-cache npm exec playwright -- install chromium
npm run preflight:cloud
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 也适用于 `npm run test:e2e` 的 Chromium 项目。并行 worktree 可通过 `PLAYWRIGHT_PREVIEW_PORT` 为各自的端到端套件选择不同的可用端口。

## 预期输出与实测证据

预检命令退出码为 `0`，末尾输出 `Cloud WebGL preflight passed`。本次复验的关键输出如下。

```json
{
  "chromium": "156.0.8078.79",
  "webgl": "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
  "renderer": "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
  "centerRgba": [0, 255, 0, 255],
  "cornerRgba": [0, 0, 0, 255],
  "error": 0
}
```

预检覆盖依赖安装、生产构建预览、浏览器启动、着色器绘制和像素读回。官方 3D 的本地资源、战场出帧、镜头、拾取和对局证据由 T039 在正式前端入口验收。场景和证据要求见[云端自主验收](../../specs/001-offline-game-refactor/quickstart.md#云端自主验收)。
