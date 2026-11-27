# T003 · SQLite OPFS 安装实测

## 驱动与启动条件

原型使用锁定的 `@sqlite.org/sqlite-wasm@3.54.1-build1`，页面显示的 SQLite 运行时版本为 `3.54.1`。专用 Worker 取得同源独占 Web Lock 后才装载 SQLite 和 `opfs-sahpool`，并持有写入权至所属页面关闭。竞争实例显示占用，持有者关闭后可重试接管。原型表和 OPFS 目录专用于设备验证。

验证入口需要安全上下文、WebAssembly、专用 Worker 中的 Web Locks 和 OPFS 同步访问句柄，以及安装和离线启动所需的 Service Worker 与 Cache Storage。桌面 Chromium `156.0.8078.79` 是本原型最早已通过的版本。Android 的 Chrome 版本由 T048 实测记录。驱动的持久化路线与兼容 VFS 候选见 [SQLite WASM 持久化文档](https://sqlite.org/wasm/doc/trunk/persistence.md)。

原工作区提交 `8aeca9a39b601bff38fb615f4979b7fc7411d485` 的源文件、图标与验证文档已依据完整会话记录恢复至 `ae2ad05fef04f0e80d6be70e8c39228d96512ad0`。恢复时核对原提交的文件统计、PNG 字节数及原构建中的 Worker、WASM 和入口模块文件名与大小。

## 复验

使用 Node.js 24 和仓库锁定依赖构建独立静态入口。

```sh
npm ci
npm exec -- vite build --config tests/acceptance/storage-spike/vite.config.ts
npm exec -- vite preview --config tests/acceptance/storage-spike/vite.config.ts --host 127.0.0.1 --port 43303 --strictPort
```

桌面打开 `http://127.0.0.1:43303/`，使用 Chromium 的安装入口。在无既存原型数据的配置文件或专用来源验证。T048 从 Android Chrome 访问独立 HTTPS 来源上发布的 `dist/storage-spike/`，并按验收指南在正式入口复验。

1. 在在线时从安装图标启动，确认「安装模式」「离线资源已就绪」「已取得存储」，并记录版本和初始记录数。点击「申请持久存储」，记录是否授予。
2. 保留持有写入权的窗口，再打开共享同源存储的第二个实例。第二个实例应显示「存储已被另一个实例占用」，写入操作禁用。关闭持有者，然后在第二个实例点击「重试取得存储」，确认接管及原记录数。若平台把安装实例与普通浏览器分在不同存储分区，记录该差异，并在共享同一存储分区的两个实例中复验。
3. 点击「提交一条记录」，确认计数增加一条。点击「触发约束回滚」，确认计数和提交后的计数相同。
4. 点击「模拟提交中断」，等界面显示一条未提交记录后完全结束应用和相关浏览器进程。切断设备网络后从安装入口重新启动，确认启动成功、原已提交记录仍可读取、未提交记录未留下。
5. 逐设备记录机型、系统和浏览器完整版本，并保存安装模式、占用与接管、回滚与断网冷启动时的状态和计数。出现异常时记录出错步骤和页面反馈。

使用 Playwright 驱动 Chromium 复验时，在持久配置文件用浏览器级 CDP 的 `PWA.install` 安装。以 `PWA.changeAppUserSettings` 选择 `displayMode: 'standalone'`，再用 `PWA.launch` 打开。检查页面 `#display-mode[data-mode=standalone]`。冷启动前结束浏览器，保留同一配置文件，停止预览服务并离线启动新浏览器进程。页面 `#database-status` 和 `#records` 的 `data-status`、`data-count` 可读取结果。

## 设备结果

| 环境 | 安装与离线冷启动 | 独占与回滚 | 持久存储 |
|---|---|---|---|
| 云端桌面 Debian GNU/Linux 13.7（trixie），Chromium 156.0.8078.79，2026-11-27 | CDP 安装并打开独立应用窗口，页面报告安装模式。同一配置文件结束并重开 Chromium，断开预览源且模拟离线后，仍从已安装入口读到 SQLite 3.54.1 和 1 条已提交记录。 | 安装窗口在原标签页持有写入权时显示占用。原标签页关闭后成功接管，从 0 条提交至 1 条。触发重复主键后仍为 1 条。关闭应用前显示事务内 2 条，重启后读到 1 条。 | 此次配置文件中持久存储申请获准。 |
| Android Chrome 已安装 PWA | T048 待实机采集 | T048 待实机采集 | T048 待实机采集 |

原工作区在云端 Chromium 的单独空配置中，通过 CDP `Storage.overrideQuotaForOrigin` 将原型来源配额限制为 1024 字节。页面显示存储配额超限和离线资源准备失败，写入操作保持禁用。复验时在首次访问之前设置配额，检查 `#database-status` 和 `#offline-status` 的 `data-status` 均为 `error`，并检查三个写入按钮禁用。

恢复后使用 Chromium `156.0.8078.79` 重新执行开发自查。安装窗口先报告占用，关闭持有者后接管并提交一条记录，约束回滚后计数仍为 1。中断事务内显示 2 条记录。关闭 Chromium 和预览服务，确认源站访问失败，再从同一配置文件的安装入口离线打开，读回 1 条记录。在单独空配置中复现了 1024 字节配额下的两项错误及三个写入按钮禁用。

T006 使用桌面 OPFS 与独占接管验证结论。T048 按发布前的 [Android 验收指南](../../specs/001-offline-game-refactor/quickstart.md) 记录实际设备、系统、浏览器、驱动和构建版本。
