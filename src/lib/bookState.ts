import type { Book, BookStatus } from "../types";

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export function getStatusChanges(
  book: Book,
  status: BookStatus,
  hasOtherReadingBooks: boolean,
  today: string,
): Partial<Book> {
  if (status === "reading") {
    return {
      status,
      startedAt: book.startedAt ?? today,
      finishedAt: undefined,
      feedback: undefined,
      isFeaturedReading: !hasOtherReadingBooks,
    };
  }
  if (status === "read") {
    return {
      status,
      finishedAt: today,
      isFeaturedReading: false,
    };
  }
  return {
    status,
    startedAt: undefined,
    finishedAt: undefined,
    feedback: undefined,
    isFeaturedReading: false,
  };
}

export function isDuplicateBook(
  books: Book[],
  candidate: { externalId?: string; title: string; authors: string[] },
) {
  const activeBooks = books.filter((book) => !book.archived);
  if (
    candidate.externalId &&
    activeBooks.some((book) => book.externalId === candidate.externalId)
  ) {
    return true;
  }
  const title = normalize(candidate.title);
  const firstAuthor = normalize(candidate.authors[0] ?? "");
  return activeBooks.some(
    (book) =>
      normalize(book.title) === title &&
      normalize(book.authors[0] ?? "") === firstAuthor,
  );
}
