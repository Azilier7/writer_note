# writer

一个离线桌面写作工具（Tauri 2 + TypeScript），支持透明背景、纯净书写模式、窗口隐藏/恢复、快捷键录制，以及文本文件导入与保存。

## 功能

- 透明背景、文字颜色/透明度、字号、行高、字体可调
- 纯净书写模式（隐藏标题栏和设置面板）
- 自定义快捷键录制（纯净 / 隐藏）
- 隐藏窗口后可用同一快捷键恢复（全局快捷键）
- 本地自动保存（`localStorage`）
- 导入文本文件、保存到文件、另存为

## 环境要求

- Node.js 18+
- Rust（建议 stable 最新版）
- Windows 10/11（当前主要测试平台）

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

### 1) 安装包（推荐发给普通用户）

```bash
npm run tauri build
```

默认产物位置（NSIS）：

- `src-tauri/target/release/bundle/nsis/*.exe`

### 2) 便携版可执行文件（免安装）

```bash
npm run build
cd src-tauri
cargo build --release
```

产物位置：

- `src-tauri/target/release/transparent-notepad.exe`

## 快捷键

- 纯净书写：默认 `F2`
- 隐藏 / 恢复窗口：默认 `Ctrl+Shift+H`
- 导入文件：`Ctrl+O`
- 保存：`Ctrl+S`
- 另存为：`Ctrl+Shift+S`

> 所有快捷键以应用内设置和当前平台行为为准。

## 数据存储

- 编辑内容：浏览器本地存储
- 设置项：浏览器本地存储
- 最近保存路径：浏览器本地存储

## 注意事项

- 首次使用导入/保存功能时会请求文件访问授权（Tauri 插件能力控制）
- 部分笔记本键位（如 Fn 组合）可能影响录制键值，已对常见导航键做兼容处理

## 许可证

如无特别声明，默认仅供学习与个人使用；如需开源发布，请补充你希望使用的许可证（例如 MIT）。
