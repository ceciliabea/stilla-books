import type { Book } from "../types";

export type LibrarySortOrder = "recent" | "title-asc" | "title-desc";

export function sortBooks(
  books: Book[],
  order: LibrarySortOrder,
): Book[] {
  return [...books].sort((a, b) => {
    if (order === "title-asc") {
      return a.title.localeCompare(b.title, "sv", { sensitivity: "base" });
    }
    if (order === "title-desc") {
      return b.title.localeCompare(a.title, "sv", { sensitivity: "base" });
    }
    const dateDifference = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return Number.isFinite(dateDifference) && dateDifference !== 0
      ? dateDifference
      : a.title.localeCompare(b.title, "sv", { sensitivity: "base" });
  });
}
