import { BookOpen } from "lucide-react";
import { cn } from "../lib/utils";
import type { Book } from "../types";

const tones = {
  sage: "from-[#7f8e75] to-[#b3bda9] text-[#f7f4ec]",
  clay: "from-[#a66f5c] to-[#d2a18d] text-[#fff8ef]",
  ink: "from-[#343a3b] to-[#697272] text-[#faf8f3]",
  sand: "from-[#b3976e] to-[#d8c6a4] text-[#342f2a]",
  blue: "from-[#778d94] to-[#a9babd] text-[#faf8f3]",
};

export function BookCover({
  book,
  className,
}: {
  book: Book;
  className?: string;
}) {
  if (book.coverUrl) {
    return (
      <div
        className={cn(
          "relative aspect-[2/3] shrink-0 overflow-hidden rounded-[3px] shadow-[0_12px_28px_rgba(46,46,44,0.12)]",
          className,
        )}
      >
        <img
          src={book.coverUrl}
          alt={`Omslag till ${book.title}`}
          className="absolute inset-0 block size-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex aspect-[2/3] shrink-0 flex-col overflow-hidden rounded-[3px] bg-gradient-to-br p-4 shadow-[0_12px_28px_rgba(46,46,44,0.12)]",
        tones[book.coverTone ?? "sage"],
        className,
      )}
      aria-label={`Illustrerat omslag till ${book.title}`}
    >
      <span className="absolute inset-y-0 left-2 w-px bg-current opacity-20" />
      <BookOpen className="mb-auto size-5 stroke-[1.2]" aria-hidden="true" />
      <div>
        <p className="font-serif text-[clamp(1rem,2vw,1.5rem)] leading-[1.05]">{book.title}</p>
        <p className="mt-2 text-[10px] uppercase tracking-[0.16em] opacity-80">{book.authors.join(", ")}</p>
      </div>
    </div>
  );
}
