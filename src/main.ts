import '@fontsource/exo-2/700.css';
import './fps/fonts.css';
import './fps/ui.css';
import './styles.css';
import { PeerLink } from './net/peer';
import { applyTranslations, getLang, setLang, t } from './i18n.js';
import { readRangeBest } from './range-store.js';
import {
  closeRoom,
  createRoom,
  joinRoom,
  pollSignals,
  type RoomSession,
} from './net/signaling';

type BootApi = {
  startWorld: () => Promise<unknown>;
  startMatch: (options?: { link?: PeerLink; role?: string; mode?: string; rangeMode?: string }) => Promise<unknown>;
};

type LobbyView = 'main' | 'create' | 'join' | 'range' | 'settings';

interface PlayerSettings {
  quality: string;
  sens: number;
  invertY: boolean;
  volume: number;
  fov: number;
}

const SETTINGS_KEY = 'saltline.settings.v1';
const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high', 'ultra'];
const DEFAULT_SETTINGS: PlayerSettings = {
  quality: 'auto',
  sens: 1,
  invertY: false,
  volume: 0.8,
  fov: 74,
};

const $ = <T extends Element>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing_element:${id}`);
  return element as unknown as T;
};

const lobby = $<HTMLDivElement>('lobby');
const lobbyInner = document.querySelector('.lb-inner');
const waitScreen = $<HTMLDivElement>('wait');
const loading = $<HTMLDivElement>('loading');
const bootElement = document.getElementById('boot');

const menuMain = $<HTMLDivElement>('menu-main');
const createView = $<HTMLElement>('create-view');
const joinView = $<HTMLElement>('join-view');
const rangeView = $<HTMLElement>('range-view');
const settingsView = $<HTMLElement>('settings-view');
const createButton = $<HTMLButtonElement>('create-room');
const createConfirmButton = $<HTMLButtonElement>('create-confirm');
const createBackButton = $<HTMLButtonElement>('create-back');
const openJoinButton = $<HTMLButtonElement>('open-join');
const openRangeButton = $<HTMLButtonElement>('open-range');
const openSettingsButton = $<HTMLButtonElement>('open-settings');
const joinBackButton = $<HTMLButtonElement>('join-back');
const rangeBackButton = $<HTMLButtonElement>('range-back');
const settingsBackButton = $<HTMLButtonElement>('settings-back');
const startBotsButton = $<HTMLButtonElement>('start-bots');
const startTargetsButton = $<HTMLButtonElement>('start-targets');
const bestBots = $<HTMLElement>('best-bots');
const bestTargets = $<HTMLElement>('best-targets');
const joinForm = $<HTMLFormElement>('join-form');
const roomInput = $<HTMLInputElement>('room-code');
const menuError = $<HTMLParagraphElement>('menu-error');
const joinError = $<HTMLParagraphElement>('join-error');
const waitCode = $<HTMLDivElement>('room-code-display');
const waitStatus = $<HTMLParagraphElement>('wait-status');
const copyButton = $<HTMLButtonElement>('copy-link');
const cancelRoomButton = $<HTMLButtonElement>('cancel-room');
const loadingText = $<HTMLParagraphElement>('loading-text');
const loadingHint = $<HTMLParagraphElement>('loading-hint');
const loadingCancel = $<HTMLButtonElement>('loading-cancel');
const toasts = $<HTMLDivElement>('toasts');

const qualitySeg = $<HTMLDivElement>('set-quality');
const langSeg = $<HTMLDivElement>('set-lang');
const sensInput = $<HTMLInputElement>('set-sens');
const sensOutput = $<HTMLOutputElement>('out-sens');
const volumeInput = $<HTMLInputElement>('set-vol');
const volumeOutput = $<HTMLOutputElement>('out-vol');
const fovInput = $<HTMLInputElement>('set-fov');
const fovOutput = $<HTMLOutputElement>('out-fov');
const invertButton = $<HTMLButtonElement>('set-invert');

let session: RoomSession | null = null;
let link: PeerLink | null = null;
let runId = 0;
let busy = false;
let worldReady = false;
let bootApi: BootApi | null = null;
let startingMatch = false;
let view: LobbyView = 'main';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  if (raw === 'timeout') return t('error.timeout');
  if (raw === 'connection_failed') return t('error.connection');
  if (raw === 'peer_left') return t('error.peerLeft');
  return raw || t('error.generic');
}

function loadSettings(): PlayerSettings {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return settings;
    if (QUALITY_OPTIONS.includes(parsed.quality)) settings.quality = parsed.quality;
    if (Number.isFinite(parsed.sens)) settings.sens = clamp(Number(parsed.sens), 0.2, 3);
    settings.invertY = Boolean(parsed.invertY);
    if (Number.isFinite(parsed.volume)) settings.volume = clamp(Number(parsed.volume), 0, 1);
    if (Number.isFinite(parsed.fov)) settings.fov = clamp(Math.round(Number(parsed.fov)), 60, 95);
  } catch {
    return settings;
  }
  return settings;
}

let settings = loadSettings();

function persistSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage may be unavailable; the match will simply use defaults
  }
}

function renderSettings(): void {
  for (const button of qualitySeg.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.q === settings.quality));
  }
  sensInput.value = String(settings.sens);
  sensOutput.textContent = `${settings.sens.toFixed(2)}×`;
  volumeInput.value = String(Math.round(settings.volume * 100));
  volumeOutput.textContent = `${Math.round(settings.volume * 100)}%`;
  fovInput.value = String(settings.fov);
  fovOutput.textContent = `${settings.fov}°`;
  invertButton.setAttribute('aria-pressed', String(settings.invertY));
  const label = invertButton.querySelector('span');
  if (label) label.textContent = settings.invertY ? 'On' : 'Off';
  for (const button of langSeg.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  }
}

function applyLanguage(): void {
  applyTranslations(document);
  renderSettings();
}

function showToast(text: string): void {
  const item = document.createElement('span');
  item.textContent = text;
  toasts.appendChild(item);
  window.setTimeout(() => item.remove(), 4200);
}

function setBusy(value: boolean): void {
  busy = value;
  createButton.disabled = value;
  createConfirmButton.disabled = value;
  openJoinButton.disabled = value;
  openRangeButton.disabled = value;
  openSettingsButton.disabled = value;
  startBotsButton.disabled = value;
  startTargetsButton.disabled = value;
  const submit = joinForm.querySelector('button[type="submit"]');
  if (submit instanceof HTMLButtonElement) submit.disabled = value;
}

function resetPanelScroll(container: HTMLElement): void {
  for (const pane of container.querySelectorAll<HTMLElement>('.panel-b')) {
    pane.scrollTop = 0;
  }
}

function showView(next: LobbyView): void {
  view = next;
  menuMain.hidden = next !== 'main';
  createView.hidden = next !== 'create';
  joinView.hidden = next !== 'join';
  rangeView.hidden = next !== 'range';
  settingsView.hidden = next !== 'settings';
  lobbyInner?.classList.toggle('is-panel', next !== 'main');
  if (next === 'join') {
    joinError.hidden = true;
    joinError.textContent = '';
    roomInput.focus({ preventScroll: true });
  }
  if (next === 'range') {
    resetPanelScroll(rangeView);
    const best = readRangeBest();
    bestBots.textContent = String(best.bots);
    bestTargets.textContent = String(best.targets);
    lobby.scrollTop = 0;
  }
  if (next === 'create') resetPanelScroll(createView);
  if (next === 'join') resetPanelScroll(joinView);
  if (next === 'settings') {
    lobby.scrollTop = 0;
    resetPanelScroll(settingsView);
    renderSettings();
  }
}

function showMenu(error = ''): void {
  lobby.hidden = false;
  waitScreen.hidden = true;
  loading.hidden = true;
  menuError.hidden = !error;
  menuError.textContent = error;
  joinError.hidden = true;
  showView('main');
  setBusy(false);
}

function showJoinFailure(message: string): void {
  lobby.hidden = false;
  waitScreen.hidden = true;
  loading.hidden = true;
  showView('join');
  joinError.hidden = false;
  joinError.textContent = message;
  setBusy(false);
}

function showWait(code: string): void {
  lobby.hidden = true;
  waitScreen.hidden = false;
  loading.hidden = true;
  waitCode.textContent = code;
  waitStatus.textContent = t('wait.status');
}

function showLoading(text: string, cancellable = true): void {
  lobby.hidden = true;
  waitScreen.hidden = true;
  loading.hidden = false;
  loadingText.textContent = text;
  loadingHint.textContent = t('loading.hint');
  loadingCancel.hidden = !cancellable;
  loadingCancel.disabled = !cancellable;
}

function cleanup(): void {
  link?.close();
  link = null;
  if (session) {
    closeRoom(session);
    session = null;
  }
}

function leaveRoom(message?: string): void {
  runId += 1;
  cleanup();
  showMenu(message);
}

async function loadWorld(): Promise<void> {
  if (worldReady) return;
  if (bootElement) bootElement.hidden = false;
  try {
    bootApi = (await import('./fps/pvp/boot.js')) as unknown as BootApi;
    await bootApi.startWorld();
    worldReady = true;
    lobby.hidden = false;
    setBusy(false);
    applyInvite();
  } catch (error) {
    if (bootElement) bootElement.hidden = true;
    lobby.hidden = false;
    setBusy(true);
    menuError.hidden = false;
    menuError.textContent = t('error.worldLoad', { msg: describeError(error) });
    showView('main');
  }
}

async function startMatch(peer: PeerLink, active: RoomSession): Promise<void> {
  if (!bootApi || !worldReady) throw new Error(t('error.worldNotReady'));
  startingMatch = true;
  showLoading(t('loading.deploy'), false);
  peer.onDisconnect = (reason: string) => {
    if (!startingMatch) return;
    showToast(reason);
    location.reload();
  };

  try {
    await bootApi.startMatch({ link: peer, role: active.role });
    startingMatch = false;
    loading.hidden = true;
  } catch (error) {
    startingMatch = false;
    showToast(t('toast.matchFailed', { msg: describeError(error) }));
    location.reload();
  }
}

async function startRange(rangeMode: 'bots' | 'targets'): Promise<void> {
  if (busy || !worldReady || !bootApi) return;
  setBusy(true);
  showLoading(t('loading.range'), false);
  try {
    await bootApi.startMatch({ mode: 'range', rangeMode });
    loading.hidden = true;
  } catch (error) {
    showToast(t('toast.matchFailed', { msg: describeError(error) }));
    location.reload();
  }
}

async function connectPeer(active: RoomSession): Promise<void> {
  showLoading(t('loading.connect'));
  const peer = new PeerLink(active);
  link = peer;
  const current = runId;

  peer.onStatus = (text) => {
    if (runId === current && !startingMatch) loadingText.textContent = text;
  };

  const hintTimer = window.setTimeout(() => {
    if (runId === current) {
      loadingHint.textContent = t('loading.slow');
    }
  }, 12_000);

  try {
    await peer.connect();
  } catch (error) {
    window.clearTimeout(hintTimer);
    if (runId !== current) return;
    cleanup();
    showMenu(describeError(error));
    return;
  }
  window.clearTimeout(hintTimer);

  if (runId !== current) {
    peer.close();
    return;
  }

  await sleep(60);
  await startMatch(peer, active);
}

async function hostFlow(): Promise<void> {
  if (busy || !worldReady) return;
  setBusy(true);
  menuError.hidden = true;
  const current = ++runId;

  let active: RoomSession;
  try {
    active = await createRoom();
  } catch (error) {
    if (runId === current) showMenu(describeError(error));
    return;
  }

  if (runId !== current) {
    closeRoom(active);
    return;
  }

  session = active;
  showWait(active.code);

  while (runId === current) {
    let joined = false;
    try {
      const signals = await pollSignals(active);
      joined = signals.some((signal) => signal.kind === 'join');
    } catch {
      // transient polling failure; retry on the next tick
    }
    if (joined) break;
    await sleep(900);
  }

  if (runId !== current) return;
  waitStatus.textContent = t('wait.joined');
  await connectPeer(active);
}

async function guestFlow(code: string): Promise<void> {
  if (busy || !worldReady) return;
  setBusy(true);
  joinError.hidden = true;
  const current = ++runId;

  let active: RoomSession;
  try {
    active = await joinRoom(code);
  } catch (error) {
    if (runId === current) {
      runId += 1;
      showJoinFailure(describeError(error));
    }
    return;
  }

  if (runId !== current) {
    closeRoom(active);
    return;
  }

  session = active;
  await connectPeer(active);
}

createButton.addEventListener('click', () => showView('create'));
createConfirmButton.addEventListener('click', () => {
  void hostFlow();
});
createBackButton.addEventListener('click', () => showView('main'));

const settingsTabs = [...settingsView.querySelectorAll<HTMLButtonElement>('.tab')];
const settingsPanes = [...settingsView.querySelectorAll<HTMLElement>('.panel-b')];

for (const tab of settingsTabs) {
  tab.addEventListener('click', () => {
    for (const other of settingsTabs) {
      other.setAttribute('aria-selected', String(other === tab));
    }
    for (const pane of settingsPanes) {
      pane.hidden = pane.dataset.pane !== tab.dataset.tab;
    }
  });
}

openJoinButton.addEventListener('click', () => showView('join'));
openRangeButton.addEventListener('click', () => showView('range'));
openSettingsButton.addEventListener('click', () => showView('settings'));
joinBackButton.addEventListener('click', () => showView('main'));
rangeBackButton.addEventListener('click', () => showView('main'));
settingsBackButton.addEventListener('click', () => showView('main'));
startBotsButton.addEventListener('click', () => {
  void startRange('bots');
});
startTargetsButton.addEventListener('click', () => {
  void startRange('targets');
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = roomInput.value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    joinError.hidden = false;
    joinError.textContent = t('error.invalidCode');
    return;
  }
  void guestFlow(code);
});

roomInput.addEventListener('input', () => {
  roomInput.value = roomInput.value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 6);
});

langSeg.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || !button.dataset.lang) return;
  setLang(button.dataset.lang);
  applyLanguage();
});

qualitySeg.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || !button.dataset.q) return;
  settings.quality = button.dataset.q;
  renderSettings();
  persistSettings();
});

sensInput.addEventListener('input', () => {
  settings.sens = clamp(Number(sensInput.value) || 1, 0.2, 3);
  renderSettings();
  persistSettings();
});

volumeInput.addEventListener('input', () => {
  settings.volume = clamp((Number(volumeInput.value) || 0) / 100, 0, 1);
  renderSettings();
  persistSettings();
});

fovInput.addEventListener('input', () => {
  settings.fov = clamp(Math.round(Number(fovInput.value) || 74), 60, 95);
  renderSettings();
  persistSettings();
});

invertButton.addEventListener('click', () => {
  settings.invertY = !settings.invertY;
  renderSettings();
  persistSettings();
});

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Escape') return;
  if (lobby.hidden || view === 'main') return;
  showView('main');
});

copyButton.addEventListener('click', async () => {
  if (!session) return;
  const url = `${location.origin}${location.pathname}?room=${session.code}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast(t('toast.inviteCopied'));
  } catch {
    showToast(t('toast.inviteLink', { url }));
  }
});

cancelRoomButton.addEventListener('click', () => leaveRoom());
loadingCancel.addEventListener('click', () => leaveRoom());

window.addEventListener('beforeunload', () => {
  cleanup();
});

const query = new URLSearchParams(location.search);
const invite = (query.get('room') ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);

function applyInvite(): void {
  if (invite.length !== 6) return;
  roomInput.value = invite;
  showView('join');
  showToast(t('toast.invitePrefilled', { code: invite }));
}

applyLanguage();
void loadWorld();
