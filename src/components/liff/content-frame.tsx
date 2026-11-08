"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The six pages of the menu get the full desktop width; every other page keeps a readable column. */
const WIDE = ["/summary", "/analytics", "/budgets", "/transactions", "/vault", "/settings"];

/**
 * Phone: one column, room for the bottom bar (max-w-md). Desktop (lg): room for the side menu on
 * the left, content centred in what is left.
 */
export function ContentFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const wide = WIDE.includes(pathname);
  return (
    <div
      className={cn(
        "mx-auto min-h-screen max-w-md pb-24 wide:max-w-none wide:pb-10 lg:pl-60",
        // the narrow rail of a sideways phone (the safe-area parts only matter once the viewport covers the notch)
        "rail:pl-[calc(4rem+env(safe-area-inset-left))] rail:pr-[env(safe-area-inset-right)]",
        pathname === "/vault" && "wide:bg-[#FAF7F2] dark:wide:bg-background",
      )}
    >
      <div
        className={cn("wide:mx-auto lg:px-8 rail:px-4", wide ? "wide:max-w-6xl" : "wide:max-w-2xl")}
      >
        {children}
      </div>
    </div>
  );
}
