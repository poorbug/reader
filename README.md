# 纸间 · 私人电子书阅读器

纯前端 EPUB PWA，专供个人阅读。无账户、无后端，书籍原文件、阅读进度、划线、笔记和书签默认保存在当前设备的 IndexedDB。

## 已实现（MVP 原型）

- 本机选择 EPUB 文件，SHA-256 去重、提取书名、作者与封面（若可获取）
- 书架：在读 / 已读 / 归档 / 删除
- epub.js 翻页阅读、目录、书签、字号和背景主题
- 进度自动保存、恢复、基于 EPUB CFI 的划线与笔记、笔记跳原文
- 完整 JSON 备份与恢复（包含 EPUB 文件的 base64）
- Service Worker 离线缓存与 PWA 主屏幕安装

## GitHub Pages

项目地址：https://github.com/poorbug/reader

Pages 地址（启用 Pages 后）：https://poorbug.github.io/reader/

在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，项目内 `.github/workflows/deploy.yml` 将通过 GitHub Actions 自动发布。

## 重要限制

- 这是尚待实际 EPUB 文件与 iPhone Safari 真机验证的 MVP 原型，不能视为正式稳定版。
- 仅支持不含 DRM 的 EPUB；尚未支持 TXT/PDF。
- 初次加载 EPUB 引擎依赖 jsDelivr CDN。缓存成功后才可离线使用；需验证断网场景。
- iOS 的选词与划线交互、复杂 EPUB 排版仍需测试。
- IndexedDB 不是永久保管库。清除站点数据可能丢失书籍与笔记，请定期导出备份。
- 备份中电子书使用 base64，会使文件体积增大；大规模书库建议改 ZIP。
- 不同设备之间不自动同步。
