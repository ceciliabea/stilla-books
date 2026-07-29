import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import { findGoogleBookCoverCandidates } from "./googleBooks";

const book: Book = {
  id: "book-1",
  title: "Mãn",
  authors: ["Kim Thúy"],
  isbn13: "9789186480844",
  description: "",
  genres: [],
  status: "read",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

beforeEach(() => {
  vi.stubEnv("VITE_GOOGLE_API_KEY", "test-api-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Google Books som omslagskälla", () => {
  it("söker på exakt ISBN och returnerar källmärkt omslag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "google-volume",
              volumeInfo: {
                title: "Mãn",
                language: "sv",
                publisher: "Sekwa",
                publishedDate: "2013",
                infoLink: "https://books.google.com/books?id=google-volume",
                industryIdentifiers: [
                  { type: "ISBN_13", identifier: "9789186480844" },
                ],
                imageLinks: {
                  thumbnail: "http://books.google.com/cover.jpg",
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findGoogleBookCoverCandidates(book);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "q=isbn%3A9789186480844",
    );
    expect(candidates[0]).toMatchObject({
      id: "google:google-volume",
      coverUrl: "https://books.google.com/cover.jpg",
      source: "google_books",
      sourceLabel: "Google Books",
      sourceUrl: "https://books.google.com/books?id=google-volume",
    });
  });

  it("ändrar aldrig bokmetadata eller befintligt omslag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      findGoogleBookCoverCandidates({
        ...book,
        coverUrl: "https://example.com/selected.jpg",
      }),
    ).resolves.toEqual([]);
  });

  it("behåller lyckade ISBN-träffar när en annan utgåva tillfälligt misslyckas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Tillfälligt fel" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "working-volume",
                volumeInfo: {
                  title: "Mãn",
                  infoLink:
                    "https://books.google.com/books?id=working-volume",
                  imageLinks: {
                    thumbnail: "https://books.google.com/working.jpg",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findGoogleBookCoverCandidates(book, [
      "9789187648243",
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("google:working-volume");
  });

  it("gör en strikt svensk titelreserv när ISBN-träffen saknar bild", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "isbn-without-cover",
                volumeInfo: {
                  title: "Mãn",
                  authors: ["Kim Thúy"],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "safe-title-match",
                volumeInfo: {
                  title: "Mãn",
                  authors: ["Kim Thúy"],
                  language: "sv",
                  infoLink:
                    "http://books.google.com/books?id=safe-title-match",
                  imageLinks: {
                    thumbnail:
                      "http://books.google.com/safe-title-match.jpg",
                  },
                },
              },
              {
                id: "wrong-author",
                volumeInfo: {
                  title: "Mãn",
                  authors: ["Någon annan"],
                  imageLinks: {
                    thumbnail: "https://books.google.com/wrong.jpg",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findGoogleBookCoverCandidates(book);

    expect(String(fetchMock.mock.calls[1][0])).toContain("langRestrict=sv");
    expect(String(fetchMock.mock.calls[1][0])).toContain("intitle%3AM%C3%A3n");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "google:safe-title-match",
      sourceUrl: "https://books.google.com/books?id=safe-title-match",
    });
  });
});
