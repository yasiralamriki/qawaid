"use client";

import { createContext, useContext, useState } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Button } from "@/components/ui/button";

const LanguageContext = createContext({ arabic: false, toggle: () => {} });
export function useLanguage() { return useContext(LanguageContext); }
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [arabic, setArabic] = useState(false);
  function toggle() {
    const next = !arabic;
    setArabic(next);
    document.documentElement.dir = next ? "rtl" : "ltr";
    document.documentElement.lang = next ? "ar" : "en";
  }
  return <LanguageContext.Provider value={{ arabic, toggle }}><DirectionProvider direction={arabic ? "rtl" : "ltr"}>{children}</DirectionProvider></LanguageContext.Provider>;
}
export function LanguageToggle() {
  const { arabic, toggle } = useLanguage();
  return <Button variant="outline" size="sm" onClick={toggle} aria-label={arabic ? "Switch to English, left to right" : "التبديل إلى العربية، من اليمين إلى اليسار"}>{arabic ? "English" : "العربية"}</Button>;
}
