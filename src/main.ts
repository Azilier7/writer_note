import { getCurrentWindow } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const STORAGE_SETTINGS = "writer-settings-v2";
const STORAGE_CONTENT = "writer-content-v1";
const STORAGE_DOC_PATH = "writer-document-path-v1";

const TEXT_FILTERS = [
  { name: "文本", extensions: ["txt", "md"] },
  { name: "所有文件", extensions: ["*"] },
];

/** 快捷键：物理键 code + 修饰键，与浏览器 keydown 一致 */
type KeyChord = {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

const defaultShortcutWrite: KeyChord = {
  code: "F2",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
};
const defaultShortcutHide: KeyChord = {
  code: "KeyH",
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
};

type Settings = {
  bgR: number;
  bgG: number;
  bgB: number;
  bgAlphaPct: number;
  textColor: string;
  textAlphaPct: number;
  fontSize: number;
  lineHeightPct: number;
  fontFamily: string;
  alwaysOnTop: boolean;
  /** 仅保留书写区，隐藏顶栏与设置（F2 切换）；窗口阴影与此联动 */
  chromeHidden: boolean;
  panelOpen: boolean;
  shortcutWriteOnly: KeyChord;
  shortcutHideWindow: KeyChord;
};

const defaultSettings: Settings = {
  bgR: 255,
  bgG: 255,
  bgB: 255,
  bgAlphaPct: 100,
  textColor: "#171717",
  textAlphaPct: 100,
  fontSize: 15,
  lineHeightPct: 155,
  fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif",
  alwaysOnTop: false,
  chromeHidden: false,
  panelOpen: false,
  shortcutWriteOnly: { ...defaultShortcutWrite },
  shortcutHideWindow: { ...defaultShortcutHide },
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<Settings> & {
      clickThrough?: boolean;
      decorations?: boolean;
      shadow?: boolean;
      shortcutPanel?: KeyChord;
    };
    const {
      clickThrough: _removed,
      decorations: _dec,
      shadow: _shadow,
      shortcutPanel: _oldPanel,
      ...rest
    } = parsed;
    const merged = { ...defaultSettings, ...rest };
    if (typeof merged.textAlphaPct !== "number" || Number.isNaN(merged.textAlphaPct)) {
      merged.textAlphaPct = defaultSettings.textAlphaPct;
    }
    if (typeof merged.chromeHidden !== "boolean") {
      merged.chromeHidden = defaultSettings.chromeHidden;
    }
    if (merged.chromeHidden) merged.panelOpen = false;
    if (!merged.shortcutWriteOnly) merged.shortcutWriteOnly = { ...defaultShortcutWrite };
    if (!merged.shortcutHideWindow) merged.shortcutHideWindow = { ...defaultShortcutHide };
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(s));
}

function loadContent(): string {
  return localStorage.getItem(STORAGE_CONTENT) ?? "";
}

let saveContentTimer: ReturnType<typeof setTimeout> | null = null;

/** 由 DOMContentLoaded 赋值，供「恢复默认」刷新快捷键显示 */
let syncShortcutLabelsRef: (() => void) | null = null;
function scheduleSaveContent(text: string) {
  if (saveContentTimer) clearTimeout(saveContentTimer);
  saveContentTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_CONTENT, text);
    saveContentTimer = null;
  }, 350);
}

function flushContentToStorage(text: string) {
  if (saveContentTimer) clearTimeout(saveContentTimer);
  saveContentTimer = null;
  localStorage.setItem(STORAGE_CONTENT, text);
}

function loadDocumentPath(): string | null {
  return localStorage.getItem(STORAGE_DOC_PATH);
}

function saveDocumentPath(p: string | null) {
  if (p === null) localStorage.removeItem(STORAGE_DOC_PATH);
  else localStorage.setItem(STORAGE_DOC_PATH, p);
}

function basenamePath(p: string): string {
  const n = p.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : p;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 8) h = h.slice(0, 6);
  const body = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(body, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const x = (n: number) => n.toString(16).padStart(2, "0");
  return `#${x(r)}${x(g)}${x(b)}`;
}

/**
 * 某些键盘（尤其带 Fn / 小键盘复用）在按导航键时 code 可能是 Numpad*，
 * 但 key 会是 End/Home/Page*。这里优先把这些归一化，保证录制和触发一致。
 */
function normalizeCodeFromEvent(e: KeyboardEvent): string {
  const keyToCode: Record<string, string> = {
    End: "End",
    Home: "Home",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Delete: "Delete",
    Del: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
  };
  return keyToCode[e.key] ?? e.code;
}

function chordFromEvent(e: KeyboardEvent): KeyChord {
  return {
    code: normalizeCodeFromEvent(e),
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
  };
}

function chordEquals(a: KeyChord, b: KeyChord): boolean {
  return (
    a.code === b.code &&
    a.ctrlKey === b.ctrlKey &&
    a.shiftKey === b.shiftKey &&
    a.altKey === b.altKey &&
    a.metaKey === b.metaKey
  );
}

function chordMatches(e: KeyboardEvent, c: KeyChord): boolean {
  return chordEquals(chordFromEvent(e), c);
}

function physicalKeyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Space: "Space",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Backslash: "\\",
  };
  return map[code] ?? code;
}

function formatChord(c: KeyChord): string {
  const parts: string[] = [];
  if (c.ctrlKey) parts.push("Ctrl");
  const metaLabel = /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ? "Cmd" : "Win";
  if (c.metaKey) parts.push(metaLabel);
  if (c.shiftKey) parts.push("Shift");
  if (c.altKey) parts.push("Alt");
  parts.push(physicalKeyLabel(c.code));
  return parts.join("+");
}

/**
 * 与 global-hotkey / Tauri global-shortcut 解析一致：修饰键在前，主键在后（与 HotKey::into_string 顺序一致）。
 * 隐藏窗口用全局快捷键注册，隐藏后仍能触发以切回。
 */
function chordToGlobalHotkeyString(c: KeyChord): string {
  const parts: string[] = [];
  if (c.shiftKey) parts.push("shift");
  if (c.ctrlKey) parts.push("control");
  if (c.altKey) parts.push("alt");
  if (c.metaKey) parts.push("super");
  parts.push(c.code);
  return parts.join("+");
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let registeredHideHotkey: string | null = null;
let hideShortcutUsesGlobal = false;

async function syncHideGlobalShortcut(chord: KeyChord): Promise<void> {
  if (!isTauriRuntime()) {
    hideShortcutUsesGlobal = false;
    return;
  }
  const next = chordToGlobalHotkeyString(chord);
  if (registeredHideHotkey === next) {
    hideShortcutUsesGlobal = true;
    return;
  }
  if (registeredHideHotkey) {
    try {
      await unregister(registeredHideHotkey);
    } catch {
      /* ignore */
    }
    registeredHideHotkey = null;
  }
  try {
    await register(next, (event) => {
      if (event.state !== "Pressed") return;
      void toggleWindowHidden();
    });
    registeredHideHotkey = next;
    hideShortcutUsesGlobal = true;
  } catch (e) {
    hideShortcutUsesGlobal = false;
    console.warn("全局隐藏快捷键注册失败，将仅在前台时响应:", e);
  }
}

function applyCss(s: Settings) {
  const root = document.documentElement;
  root.style.setProperty("--bg-r", String(s.bgR));
  root.style.setProperty("--bg-g", String(s.bgG));
  root.style.setProperty("--bg-b", String(s.bgB));
  root.style.setProperty("--bg-a", String(s.bgAlphaPct / 100));
  const { r, g, b } = hexToRgb(s.textColor);
  root.style.setProperty("--text", `rgba(${r},${g},${b},${s.textAlphaPct / 100})`);
  root.style.setProperty("--font-size", `${s.fontSize}px`);
  root.style.setProperty("--line-height", String(s.lineHeightPct / 100));
  root.style.setProperty("--font-stack", s.fontFamily);
}

async function applyWindowChrome(s: Settings) {
  const win = getCurrentWindow();
  document.body.classList.remove("native-frame");
  await win.setDecorations(false);
  await win.setAlwaysOnTop(s.alwaysOnTop);
  await win.setShadow(!s.chromeHidden);
  await win.setTheme("light");
  await win.setIgnoreCursorEvents(false);
}

async function toggleWindowHidden() {
  const win = getCurrentWindow();
  if (await win.isVisible()) {
    await win.hide();
  } else {
    await win.show();
    await win.setFocus();
  }
}

async function saveEditorToFile(editor: HTMLTextAreaElement, saveAs: boolean) {
  if (!isTauriRuntime()) return;
  const text = editor.value;
  try {
    const currentPath = loadDocumentPath();
    let path: string | null = currentPath;
    if (saveAs || !path) {
      const picked = await save({
        title: saveAs ? "另存为" : "保存",
        filters: TEXT_FILTERS,
        defaultPath: currentPath ? basenamePath(currentPath) : "未命名.txt",
      });
      if (!picked) return;
      path = picked;
      saveDocumentPath(path);
    }
    if (!path) return;
    await writeTextFile(path, text);
    flushContentToStorage(text);
  } catch (e) {
    alert(`保存失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function importFromFile(editor: HTMLTextAreaElement) {
  if (!isTauriRuntime()) return;
  if (editor.value.length > 0) {
    if (!confirm("导入将替换当前内容，是否继续？")) return;
  }
  try {
    const selected = await open({
      title: "导入",
      filters: TEXT_FILTERS,
      multiple: false,
    });
    if (selected === null) return;
    const path = typeof selected === "string" ? selected : selected[0];
    const text = await readTextFile(path);
    editor.value = text;
    flushContentToStorage(text);
    saveDocumentPath(path);
  } catch (e) {
    alert(`导入失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

function applyChromeHidden(hidden: boolean, s: Settings) {
  document.body.classList.toggle("write-only", hidden);
  s.chromeHidden = hidden;
  if (hidden) {
    s.panelOpen = false;
    document.getElementById("panel")!.classList.remove("open");
  }
}

function bindPanel(s: Settings, onChange: (next: Settings) => void) {
  const panel = document.getElementById("panel")!;
  const btnPanel = document.getElementById("btn-panel")!;

  const inpBgAlpha = document.getElementById("inp-bg-alpha") as HTMLInputElement;
  const outBgAlpha = document.getElementById("out-bg-alpha")!;
  const inpBgColor = document.getElementById("inp-bg-color") as HTMLInputElement;
  const inpTextColor = document.getElementById("inp-text-color") as HTMLInputElement;
  const inpTextAlpha = document.getElementById("inp-text-alpha") as HTMLInputElement;
  const outTextAlpha = document.getElementById("out-text-alpha")!;
  const inpFontSize = document.getElementById("inp-font-size") as HTMLInputElement;
  const outFontSize = document.getElementById("out-font-size")!;
  const inpLineHeight = document.getElementById("inp-line-height") as HTMLInputElement;
  const outLineHeight = document.getElementById("out-line-height")!;
  const inpFontFamily = document.getElementById("inp-font-family") as HTMLSelectElement;
  const inpAlwaysTop = document.getElementById("inp-always-top") as HTMLInputElement;
  const btnReset = document.getElementById("btn-reset")!;

  function syncForm() {
    inpBgAlpha.value = String(s.bgAlphaPct);
    outBgAlpha.textContent = `${s.bgAlphaPct}%`;
    inpBgColor.value = rgbToHex(s.bgR, s.bgG, s.bgB);
    const tc = hexToRgb(s.textColor);
    inpTextColor.value = rgbToHex(tc.r, tc.g, tc.b);
    inpTextAlpha.value = String(s.textAlphaPct);
    outTextAlpha.textContent = `${s.textAlphaPct}%`;
    outFontSize.textContent = `${s.fontSize}px`;
    inpLineHeight.value = String(s.lineHeightPct);
    outLineHeight.textContent = (s.lineHeightPct / 100).toFixed(2);
    inpFontFamily.value = s.fontFamily;
    inpAlwaysTop.checked = s.alwaysOnTop;
    panel.classList.toggle("open", s.panelOpen);
  }

  function togglePanel() {
    s.panelOpen = !s.panelOpen;
    panel.classList.toggle("open", s.panelOpen);
    saveSettings(s);
  }

  btnPanel.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });
  inpBgAlpha.addEventListener("input", () => {
    s.bgAlphaPct = Number(inpBgAlpha.value);
    outBgAlpha.textContent = `${s.bgAlphaPct}%`;
    applyCss(s);
    onChange(s);
  });

  inpBgColor.addEventListener("input", () => {
    const { r, g, b } = hexToRgb(inpBgColor.value);
    s.bgR = r;
    s.bgG = g;
    s.bgB = b;
    applyCss(s);
    onChange(s);
  });

  inpTextColor.addEventListener("input", () => {
    s.textColor = inpTextColor.value;
    applyCss(s);
    onChange(s);
  });

  inpTextAlpha.addEventListener("input", () => {
    s.textAlphaPct = Number(inpTextAlpha.value);
    outTextAlpha.textContent = `${s.textAlphaPct}%`;
    applyCss(s);
    onChange(s);
  });

  inpFontSize.addEventListener("input", () => {
    s.fontSize = Number(inpFontSize.value);
    outFontSize.textContent = `${s.fontSize}px`;
    applyCss(s);
    onChange(s);
  });

  inpLineHeight.addEventListener("input", () => {
    s.lineHeightPct = Number(inpLineHeight.value);
    outLineHeight.textContent = (s.lineHeightPct / 100).toFixed(2);
    applyCss(s);
    onChange(s);
  });

  inpFontFamily.addEventListener("change", () => {
    s.fontFamily = inpFontFamily.value;
    applyCss(s);
    onChange(s);
  });

  inpAlwaysTop.addEventListener("change", async () => {
    s.alwaysOnTop = inpAlwaysTop.checked;
    await getCurrentWindow().setAlwaysOnTop(s.alwaysOnTop);
    onChange(s);
  });

  btnReset.addEventListener("click", () => {
    Object.assign(s, defaultSettings);
    s.shortcutWriteOnly = { ...defaultShortcutWrite };
    s.shortcutHideWindow = { ...defaultShortcutHide };
    s.panelOpen = true;
    syncForm();
    applyCss(s);
    void applyWindowChrome(s);
    syncShortcutLabelsRef?.();
    void syncHideGlobalShortcut(s.shortcutHideWindow);
    onChange(s);
  });

  syncForm();
  return { syncForm };
}

async function initTray() {
  const win = getCurrentWindow();
  const menu = await Menu.new({
    items: [
      {
        id: "show",
        text: "显示主窗口",
        action: async () => {
          await win.show();
          await win.setFocus();
        },
      },
      {
        id: "quit",
        text: "退出",
        action: async () => {
          await win.close();
        },
      },
    ],
  });

  const icon = await defaultWindowIcon();
  await TrayIcon.new({
    icon: icon ?? undefined,
    tooltip: "writer",
    menu,
    showMenuOnLeftClick: true,
    action: (event) => {
      if (event.type === "DoubleClick" && event.button === "Left") {
        void win.show().then(() => win.setFocus());
      }
    },
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  const settings = loadSettings();
  const editor = document.getElementById("editor") as HTMLTextAreaElement;

  applyCss(settings);
  editor.value = loadContent();

  const persist = (next: Settings) => saveSettings(next);

  const { syncForm } = bindPanel(settings, persist);
  await applyWindowChrome(settings);
  applyChromeHidden(settings.chromeHidden, settings);
  saveSettings(settings);
  syncForm();
  await syncHideGlobalShortcut(settings.shortcutHideWindow);

  const btnImport = document.getElementById("btn-import");
  const btnSave = document.getElementById("btn-save");
  if (!isTauriRuntime()) {
    btnImport?.classList.add("hidden");
    btnSave?.classList.add("hidden");
  } else {
    btnImport?.addEventListener("click", () => void importFromFile(editor));
    btnSave?.addEventListener("click", () => void saveEditorToFile(editor, false));
  }

  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 5 : -5;
        settings.bgAlphaPct = clamp(settings.bgAlphaPct + delta, 0, 100);
        applyCss(settings);
        saveSettings(settings);
        syncForm();
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 5 : -5;
        settings.textAlphaPct = clamp(settings.textAlphaPct + delta, 0, 100);
        applyCss(settings);
        saveSettings(settings);
        syncForm();
      }
    },
    { passive: false, capture: true },
  );

  editor.addEventListener("input", () => scheduleSaveContent(editor.value));

  document.getElementById("btn-min")!.addEventListener("click", () => {
    void getCurrentWindow().minimize();
  });
  document.getElementById("btn-hide")!.addEventListener("click", () => {
    void toggleWindowHidden();
  });
  document.getElementById("btn-close")!.addEventListener("click", () => {
    void getCurrentWindow().close();
  });

  let recordingSlot: "write" | "hide" | null = null;

  const btnRecWrite = document.getElementById("btn-rec-write")!;
  const btnRecHide = document.getElementById("btn-rec-hide")!;
  const dispWrite = document.getElementById("disp-shortcut-write")!;
  const dispHide = document.getElementById("disp-shortcut-hide")!;

  function updateRecButtons() {
    btnRecWrite.classList.toggle("recording", recordingSlot === "write");
    btnRecHide.classList.toggle("recording", recordingSlot === "hide");
    document.body.classList.toggle("shortcut-recording", recordingSlot !== null);
  }

  function syncShortcutLabels() {
    dispWrite.textContent = formatChord(settings.shortcutWriteOnly);
    dispHide.textContent = formatChord(settings.shortcutHideWindow);
  }

  function toggleRecording(slot: "write" | "hide") {
    recordingSlot = recordingSlot === slot ? null : slot;
    updateRecButtons();
  }

  btnRecWrite.addEventListener("click", () => toggleRecording("write"));
  btnRecHide.addEventListener("click", () => toggleRecording("hide"));

  syncShortcutLabels();
  syncShortcutLabelsRef = syncShortcutLabels;

  document.addEventListener(
    "keydown",
    (e) => {
      if (recordingSlot) {
        if (e.key === "Escape") {
          e.preventDefault();
          recordingSlot = null;
          updateRecButtons();
          return;
        }
        if (e.repeat) return;
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        const chord = chordFromEvent(e);
        const other =
          recordingSlot === "write" ? settings.shortcutHideWindow : settings.shortcutWriteOnly;
        if (chordEquals(chord, other)) {
          recordingSlot = null;
          updateRecButtons();
          alert("该组合已被另一项占用");
          return;
        }

        const wasHideRecording = recordingSlot === "hide";
        if (recordingSlot === "write") settings.shortcutWriteOnly = chord;
        else settings.shortcutHideWindow = chord;

        recordingSlot = null;
        updateRecButtons();
        saveSettings(settings);
        syncShortcutLabels();
        syncForm();
        if (wasHideRecording) void syncHideGlobalShortcut(settings.shortcutHideWindow);
        return;
      }

      if (!e.repeat && (e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === "KeyS") {
          e.preventDefault();
          void saveEditorToFile(editor, e.shiftKey);
          return;
        }
        if (e.code === "KeyO") {
          e.preventDefault();
          void importFromFile(editor);
          return;
        }
      }

      if (chordMatches(e, settings.shortcutWriteOnly)) {
        e.preventDefault();
        applyChromeHidden(!settings.chromeHidden, settings);
        void getCurrentWindow().setShadow(!settings.chromeHidden);
        saveSettings(settings);
        syncForm();
        return;
      }

      if (
        !hideShortcutUsesGlobal &&
        chordMatches(e, settings.shortcutHideWindow)
      ) {
        e.preventDefault();
        void toggleWindowHidden();
        return;
      }
    },
    true,
  );

  try {
    await initTray();
  } catch (e) {
    console.warn("Tray init failed:", e);
  }
});
