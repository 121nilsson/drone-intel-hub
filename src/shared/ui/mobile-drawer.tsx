import { useEffect, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/** Widths at and above this show the desktop navigation instead (Tailwind `lg`). */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * The side panel a phone or tablet opens from the header: a dialog that traps focus, closes on
 * Escape or a tap outside, locks the page behind it from scrolling and is announced as a dialog.
 * Built on the shared Sheet, so it is placed by the browser's viewport and never by the page - a
 * wide page cannot push it out of view. It closes itself when the screen grows to a desktop width.
 */
export function MobileDrawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out by a screen reader; not shown. */
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia(DESKTOP_QUERY);
    const close = () => {
      if (wide.matches) onOpenChange(false);
    };
    close();
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, [open, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-card p-5 sm:max-w-[85vw] lg:hidden"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Pages and search</SheetDescription>
        {/* The sheet's own close button sits at the top right; this keeps the content below it. */}
        <div className="flex flex-col gap-4 pt-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
