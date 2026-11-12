import { t } from '../i18n.js';
import type { RoomSession } from './signaling';
import { postSignal, pollSignals } from './signaling';

export type PeerMessage = Record<string, unknown>;

const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.qq.com:3478',
      'stun:stun.miwifi.com:3478',
      'stun:stun.chat.bilibili.com:3478',
      'stun:stun.l.google.com:19302',
    ],
  },
];

const CONNECT_TIMEOUT_MS = 40_000;
const POLL_INTERVAL_MS = 450;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PeerLink {
  readonly session: RoomSession;

  onEvent: (message: PeerMessage) => void = () => {};
  onState: (message: PeerMessage) => void = () => {};
  onStatus: (text: string) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};

  private pc: RTCPeerConnection | null = null;
  private events: RTCDataChannel | null = null;
  private states: RTCDataChannel | null = null;
  private remoteReady = false;
  private opened = false;
  private cancelled = false;
  private disconnectReported = false;
  private failure: string | null = null;
  private readonly pendingIce: RTCIceCandidateInit[] = [];

  constructor(session: RoomSession) {
    this.session = session;
  }

  async connect(): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate || this.cancelled) return;
      postSignal(this.session, 'ice', { candidate: event.candidate.toJSON() }).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (this.cancelled) return;
      if (pc.connectionState === 'failed') {
        if (this.opened) {
          this.reportDisconnect(t('error.linkLost'));
        } else {
          this.fail('connection_failed');
        }
      } else if (pc.connectionState === 'disconnected') {
        this.onStatus(t('error.unstable'));
      }
    };

    if (this.session.role === 'host') {
      this.attachChannel(pc.createDataChannel('events', { ordered: true }));
      this.attachChannel(
        pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }),
      );
    } else {
      pc.ondatachannel = (event) => this.attachChannel(event.channel);
    }

    const started = Date.now();
    const seen = new Set<string>();
    let failureCount = 0;

    while (!this.opened) {
      if (this.cancelled) throw new Error(this.failure ?? t('error.cancelled'));
      if (Date.now() - started > CONNECT_TIMEOUT_MS) throw new Error('timeout');

      let signals;
      try {
        signals = await pollSignals(this.session);
        failureCount = 0;
      } catch (error) {
        failureCount += 1;
        if (failureCount >= 3) throw error;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      for (const signal of signals) {
        if (seen.has(signal.id)) continue;
        seen.add(signal.id);
        await this.handleSignal(signal.kind, signal.payload, pc);
        if (this.opened || this.cancelled) break;
      }

      if (!this.opened) await sleep(POLL_INTERVAL_MS);
    }
  }

  sendEvent(message: PeerMessage): void {
    this.send(this.events, message);
  }

  sendState(message: PeerMessage): void {
    this.send(this.states, message);
  }

  close(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.opened = false;
    if (this.session.role !== 'host' || this.events?.readyState === 'open') {
      postSignal(this.session, 'bye', {}).catch(() => {});
    }    for (const channel of [this.events, this.states]) {
      try {
        channel?.close();
      } catch {
        // already closed
      }
    }
    try {
      this.pc?.close();
    } catch {
      // already closed
    }
    this.events = null;
    this.states = null;
    this.pc = null;
  }

  private async handleSignal(
    kind: string,
    payload: Record<string, unknown>,
    pc: RTCPeerConnection,
  ): Promise<void> {
    if (kind === 'bye') {
      throw new Error('peer_left');
    }

    if (kind === 'join' && this.session.role === 'host' && !pc.localDescription) {
      this.onStatus('对手已加入，正在协商直连…');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await postSignal(this.session, 'offer', {
        sdp: { type: offer.type, sdp: offer.sdp },
      });
      return;
    }

    if (kind === 'offer' && this.session.role === 'guest') {
      this.onStatus('收到房间邀请，正在建立直连…');
      await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      this.remoteReady = true;
      await this.flushIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postSignal(this.session, 'answer', {
        sdp: { type: answer.type, sdp: answer.sdp },
      });
      return;
    }

    if (kind === 'answer' && this.session.role === 'host') {
      await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      this.remoteReady = true;
      await this.flushIce(pc);
      return;
    }

    if (kind === 'ice') {
      const candidate = payload.candidate as RTCIceCandidateInit | undefined;
      if (!candidate) return;
      if (this.remoteReady) {
        await pc.addIceCandidate(candidate).catch(() => {});
      } else {
        this.pendingIce.push(candidate);
      }
    }
  }

  private async flushIce(pc: RTCPeerConnection): Promise<void> {
    while (this.pendingIce.length > 0) {
      const candidate = this.pendingIce.shift();
      if (candidate) await pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  private attachChannel(channel: RTCDataChannel): void {
    if (channel.label === 'state') {
      this.states = channel;
      channel.onmessage = (event) => this.dispatch(event.data, this.onState);
    } else {
      this.events = channel;
      channel.onmessage = (event) => this.dispatch(event.data, this.onEvent);
    }

    channel.onopen = () => this.checkOpen();
    channel.onclose = () => {
      if (this.opened && !this.cancelled) this.reportDisconnect(t('error.peerLeft'));
    };
  }

  private reportDisconnect(reason: string): void {
    if (this.disconnectReported || this.cancelled) return;
    this.disconnectReported = true;
    this.onDisconnect(reason);
  }

  private dispatch(raw: unknown, handler: (message: PeerMessage) => void): void {
    if (typeof raw !== 'string') return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        handler(parsed as PeerMessage);
      }
    } catch {
      // ignore malformed peer frames
    }
  }

  private checkOpen(): void {
    if (this.opened) return;
    if (this.events?.readyState === 'open' && this.states?.readyState === 'open') {
      this.opened = true;
      this.onStatus('直连已建立');
    }
  }

  private send(channel: RTCDataChannel | null, message: PeerMessage): void {
    if (!channel || channel.readyState !== 'open') return;
    try {
      channel.send(JSON.stringify(message));
    } catch {
      // channel closing
    }
  }

  private fail(reason: string): void {
    if (this.cancelled || this.opened) return;
    this.failure = reason;
    this.cancelled = true;
  }
}
