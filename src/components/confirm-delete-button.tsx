/**
 * ConfirmDeleteButton — Two-stage delete confirmation.
 *
 * Default: Shows a trash icon button (hidden until parent hover).
 * On click: Replaces with ✓ (confirm) and ✕ (cancel) icon buttons.
 * Confirm triggers onDelete, cancel resets back to trash icon.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Check, X } from "lucide-react";

interface ConfirmDeleteButtonProps {
  onDelete: () => void;
  /** Additional className for the wrapper */
  className?: string;
}

export function ConfirmDeleteButton({ onDelete, className = "" }: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className={`flex items-center gap-0.5 animate-in fade-in zoom-in-95 duration-150 ${className}`}>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
            setConfirming(false);
          }}
          className="text-primary hover:text-primary hover:bg-primary/10"
        >
          <Check className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(false);
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
      }}
      className={`text-muted-foreground hover:text-destructive hover:bg-destructive/10 ${className}`}
    >
      <Trash2 className="size-3" />
    </Button>
  );
}
