# 环境依赖与 Docker 复验

盘点基线为 `origin/work` 的 `5da5805`。覆盖当前宿主 PWA、构建、自动化测试及仓库规格脚本。功能完成状态和设备验收条件见[实施计划](specs/001-offline-game-refactor/plan.md)、[验收指南](specs/001-offline-game-refactor/quickstart.md)和[阶段实施记录](specs/001-offline-game-refactor/implementation-status.md)。

## 环境依赖表

| 范围 | 依赖及版本 | 用途与配置来源 |
| --- | --- | --- |
| Docker 宿主 | 可用的 Docker Engine、BuildKit 和端口映射。当前工作空间为 Debian 13.7、x86_64、Docker 29.9.2 | 从仓库根目录构建。[Dockerfile](Dockerfile)固定 Node 官方 Debian 13 slim 镜像的摘要，[.dockerignore](.dockerignore)仅纳入构建与复验所需的项目文件。 |
| JS / TS | Node.js 24 LTS。当前工作空间实测 Node `24.22.3`、npm `11.19.1` | [package.json](package.json)声明直接依赖、Node 版本和命令，[package-lock.json](package-lock.json)锁定安装及平台相关依赖。统一执行 `npm ci`。TypeScript、Vite、Vitest 和 Playwright 的精确版本以锁文件为准。 |
| SQLite | `@sqlite.org/sqlite-wasm` `3.54.1-build1` | 版本在 npm 清单中锁定。浏览器专用 Worker 使用 `opfs-sahpool`。卡池和对局恢复使用各自的数据库，卡组与前端安装记录使用 IndexedDB。 |
| 浏览器自动化 | Playwright 和 Debian 系统 Chromium。当前工作空间 Chromium 为 `156.0.8078.79` | 镜像通过 APT 安装 `chromium`、传递系统库和 CJK 字体。Playwright 通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` 使用它。构建时采用 Debian 仓库提供的 Chromium 更新，复验时记录实际版本。 |
| 图形 | Chromium WebGL 2 与软件渲染后端 | [预检脚本](scripts/cloud-preflight.ts)绘制并读回画面像素。历史与当前工作空间使用 ANGLE/Vulkan/SwiftShader，具体以预检输出为准。 |
| PWA 与浏览器存储 | 支持 Service Worker、Cache Storage、IndexedDB、WebAssembly、专用 Worker、Web Locks、OPFS 同步访问句柄的 Chromium 安全上下文 | 本机使用 `http://127.0.0.1:4173`，跨设备使用可信 HTTPS。离线站点资源、安装记录和对局数据由访问该来源的浏览器配置文件保存。发布时保留静态资源路径、WASM MIME 类型和 Service Worker 的作用域。 |
| 旧版样本与正式前端规划 | [quote/](quote/)内置历史 HTML 和素材，[测试夹具](tests/)保留自动化复验输入 | 旧版 3D HTML 内嵌 Three.js r128。[前端包原型](tests/acceptance/frontend-device.md)从内嵌资源构建样本，[存储原型](tests/acceptance/storage-device.md)通过独立 Vite 配置构建。规格计划的正式 3D 前端延续 Three.js，其独立 npm 依赖待实现时随清单锁定。 |
| 仓库规格脚本 | Bash、Git、常用 Unix 命令、jq、Python 3 | 镜像安装 Git、jq、Python 3。[规格脚本](.specify/scripts/bash/)中的 Python 代码只使用标准库，无需 pip 安装。工作空间 Git `2.56.1`、Bash `5.2.37`、Python `3.12.14`，镜像采用 Debian 所提供的工具版本。镜像内运行依赖 feature 选择的脚本时，显式设置 `SPECIFY_FEATURE_DIRECTORY=specs/001-offline-game-refactor`。 |
| 辅助工具 | CA 证书、curl、ripgrep | 镜像内含这三项工具，用于安装、HTTP 验证和仓库检索。 |
| 规格编写和云同步 | Spec Kit CLI `1.4.4`、uv、Codex、GitHub 访问 | [初始化记录](.specify/init-options.json)固定 Spec Kit 版本。当前工作空间用 uv `0.13.9` 提供独立 CLI 环境。需要在自己的开发工具环境复装 CLI 时运行 `uv tool install --from git+https://github.com/github/spec-kit.git@v1.4.4 specify-cli`。Codex 与 GitHub 凭据由开发宿主提供。 |
| 首次镜像构建 | Docker Hub、Debian 软件源和 npm Registry | 分别获取基础镜像、系统包和锁定的 npm 包。缓存命中时，源文件改动可复用系统包和 npm 安装层。镜像建成后，预览和自动化套件使用容器内资源。系统 Chromium 的安装路径可避开当前云环境中 Playwright 浏览器下载源的访问限制。 |
| 实机验收 | 桌面 Chromium、Android Chrome、可信 HTTPS 入口、Android Platform Tools（ADB）和 Chrome 远程调试 | 按验收指南在真实设备上复验 PWA 安装、断网冷启动、触控或鼠标、文件选择、跨设备迁移和 3D。设备及浏览器版本随验收证据记录。 |

## 从 Docker 启动

在项目根目录执行。默认启动镜像中已构建好的 Vite 预览。

```sh
docker build -t critical-provisional:sandbox .
docker run --rm --init -p 127.0.0.1:4173:4173 critical-provisional:sandbox
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。另一个终端可运行 `curl -fsS http://127.0.0.1:4173/ -o /dev/null` 验证 HTTP 响应。更新依赖时修改项目清单与锁文件并重建镜像。修改应用源码后重建会生成新的 `dist/`。

若 npm 流量经过使用自定义 CA 的代理，构建时可用 BuildKit 临时传入该 CA 的 PEM 文件。当前 Codex 工作空间可直接使用环境中配置的路径。证书只在依赖安装步骤挂载。

```sh
docker build --secret "id=npm_ca,src=$NODE_EXTRA_CA_CERTS" -t critical-provisional:sandbox .
```

## 在容器中复验

```sh
docker run --rm --init --network none --shm-size=512m critical-provisional:sandbox \
  sh -c 'node --version && npm --version && chromium --version && npm test && npm run test:e2e && npm run preflight:cloud'
```

`npm test` 包含旧版基线，单跑可用 `npm run test:baseline`。Playwright 在容器回环地址启动独立构建预览，默认端口 `4173`，同一环境并发时可设置 `PLAYWRIGHT_PREVIEW_PORT`。`npm run preflight:cloud` 重新构建后应报告 WebGL 2、绿色中心像素、黑色背景像素和 `error: 0`。云端历史配置及浏览器替换方式见 [T035 记录](tests/acceptance/cloud-environment.md)。

Docker 复验覆盖当前基线的宿主构建、已实现的浏览器用例和软件 WebGL 出帧。完整正式业务入口的交付进度见阶段实施记录。安装图标冷启动、设备断网、输入和设备渲染按桌面和 Android 的实机验收单独取证。

## Docker 沙箱实测

| 检查 | 结果 |
| --- | --- |
| 镜像构建与默认启动 | 在当前 x86_64 Docker 沙箱构建成功。宿主经映射的回环端口取得首页和 Service Worker。 |
| 镜像内版本 | Node.js `24.22.3`、npm `11.19.1`、Chromium `156.0.8078.114`、Python `3.13.5`、Git `2.47.3`。 |
| 禁用容器外网复验 | 170 项 Vitest 和 9 项 Chromium 端到端测试全部通过。WebGL 2 使用 ANGLE/Vulkan/SwiftShader，中心为 `[0, 255, 0, 255]`、背景为 `[0, 0, 0, 255]`，GL 错误为 0。 |
| 其他构建入口 | 规格脚本成功解析当前 feature。存储原型成功构建 WASM 资源，前端包原型生成的两个样本 SHA-256 均与原型记录一致。 |
