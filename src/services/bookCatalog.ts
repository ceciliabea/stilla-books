import type { Book } from "../types";

export type BookCoverSource =
  | "libris"
  | "google_books"
  | "open_library";

export interface BookCoverCandidate {
  id: string;
  coverUrl: string;
  title: string;
  source: BookCoverSource;
  sourceLabel: string;
  sourceUrl?: string;
  language?: string;
  publisher?: string;
  publishDate?: string;
  isbn13?: string;
}

export interface BookMetadataCandidate {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  translators: string[];
  coverUrl?: string;
  isbn13?: string;
  publisher?: string;
  publishedYear?: string;
  pageCount?: number;
  edition?: string;
  description?: string;
  subjects: string[];
  languages: string[];
  safeMatch: boolean;
  source: "libris";
  sourceUrl: string;
}

export type RefreshedBookMetadata = Partial<
  Pick<
    Book,
    | "externalId"
    | "librisId"
    | "isbn13"
    | "title"
    | "subtitle"
    | "authors"
    | "translators"
    | "description"
    | "genres"
    | "language"
    | "publisher"
    | "publishedYear"
    | "pageCount"
    | "edition"
    | "metadataUpdatedAt"
  >
>;
