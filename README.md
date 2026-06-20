# Sonic Topography

Sonic Topography 是一个本地音乐可视化程序，使用 React、Three.js、Vite、Web Audio 和 Tauri 2.0 构建。它可以播放本地 Demo、上传音频和 `.lrc` 歌词、通过 Rust 后端搜索网易云音乐、保存本地歌单，并用音频频谱驱动地形、波纹和流星效果。

## 功能

- 3D 音频响应式地形可视化
- 内置 Demo 音频和同步 LRC 歌词
- 支持上传音频和 `.lrc` 歌词
- 网易云音乐搜索，并过滤不可播放结果
- 歌单保存到本地 `data/playlists.json`，浏览器 `localStorage` 作为兜底
- 支持删除歌单歌曲、删除歌单，并带确认弹窗
- 支持上一首、下一首
- 支持顺序播放和随机播放
- Windows 系统音频捕获（WASAPI loopback，Tauri 桌面版）

## Windows 桌面应用

除了网页版，项目现在包含基于 **Tauri 2.0** 的 Windows 桌面应用。Tauri 用 Rust 实现本地后端，前端仍使用 React + Vite，安装包仅约 **10MB**。

### 环境要求

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)（Tauri 2.0 需要）

### 开发运行

```powershell
npm install
npm run tauri:dev
```

这会启动 Vite 开发服务器（端口 `1420`）并打开 Tauri 窗口。前端代码修改会热更新，Rust 代码修改会重新编译。

### 构建生产版应用

```powershell
npm run tauri:build
```

构建流程：

1. `npm run build`：构建前端生产包（输出到 `dist/`）。
2. `tauri build`：编译 Rust 后端并打包 Windows 安装程序。

构建产物位于 `src-tauri/target/release/bundle/`：

- NSIS 安装包：`Sonic Topography_0.2.0_x64-setup.exe`
- MSI 安装包：`Sonic Topography_0.2.0_x64_en-US.msi`

### Windows 系统音频捕获

在 Tauri 桌面版中，点击左侧栏的 **Capture** 或 External Audio 面板中的 **Capture System Audio**，即可通过 Rust 后端捕获 Windows 默认音频输出（WASAPI loopback），并以本地 HTTP WAV 流的形式送入可视化引擎。无需额外安装虚拟声卡，即可与酷狗、系统播放器、浏览器等任意音频源联动。

网页版仍可使用浏览器自身的桌面媒体选择器或 Stereo Mix 设备进行捕获。

## 网页版开发运行

```powershell
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:1420
```

## 网页版生产预览

```powershell
npm run build
npm run preview
```

## Demo 文件

内置 Demo 文件在：

```text
public/demo.mp3
public/demo.lrc
```

如果要替换 Demo，请保持这两个文件名不变。

## 音源配置与切换

网易云音乐搜索现在支持多音源自动兜底。音源在 Rust 后端（`src-tauri/src/lib.rs`）的 `NETEASE_SOURCES` 数组中配置，默认包含 `official`（music.163.com）以及几个公开镜像。如果某个源不可用，可将其 `enabled` 设为 `false` 临时禁用。

搜索时会并发请求所有启用的音源，将结果合并、按歌曲 ID 去重后展示。每首结果会显示其可用的音源标签，最大化可搜索到的歌曲量。搜索面板中可以选择 `Auto`（自动选择可用源）或指定某个源；结果列表会显示 `via {source}`，表明当前播放使用的音源。

## 外部音频与本地播放器联动

桌面版和网页版左侧栏的 **External** 面板提供两种方式：

1. **系统音频捕获**：点击 **Capture System Audio** 捕获 Windows 正在播放的音频（桌面版使用 Rust WASAPI loopback，网页版使用浏览器桌面媒体选择器或 Stereo Mix）。
2. **手动输入音频 URL**：粘贴外部音频流地址（如 `.mp3`、`.m4a`、直播流等）后点击 Load，即可通过 `AudioEngine` 播放并驱动 3D 可视化。

## 性能与打包优化

本项目针对渲染性能和 Tauri 打包体积做了以下优化：

- **音频分析缓存**：`AudioEngine` 对 `analyser.getByteFrequencyData` 的结果按帧缓存，避免同一动画帧内多次调用分析接口。
- **渲染循环暂停**：Three.js 场景在音频暂停、页面隐藏且没有活跃视觉特效（波纹、流星、粒子）时跳过更新，显著降低 GPU/CPU 占用。
- **Uniform 精简**：主题颜色仅在目标值变化时继续插值，浮点型 uniform 只在差值超过阈值时更新，波纹数组仅在新增波纹时重新赋值。
- **减少运行时对象分配**：复用 `THREE.Vector2`、`THREE.Color` 等对象，避免每帧创建新的材质颜色。
- **Tauri 包瘦身**：`Cargo.toml` 启用 `opt-level = "z"`、`lto = true`、`strip = true`、`panic = "abort"`、`codegen-units = 1`；`tauri.conf.json` 仅开启必要的权限与插件，最终安装包约 10MB。

## 注意事项

- 网易云音乐功能使用的是非官方网页接口，并通过 Rust 后端代理请求。搜索结果会尽量只显示当前可播放的歌曲，但可播放状态仍可能因为版权、会员、地区或登录限制发生变化。
- 歌单优先保存在本地文件 `data/playlists.json`。只要保留项目文件夹，重启应用后歌单还在；浏览器 `localStorage` 只作为兜底。
- 网页版需要浏览器支持 Web Audio 和 getUserMedia/getDisplayMedia 才能使用系统音频捕获。

## 常用命令

```powershell
npm run lint            # TypeScript 类型检查（tsc --noEmit）
npm run dev             # 启动 Vite 网页开发服务器
npm run build           # 构建前端生产包
npm run preview         # 预览前端生产包
npm run tauri:dev       # 启动 Tauri 桌面应用开发模式
npm run tauri:build     # 构建 Windows 桌面安装包
```
