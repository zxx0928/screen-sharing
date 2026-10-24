import { parseServerMessage, type ClientMessage, type ServerMessage } from "@screen-sharing/protocol";

export type SignalingStatus = "connecting" | "open" | "closed";

/**
 * One WebSocket, one role. The host keeps a reconnecting socket so this
 * device keeps a code. The controller uses a second socket for the session
 * it dials, and does not reconnect after disconnect.
 */
export class SignalingClient {
  private socket: WebSocket | null = null;
  private userClosed = false;
  private retryMs = 500;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly options: {
      reconnect: boolean;
      onMessage: (message: ServerMessage) => void;
      onStatus: (status: SignalingStatus) => void;
    },
  ) {}

  connect(): void {
    this.userClosed = false;
    this.open();
  }

  close(): void {
    this.userClosed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    console.warn(`[signaling] dropped ${message.type}; socket is not open`);
  }

  private open(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.options.onStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      console.error("[signaling] could not open", this.url, error);
      this.options.onStatus("closed");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.retryMs = 500;
      this.options.onStatus("open");
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      let json: unknown;
      try {
        json = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      const message = parseServerMessage(json);
      if (!message) {
        console.warn("[signaling] ignored unrecognized server message");
        return;
      }
      this.options.onMessage(message);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.options.onStatus("closed");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.userClosed || !this.options.reconnect) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 8000);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }
}
