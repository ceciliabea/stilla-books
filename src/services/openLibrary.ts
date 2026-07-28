import type { Book } from "../types";

interface OpenLibrarySearchResult {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  subject?: string[];
  language?: string[];
}

export type RefreshedBookMetadata = Pick<Book, "externalId" | "title" | "authors"> &
  Partial<Pick<Book, "coverUrl" | "description" | "genres" | "language">>;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function languageCode(language?: string) {
  const normalized = language?.toLocaleLowerCase("sv");
  if (normalized === "sv" || normalized === "swe" || normalized === "svenska") {
    return "swe";
  }
  return normalized;
}

function scoreResult(result: OpenLibrarySearchResult, book: Book) {
  const wantedTitle = normalize(book.title);
  const resultTitle = normalize(result.title);
  const wantedAuthors = book.authors.map(normalize);
  const resultAuthors = (result.author_name ?? []).map(normalize);
  const wantedLanguage = languageCode(book.language);

  let score = 0;
  if (book.externalId && result.key === book.externalId) score += 12;
  if (resultTitle === wantedTitle) score += 8;
  else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 3;
  if (
    wantedAuthors.some((author) =>
      resultAuthors.some(
        (candidate) =>
          candidate === author ||
          candidate.includes(author) ||
          author.includes(candidate),
      ),
    )
  ) {
    score += 6;
  }
  if (wantedLanguage && result.language?.includes(wantedLanguage)) score += 4;
  if (result.cover_i && result.cover_i > 0) score += 2;
  return score;
}

function isSafeMatch(result: OpenLibrarySearchResult, book: Book) {
  if (book.externalId && result.key === book.externalId) return true;

  const wantedTitle = normalize(book.title);
  const resultTitle = normalize(result.title);
  const titleMatches =
    resultTitle === wantedTitle ||
    resultTitle.includes(wantedTitle) ||
    wantedTitle.includes(resultTitle);
  if (!titleMatches) return false;

  const knownAuthors = book.authors
    .map(normalize)
    .filter((author) => author && author !== "okand forfattare");
  if (knownAuthors.length === 0) return true;

  const resultAuthors = (result.author_name ?? []).map(normalize);
  return knownAuthors.some((author) =>
    resultAuthors.some(
      (candidate) =>
        candidate === author ||
        candidate.includes(author) ||
        author.includes(candidate),
    ),
  );
}

export function shortenDescription(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 240
    ? `${cleaned.slice(0, 237).trimEnd()}…`
    : cleaned;
}

export async function refreshBookMetadata(
  book: Book,
): Promise<RefreshedBookMetadata | null> {
  const params = new URLSearchParams({
    title: book.title,
    author: book.authors[0] ?? "",
    limit: "12",
    fields:
      "key,title,author_name,cover_i,first_publish_year,subject,language",
  });
  const response = await fetch(
    `https://openlibrary.org/search.json?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error("Bokkatalogen kunde inte nås. Försök igen om en liten stund.");
  }

  const data = (await response.json()) as { docs?: OpenLibrarySearchResult[] };
  const ranked = (data.docs ?? [])
    .filter((result) => isSafeMatch(result, book))
    .map((result) => ({ result, score: scoreResult(result, book) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;

  let description = best.result.first_publish_year
    ? `Först utgiven ${best.result.first_publish_year}.`
    : undefined;
  let genres = best.result.subject?.slice(0, 3);

  try {
    const detailResponse = await fetch(
      `https://openlibrary.org${best.result.key}.json`,
    );
    if (detailResponse.ok) {
      const details = (await detailResponse.json()) as {
        description?: string | { value?: string };
        subjects?: string[];
      };
      const detailedDescription =
        typeof details.description === "string"
          ? details.description
          : details.description?.value;
      if (detailedDescription) {
        description = shortenDescription(detailedDescription);
      }
      if (details.subjects?.length) genres = details.subjects.slice(0, 3);
    }
  } catch {
    // Sökresultatets metadata är en trygg reserv.
  }

  const wantedLanguage = languageCode(book.language);
  const matchedLanguage =
    wantedLanguage && best.result.language?.includes(wantedLanguage)
      ? wantedLanguage === "swe"
        ? "sv"
        : wantedLanguage
      : best.result.language?.[0];

  return {
    externalId: best.result.key,
    title: best.result.title,
    authors:
      best.result.author_name?.slice(0, 3) ??
      book.authors,
    ...(best.result.cover_i && best.result.cover_i > 0
      ? {
          coverUrl: `https://covers.openlibrary.org/b/id/${best.result.cover_i}-L.jpg`,
        }
      : {}),
    ...(description ? { description } : {}),
    ...(genres?.length ? { genres } : {}),
    ...(matchedLanguage ? { language: matchedLanguage } : {}),
  };
}
