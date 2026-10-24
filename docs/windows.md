# Windows 采集与键鼠 / Windows capture and input

不想自己编译时，从 [GitHub Releases](https://github.com/zxx0928/screen-sharing/releases) 下 `XiaoxuConnect-*-win-x64-setup.exe` 或便携版。跨网要填的信令和 TURN 在 [docs/download.md](download.md)，不在安装包里。

自己打安装包（同样需要下面的 C++ 工具链，因为要编 DXGI 插件）：

```powershell
npm install
npm run dist:win
```

产物是 `apps/desktop/release/XiaoxuConnect-<version>-win-x64-setup.exe` 和 `XiaoxuConnect-<version>-win-x64-portable.exe`。

被控端在 Windows 上不再走 `getDisplayMedia` 选择器。主进程加载 `screen_sharing_win32.node`，用 DXGI Desktop Duplication 抓屏幕，用 `SendInput` 注入键鼠。渲染进程开了沙箱，不能加载 `.node`。

On Windows the controlled host does not ask `getDisplayMedia` to show a picker. The main process loads `screen_sharing_win32.node`, captures with DXGI Desktop Duplication, and injects input with `SendInput`. The sandboxed renderer never loads the addon.

macOS 不在这次范围内。

## 环境 / Prerequisites

- Windows 10 1803 或更高（Desktop Duplication 需要 IDXGIOutput1）
- Node.js 20+
- Python 3（node-gyp 要用）
- Visual Studio 2022 Build Tools，工作负载选「使用 C++ 的桌面开发」，并带上 Windows 10/11 SDK

装好之后在仓库根目录：

```powershell
npm install
npm run build:native -w @screen-sharing/desktop
npm run dev
```

`npm run dev` 和 `npm run build` 在 Windows 上会先编这个插件。Linux 和 macOS 上这两条命令会跳过它，只编 TypeScript。

插件对着**当前安装的 Electron 头文件**编译，不是系统 Node 的 ABI。Electron 升级后需要重新执行 `build:native`。

产物在：

```
apps/desktop/native/win32/build/Release/screen_sharing_win32.node
```

打包时会复制到 `apps/desktop/dist/screen_sharing_win32.node`。不要把 `.node` 提交进 git。

## 跑起来之后看什么 / What a working session looks like

1. 被控端窗口出现 9 位设备码。
2. 控制端输入设备码（同一台机器开第二个窗口即可）。
3. 被控端状态变成「采集：DXGI Desktop Duplication（H.264）」。同步 H.264 编码器打不开时，状态是「采集：DXGI Desktop Duplication」，画面改走 JPEG。
4. 主进程日志里有类似一行：

```
[capture] DXGI 1920x1080 → h264 1920x1080 (Microsoft H264 Video Encoder); fallback wic-jpeg-ipc-canvas
[capture] h264 mft N encoder(s), M hardware
[input] SendInput ready
```

5. 被控端勾选「允许远程控制」。之后在控制端画面上移动鼠标，被控端光标才跟着动。单击、滚轮、字母键会作用到被控端当前用户会话。未勾选时不会调用 `SendInput`。主进程在关闭的那一下会打 `[input] remote control off`；若仍有事件漏进主进程，会打 `remote control is off; not calling SendInput`。

插件没编出来时，Windows 退回 Electron `desktopCapturer`（Chromium 自己的 DXGI），状态是「采集：Electron desktopCapturer」。这时**不会**调用 `SendInput`。

## 数据怎么走 / Data path

```
IDXGIOutputDuplication::AcquireNextFrame
  → ID3D11Texture2D (BGRA)
  → staging Map，复制到 CPU，立刻 Unmap 并 ReleaseFrame
  → 宽边超过 1920 时最近邻缩小到偶数尺寸
  → CPU BGRA 转 NV12（BT.601 studio）
  → 同步 Media Foundation H.264 MFT（CBR 8 Mbps，GOP 60，baseline，低延迟）
  → Annex-B（关键帧补 SPS/PPS）
  → IPC
  → 渲染进程 WebCodecs VideoDecoder
  → canvas.captureStream
  → RTCRtpSender（maxBitrate 8 Mbps，maxFramerate 30）
```

编码器 `Open` 失败时，状态不会带「H.264」，画面从第一帧起就是 JPEG。采集启动本身不会因为没有 H.264 MFT 而失败。Windows N 上经常没有软件 H.264 编码器。

如果编码器中途失败（连续 8 帧只有 `NeedMore`，或 `ProcessInput` 失败），状态文字仍保持启动时的 H.264，这一帧和之后的帧改用 WIC JPEG，沿同一条 IPC 画到同一块 canvas。

硬件编码器多数是异步 MFT（`IMFMediaEventGenerator`）。这一步只激活 `MFT_ENUM_FLAG_SYNCMFT`，所以采集线程不用事件循环。`probeH264()` 仍会把硬件编码器列在日志里。

键鼠不走这条图像路径。控制端把 `InputEvent` 发到 DataChannel `input`，preload 转到主进程：

```
归一化坐标 → 采集输出上的物理像素
物理像素 → 虚拟屏幕上的 0..65535（MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK）
KeyboardEvent.code → 设置 1 扫描码（KEYEVENTF_SCANCODE）
→ user32!SendInput
```

坐标公式在 `apps/desktop/src/main/input-mapping.ts`，Linux 上的 `npm test` 会锁住它。`x = 1` 落在最后一个像素，不是宽高的外沿。多显示器的原点可以是负数；虚拟屏幕是各 DXGI 输出 `DesktopCoordinates` 的并集，和采集原点用同一套物理像素。

DOM 滚轮向下是正的 `deltaY`。Win32 `MOUSEEVENTF_WHEEL` 向上是正的，所以垂直方向取反。大约 100 个像素增量算一格（120）。小于 20 的值按行模式处理。水平滚轮不取反。

会话结束时，主进程会对本会话按下但还没松开的键和键鼠按钮补一次 up，避免断线后 Shift 粘住。关掉远程控制时同样补一次 up，这次 up 仍然调用 `SendInput`；之后的新事件在调用之前就被丢掉。

## H.264 还差什么 / What H.264 still does not do

同步 MFT 已经在采集线程里调用 `ProcessInput`。码流是 Annex-B。渲染进程用 WebCodecs 解到 canvas，Chromium 再编码一次 WebRTC。这不是最终的 GPU 直通。

下一步在 `describeCapturePipeline()`（`apps/desktop/src/main/h264-plan.ts`）里：

1. 采集到的 `ID3D11Texture2D` 留在 GPU 上，编码路径不要 `Map()`。
2. 同一台 D3D11 设备上用 `ID3D11VideoProcessor` 把 BGRA 转成 NV12。
3. 用 `probeH264()` 选中的异步硬件 MFT 替换现在的同步软件 MFT。
4. 把 Annex-B 直接送进 WebRTC RTP，不再先解码到 canvas。

码率、GOP、profile 已经按这个计划设在编码器上：CBR，`AVEncCommonMeanBitRate = 8000000`，`CODECAPI_AVEncMPVGOPSize = 60`，`MF_MT_FRAME_RATE = 30/1`，`eAVEncH264VProfile_Base`。关键帧会带 SPS/PPS。

## 限制 / Limits

- 采集的是主显示器（`MONITORINFOF_PRIMARY`）。坐标按整张虚拟屏幕计算，所以副屏上的窗口可以点到，但画面默认不是副屏。
- 光标不画进 DXGI 帧里。控制端用自己的鼠标盖在画面上。
- 插件必须跑在交互式用户会话里。Session 0、服务进程、UAC 安全桌面拿不到 Desktop Duplication，也注入不进更高完整性的窗口。
- 另一路程序占满 duplication 时，`DuplicateOutput` 会失败（常见 `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE` 或 `E_ACCESSDENIED`）。日志里有 HRESULT。失败后会退回 Electron desktopCapturer，再失败才用 `getDisplayMedia`。
- 帧宽边最大 1920，H.264 和 JPEG 都用这个偶数尺寸。注入用的是输出的真实像素尺寸，不是缩放后的帧尺寸。
- 远程桌面进到这台被控机器时，控制台会话的 DXGI 可能是黑的或直接失败。在本机登录的会话里跑被控端。

## 排错 / Troubleshooting

| 现象 | 处理 |
| --- | --- |
| `node-gyp` 找不到 VS | 安装 VS 2022 Build Tools 的 C++ 桌面工作负载，然后重开终端 |
| `screen_sharing_win32.node not found` | 在 Windows 上执行 `npm run build:native -w @screen-sharing/desktop` |
| 换了 Electron 版本后插件加载失败 | 重新 `build:native`。ABI 跟着 Electron，不跟着系统 Node |
| 状态不是 DXGI | 看主进程里的 `DuplicateOutput failed (0x........)` |
| 有画面但鼠标不动 | 先在被控端勾选「允许远程控制」。仍不动再看有没有 `SendInput ready`。没有的话插件没加载，键鼠被丢掉了 |
| 点了停止共享，控制端还有画面 | 控制端应变成「对方已停止共享」，房间和设备码还在。若画面还在动，看被控端有没有把视频轨 `replaceTrack(null)` |
| 点击偏到别的屏幕 | 采集几何必须来自 DXGI 的 `DesktopCoordinates`。不要用 Electron `screen.getAllDisplays()` 的 DIP 去乘缩放 |
| Linux 上 `npm test` 失败 | 不该去编这个插件。测试只跑 TypeScript。把报错贴出来，不要在 Linux 上装 Windows SDK |
