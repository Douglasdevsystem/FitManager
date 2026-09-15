// Ambient types for the Window Management API (Chrome/Edge 100+), which
// isn't part of TypeScript's default lib.dom.d.ts yet. Used by the Câmera
// screen to detect and position a window on a second monitor — the
// browser-native equivalent of Electron's screen.getAllDisplays() +
// BrowserWindow, since this panel is a plain web app, not an Electron app.
// All usage is guarded with `"getScreenDetails" in window` at the call site,
// so this being undefined in unsupported browsers is expected and handled.
export {};

interface ScreenDetailed extends Screen {
  availLeft: number;
  availTop: number;
  left: number;
  top: number;
  isPrimary: boolean;
  isInternal: boolean;
  devicePixelRatio: number;
  label: string;
}

interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>;
  }
}
