# Windows 采集与键鼠 / Windows capture and input

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
3. 被控端状态变成「采集：DXGI Desktop Duplication」。
4. 主进程日志里有类似一行：

```
[capture] DXGI 1920x1080 → jpeg 1920x1080; next encoder media-foundation-h264-mft baseline 8000000bps
[capture] h264 mft N encoder(s), M hardware
[input] SendInput ready
```

5. 在控制端画面上移动鼠标，被控端光标跟着动。单击、滚轮、字母键会作用到被控端当前用户会话。

插件没编出来时，Windows 退回 Electron `desktopCapturer`（Chromium 自己的 DXGI），状态是「采集：Electron desktopCapturer」。这时**不会**调用 `SendInput`。

## 数据怎么走 / Data path

```
IDXGIOutputDuplication::AcquireNextFrame
  → ID3D11Texture2D (BGRA)
  → staging Map
  → 宽边超过 1920 时最近邻缩小到偶数尺寸
  → Windows Imaging Component JPEG
  → IPC
  → 渲染进程 canvas
  → canvas.captureStream
  → RTCRtpSender（maxBitrate 8 Mbps，maxFramerate 30）
```

键鼠不走这条图像路径。控制端把 `InputEvent` 发到 DataChannel `input`，preload 转到主进程：

```
归一化坐标 → 采集输出上的物理像素
物理像素 → 虚拟屏幕上的 0..65535（MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK）
KeyboardEvent.code → 设置 1 扫描码（KEYEVENTF_SCANCODE）
→ user32!SendInput
```

坐标公式在 `apps/desktop/src/main/input-mapping.ts`，Linux 上的 `npm test` 会锁住它。`x = 1` 落在最后一个像素，不是宽高的外沿。多显示器的原点可以是负数；虚拟屏幕是各 DXGI 输出 `DesktopCoordinates` 的并集，和采集原点用同一套物理像素。

DOM 滚轮向下是正的 `deltaY`。Win32 `MOUSEEVENTF_WHEEL` 向上是正的，所以垂直方向取反。大约 100 个像素增量算一格（120）。小于 20 的值按行模式处理。水平滚轮不取反。

会话结束时，主进程会对本会话按下但还没松开的键和键鼠按钮补一次 up，避免断线后 Shift 粘住。

## H.264 下一步 / H.264 next step

现在的 JPEG 是预览桥，不是最终码流。Chromium 会再编码一次 canvas。主进程里的 `probeH264()` 已经调用 `MFStartup` 和 `MFTEnumEx`，列出本机 H.264 编码器（含是否硬件），但还没有 `ProcessInput`。

下一步在 `describeCapturePipeline()`（`apps/desktop/src/main/h264-plan.ts`）里写死了，实现时按这个做：

1. 采集到的 `ID3D11Texture2D` 留在 GPU 上，编码路径不要 `Map()`。
2. 同一台 D3D11 设备上用 `ID3D11VideoProcessor` 把 BGRA 转成 NV12。
3. 优先用 `probeH264()` 返回的硬件 MFT，否则用软件 CMS H.264 MFT。
4. CBR，`AVEncCommonMeanBitRate = 8000000`，`CODECAPI_AVEncMPVGOPSize = 60`，`MF_MT_FRAME_RATE = 30/1`，profile `eAVEncH264VProfile_Base`。
5. 取出 `IMFSample`，每个 IDR 前带上 SPS/PPS，输出 Annex-B（`00 00 00 01` + NAL）。
6. 沿现有帧通道把访问单元送到渲染进程，替换 JPEG canvas 轨。在那之前，WebRTC 仍由 Chromium 的 `RTCRtpSender` 编码。

## 限制 / Limits

- 采集的是主显示器（`MONITORINFOF_PRIMARY`）。坐标按整张虚拟屏幕计算，所以副屏上的窗口可以点到，但画面默认不是副屏。
- 光标不画进 DXGI 帧里。控制端用自己的鼠标盖在画面上。
- 插件必须跑在交互式用户会话里。Session 0、服务进程、UAC 安全桌面拿不到 Desktop Duplication，也注入不进更高完整性的窗口。
- 另一路程序占满 duplication 时，`DuplicateOutput` 会失败（常见 `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE` 或 `E_ACCESSDENIED`）。日志里有 HRESULT。失败后会退回 Electron desktopCapturer，再失败才用 `getDisplayMedia`。
- JPEG 宽边最大 1920，只为了 IPC。注入用的是输出的真实像素尺寸，不是 JPEG 尺寸。
- 远程桌面进到这台被控机器时，控制台会话的 DXGI 可能是黑的或直接失败。在本机登录的会话里跑被控端。

## 排错 / Troubleshooting

| 现象 | 处理 |
| --- | --- |
| `node-gyp` 找不到 VS | 安装 VS 2022 Build Tools 的 C++ 桌面工作负载，然后重开终端 |
| `screen_sharing_win32.node not found` | 在 Windows 上执行 `npm run build:native -w @screen-sharing/desktop` |
| 换了 Electron 版本后插件加载失败 | 重新 `build:native`。ABI 跟着 Electron，不跟着系统 Node |
| 状态不是 DXGI | 看主进程里的 `DuplicateOutput failed (0x........)` |
| 有画面但鼠标不动 | 确认日志里有 `SendInput ready`。没有的话插件没加载，键鼠被丢掉了 |
| 点击偏到别的屏幕 | 采集几何必须来自 DXGI 的 `DesktopCoordinates`。不要用 Electron `screen.getAllDisplays()` 的 DIP 去乘缩放 |
| Linux 上 `npm test` 失败 | 不该去编这个插件。测试只跑 TypeScript。把报错贴出来，不要在 Linux 上装 Windows SDK |
