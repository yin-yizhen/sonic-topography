# Sonic Topography

Sonic Topography 是一个本地音乐可视化程序，使用 React、Three.js、Vite 和 Web Audio 构建。它可以播放本地 Demo、上传音频和 `.lrc` 歌词、通过本地代理搜索网易云音乐、保存浏览器本地歌单，并用音频频谱驱动地形、波纹和流星效果。

## 功能

- 3D 音频响应式地形可视化
- 内置 Demo 音频和同步 LRC 歌词
- 支持上传音频和 `.lrc` 歌词
- 网易云音乐搜索，并过滤不可播放结果
- 通过本地代理加载歌词和音频
- 歌单保存到本地 `data/playlists.json`，浏览器 `localStorage` 作为兜底
- 支持删除歌单歌曲、删除歌单，并带确认弹窗
- 支持上一首、下一首
- 支持顺序播放和随机播放
- Windows 一键启动脚本

## Windows 一键启动

前提：电脑需要先安装 Node.js。

下载或克隆本仓库后，双击：

```text
start-sonic-topography.bat
```

启动脚本会自动：

1. 如果没有 `node_modules/`，自动安装依赖；
2. 如果没有 `dist/`，自动构建项目；
3. 打开 `http://127.0.0.1:4173`；
4. 启动带网易云代理功能的本地生产服务器。

## 开发运行

```powershell
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

## 本地生产运行

```powershell
npm run build
npm start
```

打开：

```text
http://127.0.0.1:4173
```

## Demo 文件

内置 Demo 文件在：

```text
public/demo.mp3
public/demo.lrc
```

如果要替换 Demo，请保持这两个文件名不变。

## 给别人使用

对方可以下载 GitHub 仓库 ZIP，解压后双击：

```text
start-sonic-topography.bat
```

注意：这不是完全独立的 `.exe`，对方电脑仍然需要安装 Node.js。

## 注意事项

- 网易云音乐功能使用的是非官方网页接口，并通过本地服务器代理请求。搜索结果会尽量只显示当前可播放的歌曲，但可播放状态仍可能因为版权、会员、地区或登录限制发生变化。
- 歌单优先保存在本地文件 `data/playlists.json`。只要保留项目文件夹，重启应用后歌单还在；浏览器 `localStorage` 只作为兜底。
- `start-sonic-topography.bat` 会在本地启动服务，默认地址是 `http://127.0.0.1:4173`。

## 常用命令

```powershell
npm run lint
npm run build
npm start
```
