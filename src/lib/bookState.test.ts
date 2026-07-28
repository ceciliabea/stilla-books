import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import { getStatusChanges, isDuplicateBook } from "./bookState";

const book: Book = {
  id: "book-1",
  externalId: "/works/OL1W",
  title: "Färskt vatten till blommorna",
  authors: ["Valérie Perrin"],
  description: "En stillsam berättelse.",
  genres: ["Roman"],
  status: "want_to_read",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("statusbyten", () => {
  it("gör den första lästa boken till huvudbok", () => {
    expect(getStatusChanges(book, "reading", false, "2026-07-28")).toEqual({
      status: "reading",
      startedAt: "2026-07-28",
      finishedAt: undefined,
      feedback: undefined,
      isFeaturedReading: true,
    });
  });

  it("markerar en bok som läst och tar bort huvudplatsen", () => {
    expect(
      getStatusChanges(
        { ...book, status: "reading", isFeaturedReading: true },
        "read",
        false,
        "2026-07-28",
      ),
    ).toMatchObject({
      status: "read",
      finishedAt: "2026-07-28",
      isFeaturedReading: false,
    });
  });

  it("rensar läst-data när boken flyttas tillbaka till Vill läsa", () => {
    expect(
      getStatusChanges(
        {
          ...book,
          status: "read",
          feedback: "loved",
          finishedAt: "2026-07-28",
        },
        "want_to_read",
        false,
        "2026-07-29",
      ),
    ).toEqual({
      status: "want_to_read",
      startedAt: undefined,
      finishedAt: undefined,
      feedback: undefined,
      isFeaturedReading: false,
    });
  });
});

describe("dubblettkontroll", () => {
  it("hittar samma externa bok-id", () => {
    expect(
      isDuplicateBook([book], {
        externalId: "/works/OL1W",
        title: "En annan titel",
        authors: ["Någon annan"],
      }),
    ).toBe(true);
  });

  it("hittar samma titel och författare trots accenter och skiftläge", () => {
    expect(
      isDuplicateBook([book], {
        title: "FÄRSKT VATTEN TILL BLOMMORNA",
        authors: ["Valerie Perrin"],
      }),
    ).toBe(true);
  });

  it("tillåter en tidigare arkiverad bok", () => {
    expect(
      isDuplicateBook([{ ...book, archived: true }], {
        externalId: "/works/OL1W",
        title: book.title,
        authors: book.authors,
      }),
    ).toBe(false);
  });
});
