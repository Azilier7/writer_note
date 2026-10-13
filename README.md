# writer
一个离线桌面记事本（Tauri 2 + TypeScript），支持透明背景、纯净书写模式、窗口隐藏/恢复、快捷键录制，以及文本文件导入与保存。
可直接下载使用版本exe放在release里面了，然后运行时存的一些本地小数据在C:\Users*****\AppData\Local\com.writer.transparent-notepad上，也不多。为什么叫writer就是致敬我觉得很好用的软件reader。如果有什么问题可以邮箱2048439523@qq.com。

## 版本更新

v0.02-左下角新增了字数显示，并且把非纯净模式的边框厚度调薄，同时增加鼠标中键点击快速隐藏功能，再优化了一下打包逻辑，把打包后的exe变成了4m大小（4m框架，0.2m的记事本，现代代码果然臃肿，但也优化不下去了，4m也不大吧...）

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
- 隐藏 / 恢复窗口：默认 `Ctrl+Shift+H`，鼠标中键默认为隐藏。
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
