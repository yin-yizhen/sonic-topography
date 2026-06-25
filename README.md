# Sonic Topography

中文 | [English](./README.en.md)

Sonic Topography 是一个本地音乐可视化项目。它会把音乐频段转换成一片会起伏、发光、产生波纹和流星的 3D 地形。你可以播放本地音乐、内置 Demo、系统采集音频，也可以通过 QQ 音乐网页接口搜索并播放可用歌曲。

> 使用限制：本项目仅供学习、研究和个人非商业体验使用。未经作者明确许可，不得用于商业项目、商业演出、商业展示、付费服务、二次销售或任何营利用途。

![Sonic Topography main visualizer](./public/screenshots/main-visualizer.png)

## 主要功能

- 3D 音频响应地形：低频、中频、高频会分别影响地面起伏、波纹、发光和细节闪烁。
- 本地音乐播放：支持上传音频文件，也支持搭配 `.lrc` 歌词。
- 内置 Demo：第一次打开即可用示例音乐查看效果。
- QQ 音乐搜索：通过本地代理调用 QQ 音乐网页接口，过滤出当前可播放歌曲。
- QQ 音乐歌词和播放代理：搜索结果会通过 `/api/qqmusic/lyric`、`/api/qqmusic/url`、`/api/qqmusic/audio` 加载歌词和音频。
- 本地歌单：可以把喜欢的搜索结果加入本地歌单，重启后仍保留。
- 可视化设置：脉冲特效、流星特效、地面 EQ、自定义主题、主题自动轮换。
- 预设迁移：可以导入/导出主题、EQ、触发器、歌单等设置；QQ 音乐 Cookie 默认不导出。
- Windows 单 EXE：可打包成一个可执行文件，运行者不需要安装 Node.js 或 Go。

## 页面区域说明

### 1. 左上角 AJIN.

点击左上角 `AJIN.` 可以打开侧边栏。第一次进入页面时会有灰色提示：

```text
点击左上角 AJIN. 打开侧边栏
或将鼠标滑到左侧打开侧边栏
```

只要打开过一次侧边栏，这个提示就不会再显示。提示状态保存在当前浏览器里。

### 2. 左侧侧边栏

侧边栏是主要入口：

- `可视化`：关闭面板，回到纯视觉画面。
- `设置`：打开设置面板。
- `搜索`：打开 QQ 音乐搜索面板。
- `歌单`：打开本地保存的歌单。
- `示例`：播放内置 Demo。
- `上传`：选择本地音频或 `.lrc` 歌词。
- `采集`：采集系统音频，用当前电脑正在播放的声音驱动可视化。
- `全屏`：进入或退出浏览器全屏。

### 3. 右上角播放卡片

播放卡片显示当前歌曲、主题名、进度条、播放暂停、上一首、下一首、循环/随机、音量和总时长。你可以在自定义主题里选择是否显示这个播放卡片。

### 4. 左侧歌词

如果歌曲有 LRC 歌词，歌词会显示在左侧。当前播放句会更亮，其他歌词会淡出。采集系统音频时歌词会隐藏，因为这时没有具体歌曲歌词。

### 5. 底部频段数据

底部会显示 `Bass / Mid / Treble / Energy` 等频段值，方便观察当前音乐正在驱动画面的哪些部分。

## 设置面板教程

点击 `AJIN.` 打开侧边栏，再点 `设置`。

### 预设迁移

设置页最上方是导入/导出：

- `导出预设`：下载一个 JSON 文件，包含主题、EQ、触发器、本地歌单等设置。
- `导入预设`：选择之前导出的 JSON 文件，恢复到当前浏览器。
- `包含 Cookie`：默认关闭。只有你手动勾选后，导出文件才会包含 QQ 音乐 Cookie。

提醒：Cookie 等同于登录凭证，不建议随便发给别人。

### 脉冲特效

控制点击或音乐触发时产生的脉冲波纹。可以调节触发频段、阈值、强度、冷却等参数。

### 流星特效

控制画面上飞过的流星效果。可以调节触发频段、强度、数量、间隔和冷却。

### 地面 EQ

这是视觉 EQ，不会改变音乐声音，只改变地面响应。曲线从左到右代表低频到高频：

- 左侧低频：影响中心区域大块起伏和鼓点冲击。
- 中间频段：影响大范围波浪和地形流动。
- 右侧高频：影响外围尖峰、闪光、边缘微闪和细碎颗粒。

播放音乐时，曲线背景会显示实时频段能量，方便你判断应该调哪一段。

### 自定义主题

可以保存多个自定义主题。每个主题包括背景色、冷色、暖色、强调色、发光强度、旋转速度和是否显示播放器卡片。

### QQ 音乐 Cookie

这里用于手动保存 QQ 音乐 Cookie。Cookie 会保存在当前浏览器，并同步到本地代理内存。它不会写入项目配置文件，也不会默认导出到预设文件。

QQ 音乐的网页播放接口不稳定，部分歌曲可能需要登录 Cookie、会员、版权或地区权限。即使保存 Cookie，也不能绕过平台限制。

## QQ 音乐 Cookie 使用教程

这个项目不读取你的 QQ 音乐账号密码，也不会自动读取官方网页 Cookie。你需要自己从浏览器复制 Cookie。

电脑端建议步骤：

1. 打开设置页，进入 `QQ 音乐 Cookie`。
2. 点击 `打开官网`，进入 `y.qq.com`。
3. 在官网正常登录你的 QQ 音乐账号。
4. 按 `F12` 打开开发者工具。如果没反应，可以试 `Fn + F12` 或 `Ctrl + Shift + I`。
5. 点开发者工具上方的 `Network` 或 `网络`。
6. 刷新 QQ 音乐页面，或者播放/搜索一首歌。
7. 在请求列表里搜索 `fcg` 或 `musicu`；如果搜不到，可以搜索 `y.qq.com`。
8. 点任意一个请求。
9. 在右侧点 `Headers` 或 `标头`。
10. 找到 `Request Headers` 里的 `Cookie`。
11. 复制 `Cookie:` 后面的完整内容。
12. 回到 Sonic Topography，把 Cookie 粘贴进去，点击保存。

## 从源码运行

需要先安装 Node.js。

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

## Windows 一键启动脚本

下载或 clone 仓库后，可以双击：

```text
start-sonic-topography.bat
```

这个脚本会检查依赖、构建 `dist/`，然后启动本地服务并打开 `http://127.0.0.1:4173`。这种方式需要电脑安装 Node.js。

## Windows 单 EXE 打包

开发者打包需要安装 Node.js 和 Go。普通用户运行生成后的 EXE 不需要安装 Node.js 或 Go。

```powershell
npm install
npm run build:go-exe
```

生成：

```text
SonicTopography.exe
```

双击 EXE 后会启动本地服务，并自动打开默认浏览器。

EXE 固定使用 `http://127.0.0.1:4173`。如果这个端口已经有 Sonic Topography 在运行，会直接打开已有页面；如果被其他程序占用，需要先关闭占用端口的程序。

## Wallpaper Engine

```powershell
npm run build:wallpaper
```

生成的 `dist-wallpaper/` 是 Wallpaper Engine Web 壁纸目录。

## 本地数据保存在哪里

- 主题、触发器、地面 EQ、QQ 音乐 Cookie 等设置保存在浏览器 `localStorage`。
- 源码运行时，本地歌单由 `/api/playlists` 保存到项目的 `data/playlists.json`，同时浏览器保留一份 fallback。
- Go EXE 运行时，本地歌单默认保存在用户配置目录，例如 Windows 的 `%APPDATA%/SonicTopography/playlists.json`。
- 上传的真实音频文件不会被保存进预设文件，也不会被打包。

## 常用命令

```powershell
npm run lint
npm run build
npm start
go test ./...
npm run build:go-exe
```

## 作者支持

如果sonic-topography陪你欣赏了一首音乐，也欢迎请作者喝一杯咖啡。
![Sonic Topography main visualizer](./public/screenshots/zhichi.png)
您的付出将变为token，帮助项目更快更好的更新。

## 注意事项

- 本项目仅供学习、研究和个人非商业体验使用，不授权任何商业用途。
- QQ 音乐接口是网页接口，播放结果可能受版权、会员、地区、账号状态影响。
- 搜索列表只显示当前接口能拿到播放地址的歌曲。
- Cookie 是敏感登录信息，不要把自己的 Cookie 发给别人。
- 不要提交 `dist/`、`dist-mac/`、`dist-wallpaper/`、`SonicTopography.exe` 或本地 `data/`。
