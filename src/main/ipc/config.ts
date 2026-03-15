import { ipcMain } from "electron";
import {
  getConfigForRenderer,
  setConfig,
  setApiKey,
  getApiKey,
} from "../services/config.service";
import type { NiomConfig } from "@/shared/types";

/** Register config-related IPC handlers. */
export function registerConfigIpc(): void {
  ipcMain.handle("config:get", async () => {
    return getConfigForRenderer();
  });

  ipcMain.handle("config:set", async (_event, updates: Partial<NiomConfig>) => {
    setConfig(updates);
  });

  ipcMain.handle("config:setApiKey", async (_event, data: { provider: string; key: string }) => {
    setApiKey(data.provider, data.key);
  });

  ipcMain.handle("config:getApiKey", async (_event, provider: string) => {
    return getApiKey(provider);
  });
}
