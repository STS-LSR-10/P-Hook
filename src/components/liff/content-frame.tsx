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
        "mx-auto min-h-screen max-w-md pb-24 lg:max-w-none lg:pb-10 lg:pl-60",
        pathname === "/vault" && "lg:bg-[#FAF7F2]",
      )}
    >
      <div className={cn("lg:mx-auto lg:px-8", wide ? "lg:max-w-6xl" : "lg:max-w-2xl")}>
        {children}
      </div>
    </div>
  );
}
