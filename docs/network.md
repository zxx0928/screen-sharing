# 公网信令与 TURN / Public signaling and TURN

一对一远程协助要跨 NAT，需要两件事同时可达：

1. **信令**。两边用设备码找到对方，并交换 SDP / ICE。信令不传画面和键鼠。
2. **TURN**。直连和 STUN 打洞失败时，媒体（屏幕轨和键鼠 DataChannel）经 coturn 中继。

同一台机器、以及大多数局域网，不配 TURN 也能连。默认 ICE 是本机候选加上 `stun:stun.l.google.com:19302`。

Phase 1 does not load a `.env` file. The dev client reads the variables below from the process environment. An installed or portable build reads a JSON file with the same keys; a non-empty environment variable still wins. Paths and the example file are in [docs/download.md](download.md). Do not commit real TURN usernames or passwords. `.env.example` only shows empty placeholders.

## 信令让别的机器连得上 / Bind signaling so another machine can connect

默认 `SIGNALING_HOST=127.0.0.1`，只有本机能连。

On the computer that runs the signaling process (a LAN host, or a VPS):

```bash
SIGNALING_HOST=0.0.0.0 SIGNALING_PORT=8787 npm run dev:signaling
```

不监听文件变化时：

```bash
SIGNALING_HOST=0.0.0.0 SIGNALING_PORT=8787 npm run start:signaling
```

`0.0.0.0` 表示监听所有网卡。客户端的 `SIGNALING_URL` **不能**写成 `ws://0.0.0.0:8787`，要写成这台机器能被对方访问到的地址：

```bash
# 局域网
SIGNALING_URL=ws://192.168.1.20:8787 npm run dev:desktop

# 公网（信令进程所在机器的公网 IP 或域名）
SIGNALING_URL=ws://203.0.113.10:8787 npm run dev:desktop
```

PowerShell:

```powershell
$env:SIGNALING_HOST="0.0.0.0"; $env:SIGNALING_PORT="8787"; npm run dev:signaling
$env:SIGNALING_URL="ws://203.0.113.10:8787"; npm run dev:desktop
```

防火墙放行 **TCP `SIGNALING_PORT`**（默认 8787）。路由器后的机器还要做端口转发。进程日志在绑定 `0.0.0.0` 时会提醒：客户端要填可达地址，而不是 `0.0.0.0`。

这一期信令没有登录口令。设备码和临时安全连接码就是房间的准入。不要把带账号的 URL 写进仓库；如果以后加信令口令，同样只放环境变量。

## 安装版怎么读这些变量 / Installed app

`npm run dev` 只看环境变量，以及工作目录里的 `xiaoxu.config.json`（这个文件已忽略，不要提交）。

安装包和便携版按这个顺序合并，后面的盖过前面的：

1. 用户目录 `config.json`。Windows 是 `%APPDATA%\小旭连接\config.json`。第一次打开时，旁边会有一份 `config.example.json`。
2. exe 旁边的 `xiaoxu.config.json`。便携版用这个，配置可以跟 U 盘走。
3. 环境变量。从终端启动时用。

键名和下面的表一样，值都是字符串。空字符串等于没写。`SIGNALING_URL` 只接受不带账号的 `ws://` 或 `wss://`。日志里的 `[config]` / `[ice]` 只有地址和策略，没有 `TURN_USERNAME` 或 `TURN_CREDENTIAL`。点界面左侧的「小旭」也能看到当前信令地址。

完整的下载和填写步骤在 [docs/download.md](download.md)。

## 客户端 ICE / Client ICE servers

Electron 主进程读环境变量和上面的 JSON，经 `getConfig` 交给渲染进程的 `RTCPeerConnection`。变量见 `.env.example`。

| 变量 | 含义 | 不设时 |
| --- | --- | --- |
| `STUN_URLS` | 逗号分隔的 `stun:` / `stuns:` | `stun:stun.l.google.com:19302`。设成 `none` 则不用 STUN |
| `TURN_URLS` | 逗号分隔的 `turn:` / `turns:` | 不用 TURN |
| `TURN_USERNAME` | coturn 长期用户名 | `TURN_URLS` 有值但用户名或密码为空时，忽略 TURN 并在主进程打警告 |
| `TURN_CREDENTIAL` | coturn 长期密码 | 同上。不会写进日志 |
| `ICE_TRANSPORT_POLICY` | `all` 或 `relay` | `all`。`relay` 强制只走 TURN |

两边的桌面进程都要能拿到同一套 TURN 变量（以及各自可达的 `SIGNALING_URL`）。URL 里不要写 `turn:user:password@host`，这种形式会被丢掉，密码也不会被打进警告。

主进程启动后打一行，只有策略和 URL，没有用户名和密码：

```
[ice] policy=all turn=yes urls=stun:stun.l.google.com:19302,turn:203.0.113.10:3478?transport=udp
```

连通后，开发者工具控制台（`npm run dev` 会打开）还有一行选中的候选类型：

```
[ice] selected local=relay remote=relay protocol=udp
```

`local=relay` 表示媒体走了 TURN。`host` 是直连，`srflx` 是 STUN 看到的公网映射。

## 起一个 coturn / Run coturn

下面是一台有公网 IP 的 Linux 上的最小长期凭证配置。把 `replace-with-a-long-password` 换成你自己的密码，只放在服务器环境和两边客户端的环境里。

`/etc/turnserver.conf`：

```
listening-port=3478
fingerprint
lt-cred-mech
realm=screen-sharing
user=screen:replace-with-a-long-password
no-cli
no-tcp-relay
log-file=stdout
# 中继端口。防火墙要对 UDP 放开这一段，否则 TURN 分配会失败。
min-port=49160
max-port=49200
```

需要 TCP 中继时删掉 `no-tcp-relay`。TLS（`turns:`）还要证书，这一期不是必须。

Docker（Linux 上用 host 网络，TURN 才能拿到正确的公网映射）：

```bash
docker run -d --name screen-sharing-turn --network host coturn/coturn \
  -n --log-file=stdout \
  --listening-port=3478 \
  --fingerprint \
  --lt-cred-mech \
  --realm=screen-sharing \
  --user=screen:replace-with-a-long-password \
  --min-port=49160 \
  --max-port=49200 \
  --no-cli \
  --no-tcp-relay
```

防火墙：

- UDP `3478`（TURN 监听）
- UDP `49160-49200`（中继，和上面的 `min-port` / `max-port` 一致）
- 若启用了 TCP 中继，再加 TCP `3478`

客户端：

```bash
SIGNALING_URL=ws://203.0.113.10:8787 \
TURN_URLS=turn:203.0.113.10:3478?transport=udp \
TURN_USERNAME=screen \
TURN_CREDENTIAL=replace-with-a-long-password \
npm run dev:desktop
```

`TURN_URLS` 的主机名必须是对端都能解析、并且 coturn 在 `-X` / `external-ip` 上宣告的地址。机器在 NAT 后面时，给 coturn 加上 `--external-ip=公网IP/内网IP`。`--user` 的格式是 `用户名:密码`，密码里不要放冒号。

## 怎么验 / How to check

1. **同一台机器**。不设 TURN。两个窗口用设备码连接，控制台应出现 `local=host`（或 `srflx`）。
2. **局域网两台**。信令机 `SIGNALING_HOST=0.0.0.0`。两台客户端的 `SIGNALING_URL` 都写成信令机的局域网 IP。不设 TURN 时通常是 `host` 或 `srflx`。
3. **强制走中继**（没有第二张公网时用这个证明 TURN 真的在干活）。两台客户端都加上同一套 `TURN_*`，并设置 `ICE_TRANSPORT_POLICY=relay`。会话应能连上，且两边都打出 `local=relay`。把 coturn 停掉再连，会话应失败，而不是悄悄退回局域网直连。
4. **两张不同的公网**。信令和 coturn 放在两边都够得着的机器上，防火墙按上面放开。客户端只保留 `ICE_TRANSPORT_POLICY=all`（或不设）。能连上即可；若 NAT 打洞失败，选中的候选会变成 `relay`。

画面和键鼠都不经过信令。信令只交换 SDP 和 ICE；中继走的是 TURN 上的 WebRTC。
