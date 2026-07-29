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
  descriptionSource: "google_books",
  descriptionSourceUrl: "https://books.google.com/books?id=piranesi",
  genres: ["Fantasy", "Roman"],
  language: "sv",
  status: "reading",
  isFeaturedReading: true,
  archived: false,
  startedAt: "2026-07-28",
  createdAt: "2026-07-02",
  updatedAt: "2026-07-28",
  coverTone: "blue",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Sheets-formatet", () => {
  it("kan skrivas och läsas tillbaka utan att tappa bokdata", () => {
    const row = bookToSheetRow(book).map(String);
    expect(sheetRowToBook(row)).toMatchObject(book);
  });

  it("faller tillbaka till en säker status vid ett okänt värde", () => {
    const row = bookToSheetRow(book).map(String);
    row[BOOK_HEADERS.indexOf("status")] = "något_okänt";
    expect(sheetRowToBook(row)?.status).toBe("want_to_read");
  });
});

describe("Sheets-synk", () => {
  it("skriver aktuell status och läsmål till rätt intervall", async () => {
    const olderRemoteBook = {
      ...book,
      status: "want_to_read" as const,
      updatedAt: "2026-07-27T10:00:00.000Z",
    };
    const localBook = {
      ...book,
      updatedAt: "2026-07-28T10:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            valueRanges: [
              {
                values: [
                  [...BOOK_HEADERS],
                  bookToSheetRow(olderRemoteBook).map(String),
                ],
              },
              { values: [["year", "readingGoal"]] },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet("token", "sheet-id", [localBook], 12);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("values:batchGet");
    expect(String(fetchMock.mock.calls[1][0])).toContain("values:batchUpdate");
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(secondRequest.body)) as {
      data: { range: string; values: (string | boolean | number)[][] }[];
    };
    const booksWrite = body.data.find((entry) => entry.range.startsWith("Books!"));
    const settingsWrite = body.data.find((entry) => entry.range.startsWith("Settings!"));

    expect(booksWrite?.range).toBe("Books!A2:AF2");
    expect(booksWrite?.values[0][BOOK_HEADERS.indexOf("status")]).toBe("reading");
    expect(settingsWrite?.values[0]).toEqual([new Date().getFullYear(), 12]);
  });

  it("tömmer aldrig arket när den lokala boklistan är tom", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          valueRanges: [
            {
              values: [
                [...BOOK_HEADERS],
                bookToSheetRow(book).map(String),
              ],
            },
            { values: [["year", "readingGoal"]] },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet("token", "sheet-id", [], null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("values:batchGet");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("batchClear");
  });

  it("lägger till nya metadatakolumner utan att radera äldre data", async () => {
    const legacyHeaders = BOOK_HEADERS.slice(0, 16);
    const remoteBook = {
      ...book,
      coverTone: undefined,
      updatedAt: "2026-07-27T10:00:00.000Z",
    };
    const localBook = {
      ...book,
      coverUrl: undefined,
      coverTone: "sand" as const,
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            valueRanges: [
              {
                values: [
                  legacyHeaders,
                  bookToSheetRow(remoteBook).slice(0, 16).map(String),
                ],
              },
              { values: [["year", "readingGoal"]] },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet("token", "sheet-id", [localBook], null);

    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      data: { range: string; values: (string | boolean | number)[][] }[];
    };
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          range: "Books!Q1:AF1",
          values: [BOOK_HEADERS.slice(16)],
        }),
        expect.objectContaining({
          range: "Books!A2:AF2",
        }),
      ]),
    );
  });

  it("kompletterar ett 30-kolumners ark med endast beskrivningskällorna", async () => {
    const previousHeaders = BOOK_HEADERS.slice(0, 30);
    const previousBook = {
      ...book,
      descriptionSource: undefined,
      descriptionSourceUrl: undefined,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            valueRanges: [
              {
                values: [
                  previousHeaders,
                  bookToSheetRow(previousBook).slice(0, 30).map(String),
                ],
              },
              { values: [["year", "readingGoal"]] },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet(
      "token",
      "sheet-id",
      [previousBook],
      null,
    );

    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      data: { range: string; values: (string | boolean | number)[][] }[];
    };
    expect(body.data).toEqual([
      {
        range: "Books!AE1:AF1",
        majorDimension: "ROWS",
        values: [["descriptionSource", "descriptionSourceUrl"]],
      },
    ]);
  });

  it("lämnar en nyare fjärrversion av en bok orörd", async () => {
    const newerRemoteBook = {
      ...book,
      title: "Nyare titel",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    const olderLocalBook = {
      ...book,
      title: "Äldre titel",
      updatedAt: "2026-07-28T10:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          valueRanges: [
            {
              values: [
                [...BOOK_HEADERS],
                bookToSheetRow(newerRemoteBook).map(String),
              ],
            },
            { values: [["year", "readingGoal"]] },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeStillaSpreadsheet("token", "sheet-id", [olderLocalBook], null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("avbryter utan skrivning om arkstrukturen inte stämmer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valueRanges: [{ values: [["fel"]] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      writeStillaSpreadsheet("token", "sheet-id", [book], 12),
    ).rejects.toThrow("Synkningen avbröts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
