/**
 * systemInfo Tool
 *
 * Returns information about the user's system — OS, platform,
 * architecture, hostname, shell, and resource usage.
 *
 * Pack: OS (primitive)
 * Approval: auto
 */

import { tool } from "ai";
import { z } from "zod";
import * as os from "os";
import type { SkillResult } from "@/shared/skill-types";
import { success, timed } from "./helpers";

/** Data returned by systemInfo. */
interface SystemInfoData {
  platform: string;
  os: string;
  arch: string;
  hostname: string;
  username: string;
  homeDir: string;
  shell: string;
  nodeVersion: string;
  cpus: number;
  totalMemory: string;
  freeMemory: string;
  uptime: string;
}

export const systemInfoTool = tool({
  description: "Get system information including OS, platform, architecture, hostname, shell, and memory usage.",
  inputSchema: z.object({
    _unused: z.string().optional().describe("No input needed."),
  }),
  execute: async (): Promise<SkillResult<SystemInfoData>> => {
    return timed(async () => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const uptimeSeconds = os.uptime();

      const data: SystemInfoData = {
        platform: os.platform(),
        os: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        hostname: os.hostname(),
        username: os.userInfo().username,
        homeDir: os.homedir(),
        shell: os.userInfo().shell || process.env.SHELL || "unknown",
        nodeVersion: process.version,
        cpus: os.cpus().length,
        totalMemory: formatMemory(totalMem),
        freeMemory: formatMemory(freeMem),
        uptime: formatUptime(uptimeSeconds),
      };

      return success<SystemInfoData>(
        data,
        `System: ${data.os} (${data.arch}), ${data.cpus} CPUs, ${data.totalMemory} RAM (${data.freeMemory} free), up ${data.uptime}.`,
        { domain: "os" },
      );
    });
  },
});

/** Format bytes into human-readable memory size. */
function formatMemory(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}MB`;
}

/** Format seconds into human-readable uptime. */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(" ") || "< 1m";
}
