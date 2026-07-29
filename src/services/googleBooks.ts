import type { Book } from "../types";
import type { BookCoverCandidate } from "./bookCatalog";

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    language?: string;
    publisher?: string;
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: Record<string, string>;
    infoLink?: string;
  };
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function secureUrl(value?: string) {
  return value?.replace(/^http:/, "https:");
}

function bestCover(imageLinks?: Record<string, string>) {
  if (!imageLinks) return undefined;
  return secureUrl(
    imageLinks.extraLarge ??
      imageLinks.large ??
      imageLinks.medium ??
      imageLinks.small ??
      imageLinks.thumbnail ??
      imageLinks.smallThumbnail,
  );
}

export async function findGoogleBookCoverCandidates(
  book: Book,
  isbnCandidates: string[] = [],
): Promise<BookCoverCandidate[]> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  if (!apiKey) return [];
  const isbns = [book.isbn13, ...isbnCandidates]
    .filter((isbn): isbn is string => Boolean(isbn))
    .filter((isbn, index, values) => values.indexOf(isbn) === index)
    .slice(0, 4);
  async function fetchVolumes(params: URLSearchParams) {
    const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as { items?: GoogleVolume[] };
        return data.items ?? [];
      }
      const canRetry =
        response.status === 429 || response.status >= 500;
      if (canRetry && attempt < 2) {
        await new Promise((resolve) =>
          globalThis.setTimeout(resolve, 300 * (attempt + 1)),
        );
        continue;
      }
      throw new Error(
        response.status === 403
          ? "Google Books API är inte aktiverat för appens API-nyckel."
          : "Google Books kunde inte nås.",
      );
    }
    return [];
  }

  const responses = await Promise.allSettled(
    isbns.map(async (isbn) => {
      const params = new URLSearchParams({
        q: `isbn:${isbn}`,
        maxResults: "10",
        printType: "books",
        key: apiKey,
      });
      return fetchVolumes(params);
    }),
  );
  const successfulResponses = responses.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  function toCoverCandidates(volumes: GoogleVolume[]) {
    const seen = new Set<string>();
    return volumes
    .flatMap((volume) => {
      const info = volume.volumeInfo;
      const coverUrl = bestCover(info?.imageLinks);
      if (!coverUrl || seen.has(coverUrl)) return [];
      seen.add(coverUrl);
      const isbn13 = info?.industryIdentifiers?.find(
        (identifier) => identifier.type === "ISBN_13",
      )?.identifier;
      return [
        {
          id: `google:${volume.id}`,
          coverUrl,
          title: [info?.title, info?.subtitle].filter(Boolean).join(": ") || book.title,
          source: "google_books" as const,
          sourceLabel: "Google Books",
          sourceUrl: secureUrl(info?.infoLink),
          language: info?.language,
          publisher: info?.publisher,
          publishDate: info?.publishedDate,
          isbn13,
        },
      ];
    })
    .slice(0, 6);
  }

  const exactCandidates = toCoverCandidates(successfulResponses.flat());
  if (exactCandidates.length) return exactCandidates;

  const title = normalize(book.title);
  const authors = book.authors.map(normalize).filter(Boolean);
  const language = ["en", "eng"].includes(
    book.language?.toLocaleLowerCase("sv") ?? "",
  )
    ? "en"
    : "sv";
  try {
    const params = new URLSearchParams({
      q: [`intitle:${book.title}`, book.authors[0] ? `inauthor:${book.authors[0]}` : ""]
        .filter(Boolean)
        .join(" "),
      langRestrict: language,
      maxResults: "10",
      printType: "books",
      key: apiKey,
    });
    const fallbackVolumes = await fetchVolumes(params);
    return toCoverCandidates(
      fallbackVolumes.filter((volume) => {
        const candidateTitle = normalize(volume.volumeInfo?.title ?? "");
        const candidateAuthors = (volume.volumeInfo?.authors ?? []).map(normalize);
        const titleMatches =
          candidateTitle === title ||
          candidateTitle.includes(title) ||
          title.includes(candidateTitle);
        const authorMatches =
          !authors.length ||
          authors.some((author) =>
            candidateAuthors.some(
              (candidate) =>
                candidate === author ||
                candidate.includes(author) ||
                author.includes(candidate),
            ),
          );
        return titleMatches && authorMatches;
      }),
    );
  } catch (fallbackError) {
    if (!successfulResponses.length) {
      const failure = responses.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      throw failure?.reason instanceof Error ? failure.reason : fallbackError;
    }
    return [];
  }
}
