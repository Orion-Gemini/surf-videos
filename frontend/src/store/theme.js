import { create } from "zustand";

const saved = localStorage.getItem("theme") || "light";
document.documentElement.setAttribute("data-theme", saved);

function applyTheme(next) {
  localStorage.setItem("theme", next);
  document.documentElement.setAttribute("data-theme", next);
}

export const useThemeStore = create((set, get) => ({
  theme: saved,
  toggle(event) {
    const next = get().theme === "dark" ? "light" : "dark";
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? window.innerHeight / 2;

    if (!document.startViewTransition) {
      applyTheme(next);
      set({ theme: next });
      return;
    }

    const transition = document.startViewTransition(() => {
      applyTheme(next);
      set({ theme: next });
    });

    transition.ready.then(() => {
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 450,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  },
}));
