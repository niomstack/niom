/**
 * Computer Use Tools — see and interact with any application on the desktop.
 *
 * This is NIOM's key differentiator: the ability to control the entire
 * desktop GUI, not just files and shell commands. Combined with the
 * agent engine, background tasks, and ambient awareness, this makes
 * NIOM the only local-first agent with full computer use capabilities.
 *
 * Tools:
 *   - screenshot      → capture entire screen or specific window
 *   - mouseClick      → click at coordinates (left, right, double)
 *   - mouseMove       → move cursor to coordinates
 *   - typeText         → type text via keyboard
 *   - pressKey         → press key combos (Ctrl+C, Enter, etc.)
 *   - scroll           → scroll at a position
 *   - getActiveWindow → get info about the currently focused window
 *
 * Architecture:
 *   - Screenshots captured via PowerShell (.NET System.Drawing) or platform-native APIs
 *   - Mouse/keyboard via PowerShell SendKeys / nircmd on Windows
 *   - Vision analysis happens in the agent via multi-modal model (screenshot → tool call planning)
 *   - All actions are logged and auditable
 */

import { tool } from "ai";
import { z } from "zod";
import { execSync, exec } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDataDir } from "../config.js";

// ── Screenshot Directory ──

function getScreenshotDir(): string {
    const dir = join(getDataDir(), "screenshots");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

// ── Platform Utilities ──

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

/**
 * Run a command and return stdout as a string.
 */
function run(cmd: string, options?: { timeout?: number }): string {
    try {
        return execSync(cmd, {
            encoding: "utf-8",
            timeout: options?.timeout ?? 10000,
            windowsHide: true,
        }).trim();
    } catch (err: any) {
        throw new Error(`Command failed: ${err.message}`);
    }
}

/**
 * Run a PowerShell command (Windows only).
 */
function ps(script: string): string {
    return run(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 15000 });
}

// ── Screenshot Implementation ──

/**
 * Capture a screenshot and return the file path.
 * Uses platform-native methods for best quality.
 */
function captureScreenshot(region?: { x: number; y: number; width: number; height: number }): string {
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = join(getScreenshotDir(), filename);

    if (IS_WINDOWS) {
        // Use PowerShell + .NET System.Drawing for screen capture
        const script = region
            ? `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save('${filepath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`.trim()
            : `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()
$bmp.Save('${filepath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`.trim();

        run(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`, { timeout: 15000 });
    } else if (IS_MAC) {
        if (region) {
            run(`screencapture -R${region.x},${region.y},${region.width},${region.height} "${filepath}"`);
        } else {
            run(`screencapture "${filepath}"`);
        }
    } else {
        // Linux
        if (region) {
            run(`import -window root -crop ${region.width}x${region.height}+${region.x}+${region.y} "${filepath}"`);
        } else {
            run(`import -window root "${filepath}"`);
        }
    }

    if (!existsSync(filepath)) {
        throw new Error("Screenshot capture failed — file not created");
    }

    return filepath;
}

// ── Mouse/Keyboard Implementation (Windows) ──

/**
 * Move mouse to absolute screen coordinates.
 */
function moveMouse(x: number, y: number): void {
    if (IS_WINDOWS) {
        ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
'@
[MouseOps]::SetCursorPos(${x}, ${y})
`);
    } else if (IS_MAC) {
        run(`cliclick m:${x},${y}`);
    } else {
        run(`xdotool mousemove ${x} ${y}`);
    }
}

/**
 * Send a mouse click event at current position or specified coordinates.
 */
function sendClick(x: number, y: number, button: "left" | "right" | "double"): void {
    moveMouse(x, y);

    if (IS_WINDOWS) {
        const eventDown = button === "right" ? "0x0008" : "0x0002"; // RIGHTDOWN : LEFTDOWN
        const eventUp = button === "right" ? "0x0010" : "0x0004";   // RIGHTUP : LEFTUP

        if (button === "double") {
            ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseClick {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
'@
[MouseClick]::mouse_event(0x0002, 0, 0, 0, 0)
[MouseClick]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[MouseClick]::mouse_event(0x0002, 0, 0, 0, 0)
[MouseClick]::mouse_event(0x0004, 0, 0, 0, 0)
`);
        } else {
            ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseClick {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
'@
[MouseClick]::mouse_event(${eventDown}, 0, 0, 0, 0)
[MouseClick]::mouse_event(${eventUp}, 0, 0, 0, 0)
`);
        }
    } else if (IS_MAC) {
        const clickType = button === "right" ? "rc" : button === "double" ? "dc" : "c";
        run(`cliclick ${clickType}:${x},${y}`);
    } else {
        const btn = button === "right" ? "3" : "1";
        if (button === "double") {
            run(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
        } else {
            run(`xdotool mousemove ${x} ${y} click ${btn}`);
        }
    }
}

/**
 * Type text as keyboard input.
 */
function sendText(text: string): void {
    if (IS_WINDOWS) {
        // Use .NET SendKeys for text typing
        ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, "{$&}")}')
`);
    } else if (IS_MAC) {
        run(`cliclick t:"${text.replace(/"/g, '\\"')}"`);
    } else {
        run(`xdotool type -- "${text.replace(/"/g, '\\"')}"`);
    }
}

/**
 * Press key combinations (Ctrl+C, Alt+Tab, Enter, etc.)
 */
function sendKeyCombo(keys: string): void {
    if (IS_WINDOWS) {
        // Map common key names to SendKeys format
        const keyMap: Record<string, string> = {
            enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}",
            escape: "{ESC}", esc: "{ESC}", space: " ",
            backspace: "{BS}", delete: "{DEL}", del: "{DEL}",
            up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
            home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
            f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}",
            f5: "{F5}", f6: "{F6}", f7: "{F7}", f8: "{F8}",
            f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
        };

        // Parse combo like "ctrl+c" → "^c" for SendKeys
        const parts = keys.toLowerCase().split("+").map(k => k.trim());
        let sendKeysStr = "";
        let modifiers = "";

        for (const part of parts) {
            if (part === "ctrl" || part === "control") modifiers += "^";
            else if (part === "alt") modifiers += "%";
            else if (part === "shift") modifiers += "+";
            else if (part === "win" || part === "meta" || part === "super") modifiers += "^{ESC}"; // Windows key workaround
            else if (keyMap[part]) sendKeysStr += keyMap[part];
            else sendKeysStr += part;
        }

        ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${modifiers}${sendKeysStr}')
`);
    } else if (IS_MAC) {
        // Map to cliclick key codes
        const parts = keys.toLowerCase().split("+").map(k => k.trim());
        const modifiers: string[] = [];
        let key = "";

        for (const part of parts) {
            if (part === "ctrl" || part === "control") modifiers.push("ctrl");
            else if (part === "alt" || part === "option") modifiers.push("alt");
            else if (part === "shift") modifiers.push("shift");
            else if (part === "cmd" || part === "command" || part === "meta" || part === "super") modifiers.push("cmd");
            else key = part;
        }

        const modStr = modifiers.length > 0 ? modifiers.join(",") + " " : "";
        run(`cliclick kp:${modStr}${key}`);
    } else {
        // xdotool handles key combos natively
        const xdoKeys = keys.replace(/\+/g, "+").replace(/ctrl/i, "ctrl").replace(/alt/i, "alt").replace(/shift/i, "shift").replace(/super/i, "super");
        run(`xdotool key ${xdoKeys}`);
    }
}

/**
 * Scroll at a position.
 */
function sendScroll(x: number, y: number, direction: "up" | "down", amount: number): void {
    moveMouse(x, y);

    if (IS_WINDOWS) {
        const scrollAmount = direction === "up" ? amount * 120 : -(amount * 120);
        ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MouseScroll {
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
'@
[MouseScroll]::mouse_event(0x0800, 0, 0, ${Math.abs(scrollAmount)}${scrollAmount < 0 ? " -bor 0x80000000" : ""}, 0)
`);
    } else if (IS_MAC) {
        const scrollDir = direction === "up" ? `-${amount}` : `${amount}`;
        run(`cliclick scroll:${scrollDir}`);
    } else {
        const btn = direction === "up" ? "4" : "5";
        run(`xdotool click --repeat ${amount} ${btn}`);
    }
}

/**
 * Get info about the currently active window.
 */
function getActiveWindowInfo(): { title: string; processName: string; x: number; y: number; width: number; height: number } {
    if (IS_WINDOWS) {
        const result = ps(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinInfo {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$h = [WinInfo]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder(256)
[WinInfo]::GetWindowText($h, $sb, 256) | Out-Null
$r = New-Object WinInfo+RECT
[WinInfo]::GetWindowRect($h, [ref]$r) | Out-Null
$pid2 = [uint32]0
[WinInfo]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
Write-Output "$($sb.ToString())|$($proc.ProcessName)|$($r.Left)|$($r.Top)|$($r.Right - $r.Left)|$($r.Bottom - $r.Top)"
`);
        const [title, processName, x, y, width, height] = result.split("|");
        return {
            title: title || "Unknown",
            processName: processName || "unknown",
            x: parseInt(x) || 0,
            y: parseInt(y) || 0,
            width: parseInt(width) || 0,
            height: parseInt(height) || 0,
        };
    } else if (IS_MAC) {
        const title = run(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`);
        return { title, processName: title, x: 0, y: 0, width: 0, height: 0 };
    } else {
        const windowId = run("xdotool getactivewindow");
        const title = run(`xdotool getactivewindow getwindowname`);
        const geo = run(`xdotool getactivewindow getwindowgeometry --shell`);
        const geoLines = geo.split("\n");
        const x = parseInt(geoLines.find(l => l.startsWith("X="))?.split("=")[1] || "0");
        const y = parseInt(geoLines.find(l => l.startsWith("Y="))?.split("=")[1] || "0");
        const width = parseInt(geoLines.find(l => l.startsWith("WIDTH="))?.split("=")[1] || "0");
        const height = parseInt(geoLines.find(l => l.startsWith("HEIGHT="))?.split("=")[1] || "0");
        return { title, processName: "unknown", x, y, width, height };
    }
}

// ── AI SDK Tool Definitions ──

export const computerTools = {
    screenshot: tool({
        description: "Capture a screenshot of the entire screen or a specific region. Returns the screenshot as a base64-encoded image that you can analyze to understand what's on screen. Use this FIRST before any mouse/keyboard actions to see what you're working with.",
        inputSchema: z.object({
            region: z.object({
                x: z.number().describe("Left edge X coordinate"),
                y: z.number().describe("Top edge Y coordinate"),
                width: z.number().describe("Width in pixels"),
                height: z.number().describe("Height in pixels"),
            }).optional().describe("Optional region to capture. Omit for full screen."),
        }),
        execute: async ({ region }) => {
            try {
                const filepath = captureScreenshot(region);
                const imageBuffer = readFileSync(filepath);
                const base64 = imageBuffer.toString("base64");
                const sizeKB = Math.round(imageBuffer.length / 1024);

                // Clean up old screenshots (keep last 5)
                cleanupScreenshots();

                return {
                    image: `data:image/png;base64,${base64}`,
                    path: filepath,
                    sizeKB,
                    region: region || "full screen",
                    instruction: "Analyze this screenshot to understand what's visible on screen. Describe the UI elements, windows, and content you can see. Then decide what actions to take.",
                };
            } catch (err: any) {
                return { error: `Screenshot failed: ${err.message}` };
            }
        },
    }),

    mouseClick: tool({
        description: "Click at specific screen coordinates. Always take a screenshot first to identify the exact coordinates of the element you want to click. Supports left click, right click, and double click.",
        inputSchema: z.object({
            x: z.number().describe("X coordinate (pixels from left edge of screen)"),
            y: z.number().describe("Y coordinate (pixels from top edge of screen)"),
            button: z.enum(["left", "right", "double"]).default("left").describe("Mouse button to click"),
        }),
        execute: async ({ x, y, button }) => {
            try {
                sendClick(x, y, button);
                // Small delay to let the UI respond
                await new Promise(r => setTimeout(r, 300));
                return { status: "clicked", x, y, button, hint: "Take a screenshot to verify the click had the expected effect." };
            } catch (err: any) {
                return { error: `Click failed: ${err.message}` };
            }
        },
    }),

    mouseMove: tool({
        description: "Move the mouse cursor to specific screen coordinates without clicking. Useful for hovering over elements to trigger tooltips or hover menus.",
        inputSchema: z.object({
            x: z.number().describe("X coordinate"),
            y: z.number().describe("Y coordinate"),
        }),
        execute: async ({ x, y }) => {
            try {
                moveMouse(x, y);
                return { status: "moved", x, y };
            } catch (err: any) {
                return { error: `Mouse move failed: ${err.message}` };
            }
        },
    }),

    typeText: tool({
        description: "Type text using the keyboard at the current cursor position. The text will be typed as if the user pressed each key. Make sure the target text field is focused first (by clicking on it).",
        inputSchema: z.object({
            text: z.string().describe("Text to type"),
        }),
        execute: async ({ text }) => {
            try {
                sendText(text);
                return { status: "typed", length: text.length };
            } catch (err: any) {
                return { error: `Type failed: ${err.message}` };
            }
        },
    }),

    pressKey: tool({
        description: "Press a key or key combination. Use '+' to combine modifiers (e.g., 'ctrl+c', 'alt+tab', 'ctrl+shift+s'). Common keys: enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, space, home, end, pageup, pagedown.",
        inputSchema: z.object({
            keys: z.string().describe("Key combo (e.g., 'ctrl+c', 'enter', 'alt+tab', 'ctrl+shift+s')"),
        }),
        execute: async ({ keys }) => {
            try {
                sendKeyCombo(keys);
                await new Promise(r => setTimeout(r, 200));
                return { status: "pressed", keys };
            } catch (err: any) {
                return { error: `Key press failed: ${err.message}` };
            }
        },
    }),

    scroll: tool({
        description: "Scroll at a specific position on screen. First move to the position, then scroll up or down. Amount is in 'clicks' of the scroll wheel (1 = small scroll, 5 = medium scroll, 10 = large scroll).",
        inputSchema: z.object({
            x: z.number().describe("X coordinate to scroll at"),
            y: z.number().describe("Y coordinate to scroll at"),
            direction: z.enum(["up", "down"]).describe("Scroll direction"),
            amount: z.number().min(1).max(20).default(3).describe("Scroll amount (1-20 clicks)"),
        }),
        execute: async ({ x, y, direction, amount }) => {
            try {
                sendScroll(x, y, direction, amount);
                return { status: "scrolled", x, y, direction, amount };
            } catch (err: any) {
                return { error: `Scroll failed: ${err.message}` };
            }
        },
    }),

    getActiveWindow: tool({
        description: "Get information about the currently active (focused) window, including its title, process name, position, and size. Useful for understanding what application the user is working in.",
        inputSchema: z.object({}),
        execute: async () => {
            try {
                return getActiveWindowInfo();
            } catch (err: any) {
                return { error: `Failed to get window info: ${err.message}` };
            }
        },
    }),
};

// ── Cleanup ──

function cleanupScreenshots(): void {
    try {
        const dir = getScreenshotDir();
        const { readdirSync, statSync } = require("fs");
        const files = readdirSync(dir)
            .map((f: string) => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtime.getTime() }))
            .sort((a: any, b: any) => b.mtime - a.mtime);

        // Keep only the last 5 screenshots
        for (const file of files.slice(5)) {
            try { unlinkSync(file.path); } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}
