import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import {
  findLibrisMetadataCandidates,
  metadataFromLibrisCandidate,
  searchLibrisEditions,
} from "./libris";

const book: Book = {
  id: "book-1",
  title: "Mãn",
  authors: ["Kim Thúy"],
  description: "Min egen korta beskrivning.",
  genres: [],
  status: "read",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const librisItem = {
  "@id": "https://libris.kb.se/r9361w232pd9mn2#it",
  "@type": "PhysicalResource",
  hasTitle: { "@type": "Title", mainTitle: "Mãn", subtitle: "roman" },
  identifiedBy: [
    { "@type": "ISBN", value: "9789186480844" },
    { "@type": "ISBN", value: "9186480847" },
  ],
  publication: {
    agent: { "@type": "Agent", label: ["Sekwa"] },
    year: "2013",
  },
  extent: { "@type": "Extent", label: ["155 s."] },
  editionStatement: "1. uppl.",
  image: {
    "@id":
      "https://libris.kb.se/dataset/images/example.full.jpg",
  },
  instanceOf: {
    "@type": "Monograph",
    language: [{ code: "swe" }],
    contribution: [
      {
        "@type": "PrimaryContribution",
        agent: { givenName: "Kim", familyName: "Thúy" },
        role: { code: "aut" },
      },
      {
        "@type": "Contribution",
        agent: { givenName: "Marianne", familyName: "Tufvesson" },
        role: [{ code: "trl" }],
      },
    ],
    category: [{ prefLabel: "Romaner" }],
    subject: [{ prefLabel: "Migration" }],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Libris-katalogen", () => {
  it("läser svensk utgåva, ISBN och medverkande", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [librisItem] }), {
          status: 200,
          headers: { "Content-Type": "application/ld+json" },
        }),
      ),
    );

    const candidates = await findLibrisMetadataCandidates(book);

    expect(candidates[0]).toMatchObject({
      title: "Mãn",
      subtitle: "roman",
      authors: ["Kim Thúy"],
      translators: ["Marianne Tufvesson"],
      isbn13: "9789186480844",
      publisher: "Sekwa",
      publishedYear: "2013",
      pageCount: 155,
      edition: "1. uppl.",
      languages: ["swe"],
      safeMatch: true,
    });
  });

  it("skriver inte över fält som användaren har redigerat", () => {
    const candidate = {
      key: "https://libris.kb.se/example#it",
      title: "Mãn",
      authors: ["Kim Thúy"],
      translators: [],
      description: "Katalogens beskrivning.",
      subjects: ["Romaner"],
      languages: ["swe"],
      safeMatch: true,
      source: "libris" as const,
      sourceUrl: "https://libris.kb.se/example",
    };

    const metadata = metadataFromLibrisCandidate(
      { ...book, manualFields: ["description"] },
      candidate,
    );

    expect(metadata).not.toHaveProperty("description");
    expect(metadata).toMatchObject({
      title: "Mãn",
      language: "swe",
      librisId: candidate.key,
    });
    expect(metadata).not.toHaveProperty("coverUrl");
  });

  it("prioriterar svenska tryckta utgåvor och filtrerar MTM-format", async () => {
    const frenchEdition = {
      ...librisItem,
      "@id": "https://libris.kb.se/french#it",
      publication: {
        agent: { label: "L. Levi" },
        year: "2013",
      },
      instanceOf: {
        ...librisItem.instanceOf,
        language: [{ code: "fre" }],
      },
    };
    const tactileEdition = {
      ...librisItem,
      "@id": "https://libris.kb.se/tactile#it",
      publication: {
        agent: { label: "MTM" },
        year: "2014",
      },
      extent: { label: "3 vol. tryckt punktskrift" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [frenchEdition, tactileEdition, librisItem],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/ld+json" },
          },
        ),
      ),
    );

    const results = await searchLibrisEditions("Mãn Kim Thúy");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      key: librisItem["@id"],
      languages: ["swe"],
    });
  });
});
