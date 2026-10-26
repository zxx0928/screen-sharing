# 小旭连接：第一期闭环进度

下次打开看这里。这份说明写于 **2026-10-26**，只回答两件事：已经做完什么，第一期闭环还缺什么。安装、填地址、Windows 验收的步骤不在这里重复，文末有链接。

第一期闭环是指：你能自己下载安装包，在自己的电脑上装好；同一台电脑或同一个 Wi-Fi（家里或办公室的同一无线网络）里能连上；Windows 真机上的抓屏和键鼠也验收过。不在同一网络时要用的常驻服务器，程序已经能配，按你的决定暂时不部署。

## 已经做完

- **定稿界面已接进客户端。** 8 个画面都在：此设备、我的设备、连接记录、对方来连时的授权、连接中、主控、被控、已断开。它们已合并进 Electron（把界面做成可安装电脑软件的外壳）客户端。见 [PR #4](https://github.com/zxx0928/screen-sharing/pull/4)（PR 是已经合并进正式代码的一次改动）。
- **Windows 抓屏和控制的程序已进正式代码。** DXGI（抓屏）、H.264（把画面压成视频）、SendInput（把对方的键盘和鼠标操作写进这台电脑）已合并，见 [PR #2](https://github.com/zxx0928/screen-sharing/pull/2)。真机验收按你的安排先不做，等有 Windows 电脑再说。
- **跨网络时怎么填地址，已经能配。** 可以用环境变量（启动程序时临时写上的设置），或本机一份 `config.json`（安装后放在用户目录里的设置文件）。要填的是 `SIGNALING_URL`（信令地址：两边用来找到对方的网址），以及 TURN（画面直连不通时帮绕路转发的服务）的地址和口令，键名是 `TURN_*`。说明在 [网络配置](network.md)。见 [PR #5](https://github.com/zxx0928/screen-sharing/pull/5)。
- **安装包已发布。** [v0.1.0](https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0) 里有 Windows 安装版、Windows 便携版，以及 Mac 的 arm64（Apple 芯片）和 x64（Intel 芯片）压缩包。这些包没有盖开发者章。Windows 若弹出 SmartScreen（系统对未盖章程序的拦截提示），点「更多信息」，再点「仍要运行」。
- **同一台电脑、同一个 Wi-Fi，用这个安装包就能试连。** 不改设置时，信令（两边怎么找到对方的小服务）默认只连 localhost（只在这台电脑内部使用的地址）。同一 Wi-Fi 时，把信令改成双方都能访问的局域网地址即可。安装包里没有一直开着的公网信令，也没有 TURN。

## 第一期闭环还没做完

- [ ] **你自己下载 [v0.1.0](https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0)，在自己的电脑上试一次。** 先试同一台电脑，再试同一个 Wi-Fi。下哪个文件、第一次怎么打开，见 [下载说明](download.md)。
- [ ] **Windows 真机验收。** 按 [Windows 说明](windows.md) 看三件事：DXGI 抓到的画面、SendInput 能否控制键鼠、被控端能否开关「允许远程控制」。这项明确等你提供一台 Windows 电脑再做。
- [ ] **公网上一台一直开着的信令，外加 TURN / coturn（coturn 是 TURN 的常用程序，负责绕路转发画面）。** 代码和填写方式已经写好，放到 VPS（租来一直开着的云服务器）上就能用。你说过暂时不做，所以现在不部署。

## 以后再说，不挡住第一期

这些没有排期。缺了也不影响上面的闭环：

- 代码签名（给安装包盖开发者章，减少 Windows 拦截）和公证（苹果对 Mac 安装包的官方检查）
- 自动更新
- 账号系统

## 相关链接

- 安装包：[v0.1.0](https://github.com/zxx0928/screen-sharing/releases/tag/v0.1.0)
- 下载和第一次打开：[docs/download.md](download.md)
- 跨网络地址和绕路转发：[docs/network.md](network.md)
- Windows 抓屏和控制怎么验收：[docs/windows.md](windows.md)
