import { t } from '../i18n.js';

export type Role = 'host' | 'guest';

export interface RoomSession {
  roomId: string;
  code: string;
  token: string;
  role: Role;
}

export type SignalKind = 'join' | 'offer' | 'answer' | 'ice' | 'bye';

interface SignalItem {
  id: string;
  kind: SignalKind;
  payload: Record<string, unknown>;
}

const BASE = '/functions/v1/app';

const MESSAGES: Record<string, string> = {
  room_full: 'error.roomFull',
  room_not_found: 'error.roomNotFound',
  invalid_input: 'error.invalidCode',
  code_taken: 'error.codeTaken',
  payload_too_large: 'error.payloadLarge',
  database_not_configured: 'error.backend',
  rate_limited: 'error.rate',
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(t('error.network'));
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : '';
    throw new Error(MESSAGES[code] ? t(MESSAGES[code]) : t('error.service'));
  }

  return data as T;
}

export function createRoom(): Promise<RoomSession> {
  return request<RoomSession>('/api/rooms', {});
}

export function joinRoom(code: string): Promise<RoomSession> {
  return request<RoomSession>('/api/rooms/join', { code });
}

export function postSignal(
  session: RoomSession,
  kind: SignalKind,
  payload: Record<string, unknown>,
): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/signal', {
    roomId: session.roomId,
    token: session.token,
    kind,
    payload,
  });
}

export async function pollSignals(session: RoomSession): Promise<SignalItem[]> {
  const query = new URLSearchParams({ roomId: session.roomId, token: session.token });
  const data = await request<{ items: SignalItem[] }>(`/api/signal?${query.toString()}`);
  return Array.isArray(data?.items) ? data.items : [];
}

export function closeRoom(session: RoomSession): void {
  void fetch(`${BASE}/api/rooms/close`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId: session.roomId, token: session.token }),
    keepalive: true,
  }).catch(() => {});
}
