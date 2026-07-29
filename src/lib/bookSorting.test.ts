import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import { sortBooks } from "./bookSorting";

function book(id: string, title: string, createdAt: string): Book {
  return {
    id,
    title,
    authors: ["Författare"],
    description: "",
    genres: [],
    status: "want_to_read",
    createdAt,
    updatedAt: createdAt,
  };
}

const books = [
  book("2", "Ödemark", "2026-01-02"),
  book("1", "Alkemisten", "2026-01-01"),
  book("3", "Älskaren", "2026-01-03"),
];

describe("bibliotekets sortering", () => {
  it("sorterar titlar med svensk alfabetisk ordning", () => {
    expect(sortBooks(books, "title-asc").map(({ title }) => title)).toEqual([
      "Alkemisten",
      "Älskaren",
      "Ödemark",
    ]);
  });

  it("kan visa senast tillagda först", () => {
    expect(sortBooks(books, "recent").map(({ id }) => id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });
});
