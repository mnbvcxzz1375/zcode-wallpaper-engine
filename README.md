# zcode-wallpaper-engine

[English](README.en.md) | 中文

把电脑上的 **Wallpaper Engine** 壁纸变成 **ZCode 工作台**（[zai-org/ZCode](https://github.com/zai-org/ZCode)）的背景。

自动发现本机的 Wallpaper Engine 安装，列出壁纸，把*可移植*的类型渲染到工作台界面后方，配以 **iOS 风格液态玻璃**效果：Video（`.mp4`）动态播放、Web/HTML 以 iframe 加载、**Scene（场景）由内置纯 JS 渲染器输出完整场景帧**。从 [dsh-plugin-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) 移植。

> **为什么是移植而不是插件**：ZCode 没有开箱即用的插件总线（没有 DSH 的 Cordis host / `ctx.webServer.register` / `slots.inject`），所以集成方式不同——在编译期把路由挂载到 ZCode 的 Hono server、把客户端注入 `index.html`（见 [zcode.patch.yml](zcode.patch.yml) 与 `scripts/install-to-zcode.mjs`）。功能集合与上游一致。

## 功能矩阵：dsh → zcode

| 上游功能 | 移植状态 | 实现方式 |
|---|---|---|
| Steam 库自动发现（`libraryfolders.vdf`，非默认盘可用） | ✅ | `lib/vdf.js` — 读 Steam 注册表 + libraryfolders.vdf；`ZCODE_WE_STEAM_ROOT` 可覆盖 |
| 壁纸枚举（`projects/defaultprojects`、`myprojects`、`steamapps/workshop/content/431960/*`） | ✅ | 同上游拓扑，全异步扫描 |
| Video 壁纸（`.mp4` Range 流式播放） | ✅ | `/media/<token>` + `Range` 支持 |
| Web / HTML 壁纸（iframe 加载） | ✅ | `/media/<token>` 直出 HTML |
| Scene 壁纸完整场景帧 | ✅ | `lib/scene-render-worker.mjs`（worker 线程）+ `lib/we-renderer/`（对象树 / 纹理 / 粒子 / shader 效果 / puppet 骨骼） |
| Scene 静态帧缓存（`<版本>_<路径>_<mtime>`） | ✅ | `~/.zcode-wallpaper-engine/cache/frames/`，mtime 变即失效 |
| Scene 动画（APNG / MP4 / WebM） | ✅ | `/scene-anim`，单实例复用 + 逐帧 IDAT 即时压缩 + 进度条轮询 |
| 壁纸选择弹窗（缩略图网格） | ✅ | `src/client/components/Picker.tsx` |
| 隐藏 / 恢复壁纸（软删除，不碰源文件） | ✅ | `hiddenIds`，持久化到 config.json |
| 视频倍速 0.5x–2x | ✅ | 原生 `playbackRate`，即时生效 |
| 水平翻转（视频 / 网页 / 上传图片） | ✅ | CSS `scaleX(-1)` 滤镜 |
| 自定义上传壁纸（JPG / PNG / MP4，原始字节流） | ✅ | `POST /upload?title=X`（**注意：raw body，不是 multipart**） |
| 上传 MP4 自动抽帧缩略图 | ✅ | `/video-preview/<token>`，ffmpeg 懒加载 + 磁盘缓存 |
| 上传目录可改 + 自动迁移 | ✅ | `POST /upload-dir`，持久化 |
| 媒体元数据（分辨率 / 编码 / 帧率 / 时长，moov 探测） | ✅ | `/media-info/<token>` |
| 解码帧率上限（抽帧转码，4K 保留 + AV1） | ✅ | `/transcoded/<token>?fps=N` + `/transcode-progress`；ffmpeg 三档供给（显式 → 自动下载 → PATH） |
| 壁纸效果（暗化 / 模糊 / 亮度 / 对比度 / 饱和度 / 壁纸透明度） | ✅ | CSS 滤镜链，全部即时生效、持久保存 |
| 遮挡暂停三档（最小化 / 失焦 / 电池） | ✅ | `src/client/effects.ts`，解码直接归零 |
| 轮播（顺序 / 随机，读 WE 工坊播放列表） | ✅ | `src/client/rotation.ts`，读 `playlist.json` |
| 液态玻璃设置页（配色 + 透明度） | ⚠️ 部分 | 玻璃 / 暗化 / 滤镜 / 配色完整；**ZCode 没有原生设置窗口**，上游的「整个设置窗口液态玻璃化」无对应宿主，`betterSidebar` 恒为 `false`（见 `lib/host.js: isBetterSidebarLoaded`） |
| 字体自定义 / 输入光标颜色 | ❌ 未移植 | ZCode 的界面 chrome 与 DSH 不同；这两项染的是宿主原生控件，移植过去会变成「改一个谁也不看的样式」 |
| Edge 兼容渲染（canvas 规避下载悬浮条） | ❌ 未移植 | ZCode 内嵌 Chromium，不存在 Edge 的悬浮工具栏问题 |
| 设置持久化到宿主端文件 | ✅ | `~/.zcode-wallpaper-engine/config.json`（200ms 防抖；损坏时回退默认值且不覆盖） |
| 媒体流句柄及时释放 | ✅ | 客户端断开即销毁流，Windows 下壁纸文件不再被锁 |
| WSL 支持（`/mnt/<盘符>` 探测） | ✅ | 同上游探测逻辑 |

## 路由表（19 个注册点，20 条路由）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/wallpaper-engine/inventory` | 壁纸 JSON 列表（含播放列表、可移植计数） |
| GET | `/wallpaper-engine/settings` | 读取设置 |
| PUT | `/wallpaper-engine/settings` | 保存设置（**body 是 settings 对象本身，不是 `{settings:{}}`；整体替换不合并**） |
| GET | `/wallpaper-engine/media/<token>` | 视频 / HTML，Range 支持 |
| GET | `/wallpaper-engine/preview/<token>` | 预览图 |
| GET | `/wallpaper-engine/video-preview/<token>` | 自上传 MP4 按需抽帧 |
| GET | `/wallpaper-engine/media-info/<token>` | moov 探测的媒体元数据 |
| GET | `/wallpaper-engine/transcoded/<token>?fps=N` | 抽帧转码流 |
| GET | `/wallpaper-engine/transcode-progress/<token>?fps=N` | 下载 / 转码进度 |
| GET | `/wallpaper-engine/scene-frame/<token>` | 场景静态帧（4K，PNG 缓存） |
| GET | `/wallpaper-engine/scene-anim/<token>?fps&fmt&sec` | 场景动画（apng / mp4 / webm） |
| GET | `/wallpaper-engine/scene-anim-progress/<token>` | 渲染进度轮询 |
| GET | `/wallpaper-engine/scene-runtime/<token>` | 场景 iframe 运行时 |
| GET | `/wallpaper-engine/scene-manifest/<token>` | 场景包内容清单 |
| GET | `/wallpaper-engine/scene-resource/<token>` | 场景包内资源 |
| GET | `/wallpaper-engine/scene-video/<token>` | 场景内嵌 MP4 音视频轨 |
| GET | `/wallpaper-engine/scene-audio/<token>` | 场景独立音频 |
| GET | `/wallpaper-engine/custom-frame/<token>` | 截屏导入的自定义画面 |
| POST | `/wallpaper-engine/upload?title=X` | 上传（raw body + content-type） |
| POST | `/wallpaper-engine/remove` | 移除上传（body `{"id"}`，**按 id 不是 token**） |
| POST | `/wallpaper-engine/upload-dir` | 更改上传目录 |

所有媒体路径走 base64url token map —— **任意文件系统字符串绝不进 URL**。

## 安装

### 前置条件

- 本机装有 Wallpaper Engine（Steam），或用 `ZCODE_WE_STEAM_ROOT` 指向 Steam 根目录
- 一份 ZCode 源码（`git clone github.com/zai-org/ZCode`）
- Node ≥ 18，pnpm

### 步骤

```sh
# 在本仓库
pnpm install
pnpm build        # 生成 lib/client.js（React + 内联 CSS，单文件）

# 接入 ZCode 检出
pnpm start -- install --zcode-root <你的 ZCode 路径>
# 或在 ZCode 仓库目录里直接运行
npx zcode-wallpaper-engine install
```

安装会做四件事（详见 [zcode.patch.yml](zcode.patch.yml)）：

1. 把本包 junction 进 ZCode 的 `packages/wallpaper-engine`（pnpm workspace 内）
2. `packages/server/package.json` 加一行 `workspace:*` 依赖
3. `packages/server/src/http.ts` 挂载 `registerWallpaperEngineRoutes(app, { authToken })` —— 落在 `authToken` 之后、静态 SPA 兜底之前
4. `packages/web/index.html` 插入 `<script defer src="/wallpaper-engine-client.js">`，bundle 拷进 `packages/web/public/`

然后在 ZCode 仓库 `pnpm dev`，打开工作台即见 **设置 → Wallpaper Engine**。

**卸载**：`zcode-wallpaper-engine uninstall` —— 哨兵区块逐字移除，检出恢复原样（往返与幂等已被测试覆盖）。

### ZCode 没有插件总线，所以这些设计不同

| DSH | ZCode |
|---|---|
| `ctx.webServer.register({kind, path, handler})` | Hono `app.all(pattern, ...)`，见 `lib/host.js: registerRoute` |
| Node handler 直接写 `res` | `c.env.incoming/outgoing`（@hono/node-server 暴露的原始 `IncomingMessage`/`ServerResponse`），handler **几乎逐字不变**；返回 `x-hono-already-sent` 告诉适配器响应已上路，否则它再写一遍空响应触发 `ERR_HTTP_HEADERS_SENT` |
| `slots.inject` 注入客户端 | 编译期插入 `index.html` 的 `<script>` |
| `~/.dsh-wallpaper-engine/` | `~/.zcode-wallpaper-engine/` |
| `DSH_WE_*` 环境变量 | `ZCODE_WE_STEAM_ROOT` / `ZCODE_WE_UPLOAD_DIR` / `ZCODE_WE_PORT` |
| `dsh-*` postMessage 协议 | `zcode-*` |

## 自动 review（`pnpm verify`）

这是本项目的自检脚本（`scripts/auto-review.mjs`），也是「自动 review」需求的落点：一个这种规模的移植（20 条路由、场景渲染器、React 客户端）会**静默漂移**——复制时漏一条路由、客户端某个模块不构建了、上游一重构安装器就找不到哨兵、shim 把 404 报成 200。每一条用户撞上之前都看不见。脚本断言这些不变量，失败即非零退出：

1. **shipped files** — `package.json` 的 `files` 逐项存在
2. **route table** — 恰好 19 个 `registerRoute` 注册点（media/preview 共用一个 for 循环体，所以锚点接受任意缩进）；每条声明 kind + path；媒体路由必须经 `mediaMap.get`
3. **client bundle** — 自包含：CSS 以字符串内联（`?inline` 导入 + 运行期 `<style>` 注入，因为注入点是单个 `<script>` 标签，ZCode 的 Vite 构建没有位置放配套资源）、无外部引用、`?we-disable=1` 逃生口在
4. **dsh residue** — 无 `DSH_WE_*` 环境变量、无 `.dsh-wallpaper-engine` 目录、无 `dsh-*` postMessage 类型
5. **installer sentinels** — 三个区块定义的 begin/end 哨兵各自配对；换行风格保留（否则 patch 变成整文件 diff）；挂载点在静态兜底之前
6. **bridge contracts** — `x-hono-already-sent` 只在 node-server 分支出现（在 shim 分支会掩盖所有状态码）；`res.statusCode` 是活属性（handler 直接赋值 `= 404`，普通字段会让所有错误报 200）；shim 在响应流的 end/error 上 resolve 而非 handler 返回时（异步 handler 在返回之后才写响应）；`Readable.fromWeb` 的 destroy（正常输入结束）与 handler abort（499）区分有注释
7. **live routes** — 起一个隔离的临时上传目录，真实跑一遍：4 条静态路由 + PUT/GET 往返 + 畸形输入 4xx + upload→remove 往返

另有 `pnpm verify:mount`（`scripts/verify-mjs`）—— esbuild 打包**真实**的 `packages/server/src/http.ts`，起 `createHttpServer`，验证三条路由真的 200 且无重复写响应。

```sh
pnpm verify         # 自动 review
pnpm verify:mount   # 真实 ZCode server 挂载验证
pnpm test           # vitest: 17 个测试（config / vdf / routes）
```

## 数据与隐私

壁纸**只从本机读取**：Steam 库、WE workshop 目录、`~/.zcode-wallpaper-engine/uploads`。不上传、不分发、不做任何网络外发（唯一的网络请求是 ffmpeg 按需下载，且只在用户开启抽帧转码时发生）。设置与上传库存在 `~/.zcode-wallpaper-engine/`。

## 许可

MIT。场景渲染器的逆向成果参考 [linux-wallpaperengine](https://github.com/Alia5/linux-wallpaperengine) / [repkg](https://github.com/notscuffed/repkg)。
