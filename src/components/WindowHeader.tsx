/**
 * WindowHeader — Invisible titlebar with macOS-style traffic light buttons.
 * Acts as the window drag region for frameless Tauri window.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowHeader() {
    const appWindow = getCurrentWindow();

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        appWindow.hide();
    };

    const handleMinimize = (e: React.MouseEvent) => {
        e.stopPropagation();
        appWindow.minimize();
    };

    const handleMaximize = (e: React.MouseEvent) => {
        e.stopPropagation();
        appWindow.toggleMaximize();
    };

    const handleDrag = (e: React.MouseEvent) => {
        // Only drag if clicking directly on the header background, not buttons
        if ((e.target as HTMLElement).closest("button")) return;
        appWindow.startDragging();
    };

    return (
        <div
            className="fixed top-0 left-0 right-0 z-50 h-10 flex items-center select-none cursor-grab active:cursor-grabbing"
            onMouseDown={handleDrag}
        >
            {/* Traffic light buttons */}
            <div className="flex items-center gap-[7px] ml-auto pr-4 group">
                {/* Minimize */}
                <button
                    onClick={handleMinimize}
                    className="traffic-btn w-[13px] h-[13px] rounded-full bg-[#febc2e] border border-[#dfa123]/60 flex items-center justify-center transition-all hover:brightness-90 active:brightness-75"
                    title="Minimize"
                >
                    <svg className="w-[7px] h-[7px] opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 10 10" fill="none" stroke="#995700" strokeWidth="1.8" strokeLinecap="round">
                        <line x1="1.5" y1="5" x2="8.5" y2="5" />
                    </svg>
                </button>

                {/* Maximize */}
                <button
                    onClick={handleMaximize}
                    className="traffic-btn w-[13px] h-[13px] rounded-full bg-[#28c840] border border-[#1aab29]/60 flex items-center justify-center transition-all hover:brightness-90 active:brightness-75"
                    title="Maximize"
                >
                    <svg className="w-[7px] h-[7px] opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 10 10" fill="none" stroke="#006500" strokeWidth="1.2">
                        <polyline points="1,6 1,9 4,9" strokeLinecap="round" strokeLinejoin="round" />
                        <polyline points="9,4 9,1 6,1" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="1" y1="9" x2="9" y2="1" strokeLinecap="round" />
                    </svg>
                </button>

                {/* Close */}
                <button
                    onClick={handleClose}
                    className="traffic-btn w-[13px] h-[13px] rounded-full bg-[#ff5f57] border border-[#e0443e]/60 flex items-center justify-center transition-all hover:brightness-90 active:brightness-75"
                    title="Close"
                >
                    <svg className="w-[7px] h-[7px] opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 10 10" fill="none" stroke="#4d0000" strokeWidth="1.8" strokeLinecap="round">
                        <line x1="2" y1="2" x2="8" y2="8" />
                        <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
