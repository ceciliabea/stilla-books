import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import {
  findBookCoverCandidates,
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
  it("prioriterar en svensk träff utan att ändra omslaget", async () => {
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
      });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await refreshBookMetadata(book);

    expect(metadata).toMatchObject({
      externalId: "/works/OL-SV",
    });
    expect(metadata).not.toHaveProperty("coverUrl");
    expect(metadata).not.toHaveProperty("genres");
    expect(String(fetchMock.mock.calls[0][0])).toContain("lang=sv");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("låter titeln styra språket i stället för ett gammalt språkfält", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        docs: [
          {
            key: "/works/OL-MAN",
            title: "Mãn",
            author_name: ["Kim Thúy"],
            cover_i: 44,
            language: ["spa"],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await refreshBookMetadata({
      ...book,
      title: "Mãn",
      authors: ["Kim Thúy"],
      language: "spa",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("lang=sv");
    expect(metadata).not.toHaveProperty("coverUrl");
    expect(metadata).not.toHaveProperty("description");
  });

  it("söker på engelska utan att låta metadata ändra omslaget", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        docs: [
          {
            key: "/works/OL-HELP",
            title: "The Help",
            author_name: ["Kathryn Stockett"],
            cover_i: 55,
            language: ["eng"],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const metadata = await refreshBookMetadata({
      ...book,
      title: "The Help",
      authors: ["Kathryn Stockett"],
      language: "spa",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("lang=en");
    expect(metadata).not.toHaveProperty("coverUrl");
  });

  it("hämtar unika omslag från bokens engelska utgåvor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          docs: [
            {
              key: "/works/OL59038W",
              title: "Never Let Me Go",
              author_name: ["Kazuo Ishiguro"],
              language: ["eng"],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [
            {
              key: "/books/OL-EN",
              title: "Never Let Me Go",
              covers: [8740419],
              languages: [{ key: "/languages/eng" }],
              publishers: ["Faber & Faber"],
              publish_date: "2006",
            },
            {
              key: "/books/OL-DUPLICATE",
              title: "Never Let Me Go",
              covers: [8740419],
              languages: [{ key: "/languages/eng" }],
            },
            {
              key: "/books/OL-ES",
              title: "Nunca me abandones",
              covers: [1047334],
              languages: [{ key: "/languages/spa" }],
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findBookCoverCandidates({
      ...book,
      externalId: "/works/OL59038W",
      title: "Never Let Me Go",
      authors: ["Kazuo Ishiguro"],
      coverUrl: "https://example.com/selected.jpg",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      coverUrl:
        "https://covers.openlibrary.org/b/id/8740419-L.jpg?default=false",
      language: "eng",
      publisher: "Faber & Faber",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/works/OL59038W/editions.json",
    );
  });
});
