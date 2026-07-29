export type BookStatus = "want_to_read" | "reading" | "read";
export type Feedback = "not_for_me" | "liked" | "loved";
export type CoverTone = "sage" | "clay" | "ink" | "sand" | "blue";
export type CoverSource =
  | "libris"
  | "google_books"
  | "open_library"
  | "custom"
  | "stilla";
export type DescriptionSource = "libris" | "google_books";

export type ManualBookField =
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
  | "edition";

export interface Book {
  id: string;
  externalId?: string;
  librisId?: string;
  googleBooksId?: string;
  isbn13?: string;
  title: string;
  subtitle?: string;
  authors: string[];
  translators?: string[];
  coverUrl?: string;
  coverSource?: CoverSource;
  coverSourceUrl?: string;
  description: string;
  descriptionSource?: DescriptionSource;
  descriptionSourceUrl?: string;
  genres: string[];
  language?: string;
  publisher?: string;
  publishedYear?: string;
  pageCount?: number;
  edition?: string;
  status: BookStatus;
  feedback?: Feedback;
  isFeaturedReading?: boolean;
  archived?: boolean;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  metadataUpdatedAt?: string;
  manualFields?: ManualBookField[];
  coverTone?: CoverTone;
}
