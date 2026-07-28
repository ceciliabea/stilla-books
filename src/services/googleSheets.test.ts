import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import {
  BOOK_HEADERS,
  bookToSheetRow,
  sheetRowToBook,
  writeStillaSpreadsheet,
} from "./googleSheets";

const book: Book = {
  id: "book-1",
  externalId: "/works/OL1W",
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  coverUrl: "https://example.com/piranesi.jpg",
  description: "Ett gåtfullt hus.",
  genres: ["Fantasy", "Roman"],
  language: "sv",
  status: "reading",
  isFeaturedReading: true,
  archived: false,
  startedAt: "2026-07-28",
  createdAt: "2026-07-02",
  updatedAt: "2026-07-28",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Sheets-formatet", () => {
  it("kan skrivas och läsas tillbaka utan att tappa bokdata", () => {
    const row = bookToSheetRow(book).map(String);
    expect(sheetRowToBook(row)).toEqual(book);
  });

  it("faller tillbaka till en säker status vid ett okänt värde", () => {
    const row = bookToSheetRow(book).map(String);
    row[BOOK_HEADERS.indexOf("status")] = "något_okänt";
    expect(sheetRowToBook(row)?.status).toBe("want_to_read");
  });
});

describe("Sheets-synk", () => {
  it("skriver aktuell status och läsmål till rätt intervall", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet("token", "sheet-id", [book], 12);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(secondRequest.body)) as {
      data: { range: string; values: (string | boolean | number)[][] }[];
    };
    const booksWrite = body.data.find((entry) => entry.range.startsWith("Books!"));
    const settingsWrite = body.data.find((entry) => entry.range === "Settings!A2:B2");

    expect(booksWrite?.values[0][BOOK_HEADERS.indexOf("status")]).toBe("reading");
    expect(settingsWrite?.values[0]).toEqual([new Date().getFullYear(), 12]);
  });
});
