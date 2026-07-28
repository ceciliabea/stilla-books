import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import {
  findBookMetadataCandidates,
  refreshBookMetadata,
} from "./openLibrary";

const book: Book = {
  id: "book-1",
  title: "Detaljerna",
  authors: ["Ia Genberg"],
  description: "Beskrivning saknas.",
  genres: [],
  language: "sv",
  status: "read",
  feedback: "loved",
  finishedAt: "2026-07-01",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uppdatering från Open Library", () => {
  it("prioriterar en svensk träff med omslag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          docs: [
            {
              key: "/works/OL-EN",
              title: "Detaljerna",
              author_name: ["Ia Genberg"],
              cover_i: 10,
              language: ["eng"],
            },
            {
              key: "/works/OL-SV",
              title: "Detaljerna",
              author_name: ["Ia Genberg"],
              cover_i: 20,
              language: ["swe"],
              subject: ["Roman"],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          description: "En ny och längre beskrivning.",
          subjects: ["Roman", "Svensk litteratur"],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await refreshBookMetadata(book);

    expect(metadata).toMatchObject({
      externalId: "/works/OL-SV",
      coverUrl: "https://covers.openlibrary.org/b/id/20-L.jpg",
      description: "En ny och längre beskrivning.",
      genres: ["Roman", "Svensk litteratur"],
      language: "sv",
    });
  });

  it("avstår när titel och författare inte matchar tillräckligt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          docs: [
            {
              key: "/works/OL-OTHER",
              title: "En annan bok",
              author_name: ["Någon annan"],
              cover_i: 30,
            },
          ],
        }),
      }),
    );

    await expect(refreshBookMetadata(book)).resolves.toBeNull();
  });

  it("väljer inte en annan titel av samma författare", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          docs: [
            {
              key: "/works/OL-OTHER",
              title: "En annan bok",
              author_name: ["Ia Genberg"],
              cover_i: 30,
            },
          ],
        }),
      }),
    );

    await expect(refreshBookMetadata(book)).resolves.toBeNull();
  });

  it("returnerar osäkra alternativ utan att applicera dem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          docs: [
            {
              key: "/works/OL-OTHER",
              title: "The Details",
              author_name: ["Ia Genberg"],
              cover_i: 30,
              first_publish_year: 2022,
              language: ["eng"],
            },
          ],
        }),
      }),
    );

    await expect(findBookMetadataCandidates(book)).resolves.toEqual([
      expect.objectContaining({
        key: "/works/OL-OTHER",
        title: "The Details",
        authors: ["Ia Genberg"],
        coverUrl: "https://covers.openlibrary.org/b/id/30-L.jpg",
        firstPublishYear: 2022,
        languages: ["eng"],
        safeMatch: false,
      }),
    ]);
  });
});
