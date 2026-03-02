import { tool } from "ai";
import { z } from "zod";
import { cpus, totalmem, freemem, platform, arch, hostname, uptime, homedir, userInfo } from "os";
import { execSync } from "child_process";

export const systemTools = {
    systemInfo: tool({
        description: "Get system information — CPU, memory, disk, platform, uptime. Use when the user asks about their system status or resource usage.",
        inputSchema: z.object({
            detail: z.enum(["summary", "full"]).optional().describe("Level of detail (default: summary)"),
        }),
        execute: async ({ detail }) => {
            const cpuInfo = cpus();
            const totalMem = totalmem();
            const freeMem = freemem();

            const info: any = {
                platform: platform(),
                arch: arch(),
                hostname: hostname(),
                user: userInfo().username,
                home: homedir(),
                uptime_hours: Math.round(uptime() / 3600 * 10) / 10,
                cpu: {
                    model: cpuInfo[0]?.model || "unknown",
                    cores: cpuInfo.length,
                },
                memory: {
                    total_gb: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10,
                    free_gb: Math.round(freeMem / 1024 / 1024 / 1024 * 10) / 10,
                    used_percent: Math.round((1 - freeMem / totalMem) * 100),
                },
            };

            if (detail === "full") {
                // Add disk info (Windows)
                try {
                    if (platform() === "win32") {
                        const diskOutput = execSync("wmic logicaldisk get size,freespace,caption", {
                            encoding: "utf-8",
                            timeout: 5000,
                        });
                        info.disks = diskOutput.trim();
                    } else {
                        const diskOutput = execSync("df -h /", {
                            encoding: "utf-8",
                            timeout: 5000,
                        });
                        info.disks = diskOutput.trim();
                    }
                } catch {
                    info.disks = "unavailable";
                }

                // Node.js version
                info.node_version = process.version;
                info.env_path = process.env.PATH?.split(platform() === "win32" ? ";" : ":").slice(0, 5);
            }

            return info;
        },
    }),
};
