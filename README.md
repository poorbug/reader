# 纸间 · 私人电子书阅读器

纯前端 EPUB / PDF / MOBI PWA，专供个人阅读。无账户、无后端，书籍原文件、阅读进度、划线、笔记和书签默认保存在当前设备的 IndexedDB。

## 已实现（MVP 原型）

- 本机选择 EPUB、PDF、MOBI 文件，SHA-256 去重、提取书名、作者与封面（若可获取）
- 书架：在读 / 已读 / 归档 / 删除
- epub.js 翻页阅读、目录、书签、字号和背景主题
- 进度自动保存、恢复、基于 EPUB CFI 的划线与笔记、笔记跳原文
- 完整 JSON 备份与恢复（包含 EPUB 文件的 base64）
- Service Worker 离线缓存与 PWA 主屏幕安装

## GitHub Pages

项目地址：https://github.com/poorbug/reader

Pages 地址（启用 Pages 后）：https://poorbug.github.io/reader/

在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，项目内 `.github/workflows/deploy.yml` 将通过 GitHub Actions 自动发布。

## 应用更新

设置 → 应用更新 → 检查更新：请求 `version.json` 的实时版本号，发现新版后更新 Service Worker 并预缓存资源；缓存准备完成才展示「刷新并使用新版」。刷新只更新站点代码，不主动清理 IndexedDB。

**发布新版本时必须同步更新以下三处：** `app.js` 内的 `APP_VERSION`、`version.json` 中的 `version`、`sw.js` 内的 `VERSION` 和 `NAME`（增加缓存版本号）。部署完成后，旧页面才能正确识别并加载新版本。GitHub Pages 自动部署可能需要一段时间。

## 在线书库（火山引擎 TOS）

书架新增「在线书库」标签，可搜索公开书籍、查看格式和大小，并一键导入本地书架。已导入的下载链接会显示「已加入书架」；下载仍复用 SHA-256 去重和 IndexedDB 保存逻辑，不会覆盖用户已有进度或笔记。当前单本文件导入上限 250 MiB（大文件请留意移动设备存储空间及流量）。

- 数据源：`https://reader-ebook.tos-cn-beijing.volces.com/books/`。
- `.github/workflows/deploy.yml` 在每次推送及每天北京时间 08:17 定时运行时，通过 `scripts/sync_tos_catalog.py` 枚举 TOS `books/` 前缀（含分页），生成 `catalog/books.json` 后发布 GitHub Pages。无需用户每次上传时提交 GitHub 代码。GitHub Actions 的定时运行有可能延迟。
- 页面访问时只请求同源的 `catalog/books.json`；Service Worker 对这个 JSON 使用网络优先，不需要发布新 APP_VERSION 才能获取最新书单。点「刷新列表」可重新请求已发布的书单，但不会直接触发 GitHub Actions 同步。 若权限刚开放仍显示同步失败，可在 GitHub Actions 手动运行 `Deploy Reader to GitHub Pages` 重新生成书单（页面刷新不会主动执行 TOS 列举）。
- 如果 TOS 公开访问权限**包括** `tos:ListBucket`，生成脚本可以匿名列举，无需任何密钥。如果仅对具体文件公开读取而禁止列目录，必须在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加 `TOS_ACCESS_KEY` 与 `TOS_SECRET_KEY`，对应的 IAM 用户只需最小化的 `tos:ListBucket` 权限（尽量限定 `reader-ebook/books/` 前缀）。**不要把密钥放进前端或提交到仓库。**
- 目录扫描失败时，脚本会尝试保留上一次成功发布的书单并显示旧数据提示；首次扫描失败则显示具体的权限配置提示，不会把失败伪装成“书库是空的”。
- 单本文件直接从 TOS 跨域下载。即使文件 URL 可以在浏览器打开，用户一键导入仍要求 TOS CORS 允许来源 `https://poorbug.github.io`、方法 `GET`（及必要时 `HEAD`）。`ListBucket` 的服务端同步并不要求浏览器具有跨域列目录权限。
- 在线目录会公开展示书名与下载地址。请确保这些书籍允许公开分发，且 Bucket 的读取/出口流量成本可接受。

## MOBI 引擎的部署方式

自动部署时，Actions 会从 `johnfactotum/foliate-js` 拉取固定提交 `78914aef4466eb960965702401634c2cb348e9b1` 到 `vendor/foliate-js/`，一起发布到 Pages；运行时使用 `./vendor/foliate-js/view.js`，不使用外部 CDN。Service Worker 将主要 MOBI 依赖一起缓存，避免安装版 PWA 在无网络时动态导入失败。仓库中的代码保持精简；不要直接编辑 Actions 生成的 `vendor/` 文件。

## 重要限制

- 这是尚待实际 EPUB 文件与 iPhone Safari 真机验证的 MVP 原型，不能视为正式稳定版。
- 仅支持无 DRM 的 EPUB、PDF 和 MOBI。PDF 是原版页面查看；MOBI 使用 foliate-js 试验性阅读。PDF/MOBI 尚未实现原有 EPUB 的划线笔记及进度恢复。
- MOBI 使用随 GitHub Pages 一同发布的 foliate-js 固定版本（GitHub Actions 自动拉取），所需模块由 Service Worker 预缓存，不再在手机运行时请求 jsDelivr。首次更新需联网完成缓存；仍需 Android/iPhone 真机验证离线场景。EPUB 引擎仍从 jsDelivr 首次加载，缓存后可在离线环境使用。
- iOS 的选词与划线交互、复杂 EPUB 排版仍需测试。
- IndexedDB 不是永久保管库。清除站点数据可能丢失书籍与笔记，请定期导出备份。
- 备份中电子书使用 base64，会使文件体积增大；大规模书库建议改 ZIP。
- 不同设备之间不自动同步。
