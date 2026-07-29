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

interface OpenLibraryEdition {
  key: string;
  title?: string;
  covers?: number[];
  languages?: { key: string }[];
  publishers?: string[];
  publish_date?: string;
}

export type RefreshedBookMetadata = Pick<
  Book,
  "externalId" | "title" | "authors"
>;

export interface BookMetadataCandidate {
  key: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  firstPublishYear?: number;
  subjects: string[];
  languages: string[];
  safeMatch: boolean;
}

export interface BookCoverCandidate {
  id: string;
  coverUrl: string;
  title: string;
  language?: string;
  publisher?: string;
  publishDate?: string;
}

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
  const aliases: Record<string, string> = {
    sv: "swe",
    svenska: "swe",
    en: "eng",
    engelska: "eng",
    no: "nor",
    da: "dan",
    fi: "fin",
    is: "isl",
    de: "deu",
    fr: "fra",
    es: "spa",
    it: "ita",
  };
  return normalized ? aliases[normalized] ?? normalized : undefined;
}

function twoLetterLanguageCode(language?: string) {
  const normalized = languageCode(language);
  const codes: Record<string, string> = {
    swe: "sv",
    eng: "en",
    nor: "no",
    dan: "da",
    fin: "fi",
    isl: "is",
    deu: "de",
    fra: "fr",
    spa: "es",
    ita: "it",
  };
  return normalized ? codes[normalized] ?? normalized.slice(0, 2) : undefined;
}

function inferTitleLanguage(title: string) {
  const words = new Set(normalize(title).split(" ").filter(Boolean));
  const hasAny = (candidates: string[]) =>
    candidates.some((candidate) => words.has(candidate));

  if (
    /[åäö]/iu.test(title) ||
    hasAny([
      "och",
      "den",
      "det",
      "en",
      "ett",
      "att",
      "som",
      "på",
      "för",
      "med",
      "till",
      "från",
      "inte",
      "över",
      "mellan",
    ])
  ) {
    return "sv";
  }

  if (
    hasAny([
      "the",
      "and",
      "of",
      "a",
      "an",
      "to",
      "in",
      "on",
      "for",
      "with",
      "my",
      "our",
      "me",
      "you",
      "never",
      "let",
      "go",
      "who",
      "when",
      "where",
    ])
  ) {
    return "en";
  }

  // Korta eller språkligt neutrala titlar som "Mãn" får svensk
  // utgåva som förstahandsval, eftersom Stilla primärt är ett svenskt bibliotek.
  return "sv";
}

function scoreResult(
  result: OpenLibrarySearchResult,
  book: Book,
  preferredLanguage?: string,
) {
  const wantedTitle = normalize(book.title);
  const resultTitle = normalize(result.title);
  const wantedAuthors = book.authors.map(normalize);
  const resultAuthors = (result.author_name ?? []).map(normalize);
  const wantedLanguage = languageCode(preferredLanguage ?? book.language);

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

export async function findBookMetadataCandidates(
  book: Book,
  preferredLanguage = inferTitleLanguage(book.title),
): Promise<BookMetadataCandidate[]> {
  const searchLanguage = twoLetterLanguageCode(preferredLanguage);
  const params = new URLSearchParams({
    title: book.title,
    author: book.authors[0] ?? "",
    limit: "12",
    fields:
      "key,title,author_name,cover_i,first_publish_year,subject,language",
  });
  if (searchLanguage) params.set("lang", searchLanguage);
  const response = await fetch(
    `https://openlibrary.org/search.json?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error("Bokkatalogen kunde inte nås. Försök igen om en liten stund.");
  }

  const data = (await response.json()) as { docs?: OpenLibrarySearchResult[] };
  return (data.docs ?? [])
    .map((result) => ({
      result,
      score: scoreResult(result, book, preferredLanguage),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ result }) => ({
      key: result.key,
      title: result.title,
      authors: result.author_name?.slice(0, 3) ?? [],
      ...(result.cover_i && result.cover_i > 0
        ? {
            coverUrl: `https://covers.openlibrary.org/b/id/${result.cover_i}-L.jpg`,
          }
        : {}),
      firstPublishYear: result.first_publish_year,
      subjects: result.subject?.slice(0, 3) ?? [],
      languages: result.language ?? [],
      safeMatch: isSafeMatch(result, book),
    }));
}

export async function refreshBookMetadataFromCandidate(
  book: Book,
  candidate: BookMetadataCandidate,
): Promise<RefreshedBookMetadata> {
  return {
    externalId: candidate.key,
    title: candidate.title,
    authors: candidate.authors.length ? candidate.authors : book.authors,
  };
}

function editionLanguage(edition: OpenLibraryEdition) {
  return edition.languages?.[0]?.key.replace("/languages/", "");
}

function editionScore(
  edition: OpenLibraryEdition,
  book: Book,
  preferredLanguage: string,
) {
  const title = normalize(edition.title ?? "");
  const wantedTitle = normalize(book.title);
  const language = editionLanguage(edition);
  let score = 0;
  if (title === wantedTitle) score += 6;
  else if (title.includes(wantedTitle) || wantedTitle.includes(title)) score += 2;
  if (language === preferredLanguage) score += 7;
  if (!language) score += 1;
  if (edition.publishers?.length) score += 1;
  if (edition.publish_date) score += 1;
  return score;
}

export async function findBookCoverCandidates(
  book: Book,
): Promise<BookCoverCandidate[]> {
  const metadataCandidates = await findBookMetadataCandidates(book);
  const workKeys = [
    ...(book.externalId?.startsWith("/works/") ? [book.externalId] : []),
    ...metadataCandidates
      .filter((candidate) => candidate.safeMatch)
      .map((candidate) => candidate.key),
  ]
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .slice(0, 2);

  if (!workKeys.length) return [];

  const preferredLanguage = languageCode(inferTitleLanguage(book.title)) ?? "swe";
  const editions = (
    await Promise.all(
      workKeys.map(async (workKey) => {
        const response = await fetch(
          `https://openlibrary.org${workKey}/editions.json?limit=50`,
        );
        if (!response.ok) return [];
        const data = (await response.json()) as {
          entries?: OpenLibraryEdition[];
        };
        return data.entries ?? [];
      }),
    )
  ).flat();

  const seenCovers = new Set<number>();
  return editions
    .filter((edition) => edition.covers?.some((cover) => cover > 0))
    .sort(
      (a, b) =>
        editionScore(b, book, preferredLanguage) -
        editionScore(a, book, preferredLanguage),
    )
    .flatMap((edition) => {
      const coverId = edition.covers?.find(
        (cover) => cover > 0 && !seenCovers.has(cover),
      );
      if (!coverId) return [];
      seenCovers.add(coverId);
      return [
        {
          id: `${edition.key}:${coverId}`,
          coverUrl: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`,
          title: edition.title ?? book.title,
          language: editionLanguage(edition),
          publisher: edition.publishers?.[0],
          publishDate: edition.publish_date,
        },
      ];
    })
    .slice(0, 6);
}

export async function refreshBookMetadata(
  book: Book,
  preferredLanguage = inferTitleLanguage(book.title),
): Promise<RefreshedBookMetadata | null> {
  const candidates = await findBookMetadataCandidates(
    book,
    preferredLanguage,
  );
  const safeCandidate = candidates.find((candidate) => candidate.safeMatch);
  return safeCandidate
    ? refreshBookMetadataFromCandidate(
        book,
        safeCandidate,
      )
    : null;
}
