# YuanTu-Harness 品牌图标套件

基于 Concept B（源图 + 安全盾）定稿 logo 生成的完整品牌图标套件。设计方向：目标图形为中心的金色罗盘圆环，内置源图网格、网络节点与信任对勾，外围蓝色圆角正方形，角部透明。

## 目录结构

```
yuantu-harness-brand-icons/
├── README.md                      # 本说明
├── make-icons.mjs                 # Node + sharp 生成脚本（可重复执行）
├── assets/
│   ├── yuantu-harness.svg         # 浅色主 logo（SVG 源）
│   └── yuantu-harness-dark.svg    # 暗黑模式主 logo（SVG 源）
├── favicon/
│   ├── favicon.svg                # Web favicon（矢量）
│   ├── favicon.ico                # 16/32/48 多尺寸
│   ├── favicon-16.png
│   ├── favicon-32.png
│   └── favicon-48.png
├── desktop/
│   ├── icon.png                   # 应用主图标 512x512
│   ├── icon.ico                   # Win 多尺寸 16/24/32/48/64/128/256
│   ├── icon.icns                  # macOS（PNG 条目）
│   ├── hicolor/<N>x<N>/apps/yuantu-harness-desktop.png   # Linux 图标主题 16..512
│   └── windows/                   # 微软商店 Square 全套 + StoreLogo
├── mobile/
│   ├── icon-128.png
│   ├── icon-256.png
│   └── icon-512.png
├── installer/
│   ├── installer-128.png
│   ├── installer-256.png
│   ├── installer-512.png
│   └── installer.ico              # 16/32/48/256
└── dark-mode/
    ├── logo-dark.svg
    ├── icon-256-dark.png
    ├── icon-512-dark.png
    └── favicon-dark-32.png
```

## 生成方式

前置：Node.js 与 `sharp`（`pnpm add -D sharp` 或全局安装）。

```bash
node make-icons.mjs
```

脚本会从 `assets/yuantu-harness.svg`（浅色）与 `assets/yuantu-harness-dark.svg`（暗黑）渲染所有 PNG，并组装多尺寸 `.ico` 与 `.icns`。修改主 SVG 后重跑即可全量刷新。

## 色值速查

| 用途 | 色值 |
|------|------|
| 浅色背景径向渐变 | `#3B82F6 → #1E40AF → #0B1E4B` |
| 暗黑背景径向渐变 | `#1E293B → #0B1120 → #020617` |
| 金色圆环/罗盘 | `#FCD34D` / `#F59E0B` |
| 源图网格线 | `#2DD4BF → #0F766E` |
| 知识节点（绿）| `#2DD4BF` |
| 底部节点（橙）| `#F59E0B` |
| 中心/信任对勾 | `#F59E0B→#EF4444` / `#22C55E` |
| 连接白线 | `#FFFFFF` |

## 接入项目（替换现有 BitFun 资源）

- 桌面 Tauri bundle：`src/apps/desktop/icons/` 下的 `icon.icns`、`icon.ico`、`icon.png`（对应 `tauri.conf.json` 的 `bundle.icon`）。
- Linux 图标主题：`hicolor/<N>x<N>/apps/yuantu-harness-desktop.png`（对应 `tauri.conf.json` 的 `linux.deb.files`）。
- 应用 logo：替换 `src/apps/desktop/icons/Logo-ICON.png`。
- Web favicon：`favicon/` 下资源替换各前端 `public/favicon.*`。
- 移动端：`mobile/` 下资源替换 HarmanOS 媒体资源与 Web 应用图标。
- 暗黑模式：`dark-mode/` 下资源用于支持明暗两态图标的平台（如 macOS/Windows 深色图标、系统深色主题）。

## 说明

- 主 SVG 使用 1024×1024 viewBox，可无损缩放到任意尺寸。
- 图标背景为圆角正方形、角部透明，可直接作为 favicon 或应用图标使用。
- `.ico`/`.icns` 均以嵌入 PNG 的方式构建，现代 Windows/macOS 均可正常读取。
