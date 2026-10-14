"use client";

import { Moon, SunDim } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/shared/lib/utils";
import { useTheme } from "next-themes";

type props = {
  className?: string;
};

export const AnimatedThemeToggler = ({ className }: props) => {
  const { resolvedTheme, setTheme } = useTheme();
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    setIsDarkMode(resolvedTheme === "dark");
  }, [resolvedTheme]);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const changeTheme = async () => {
    if (!buttonRef.current) return;

    const updateTheme = () => {
      flushSync(() => {
        const dark = document.documentElement.classList.toggle("dark");
        setTheme(dark ? "dark" : "light");
        setIsDarkMode(dark);
      });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof document.startViewTransition !== 'function') {
      updateTheme();
      return;
    }
    await document.startViewTransition(updateTheme).ready;

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect();
    const y = top + height / 2;
    const x = left + width / 2;

    const right = window.innerWidth - left;
    const bottom = window.innerHeight - top;
    const maxRad = Math.hypot(Math.max(left, right), Math.max(top, bottom));

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRad}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 700,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    );
  };
  if (!mounted) {
    return null;
  }

  return (
    <button
      ref={buttonRef}
      onClick={changeTheme}
      className={cn('inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)}
      aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDarkMode ? <SunDim /> : <Moon />}
    </button>
  );
};
