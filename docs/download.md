# 下载小旭连接 / Download 小旭连接

安装包只带桌面客户端。里面没有公网信令，也没有 TURN 密码。两台电脑要互相连，需要一台双方都够得着的信令，跨 NAT 时还要一台 coturn。变量和服务器怎么起，见 [docs/network.md](https://github.com/zxx0928/screen-sharing/blob/main/docs/network.md)。

The installer is only the desktop client. It does not contain a public signaling server or a TURN password. Two computers need a signaling process both can reach, and a coturn server when they are behind different NATs. Server setup and the variable list are in [docs/network.md](https://github.com/zxx0928/screen-sharing/blob/main/docs/network.md).

## 下哪个文件 / Which file

在 [GitHub Releases](https://github.com/zxx0928/screen-sharing/releases) 下载：

| 文件 | 给谁用 |
| --- | --- |
| `XiaoxuConnect-<version>-win-x64-setup.exe` | Windows 安装包（NSIS）。可选安装目录，开始菜单和桌面会有「小旭连接」 |
| `XiaoxuConnect-<version>-win-x64-portable.exe` | Windows 便携版。解出来就能跑，配置可以放在 exe 旁边 |
| `XiaoxuConnect-<version>-mac-arm64.zip` | Apple 芯片的 Mac。未签名 |
| `XiaoxuConnect-<version>-mac-x64.zip` | Intel Mac。未签名 |

Windows 包没有代码签名证书。SmartScreen 可能提示「Windows 已保护你的电脑」。点「更多信息」，再点「仍要运行」。

macOS 包没有签名，也没有公证。第一次打开：访达里对 `小旭连接.app` 按住 Control 点「打开」。系统自带的采集是屏幕共享选择器，不是 Windows 上的 DXGI。

These Windows builds are unsigned. SmartScreen may block the exe until you choose More info → Run anyway. The macOS zip is unsigned and not notarized: Control-click the app and choose Open. macOS capture uses the system picker, not DXGI.

## 装好之后先改信令地址 / Set the signaling URL

不改配置时，客户端连接 `ws://127.0.0.1:8787`。这只够同一台电脑上的信令。点左侧名字「小旭」，菜单里能看到当前要连的地址。

默认 ICE 仍是本机候选加上 `stun:stun.l.google.com:19302`。不写 TURN 时，同一台机器和大多数局域网可以连。两张不同的公网需要 TURN。

Until you set a URL, the client dials `ws://127.0.0.1:8787`. Click the name 小旭 in the sidebar to see the URL it is using. TURN stays off until you set it, which is enough on one machine and on most LANs.

仓库不加载 `.env`。开发时用环境变量。安装包读 JSON 文件，键名和环境变量一样。环境变量优先于文件。

| 键 | 含义 | 空着时 |
| --- | --- | --- |
| `SIGNALING_URL` | 客户端要连的信令，`ws://` 或 `wss://`。不要在 URL 里写账号密码 | `ws://127.0.0.1:8787` |
| `STUN_URLS` | 逗号分隔的 `stun:` / `stuns:` | `stun:stun.l.google.com:19302`。写成 `none` 则不用 STUN |
| `TURN_URLS` | 逗号分隔的 `turn:` / `turns:`。不要写成 `turn:user:password@host` | 不用 TURN |
| `TURN_USERNAME` | coturn 长期用户名 | 用户名或密码空着时，忽略 TURN |
| `TURN_CREDENTIAL` | coturn 长期密码。只放在这台电脑上 | 同上。不会写进日志 |
| `ICE_TRANSPORT_POLICY` | `all` 或 `relay` | `all`。`relay` 强制只走 TURN |

### 安装版（setup.exe）

1. 先打开一次「小旭连接」。它会把示例复制到用户目录。
2. 编辑下面这个文件（没有就新建）。Windows 路径：

```
%APPDATA%\小旭连接\config.json
```

macOS：

```
~/Library/Application Support/小旭连接/config.json
```

示例在同一目录的 `config.example.json`。安装目录里、exe 旁边也有一份 `xiaoxu.config.example.json`。

3. 完全退出后再打开。主进程日志有一行 `[config]`，里面是信令地址、有没有 TURN、读了哪个文件。没有用户名和密码。

### 便携版（portable.exe）

把 `xiaoxu.config.example.json` 复制成同目录的 `xiaoxu.config.json` 再改。这个文件比 `%APPDATA%\小旭连接\config.json` 优先。U 盘上的配置会跟着走。

### 开发，或从终端启动安装包

环境变量盖过文件。PowerShell：

```powershell
$env:SIGNALING_URL="ws://203.0.113.10:8787"
$env:TURN_URLS="turn:203.0.113.10:3478?transport=udp"
$env:TURN_USERNAME="screen"
$env:TURN_CREDENTIAL="replace-with-a-long-password"
$env:ICE_TRANSPORT_POLICY="all"
```

`npm run dev` 不会去读 `%APPDATA%` 里的配置，只看当前目录的 `xiaoxu.config.json`（已在 `.gitignore`）和环境变量。这样本机装过的配置不会改掉开发时的行为。

### 示例

把 `203.0.113.10` 换成你的信令机和 coturn。密码换成你自己的，不要提交，也不要发到 Release 附件里。

```json
{
  "SIGNALING_URL": "ws://203.0.113.10:8787",
  "TURN_URLS": "turn:203.0.113.10:3478?transport=udp",
  "TURN_USERNAME": "screen",
  "TURN_CREDENTIAL": "replace-with-a-long-password",
  "ICE_TRANSPORT_POLICY": "all"
}
```

文件是 UTF-8，最大约 16 KB。值都必须是字符串。空字符串等于没写。

优先级，从低到高：用户目录的 `config.json`，然后 exe 旁边的 `xiaoxu.config.json`，最后是环境变量。后写的盖过先写的。

## 信令要另外跑 / Signaling is a separate process

安装包不含信令进程。在一台双方都能访问的机器上，用仓库里的服务：

```bash
SIGNALING_HOST=0.0.0.0 SIGNALING_PORT=8787 npm run start:signaling
```

客户端的 `SIGNALING_URL` 写成这台机器的公网或局域网地址，例如 `ws://203.0.113.10:8787`。不要写 `ws://0.0.0.0:8787`。防火墙放行 TCP `8787`。

coturn 的最小配置、端口，以及用 `ICE_TRANSPORT_POLICY=relay` 证明媒体真的走中继，都在 [docs/network.md](https://github.com/zxx0928/screen-sharing/blob/main/docs/network.md)。

## 自己打包 / Build the packages yourself

Windows（需要 VS 2022 C++ 构建工具、Windows SDK、Python 3，和 [docs/windows.md](https://github.com/zxx0928/screen-sharing/blob/main/docs/windows.md) 里写的一样）：

```bash
npm install
npm run dist:win
```

产物在 `apps/desktop/release/`。macOS 上 `npm run dist:mac` 打出未签名 zip。

推送 `v*` 标签时，GitHub Actions 会在 Windows 上打安装包和便携版，在 macOS 上打 zip，并附到同一个 Release。带连字符的标签（例如 `v0.1.0-rc.1`）标成 pre-release。Release 说明用的就是这一页。
