"use client";
import { useEffect } from "react";

export function FocusClearance() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".app-bottom-nav");
    if (!nav) return;
    let frame = 0;
    const update = () => {
      document.documentElement.style.setProperty("--mobile-nav-clearance", `${nav.getBoundingClientRect().height + 16}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    update();
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest(".app-content")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bar = nav.getBoundingClientRect();
        if (bar.height && target.getBoundingClientRect().bottom > bar.top - 16) {
          target.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      });
    };
    document.addEventListener("focusin", focus);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("focusin", focus);
      document.documentElement.style.removeProperty("--mobile-nav-clearance");
    };
  }, []);
  return null;
}
