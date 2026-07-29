export type BookStatus = "want_to_read" | "reading" | "read";
export type Feedback = "not_for_me" | "liked" | "loved";
export type CoverTone = "sage" | "clay" | "ink" | "sand" | "blue";

export interface Book {
  id: string;
  externalId?: string;
  title: string;
  authors: string[];
  coverUrl?: string;
  description: string;
  genres: string[];
  language?: string;
  status: BookStatus;
  feedback?: Feedback;
  isFeaturedReading?: boolean;
  archived?: boolean;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  coverTone?: CoverTone;
}
