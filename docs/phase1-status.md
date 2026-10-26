# 小旭连接 · 一期进度与缺口

给产品负责人看。打开这一页就知道一期做到哪、还差什么。

更新日期：2026-10-26。

## 产品定位

- 一期：类似向日葵 / ToDesk 的 1 对 1 远程协助。不是多人会议。
- 产品名「小旭连接」。
- 仓库：<https://github.com/zxx0928/screen-sharing>

## 已经有的

- **出码 / 连码。** 被控端展示 9 位设备码（临时连接码），以及可选的安全连接码。控制端填码发起连接。
- **授权。** 被控端弹出三个选择：好呀（允许看画面，并打开远程控制）、先看一眼（只共享画面）、下次吧（拒绝这次连接）。
- **开停共享、远程控制开关。** 被控端可以单独开始或停止共享，房间不断开。远程控制默认关闭，勾选「允许远程控制」后，对方的键鼠才会作用到这台电脑。
- **Windows 抓屏和键鼠代码已进主干。** DXGI（抓屏）、H.264（把画面压成视频）、SendInput（把对方的键鼠动作注入这台电脑）。真机有没有跑过，见下面「还差什么」。
- **「小旭连接」8 态界面。** 此设备、我的设备、连接记录、授权弹窗、正在连接、控制端看画面、被控端被占用、已断开。
- **信令（两边靠设备码找到对方，不传画面）和 TURN（画面直连不通时帮绕路转发的服务）。** 客户端已经能读配置。怎么绑、怎么填，写在 [docs/network.md](network.md)。
- **GitHub Releases（安装包下载页）v0.1.0：** <https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0>
  - Windows 安装版：`XiaoxuConnect-0.1.0-win-x64-setup.exe`
  - Windows 便携版（解出来就能跑）：`XiaoxuConnect-0.1.0-win-x64-portable.exe`
  - Mac（Apple 芯片）zip：`XiaoxuConnect-0.1.0-mac-arm64.zip`
  - Mac（Intel）zip：`XiaoxuConnect-0.1.0-mac-x64.zip`
- **同机 / 同一局域网可以做最小闭环。** 用上面的安装包即可。本机还要另开一个信令进程（负责两边对上号），步骤见 [docs/network.md](network.md) 和 [docs/download.md](download.md)。不改配置时，客户端只连本机 `ws://127.0.0.1:8787`。

## 还差什么（闭环缺口）

1. **Windows 真机补验。** DXGI（抓屏）、SendInput（键鼠注入）、控制开关，还没在用户自己的 Windows 实机上跑过。此前约定有机器再测。代码已在主干，v0.1.0 安装包里也带了。
2. **公网常开服务。** 两台电脑不在同一个网络时，需要一台双方都够得着、一直开着的机器。上面要跑信令（对上号）和 coturn（TURN 的开源服务端，负责绕路转发画面）。代码和安装包配置已经支持：`SIGNALING_URL`（信令地址）、`TURN_*`（绕路转发的地址和口令）。用户 2026-10-26 表示暂时不架。
3. **安装包未代码签名。** Windows 可能被 SmartScreen（系统拦截不明软件的提示）拦住，需要点「更多信息 → 仍要运行」。macOS 未公证（苹果没有给这个包盖章），第一次打开要在访达里按住 Control，再点「打开」。
4. **未排进一期（可选下一档）。** 自动更新、账号体系、GitHub 以外的分发渠道等。

## 下次怎么验

- **最小闭环。** 同一台电脑，或同一局域网。下载 [v0.1.0](https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0)，按 Release（这一版的发布说明）、[docs/download.md](download.md)、[docs/network.md](network.md) 先起信令（对上号的进程），再连。
- **跨公网。** 先有一台公网服务器，再配 `SIGNALING_URL`（信令地址）和 `TURN_*`（绕路转发的地址和口令）。地址和口令只放每台电脑自己的配置里，不写进仓库。
- **Windows 真机。** 装 setup（安装版）或 portable（便携版）。重点看两件事：画面出不来，键鼠控不控得动。被控端点「好呀」，或之后勾选「允许远程控制」，控制端在画面里移动鼠标，被控端光标才跟着走。

## 相关链接

- [v0.1.0 安装包](https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0)
- [全部 Releases（安装包下载页）](https://github.com/zxx0928/screen-sharing/releases)
- [docs/network.md](network.md) — 信令（对上号）怎么对外开放，TURN（绕路转发）怎么配
- [docs/download.md](download.md) — 下哪个包，装好后改哪份配置
- [docs/windows.md](windows.md) — Windows 上抓屏和键鼠装好之后看什么
