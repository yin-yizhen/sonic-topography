# 🎵 Lanhu Plus

> **在线体验：[blog.lanhu199.top/music/](https://blog.lanhu199.top/music/)**
>
> 基于 [sonic-topography](https://github.com/yin-yizhen/sonic-topography) · 作者 [yin-yizhen](https://github.com/yin-yizhen)

---

## 📌 概述

基于 sonic-topography 原版的增强版本，在保留原版全部功能的基础上，增加了以下改进。

---

## ⭐ 新增功能与改进

### 1. 子路径部署支持
新增 `VITE_BASE_PATH` 环境变量，可部署到任意子路径（如 `/music/`），无需独立域名。

```bash
VITE_BASE_PATH=/music/ npm run build
```

### 2. 在线可访问
原版仅限本地 `localhost` 运行。本增强版已部署至公网，**无需安装、打开即用**。

### 3. 中文文档完善
新增完整中文 README，降低中文用户的使用门槛。

### 4. 构建配置优化
- 支持通过环境变量配置部署路径
- 更新 index.html 添加中文 SEO 元信息

### 5. 跨平台部署指南
提供完整的 Nginx 部署示例，方便自托管。

---

## ⚙️ 原版已有功能（本版本全部保留）

- 3D 音频响应式地形可视化
- 内置 Demo 音频 + 同步 LRC 歌词
- 上传音频和 `.lrc` 歌词
- 网易云音乐搜索与播放
- 歌单管理（本地持久化）
- 顺序播放 / 随机播放 / 上一首 / 下一首
- 本地开发服务器 + 网易云代理

---

## 🚀 快速开始

```bash
git clone <本仓库>
cd <目录>
npm install
npm run dev        # 开发模式，访问 http://localhost:3000
npm run build      # 构建生产版本
npm start          # 生产运行（含网易云代理）
```

---

## 📁 项目结构

```
src/
├── App.tsx                    # 主应用
├── components/
│   ├── AudioVisualizer/
│   │   ├── MapScene.tsx       # 3D 地形场景
│   │   └── CustomShaderMaterial.ts
│   └── UI/
│       ├── UI.tsx             # 用户界面
│       └── LyricsDisplay.tsx  # 歌词显示
├── lib/
│   ├── AudioEngine.ts         # Web Audio API
│   ├── lyrics.ts              # LRC 解析
│   ├── themes.ts              # 主题系统
│   └── metadata.ts            # 元数据
└── main.tsx                   # 入口
```

---

## 🌐 部署到子路径

```nginx
location /music/ {
    alias /path/to/dist/;
    try_files $uri $uri/ /music/index.html;
}
```

---

## 📜 许可证

MIT
