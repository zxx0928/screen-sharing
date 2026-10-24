# screen-sharing

屏幕共享。一对一远程桌面骨架，形态接近 ToDesk / 向日葵：被控端展示设备码和可选临时密码，控制端输入设备码发起连接。不是多人会议。

Phase-1 skeleton for a 1:1 remote desktop, in the shape of ToDesk / Sunflower. The controlled host shows a device code and an optional temporary password; the controller types that code to connect. This is not a multi-party meeting.

同一个 Electron 客户端既能当被控端，也能当控制端。Phase 1 先把仓库、信令和会话骨架跑起来，Windows 的 DXGI 采集和键鼠注入留给后续原生成模块。

The same Electron client plays both roles. Phase 1 is a runnable skeleton: signaling, UI, and a WebRTC session with clear extension points. Windows DXGI capture and OS input injection come later as native modules.

## 技术栈 / Stack

- Electron（Windows 优先，macOS 以后）
- WebRTC 屏幕轨 + DataChannel 传键鼠
- 自建轻量 WebSocket 信令，用设备码做房间
- npm workspaces，TypeScript

No secrets belong in this repo. Signaling binds to `127.0.0.1` unless you change it.

## 目录 / Folder map

```
apps/desktop          Electron 客户端（主进程 + preload + 渲染进程）
services/signaling    设备码房间的 WebSocket 信令
packages/protocol     两边共用的信令消息和键鼠事件类型
```

| 路径 | 作用 |
| --- | --- |
| `packages/protocol` | 设备码、临时密码、SDP/ICE、键鼠事件的共享约定 |
| `services/signaling` | 内存房间：创建 / 加入 / 转发 SDP 与 ICE / 离开 |
| `apps/desktop/src/main` | 窗口，以及以后的 DXGI、SendInput |
| `apps/desktop/src/preload` | 渲染进程和主进程之间的窄桥 |
| `apps/desktop/src/renderer` | 设备码界面、WebRTC、DataChannel |

## 安装与运行 / Install and run

需要 Node.js 20 或更高版本。

```bash
npm install
```

`npm install` 会编译 `@screen-sharing/protocol`。同时启动信令和 Electron：

```bash
npm run dev
```

分开启动：

```bash
npm run dev:signaling
npm run dev:desktop
```

只跑信令（不监听文件变化）：

```bash
npm run start:signaling
```

默认地址是 `ws://127.0.0.1:8787`。换端口时两边一起改：

```bash
SIGNALING_PORT=8787 npm run dev:signaling
SIGNALING_URL=ws://127.0.0.1:8787 npm run dev:desktop
```

PowerShell:

```powershell
$env:SIGNALING_PORT="8787"; npm run dev:signaling
$env:SIGNALING_URL="ws://127.0.0.1:8787"; npm run dev:desktop
```

让局域网里的另一台机器连接时，把信令绑到 `0.0.0.0`，并把 `SIGNALING_URL` 设成这台机器的地址。默认只监听本机。

```bash
SIGNALING_HOST=0.0.0.0 SIGNALING_PORT=8787 npm run dev:signaling
```

检查与测试：

```bash
npm test
npm run typecheck
```

### 本地怎么试一条会话

1. 启动 `npm run dev`，窗口左侧会出现 9 位设备码和临时密码。
2. 再开一个客户端（另一个终端执行 `npm run dev:desktop`），或在**同一个窗口**右侧输入自己的设备码和密码，点连接。
3. 自连时，右侧会看到本机屏幕或占位画面。在画面上移动鼠标，被控端主进程日志里会出现 `[input] stub ...`。那就是键鼠注入的挂载点，现在不会操作系统。

占位画面上写着 `TODO(windows-dxgi)`。没有真实屏幕时这是预期结果。

## 字段 / Fields

信令消息走 WebSocket。键鼠不走信令，走 WebRTC DataChannel，标签是 `input`。

| 字段 | 业务含义 | 类型 | 怎么流转 |
| --- | --- | --- | --- |
| `code` | 被控端设备码，也是房间号 | 9 位数字字符串 | 信令在创建房间时生成，被控端展示，控制端填写后 `join-room` |
| `password` | 这个房间的临时准入密码，不是账号密码 | 可选字符串，最长 64 | 被控端设置，只存在信令进程内存里；控制端加入时提交 |
| `role` | `host` 被控端，`controller` 控制端 | 枚举 | 由信令根据「创建」或「加入」分配，客户端不能自报角色 |
| `sdp` | WebRTC 协商描述，信令不解析 | 字符串 | 对端之间原样转发 |
| `candidate` | ICE 候选，信令不解析 | 对象或 `null` | 对端之间原样转发 |
| `from` | 这条 SDP/ICE 是哪一方发出的 | `host` \| `controller` | 信令盖章，客户端不填写 |
| `InputEvent.x` / `y` | 控制端看到的**画面内容区域**上的位置，左上角是 0，范围 0 到 1，已经去掉黑边 | 数字 | 只走 DataChannel。被控端以后按采集画面的原点映射成像素 |
| `InputEvent.code` | 物理按键，对应 `KeyboardEvent.code`（如 `KeyA`） | 字符串 | 只走 DataChannel。不重复发送自动连发，按键按住后的连发交给被控端系统 |
| `deltaX` / `deltaY` | 控制端滚轮的 DOM 增量，`deltaY` 为正表示向下 | 数字 | 只走 DataChannel |

一个房间最多一个被控端、一个控制端。第三个控制端会收到 `room-full`。

## Phase 1 范围 / Scope

现在有：

- 可运行的单体仓库和中英说明
- 内存设备码房间：创建、加入、临时密码、SDP/ICE 转发、离开、断线
- Electron 界面：本机设备码、输入设备码连接、远端画面、断开
- WebRTC 会话骨架：优先 `getDisplayMedia`，失败则用画布占位轨
- 键鼠事件类型，以及主进程里的注入桩（只打日志）

现在没有：

- 真正的 Windows DXGI 采集和硬件编码
- 真正的键鼠注入
- macOS
- TURN / coturn（跨网穿透）
- 账号、设备码防爆破、密码哈希、房间持久化
- 剪贴板、文件传输、多显示器策略
- 多人会议

## 扩展点 / Where to plug in

在仓库里搜这些标记：

| 标记 | 位置 | 要接什么 |
| --- | --- | --- |
| `TODO(windows-dxgi)` | `apps/desktop/src/main/capture-plan.ts`、`apps/desktop/src/renderer/capture.ts` | Win32 DXGI Desktop Duplication。原生成模块放在**主进程**，渲染进程开了沙箱，不能加载 `.node` |
| `TODO(windows-input)` | `apps/desktop/src/main/input-injection.ts` | Win32 `SendInput`。渲染进程把 DataChannel 里的 `InputEvent` 经 preload 送到这里 |
| `TODO(encode)` | `apps/desktop/src/renderer/capture.ts` | 采集落地后的码率、帧率 |
| `TODO(turn)` | `apps/desktop/src/renderer/peer-session.ts` | 自建 coturn。不要把长期凭证提交进仓库 |
| `TODO(macos)` | `capture-plan.ts`、`input-injection.ts` | 以后的 ScreenCaptureKit 和 CGEvent |

```mermaid
flowchart LR
  controller[控制端 Electron]
  host[被控端 Electron]
  signaling[信令 WebSocket]
  controller -->|设备码加入| signaling
  host -->|创建房间| signaling
  host -->|WebRTC 屏幕轨| controller
  controller -->|DataChannel 键鼠| host
  host -.-> dxgi[TODO DXGI]
  host -.-> inject[TODO SendInput]
```

原生模块以后加进 `apps/desktop/scripts/bundle.mjs` 的 `external` 列表，esbuild 不能打包 `.node`。

## 信令进程模型 / Signaling notes

房间表在 `services/signaling/src/rooms.ts`，进程重启后设备码全部失效。这是 Phase 1 的刻意选择。密码目前明文放在内存里，只做长度相等时的逐字符比较；上线前需要改成限流、哈希，以及设备码防猜。

日志不打印密码和 SDP 正文。
