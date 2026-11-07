import type { ReactNode } from "react";
import { ContentFrame } from "@/components/liff/content-frame";
import { BottomNav } from "@/components/liff/bottom-nav";
import { LiffProvider } from "@/components/liff/liff-provider";
import { ThemeScope } from "@/components/liff/theme-scope";

export default function LiffLayout({ children }: { children: ReactNode }) {
  return (
    <LiffProvider>
      <ThemeScope />
      <ContentFrame>{children}</ContentFrame>
      <BottomNav />
    </LiffProvider>
  );
}
