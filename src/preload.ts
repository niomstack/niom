import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("niom", {
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    platform: () => ipcRenderer.invoke("window:platform"),
  },
});
