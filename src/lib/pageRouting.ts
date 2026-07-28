export type AppPage = "home" | "library" | "add" | "settings";

const APP_PAGES = new Set<AppPage>(["home", "library", "add", "settings"]);

export function pageFromHash(hash: string): AppPage {
  const candidate = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  return APP_PAGES.has(candidate as AppPage) ? (candidate as AppPage) : "home";
}

export function hashForPage(page: AppPage) {
  return page === "home" ? "#/" : `#/${page}`;
}
