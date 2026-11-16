const KEY = "saltline.keys.v1";

export const KEY_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "jump",
  "sprint",
  "crouch",
  "reload",
  "pause",
];

export const DEFAULT_KEY_BINDINGS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  sprint: "ShiftLeft",
  crouch: "KeyC",
  reload: "KeyR",
  pause: "Escape",
};

const VALID_CODE = /^[A-Za-z0-9]{1,32}$/;

export function loadKeyBindings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    const bindings = {};
    if (!parsed || typeof parsed !== "object") return bindings;
    for (const action of KEY_ACTIONS) {
      const code = parsed[action];
      if (typeof code === "string" && VALID_CODE.test(code)) bindings[action] = code;
    }
    return bindings;
  } catch {
    return {};
  }
}

export function saveKeyBinding(action, code) {
  if (!KEY_ACTIONS.includes(action) || typeof code !== "string" || !VALID_CODE.test(code)) {
    return loadKeyBindings();
  }
  const bindings = loadKeyBindings();
  if (code === DEFAULT_KEY_BINDINGS[action]) delete bindings[action];
  else bindings[action] = code;
  try {
    localStorage.setItem(KEY, JSON.stringify(bindings));
  } catch {
    // storage unavailable; the binding still applies for this session
  }
  return bindings;
}

export function resetKeyBindings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function currentKeyBinding(action) {
  const custom = loadKeyBindings();
  return custom[action] || DEFAULT_KEY_BINDINGS[action] || "";
}

const KEY_LABELS = {
  Space: "SPACE",
  Escape: "ESC",
  Enter: "ENTER",
  NumpadEnter: "NUM ENTER",
  Tab: "TAB",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ShiftLeft: "SHIFT",
  ShiftRight: "SHIFT",
  ControlLeft: "CTRL",
  ControlRight: "CTRL",
  AltLeft: "ALT",
  AltRight: "ALT",
  CapsLock: "CAPS",
  Backspace: "BACKSPACE",
  Delete: "DELETE",
  Insert: "INSERT",
  Home: "HOME",
  End: "END",
  PageUp: "PAGE UP",
  PageDown: "PAGE DOWN",
};

export function formatKey(code) {
  if (!code) return "—";
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6).toUpperCase();
  if (code.startsWith("F") && /^\d+$/.test(code.slice(1))) return code;
  return code.toUpperCase();
}
