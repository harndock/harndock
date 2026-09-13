import {
  isProtocolFrame,
  PROTOCOL_VERSION,
  type ClientHelloFrame,
  type ClientSubscribeFrame,
  type ProtocolFrame,
} from '@harndock/sync-protocol'

export type GatewayConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'

export interface GatewayClientOptions {
  url: string
  accessToken: string
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  onState?: (state: GatewayConnectionState) => void
  onFrame?: (frame: ProtocolFrame) => void
}

export class GatewayClient {
  private socket: WebSocket | undefined
  private readonly subscriptions = new Map<string, number>()
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private sequence = 0
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private handshakeComplete = false

  constructor(private readonly options: GatewayClientOptions) {
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000
  }

  connect(): void {
    if (!this.stopped && (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING)) return
    this.stopped = false
    this.reconnectAttempt = 0
    this.open()
  }

  retry(): void {
    if (this.stopped) {
      this.connect()
      return
    }
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.reconnectAttempt = 0
    const socket = this.socket
    this.socket = undefined
    socket?.close()
    this.open()
  }

  private open(): void {
    if (this.stopped) return
    this.options.onState?.(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting')
    const WebSocketWithHeaders = WebSocket as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers: Record<string, string> },
    ) => WebSocket
    let socket: WebSocket
    try {
      socket = new WebSocketWithHeaders(this.options.url, undefined, {
        headers: { Authorization: `Bearer ${this.options.accessToken}` },
      })
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) {
        socket.close()
        return
      }
      this.sendHello()
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.handshakeComplete = false
      if (this.stopped) this.options.onState?.('closed')
      else this.scheduleReconnect()
    }
    socket.onerror = () => {
      if (this.socket !== socket) return
      this.options.onState?.('error')
      socket.close()
    }
    socket.onmessage = event => {
      try {
        const value: unknown = JSON.parse(String(event.data))
        if (!isProtocolFrame(value)) return
        if (value.kind === 'server.hello') {
          this.handshakeComplete = true
          this.reconnectAttempt = 0
          this.options.onState?.('connected')
          for (const [sessionId, fromSeq] of this.subscriptions) this.sendSubscribe(sessionId, fromSeq)
          return
        }
        this.options.onFrame?.(value)
      } catch {
        this.options.onState?.('error')
      }
    }
  }

  send(frame: ProtocolFrame): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Gateway is not connected')
    this.socket.send(JSON.stringify(frame))
  }

  subscribe(sessionId: string, fromSeq = 0, includeSnapshot = fromSeq === 0): void {
    this.subscriptions.set(sessionId, fromSeq)
    if (this.socket?.readyState === WebSocket.OPEN && this.handshakeComplete) {
      this.sendSubscribe(sessionId, fromSeq, includeSnapshot)
    }
  }

  advance(sessionId: string, nextFromSeq: number): void {
    const current = this.subscriptions.get(sessionId)
    if (current === undefined || nextFromSeq > current) this.subscriptions.set(sessionId, nextFromSeq)
  }

  resume(sessionId: string, lastSeq: number): void {
    this.subscriptions.set(sessionId, lastSeq + 1)
    if (this.socket?.readyState !== WebSocket.OPEN || !this.handshakeComplete) return
    this.send({
      protocolVersion: PROTOCOL_VERSION,
      frameId: this.nextFrameId('resume'),
      kind: 'cursor.resume',
      sessionId,
      sentAt: new Date().toISOString(),
      payload: { lastSeq },
    })
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    const socket = this.socket
    this.socket = undefined
    this.handshakeComplete = false
    socket?.close()
    this.options.onState?.('closed')
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.options.onState?.('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.open()
    }, delay)
  }

  private sendHello(): void {
    const frame: ClientHelloFrame = {
      protocolVersion: PROTOCOL_VERSION,
      frameId: this.nextFrameId('hello'),
      kind: 'client.hello',
      sentAt: new Date().toISOString(),
      payload: {
        supportedVersions: [PROTOCOL_VERSION],
        client: {
          name: 'harndock-mobile',
          version: '0.1.0',
          platform: 'android',
          capabilities: ['session.read', 'session.control'],
        },
      },
    }
    this.send(frame)
  }

  private sendSubscribe(sessionId: string, fromSeq: number, includeSnapshot = fromSeq === 0): void {
    const frame: ClientSubscribeFrame = {
      protocolVersion: PROTOCOL_VERSION,
      frameId: this.nextFrameId('subscribe'),
      kind: 'client.subscribe',
      sessionId,
      sentAt: new Date().toISOString(),
      payload: {
        ...(fromSeq === 0 ? {} : { fromSeq }),
        includeSnapshot,
      },
    }
    this.send(frame)
  }

  private nextFrameId(prefix: string): string {
    this.sequence += 1
    return `mobile_${prefix}_${Date.now().toString(36)}_${this.sequence.toString(36)}`
  }
}
