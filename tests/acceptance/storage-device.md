# T003 · SQLite OPFS 安装实测

## 驱动与启动条件

原型使用锁定的 `@sqlite.org/sqlite-wasm@3.54.1-build1`，页面显示的 SQLite 运行时版本为 `3.54.1`。专用 Worker 取得同源独占 Web Lock 后才装载 SQLite 和 `opfs-sahpool`，并持有写入权至所属页面关闭。竞争实例显示占用，持有者关闭后可重试接管。原型表和 OPFS 目录专用于设备验证。

验证入口需要安全上下文、WebAssembly、专用 Worker 中的 Web Locks 和 OPFS 同步访问句柄，以及安装和离线启动所需的 Service Worker 与 Cache Storage。本轮已实测的桌面起始版本为 Chromium `156.0.8078.79`。iOS Safari 与 Android Chrome 的起始版本待实机验证后确定。驱动的持久化路线与兼容 VFS 候选见 [SQLite WASM 持久化文档](https://sqlite.org/wasm/doc/trunk/persistence.md)。

## 复验

使用 Node.js 24 和仓库锁定依赖构建独立静态入口。

```sh
npm ci
npm exec -- vite build --config tests/acceptance/storage-spike/vite.config.ts
npm exec -- vite preview --config tests/acceptance/storage-spike/vite.config.ts --host 127.0.0.1 --port 43303 --strictPort
```

桌面打开 `http://127.0.0.1:43303/`。移动设备从其浏览器访问独立 HTTPS 来源上发布的 `dist/storage-spike/`。安装时使用 iOS Safari 的「添加到主屏幕」或 Chromium 的安装入口。在无既存原型数据的配置文件或专用来源验证。

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
| iOS Safari 主屏幕安装 | 待实机采集 | 待实机采集 | 待实机采集 |
| Android Chrome 安装 | 待实机采集 | 待实机采集 | 待实机采集 |

云端 Chromium 在单独的空配置中通过 CDP `Storage.overrideQuotaForOrigin` 将原型来源配额限制为 1024 字节。页面显示存储配额超限和离线资源准备失败，写入操作保持禁用。

iOS 和 Android 的可用起始版本及实测结论仍开放。待采集两类移动设备的证据后，再据 [迁移顺序](../../specs/001-offline-game-refactor/plan.md#迁移顺序) 确定存储路线。
