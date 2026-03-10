export interface NiomAPI {
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    platform: () => Promise<string>;
  };
}

declare global {
  interface Window {
    niom: NiomAPI;
  }
}
