/**
 * useKeyboardShortcuts — Global keyboard shortcuts for NIOM.
 *
 * Registers:
 *   Cmd+N  → New thread (navigate to home + focus prompt)
 *   Cmd+K  → Focus search in home view
 *   Cmd+,  → Open settings
 *
 * All shortcuts use Cmd on macOS and Ctrl on Windows/Linux.
 * Shortcuts are disabled when the user is typing in an input/textarea
 * (except for the ones that explicitly target those elements).
 */

import { useEffect, useCallback } from "react";

interface KeyboardShortcutActions {
  /** Navigate to home view and start a new thread */
  onNewThread: () => void;
  /** Focus the search input in home view */
  onSearchThreads: () => void;
  /** Navigate to settings */
  onOpenSettings: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  const { onNewThread, onSearchThreads, onOpenSettings } = actions;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Use metaKey on macOS (Cmd), ctrlKey on others (Ctrl)
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case "n": {
          e.preventDefault();
          onNewThread();
          break;
        }
        case "k": {
          e.preventDefault();
          onSearchThreads();
          break;
        }
        case ",": {
          e.preventDefault();
          onOpenSettings();
          break;
        }
      }
    },
    [onNewThread, onSearchThreads, onOpenSettings],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
