// Paper / Terminal switching, shared by every page.
// The choice is kept in localStorage only. The site sets no cookies.

export const THEMES = ["paper", "terminal"];
const KEY = "bs-theme";

export function currentTheme() {
  return document.documentElement.dataset.theme === "terminal" ? "terminal" : "paper";
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  window.setTimeout(() => root.classList.remove("theme-switching"), 450);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows can refuse storage. The switch still works for this visit.
  }
  window.dispatchEvent(new CustomEvent("bs-theme", { detail: theme }));
}

// Put this in <head> as an inline script so a remembered choice is applied
// before the first paint and the page never flashes the wrong colours.
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${KEY}");if(t==="paper"||t==="terminal")document.documentElement.dataset.theme=t}catch(e){}})();`;
