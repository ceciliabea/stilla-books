import type { Book, ManualBookField } from "../types";
import type {
  BookMetadataCandidate,
  RefreshedBookMetadata,
} from "./bookCatalog";

type JsonLdValue = string | number | JsonLdNode | JsonLdValue[];

interface JsonLdNode {
  "@id"?: string;
  "@type"?: string | string[];
  [key: string]: JsonLdValue | undefined;
}

interface LibrisResponse {
  items?: JsonLdNode[];
}

function asArray<T>(value?: T | T[]): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asNode(value?: JsonLdValue): JsonLdNode | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonLdNode)
    : undefined;
}

function nodes(value?: JsonLdValue) {
  return asArray(value).filter(
    (item): item is JsonLdNode =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function firstString(value?: JsonLdValue): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map(firstString).find(Boolean);
  }
  return undefined;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function typeIncludes(node: JsonLdNode, type: string) {
  return asArray(node["@type"]).includes(type);
}

function mainTitle(node: JsonLdNode) {
  return nodes(node.hasTitle)
    .map((title) => firstString(title.mainTitle))
    .find(Boolean);
}

function subtitle(node: JsonLdNode) {
  return nodes(node.hasTitle)
    .map(
      (title) =>
        firstString(title.subtitle) ?? firstString(title.titleRemainder),
    )
    .find(Boolean);
}

function roleCodes(contribution: JsonLdNode) {
  return nodes(contribution.role)
    .map((role) => firstString(role.code))
    .filter((role): role is string => Boolean(role));
}

function agentName(contribution: JsonLdNode) {
  const agent = asNode(contribution.agent);
  if (!agent) return undefined;
  const givenName = firstString(agent.givenName);
  const familyName = firstString(agent.familyName);
  return (
    [givenName, familyName].filter(Boolean).join(" ") ||
    firstString(agent.name) ||
    firstString(agent.label)
  );
}

function contributors(work: JsonLdNode, role: "aut" | "trl") {
  return nodes(work.contribution)
    .filter((contribution) => {
      const codes = roleCodes(contribution);
      if (role === "aut") {
        return codes.includes("aut") || contribution["@type"] === "PrimaryContribution";
      }
      return codes.includes(role);
    })
    .map(agentName)
    .filter((name): name is string => Boolean(name))
    .filter((name, index, names) => names.indexOf(name) === index);
}

function isbn13(node: JsonLdNode) {
  return nodes(node.identifiedBy)
    .filter((identifier) => identifier["@type"] === "ISBN")
    .map((identifier) => firstString(identifier.value)?.replace(/\D/g, ""))
    .find((value) => value?.length === 13);
}

function languageCodes(work: JsonLdNode) {
  return nodes(work.language)
    .map((language) => firstString(language.code))
    .filter((code): code is string => Boolean(code));
}

function labels(value?: JsonLdValue) {
  return nodes(value)
    .flatMap((item) => [
      firstString(item.prefLabel),
      firstString(item.label),
      firstString(asNode(item.singularLabelByLang)?.sv),
    ])
    .filter((label): label is string => Boolean(label));
}

function subjects(work: JsonLdNode) {
  return [...labels(work.category), ...labels(work.subject)]
    .map((label) => label.replace(/\.$/, ""))
    .filter(
      (label) =>
        !["Text", "Skönlitteratur"].includes(label) &&
        label.length < 70,
    )
    .filter((label, index, values) => values.indexOf(label) === index)
    .slice(0, 5);
}

function publicationData(instance: JsonLdNode) {
  const publication = nodes(instance.publication)[0];
  const agent = publication ? asNode(publication.agent) : undefined;
  return {
    publisher: agent
      ? firstString(agent.label) ?? firstString(agent.name)
      : undefined,
    publishedYear: publication
      ? firstString(publication.year) ?? firstString(publication.date)
      : undefined,
  };
}

function pageCount(instance: JsonLdNode) {
  const extent = nodes(instance.extent)
    .flatMap((item) => asArray(item.label))
    .map(firstString)
    .find((label) => label && /\d+\s*(s\.|sidor)/iu.test(label));
  const match = extent?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function summary(instance: JsonLdNode) {
  return nodes(instance.summary)
    .flatMap((item) => asArray(item.label))
    .map(firstString)
    .find(Boolean);
}

function isNonPrintEdition(instance: JsonLdNode, work: JsonLdNode) {
  const extent = nodes(instance.extent)
    .flatMap((item) => asArray(item.label))
    .map(firstString);
  const qualifiers = nodes(instance.identifiedBy)
    .flatMap((identifier) => asArray(identifier.qualifier))
    .map(firstString);
  const categories = labels(work.category);
  const description = [...extent, ...qualifiers, ...categories]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("sv");
  return /(talbok|ljudbok|audio|cd-r|mp3|timmar|tim\.|e-bok|elektronisk resurs|online|punktskrift|taktil text|punkt_)/u.test(
    description,
  );
}

function sourceUrl(id: string) {
  return id.replace(/#it$/, "");
}

function scoreCandidate(candidate: BookMetadataCandidate, book: Book) {
  const wantedTitle = normalize(book.title);
  const candidateTitle = normalize(candidate.title);
  const wantedAuthors = book.authors.map(normalize);
  const candidateAuthors = candidate.authors.map(normalize);
  let score = 0;
  if (candidateTitle === wantedTitle) score += 12;
  else if (
    candidateTitle.includes(wantedTitle) ||
    wantedTitle.includes(candidateTitle)
  ) {
    score += 4;
  }
  if (
    wantedAuthors.some((author) =>
      candidateAuthors.some(
        (candidateAuthor) =>
          candidateAuthor === author ||
          candidateAuthor.includes(author) ||
          author.includes(candidateAuthor),
      ),
    )
  ) {
    score += 9;
  }
  if (candidate.languages.includes("swe")) score += 7;
  if (candidate.isbn13) score += 3;
  if (candidate.publisher) score += 1;
  return score;
}

function isSafeMatch(candidate: BookMetadataCandidate, book: Book) {
  const wantedTitle = normalize(book.title);
  const candidateTitle = normalize(candidate.title);
  if (
    candidateTitle !== wantedTitle &&
    !candidateTitle.includes(wantedTitle) &&
    !wantedTitle.includes(candidateTitle)
  ) {
    return false;
  }
  const wantedAuthors = book.authors
    .map(normalize)
    .filter((author) => author && author !== "okand forfattare");
  if (!wantedAuthors.length) return true;
  const candidateAuthors = candidate.authors.map(normalize);
  return wantedAuthors.some((author) =>
    candidateAuthors.some(
      (candidate) =>
        candidate === author ||
        candidate.includes(author) ||
        author.includes(candidate),
    ),
  );
}

function parseCandidate(instance: JsonLdNode): BookMetadataCandidate | null {
  if (!typeIncludes(instance, "PhysicalResource")) return null;
  const title = mainTitle(instance);
  const id = instance["@id"];
  const work = asNode(instance.instanceOf);
  if (!title || !id || !work) return null;
  if (isNonPrintEdition(instance, work)) return null;
  const authors = contributors(work, "aut");
  const { publisher, publishedYear } = publicationData(instance);
  if (publisher && /^(btj|mtm)\b/iu.test(publisher)) return null;
  const candidate: BookMetadataCandidate = {
    key: id,
    title,
    subtitle: subtitle(instance),
    authors,
    translators: contributors(work, "trl"),
    isbn13: isbn13(instance),
    publisher,
    publishedYear,
    pageCount: pageCount(instance),
    edition: firstString(instance.editionStatement),
    description: summary(instance),
    subjects: subjects(work),
    languages: languageCodes(work),
    safeMatch: false,
    source: "libris",
    sourceUrl: sourceUrl(id),
  };
  return candidate;
}

async function librisSearch(query: string, limit = 30) {
  const params = new URLSearchParams({
    q: query,
    _limit: String(limit),
  });
  const response = await fetch(
    `https://libris.kb.se/find.jsonld?${params.toString()}`,
    { headers: { Accept: "application/ld+json" } },
  );
  if (!response.ok) {
    throw new Error("Libris kunde inte nås. Försök igen om en liten stund.");
  }
  return (await response.json()) as LibrisResponse;
}

export async function searchLibrisEditions(
  query: string,
): Promise<BookMetadataCandidate[]> {
  const data = await librisSearch(query);
  const queryTokens = normalize(query)
    .split(" ")
    .filter((token) => token.length > 1);
  return (data.items ?? [])
    .map(parseCandidate)
    .filter((candidate): candidate is BookMetadataCandidate => Boolean(candidate))
    .map((candidate) => {
      const searchable = normalize(
        [candidate.title, ...candidate.authors].join(" "),
      );
      return {
        ...candidate,
        queryScore: queryTokens.filter((token) => searchable.includes(token))
          .length,
      };
    })
    .filter(
      (candidate) =>
        candidate.queryScore >= Math.min(2, Math.max(1, queryTokens.length)),
    )
    .filter((candidate, ...context) => {
      const candidates = context[1];
      return (
        !candidates.some((other) => other.languages.includes("swe")) ||
        candidate.languages.includes("swe")
      );
    })
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex(
          (other) =>
            (candidate.isbn13 && other.isbn13 === candidate.isbn13) ||
            other.key === candidate.key,
        ) === index,
    )
    .sort((a, b) => {
      const aSwedish = a.languages.includes("swe") ? 1 : 0;
      const bSwedish = b.languages.includes("swe") ? 1 : 0;
      return (
        b.queryScore - a.queryScore ||
        bSwedish - aSwedish ||
        Number(b.publishedYear ?? 0) - Number(a.publishedYear ?? 0)
      );
    })
    .slice(0, 12)
    .map(({ queryScore: _queryScore, ...candidate }) => ({
      ...candidate,
      safeMatch:
        _queryScore >= Math.min(2, Math.max(1, queryTokens.length)),
    }));
}

export async function findLibrisMetadataCandidates(
  book: Book,
): Promise<BookMetadataCandidate[]> {
  const data = await librisSearch(
    [book.title, book.authors[0]].filter(Boolean).join(" "),
  );
  return (data.items ?? [])
    .map(parseCandidate)
    .filter((candidate): candidate is BookMetadataCandidate => Boolean(candidate))
    .map((candidate) => ({
      ...candidate,
      safeMatch: isSafeMatch(candidate, book),
      score: scoreCandidate(candidate, book),
    }))
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex(
          (other) =>
            (candidate.isbn13 && other.isbn13 === candidate.isbn13) ||
            other.key === candidate.key,
        ) === index,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((candidate) => candidate as BookMetadataCandidate);
}

export function metadataFromLibrisCandidate(
  book: Book,
  candidate: BookMetadataCandidate,
): RefreshedBookMetadata {
  const manualFields = new Set(book.manualFields ?? []);
  const metadata: RefreshedBookMetadata = {
    externalId: candidate.key,
    librisId: candidate.key,
    isbn13: candidate.isbn13,
    metadataUpdatedAt: new Date().toISOString(),
  };
  const assign = <K extends keyof RefreshedBookMetadata>(
    key: K,
    value: RefreshedBookMetadata[K],
  ) => {
    if (
      !manualFields.has(key as ManualBookField) &&
      value !== undefined
    ) {
      metadata[key] = value;
    }
  };
  assign("title", candidate.title);
  assign("subtitle", candidate.subtitle);
  assign("authors", candidate.authors.length ? candidate.authors : undefined);
  assign(
    "translators",
    candidate.translators.length ? candidate.translators : undefined,
  );
  assign("description", candidate.description);
  assign("genres", candidate.subjects.length ? candidate.subjects : undefined);
  assign("language", candidate.languages[0]);
  assign("publisher", candidate.publisher);
  assign("publishedYear", candidate.publishedYear);
  assign("pageCount", candidate.pageCount);
  assign("edition", candidate.edition);
  return metadata;
}
