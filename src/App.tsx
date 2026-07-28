import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  BookOpen,
  Check,
  ChevronRight,
  Heart,
  Library,
  Menu,
  Plus,
  Search,
  Settings,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookCover } from "./components/BookCover";
import { Button } from "./components/ui/button";
import { demoBooks } from "./data/demo-books";
import { getStatusChanges, isDuplicateBook } from "./lib/bookState";
import { cn } from "./lib/utils";
import {
  createStillaSpreadsheet,
  isGoogleConfigured,
  pickStillaSpreadsheet,
  readStillaSpreadsheet,
  requestGoogleToken,
  writeStillaSpreadsheet,
} from "./services/googleSheets";
import type { Book, BookStatus, Feedback } from "./types";

type Page = "home" | "library" | "add" | "settings";
type SyncState = "idle" | "connecting" | "syncing" | "synced" | "error";
const CURRENT_YEAR = new Date().getFullYear();

interface SheetConnection {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
}

const statusLabel: Record<BookStatus, string> = {
  want_to_read: "Vill läsa",
  reading: "Läser",
  read: "Läst",
};

const feedbackMeta: Record<Feedback, { label: string; icon: typeof Heart }> = {
  not_for_me: { label: "Inte för mig", icon: ThumbsDown },
  liked: { label: "Tyckte om", icon: ThumbsUp },
  loved: { label: "Älskade", icon: Heart },
};

function loadBooks() {
  try {
    const saved = localStorage.getItem("stilla-demo-books");
    if (!saved) return import.meta.env.DEV ? demoBooks : [];
    return (JSON.parse(saved) as Book[]).map((book) => {
      const currentDemo = demoBooks.find((demoBook) => demoBook.id === book.id);
      return currentDemo
        ? { ...book, coverUrl: currentDemo.coverUrl }
        : book;
    });
  } catch {
    return demoBooks;
  }
}

function loadSheetConnection(): SheetConnection | null {
  try {
    const saved = localStorage.getItem("stilla-sheet-connection");
    return saved ? (JSON.parse(saved) as SheetConnection) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [books, setBooks] = useState<Book[]>(loadBooks);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [celebrating, setCelebrating] = useState<Book | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sheetConnection, setSheetConnection] = useState<SheetConnection | null>(
    loadSheetConnection,
  );
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [sheetReady, setSheetReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const skipNextSheetWrite = useRef(false);
  const sheetWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const [goal, setGoal] = useState<number | null>(() => {
    const saved = localStorage.getItem("stilla-reading-goal");
    return saved ? Number(saved) : import.meta.env.DEV ? 12 : null;
  });

  useEffect(() => {
    localStorage.setItem("stilla-demo-books", JSON.stringify(books));
  }, [books]);

  useEffect(() => {
    if (goal) localStorage.setItem("stilla-reading-goal", String(goal));
    else localStorage.removeItem("stilla-reading-goal");
  }, [goal]);

  useEffect(() => {
    if (!sheetConnection || !googleToken || !sheetReady) return;
    if (skipNextSheetWrite.current) {
      skipNextSheetWrite.current = false;
      return;
    }
    const timeout = window.setTimeout(async () => {
      sheetWriteQueue.current = sheetWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          setSyncState("syncing");
          setSyncMessage("Sparar stilla i ditt Google Sheet…");
          try {
            await writeStillaSpreadsheet(
              googleToken,
              sheetConnection.spreadsheetId,
              books,
              goal,
            );
            setSyncState("synced");
            setSyncMessage("Sparat i ditt Google Sheet.");
          } catch (error) {
            setSyncState("error");
            setSyncMessage(
              error instanceof Error
                ? error.message
                : "Kunde inte spara i Google Sheet.",
            );
          }
        });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [books, goal, googleToken, sheetConnection, sheetReady]);

  useEffect(() => {
    if (!sheetConnection || !googleToken || !sheetReady) return;
    const token = googleToken;
    const spreadsheetId = sheetConnection.spreadsheetId;
    let cancelled = false;
    let lastRefresh = 0;

    async function refreshOnFocus() {
      if (Date.now() - lastRefresh < 2000) return;
      lastRefresh = Date.now();
      try {
        const snapshot = await readStillaSpreadsheet(
          token,
          spreadsheetId,
        );
        if (cancelled) return;
        skipNextSheetWrite.current = true;
        setBooks(snapshot.books);
        setGoal(snapshot.goal);
        setSyncState("synced");
        setSyncMessage("Biblioteket är uppdaterat från Google Sheet.");
      } catch (error) {
        if (cancelled) return;
        setSyncState("error");
        setSyncMessage(
          error instanceof Error
            ? error.message
            : "Kunde inte läsa från Google Sheet.",
        );
      }
    }

    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [googleToken, sheetConnection, sheetReady]);

  const activeBooks = books.filter((book) => !book.archived);
  const reading = activeBooks.filter((book) => book.status === "reading");
  const featured = reading.find((book) => book.isFeaturedReading) ?? reading[reading.length - 1];
  const readThisYear = activeBooks.filter(
    (book) =>
      book.status === "read" &&
      book.finishedAt?.startsWith(String(CURRENT_YEAR)),
  ).length;

  function updateBook(id: string, changes: Partial<Book>) {
    setBooks((current) =>
      current.map((book) =>
        book.id === id
          ? { ...book, ...changes, updatedAt: new Date().toISOString().slice(0, 10) }
          : changes.isFeaturedReading
            ? { ...book, isFeaturedReading: false }
            : book,
      ),
    );
    setSelectedBook((current) =>
      current?.id === id ? { ...current, ...changes } : current,
    );
  }

  function changeStatus(book: Book, status: BookStatus) {
    const changes = getStatusChanges(
      book,
      status,
      reading.some((readingBook) => readingBook.id !== book.id),
      new Date().toISOString().slice(0, 10),
    );
    if (status === "read") {
      setSelectedBook(null);
      window.setTimeout(() => setCelebrating({ ...book, ...changes }), 180);
    }
    updateBook(book.id, changes);
  }

  function setFeedback(book: Book, feedback: Feedback) {
    updateBook(book.id, { feedback });
    setCelebrating(null);
  }

  function navigate(next: Page) {
    setPage(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rememberSheet(connection: SheetConnection) {
    setSheetConnection(connection);
    localStorage.setItem("stilla-sheet-connection", JSON.stringify(connection));
  }

  async function createSheet() {
    setSyncState("connecting");
    setSyncMessage("Öppnar Google…");
    try {
      const token = await requestGoogleToken();
      const result = await createStillaSpreadsheet(token);
      const connection = {
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl:
          result.spreadsheetUrl ??
          `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`,
        title: result.properties?.title ?? "Stilla Books",
      };
      await writeStillaSpreadsheet(token, result.spreadsheetId, books, goal);
      skipNextSheetWrite.current = true;
      rememberSheet(connection);
      setGoogleToken(token);
      setSheetReady(true);
      setSyncState("synced");
      setSyncMessage("Ditt Stilla Books-ark är skapat och anslutet.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Arket kunde inte skapas.");
    }
  }

  async function connectExistingSheet() {
    setSyncState("connecting");
    setSyncMessage("Öppnar Google…");
    try {
      const token = await requestGoogleToken();
      const connection = await pickStillaSpreadsheet(token);
      const snapshot = await readStillaSpreadsheet(token, connection.spreadsheetId);
      skipNextSheetWrite.current = true;
      setBooks(snapshot.books);
      setGoal(snapshot.goal);
      rememberSheet(connection);
      setGoogleToken(token);
      setSheetReady(true);
      setSyncState("synced");
      setSyncMessage("Ditt Google Sheet är anslutet.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(
        error instanceof Error ? error.message : "Kalkylarket kunde inte anslutas.",
      );
    }
  }

  async function refreshSheet() {
    if (!sheetConnection) return;
    setSyncState("connecting");
    setSyncMessage("Läser från ditt Google Sheet…");
    try {
      const token = await requestGoogleToken();
      const snapshot = await readStillaSpreadsheet(
        token,
        sheetConnection.spreadsheetId,
      );
      skipNextSheetWrite.current = true;
      setBooks(snapshot.books);
      setGoal(snapshot.goal);
      setGoogleToken(token);
      setSheetReady(true);
      setSyncState("synced");
      setSyncMessage("Biblioteket är uppdaterat från Google Sheet.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(
        error instanceof Error ? error.message : "Kunde inte läsa från Google Sheet.",
      );
    }
  }

  return (
    <div className="min-h-screen">
      <a className="skip-link" href="#main-content">
        Hoppa till innehållet
      </a>
      <TopLine value={goal ? Math.min(readThisYear / goal, 1) : 0} hasGoal={Boolean(goal)} />
      <Header page={page} navigate={navigate} openMenu={() => setMobileNav(true)} />
      {sheetConnection && !googleToken && (
        <div className="page-shell">
          <div className="sync-notice" role="status">
            <span>Ditt ark är ihågkommet, men Google behöver återanslutas för synkning.</span>
            <button
              className="text-link whitespace-nowrap"
              onClick={refreshSheet}
              disabled={syncState === "connecting"}
            >
              {syncState === "connecting" ? "Ansluter…" : "Återanslut"}
            </button>
          </div>
        </div>
      )}
      <main id="main-content">
        {page === "home" && (
          <HomePage
            featured={featured}
            reading={reading}
            wantToRead={activeBooks.filter((book) => book.status === "want_to_read")}
            goal={goal}
            readThisYear={readThisYear}
            year={CURRENT_YEAR}
            openBook={setSelectedBook}
            navigate={navigate}
            featureBook={(book) => updateBook(book.id, { isFeaturedReading: true })}
          />
        )}
        {page === "library" && (
          <LibraryPage
            books={activeBooks}
            query={libraryQuery}
            setQuery={setLibraryQuery}
            openBook={setSelectedBook}
            navigate={navigate}
          />
        )}
        {page === "add" && (
          <AddBookPage
            existingBooks={books}
            onAdd={(book) => {
              setBooks((current) => [...current, book]);
              setPage("library");
            }}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            goal={goal}
            setGoal={setGoal}
            connection={sheetConnection}
            configured={isGoogleConfigured()}
            syncState={syncState}
            syncMessage={syncMessage}
            archivedBooks={books.filter((book) => book.archived)}
            createSheet={createSheet}
            connectSheet={connectExistingSheet}
            refreshSheet={refreshSheet}
            restoreBook={(id) => updateBook(id, { archived: false })}
          />
        )}
      </main>
      <footer className="page-shell border-t border-ink/10 py-8 text-xs text-muted">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <p>Stilla Books · En privat plats för läsning och eftertanke.</p>
          <nav className="flex gap-5" aria-label="Juridisk information">
            <a
              className="transition-colors hover:text-ink"
              href={`${import.meta.env.BASE_URL}privacy.html`}
            >
              Integritet
            </a>
            <a
              className="transition-colors hover:text-ink"
              href={`${import.meta.env.BASE_URL}terms.html`}
            >
              Villkor
            </a>
          </nav>
        </div>
      </footer>

      <BookPanel
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
        changeStatus={changeStatus}
        updateBook={updateBook}
      />
      <Celebration
        book={celebrating}
        onClose={() => setCelebrating(null)}
        onFeedback={setFeedback}
      />
      <MobileNavigation
        open={mobileNav}
        close={() => setMobileNav(false)}
        navigate={navigate}
      />
    </div>
  );
}

function TopLine({ value, hasGoal }: { value: number; hasGoal: boolean }) {
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-9 bg-paper px-4 pt-2 md:px-7" aria-hidden="true">
      <svg viewBox="0 0 1000 24" preserveAspectRatio="none" className="absolute bottom-1.5 left-0 h-6 w-[calc(100%-3.75rem)] overflow-visible">
        <path
          d="M0 14 C140 12, 250 16, 380 13 S650 15, 815 13 S930 14, 1000 13"
          pathLength="1"
          className="line-draw fill-none stroke-ink/25"
          strokeWidth="1"
        />
        {hasGoal && (
          <path
            d="M0 14 C140 12, 250 16, 380 13 S650 15, 815 13 S930 14, 1000 13"
            pathLength="1"
            className="line-draw fill-none stroke-gold"
            strokeWidth="1.5"
            style={{ strokeDasharray: `${value} 1` }}
          />
        )}
      </svg>
      <svg viewBox="0 0 42 26" className="absolute bottom-1 right-4 h-[26px] w-[42px] overflow-visible md:right-7">
        <path
          d="M0 14 C4 14 6 13 9 12 C14 8 20 8 21 11 L21 22 C18 19 13 18 8 20 C5 21 2 20 0 19 M21 11 C23 8 29 8 34 11 C37 13 39 14 42 14 M21 11 L21 22 C24 19 29 18 34 20 C37 21 40 20 42 19 L42 14"
          className="book-line fill-none stroke-ink/50"
          strokeWidth="1.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Header({
  page,
  navigate,
  openMenu,
}: {
  page: Page;
  navigate: (page: Page) => void;
  openMenu: () => void;
}) {
  return (
    <header className="mx-auto flex max-w-[1280px] items-center justify-between px-5 pb-4 pt-14 md:px-10 lg:px-16">
      <button onClick={() => navigate("home")} className="text-left" aria-label="Gå till Min läsning">
        <span className="font-serif text-2xl tracking-[-0.02em]">Stilla</span>
        <span className="ml-2 text-[10px] uppercase tracking-[0.24em] text-muted">Books</span>
      </button>
      <nav className="hidden items-center gap-8 md:flex" aria-label="Huvudnavigation">
        {[
          ["home", "Min läsning"],
          ["library", "Biblioteket"],
          ["add", "Lägg till"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => navigate(value as Page)}
            className={cn(
              "nav-link text-sm text-muted",
              page === value && "active text-ink",
            )}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => navigate("settings")}
          className={cn("text-muted transition-colors hover:text-ink", page === "settings" && "text-ink")}
          aria-label="Inställningar"
        >
          <Settings className="size-[18px] stroke-[1.4]" />
        </button>
      </nav>
      <button onClick={openMenu} className="md:hidden" aria-label="Öppna meny">
        <Menu className="size-6 stroke-[1.3]" />
      </button>
    </header>
  );
}

function HomePage({
  featured,
  reading,
  wantToRead,
  goal,
  readThisYear,
  year,
  openBook,
  navigate,
  featureBook,
}: {
  featured?: Book;
  reading: Book[];
  wantToRead: Book[];
  goal: number | null;
  readThisYear: number;
  year: number;
  openBook: (book: Book) => void;
  navigate: (page: Page) => void;
  featureBook: (book: Book) => void;
}) {
  const others = reading.filter((book) => book.id !== featured?.id);
  return (
    <div className="page-shell">
      <section className="pb-16 pt-12 md:pb-24 md:pt-20">
        <p className="eyebrow">Min läsning</p>
        <h1 className="mt-4 max-w-2xl font-serif text-5xl leading-[0.98] tracking-[-0.035em] md:text-7xl">
          Nästa berättelse <em className="font-normal text-sage-dark">väntar.</em>
        </h1>
        {goal && (
          <p className="mt-6 text-sm text-muted">
            {readThisYear} av {goal} böcker under {year}
          </p>
        )}
      </section>

      {featured ? (
        <section className="featured-grid border-y border-ink/10 py-10 md:py-16">
          <div className="flex justify-center md:justify-start">
            <button onClick={() => openBook(featured)} className="cover-button">
              <BookCover book={featured} className="w-44 md:w-64" />
            </button>
          </div>
          <div className="flex flex-col justify-center">
            <p className="eyebrow">Läser just nu</p>
            <h2 className="mt-4 font-serif text-4xl tracking-[-0.025em] md:text-6xl">{featured.title}</h2>
            <p className="mt-2 text-sm text-muted">{featured.authors.join(", ")}</p>
            <p className="mt-7 max-w-xl font-serif text-xl leading-relaxed text-ink/75">
              {featured.description}
            </p>
            <button onClick={() => openBook(featured)} className="text-link mt-8 self-start">
              Öppna boken <ChevronRight className="size-4" />
            </button>
          </div>
        </section>
      ) : (
        <section className="quiet-empty">
          <BookOpen className="size-8 stroke-[1]" />
          {wantToRead.length ? (
            <>
              <h2 className="font-serif text-3xl">Vad vill du läsa nu?</h2>
              <Button onClick={() => navigate("library")} variant="secondary">
                Välj från biblioteket
              </Button>
            </>
          ) : (
            <>
              <h2 className="font-serif text-3xl">Din första berättelse väntar.</h2>
              <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
                Sök efter en bok du vill läsa, läser just nu eller redan bär med dig.
              </p>
              <Button onClick={() => navigate("add")}>Sök efter en bok</Button>
            </>
          )}
        </section>
      )}

      {others.length > 0 && (
        <BookRow
          title="Också på nattduksbordet"
          books={others}
          openBook={openBook}
          action={(book) => (
            <button className="mini-action" onClick={() => featureBook(book)}>Gör till huvudbok</button>
          )}
        />
      )}
      {wantToRead.length > 0 && (
        <BookRow
          title="Väntar på att bli öppnade"
          books={wantToRead.slice(0, 4)}
          openBook={openBook}
          linkLabel="Se hela biblioteket"
          onLink={() => navigate("library")}
        />
      )}
    </div>
  );
}

function BookRow({
  title,
  books,
  openBook,
  linkLabel,
  onLink,
  action,
}: {
  title: string;
  books: Book[];
  openBook: (book: Book) => void;
  linkLabel?: string;
  onLink?: () => void;
  action?: (book: Book) => React.ReactNode;
}) {
  return (
    <section className="py-16 md:py-24">
      <div className="mb-8 flex items-end justify-between">
        <h2 className="font-serif text-3xl tracking-[-0.02em] md:text-4xl">{title}</h2>
        {linkLabel && (
          <button onClick={onLink} className="text-link hidden sm:flex">{linkLabel}<ChevronRight className="size-4" /></button>
        )}
      </div>
      <div className="book-scroll">
        {books.map((book) => (
          <article key={book.id} className="group min-w-36 sm:min-w-44">
            <button onClick={() => openBook(book)} className="cover-button w-full text-left">
              <BookCover book={book} className="w-full" />
              <h3 className="mt-4 font-serif text-xl leading-tight">{book.title}</h3>
              <p className="mt-1 text-xs text-muted">{book.authors.join(", ")}</p>
            </button>
            {action?.(book)}
          </article>
        ))}
      </div>
      {linkLabel && <button onClick={onLink} className="text-link mt-8 sm:hidden">{linkLabel}<ChevronRight className="size-4" /></button>}
    </section>
  );
}

function LibraryPage({
  books,
  query,
  setQuery,
  openBook,
  navigate,
}: {
  books: Book[];
  query: string;
  setQuery: (query: string) => void;
  openBook: (book: Book) => void;
  navigate: (page: Page) => void;
}) {
  const [tab, setTab] = useState<BookStatus>("want_to_read");
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase("sv");
    return books.filter(
      (book) =>
        book.status === tab &&
        (!needle ||
          [book.title, book.authors.join(" "), book.genres.join(" ")]
            .join(" ")
            .toLocaleLowerCase("sv")
            .includes(needle)),
    );
  }, [books, query, tab]);

  return (
    <div className="page-shell pb-24 pt-12 md:pt-20">
      <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow">Din samling</p>
          <h1 className="mt-3 font-serif text-5xl tracking-[-0.035em] md:text-7xl">Biblioteket</h1>
        </div>
        <Button variant="secondary" onClick={() => navigate("add")}><Plus className="size-4" /> Lägg till bok</Button>
      </div>
      <div className="search-field mt-12">
        <Search className="size-5 stroke-[1.3] text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sök på titel, författare eller genre"
          aria-label="Sök i biblioteket"
        />
      </div>
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as BookStatus)} className="mt-10">
        <Tabs.List className="tab-list" aria-label="Bokstatus">
          {(["want_to_read", "reading", "read"] as BookStatus[]).map((status) => (
            <Tabs.Trigger key={status} value={status} className="tab-trigger">
              {statusLabel[status]}
              <span>{books.filter((book) => book.status === status).length}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={tab} className="mt-12 outline-none">
          {filtered.length ? (
            <div className="library-grid">
              {filtered.map((book) => (
                <button key={book.id} onClick={() => openBook(book)} className="book-tile">
                  <BookCover book={book} className="w-full" />
                  <h2 className="mt-4 min-h-12 font-serif text-xl leading-tight">{book.title}</h2>
                  <p className="mt-1 text-xs text-muted">{book.authors.join(", ")}</p>
                  {book.feedback && <FeedbackLabel feedback={book.feedback} />}
                </button>
              ))}
            </div>
          ) : (
            <div className="quiet-empty">
              <Search className="size-7 stroke-[1]" />
              <h2 className="font-serif text-2xl">Inga böcker här ännu</h2>
              <p className="max-w-sm text-center text-sm text-muted">
                {query ? "Prova ett annat sökord." : "När en bok får den här statusen dyker den upp här."}
              </p>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

interface SearchResult {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  subject?: string[];
  language?: string[];
}

function shortenDescription(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 237).trimEnd()}…` : cleaned;
}

function AddBookPage({
  existingBooks,
  onAdd,
}: {
  existingBooks: Book[];
  onAdd: (book: Book) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingKey, setAddingKey] = useState("");
  const [error, setError] = useState("");

  async function searchBooks(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8&fields=key,title,author_name,cover_i,first_publish_year,subject,language`);
      if (!response.ok) throw new Error("search_failed");
      const data = (await response.json()) as { docs: SearchResult[] };
      setResults(data.docs);
    } catch {
      setError("Sökningen nådde inte bokkatalogen. Försök igen om en liten stund.");
    } finally {
      setLoading(false);
    }
  }

  async function addResult(result: SearchResult, status: BookStatus) {
    const today = new Date().toISOString().slice(0, 10);
    const authors = result.author_name?.slice(0, 3) ?? ["Okänd författare"];
    if (
      isDuplicateBook(existingBooks, {
        externalId: result.key,
        title: result.title,
        authors,
      })
    ) {
      setError("Den här boken finns redan i ditt bibliotek.");
      return;
    }

    setAddingKey(result.key);
    setError("");
    let description = result.first_publish_year
      ? `Först utgiven ${result.first_publish_year}.`
      : "Beskrivning saknas.";
    let genres = result.subject?.slice(0, 3) ?? [];
    try {
      const detailResponse = await fetch(`https://openlibrary.org${result.key}.json`);
      if (detailResponse.ok) {
        const details = (await detailResponse.json()) as {
          description?: string | { value?: string };
          subjects?: string[];
        };
        const detailDescription =
          typeof details.description === "string"
            ? details.description
            : details.description?.value;
        if (detailDescription) description = shortenDescription(detailDescription);
        if (details.subjects?.length) genres = details.subjects.slice(0, 3);
      }
    } catch {
      // Sökresultatets enklare metadata är en trygg reserv.
    }

    const candidate: Book = {
      id: crypto.randomUUID(),
      externalId: result.key,
      title: result.title,
      authors,
      coverUrl: result.cover_i ? `https://covers.openlibrary.org/b/id/${result.cover_i}-L.jpg` : undefined,
      description,
      genres,
      language: result.language?.includes("swe") ? "sv" : result.language?.[0],
      status,
      isFeaturedReading:
        status === "reading" &&
        !existingBooks.some((book) => !book.archived && book.status === "reading"),
      startedAt: status === "reading" ? today : undefined,
      createdAt: today,
      updatedAt: today,
      coverTone: "sage",
    };
    onAdd(candidate);
    setAddingKey("");
  }

  return (
    <div className="page-shell pb-24 pt-12 md:pt-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">En ny berättelse</p>
        <h1 className="mt-4 font-serif text-5xl tracking-[-0.035em] md:text-7xl">Lägg till en bok</h1>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-muted">
          Sök efter en titel eller författare. Du väljer själv om boken väntar på hyllan eller följer med direkt.
        </p>
        <form onSubmit={searchBooks} className="search-field mx-auto mt-10">
          <Search className="size-5 stroke-[1.3] text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Till exempel Piranesi eller Tove Jansson" aria-label="Sök efter bok" />
          <Button type="submit" disabled={loading || query.trim().length < 2}>{loading ? "Söker…" : "Sök"}</Button>
        </form>
      </div>
      {error && <p className="mx-auto mt-8 max-w-xl text-center text-sm text-[#895e52]">{error}</p>}
      {results.length > 0 && (
        <div className="search-results mt-14">
          {results.map((result) => (
            <article key={result.key} className="search-result">
              {result.cover_i ? (
                <img src={`https://covers.openlibrary.org/b/id/${result.cover_i}-M.jpg`} alt="" className="h-32 w-20 rounded-[2px] object-cover" />
              ) : (
                <div className="flex h-32 w-20 items-center justify-center rounded-[2px] bg-paper-soft"><BookOpen className="size-5 stroke-[1] text-muted" /></div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-2xl leading-tight">{result.title}</h2>
                <p className="mt-1 text-xs text-muted">{result.author_name?.slice(0, 3).join(", ") ?? "Okänd författare"}</p>
                {result.first_publish_year && <p className="mt-3 text-xs text-muted">Först utgiven {result.first_publish_year}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={Boolean(addingKey)}
                    onClick={() => addResult(result, "want_to_read")}
                  >
                    {addingKey === result.key ? "Lägger till…" : "Vill läsa"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={Boolean(addingKey)}
                    onClick={() => addResult(result, "reading")}
                  >
                    Börja läsa
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  goal,
  setGoal,
  connection,
  configured,
  syncState,
  syncMessage,
  archivedBooks,
  createSheet,
  connectSheet,
  refreshSheet,
  restoreBook,
}: {
  goal: number | null;
  setGoal: (goal: number | null) => void;
  connection: SheetConnection | null;
  configured: boolean;
  syncState: SyncState;
  syncMessage: string;
  archivedBooks: Book[];
  createSheet: () => void;
  connectSheet: () => void;
  refreshSheet: () => void;
  restoreBook: (id: string) => void;
}) {
  const [draftGoal, setDraftGoal] = useState(goal?.toString() ?? "");
  const busy = syncState === "connecting" || syncState === "syncing";
  useEffect(() => {
    setDraftGoal(goal?.toString() ?? "");
  }, [goal]);
  return (
    <div className="page-shell pb-24 pt-12 md:pt-20">
      <p className="eyebrow">Din plats</p>
      <h1 className="mt-3 font-serif text-5xl tracking-[-0.035em] md:text-7xl">Inställningar</h1>
      <div className="settings-grid mt-14">
        <section className="paper-panel">
          <p className="eyebrow">Boksamlingen</p>
          <h2 className="mt-3 font-serif text-3xl">Google Sheet</h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
            {connection
              ? "Ditt bibliotek sparas i kalkylarket du har valt. Arket är privat i din egen Google Drive."
              : "Skapa ett nytt Stilla Books-ark med ditt nuvarande bibliotek, eller välj ett ark som tidigare skapats av appen."}
          </p>
          {connection && (
            <a
              href={connection.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex font-serif text-xl text-ink underline decoration-ink/20 underline-offset-4 transition-colors hover:decoration-ink/50"
            >
              {connection.title}
            </a>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            {connection ? (
              <>
                <Button onClick={refreshSheet} disabled={!configured || busy}>
                  {busy ? "Ansluter…" : "Läs in från arket"}
                </Button>
                <Button variant="secondary" onClick={connectSheet} disabled={!configured || busy}>
                  Byt ark
                </Button>
              </>
            ) : (
              <>
                <Button onClick={createSheet} disabled={!configured || busy}>
                  {busy ? "Ansluter…" : "Skapa mitt ark"}
                </Button>
                <Button variant="secondary" onClick={connectSheet} disabled={!configured || busy}>
                  Anslut befintligt
                </Button>
              </>
            )}
          </div>
          {syncMessage && (
            <p
              className={cn(
                "mt-4 text-xs",
                syncState === "error" ? "text-[#895e52]" : "text-muted",
              )}
              role={syncState === "error" ? "alert" : "status"}
            >
              {syncMessage}
            </p>
          )}
          {!configured && (
            <p className="mt-4 text-xs text-[#895e52]">
              Google-konfigurationen saknas i den här versionen av appen.
            </p>
          )}
        </section>
        <section className="paper-panel">
          <p className="eyebrow">Den kontinuerliga linjen</p>
          <h2 className="mt-3 font-serif text-3xl">Läsmål {CURRENT_YEAR}</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted">Frivilligt. Utan mål får linjen bara vara en linje.</p>
          <div className="mt-7 flex items-center gap-3">
            <input
              type="number"
              min="1"
              max="365"
              value={draftGoal}
              onChange={(event) => setDraftGoal(event.target.value)}
              className="goal-input"
              aria-label="Antal böcker i årets läsmål"
            />
            <Button onClick={() => setGoal(draftGoal ? Number(draftGoal) : null)}>Spara</Button>
          </div>
          {goal && <button onClick={() => { setGoal(null); setDraftGoal(""); }} className="text-link mt-5">Ta bort läsmålet</button>}
        </section>
        {archivedBooks.length > 0 && (
          <section className="paper-panel lg:col-span-2">
            <p className="eyebrow">Undanställda berättelser</p>
            <h2 className="mt-3 font-serif text-3xl">Arkiverade böcker</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Böcker du tagit bort ligger kvar i arket och kan återställas här.
            </p>
            <div className="mt-7 divide-y divide-ink/10">
              {archivedBooks.map((book) => (
                <div
                  key={book.id}
                  className="flex flex-col justify-between gap-3 py-4 first:pt-0 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-serif text-xl">{book.title}</p>
                    <p className="mt-1 text-xs text-muted">{book.authors.join(", ")}</p>
                  </div>
                  <button className="text-link self-start sm:self-auto" onClick={() => restoreBook(book.id)}>
                    Återställ
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function BookPanel({
  book,
  onClose,
  changeStatus,
  updateBook,
}: {
  book: Book | null;
  onClose: () => void;
  changeStatus: (book: Book, status: BookStatus) => void;
  updateBook: (id: string, changes: Partial<Book>) => void;
}) {
  return (
    <Dialog.Root open={Boolean(book)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="book-dialog">
          {book && (
            <>
              <Dialog.Close className="dialog-close" aria-label="Stäng"><X className="size-5 stroke-[1.3]" /></Dialog.Close>
              <div className="book-dialog-grid">
                <BookCover book={book} className="mx-auto w-40 md:w-full" />
                <div className="flex flex-col">
                  <p className="eyebrow">{statusLabel[book.status]}</p>
                  <Dialog.Title className="mt-3 font-serif text-4xl leading-none tracking-[-0.025em] md:text-5xl">{book.title}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-muted">{book.authors.join(", ")}</Dialog.Description>
                  <p className="mt-7 font-serif text-lg leading-relaxed text-ink/75">{book.description}</p>
                  {book.genres.length > 0 && <p className="mt-5 text-xs tracking-wide text-muted">{book.genres.join(" · ")}</p>}
                  {book.feedback && <FeedbackLabel feedback={book.feedback} className="mt-6" />}
                  <div className="mt-8 flex flex-wrap gap-2">
                    {book.status !== "want_to_read" && <Button variant="secondary" onClick={() => changeStatus(book, "want_to_read")}>Vill läsa</Button>}
                    {book.status !== "reading" && <Button variant="secondary" onClick={() => changeStatus(book, "reading")}>Läser</Button>}
                    {book.status !== "read" && <Button onClick={() => changeStatus(book, "read")}><Check className="size-4" /> Markera som läst</Button>}
                  </div>
                  {book.status === "reading" && !book.isFeaturedReading && (
                    <button onClick={() => updateBook(book.id, { isFeaturedReading: true })} className="text-link mt-5 self-start">Visa som huvudbok</button>
                  )}
                  {book.status === "read" && (
                    <div className="mt-8 border-t border-ink/10 pt-6">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted">Hur kändes den?</p>
                      <FeedbackButtons book={book} onFeedback={(feedback) => updateBook(book.id, { feedback })} />
                    </div>
                  )}
                  <button
                    className="mt-10 self-start text-xs text-muted underline decoration-ink/20 underline-offset-4 hover:text-ink"
                    onClick={() => {
                      if (window.confirm("Ta bort boken från ditt bibliotek? Den kan återställas senare.")) {
                        updateBook(book.id, { archived: true });
                        onClose();
                      }
                    }}
                  >
                    Ta bort från mitt bibliotek
                  </button>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Celebration({
  book,
  onClose,
  onFeedback,
}: {
  book: Book | null;
  onClose: () => void;
  onFeedback: (book: Book, feedback: Feedback) => void;
}) {
  return (
    <Dialog.Root open={Boolean(book)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="celebration-dialog">
          {book && (
            <>
              <div className="page-turn" aria-hidden="true"><BookOpen className="size-8 stroke-[1]" /></div>
              <p className="eyebrow">Utläst</p>
              <Dialog.Title className="mt-4 font-serif text-4xl leading-tight">Ännu en berättelse<br />att bära med sig.</Dialog.Title>
              <Dialog.Description className="mt-3 text-sm text-muted">{book.title}</Dialog.Description>
              <div className="my-8 h-px w-16 bg-gold/70" />
              <p className="font-serif text-xl">Hur kändes den?</p>
              <FeedbackButtons book={book} onFeedback={(feedback) => onFeedback(book, feedback)} centered />
              <button onClick={onClose} className="mt-7 text-xs text-muted underline decoration-ink/20 underline-offset-4">Hoppa över</button>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FeedbackButtons({
  book,
  onFeedback,
  centered,
}: {
  book: Book;
  onFeedback: (feedback: Feedback) => void;
  centered?: boolean;
}) {
  return (
    <div className={cn("mt-4 flex flex-wrap gap-2", centered && "justify-center")}>
      {(Object.keys(feedbackMeta) as Feedback[]).map((feedback) => {
        const { label, icon: Icon } = feedbackMeta[feedback];
        return (
          <button
            key={feedback}
            onClick={() => onFeedback(feedback)}
            className={cn("feedback-button", book.feedback === feedback && "selected")}
            data-feedback={feedback}
            aria-pressed={book.feedback === feedback}
          >
            <Icon className="size-4 stroke-[1.4]" /> {label}
          </button>
        );
      })}
    </div>
  );
}

function FeedbackLabel({ feedback, className }: { feedback: Feedback; className?: string }) {
  const { label, icon: Icon } = feedbackMeta[feedback];
  return <span className={cn("feedback-label", className)}><Icon className="size-3.5 stroke-[1.4]" /> {label}</span>;
}

function MobileNavigation({
  open,
  close,
  navigate,
}: {
  open: boolean;
  close: () => void;
  navigate: (page: Page) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="mobile-dialog">
          <Dialog.Title className="sr-only">Meny</Dialog.Title>
          <Dialog.Close className="dialog-close" aria-label="Stäng"><X className="size-5" /></Dialog.Close>
          <p className="font-serif text-3xl">Stilla Books</p>
          <nav className="mt-12 flex flex-col items-start gap-6">
            <button onClick={() => navigate("home")}><BookOpen /> Min läsning</button>
            <button onClick={() => navigate("library")}><Library /> Biblioteket</button>
            <button onClick={() => navigate("add")}><Plus /> Lägg till bok</button>
            <button onClick={() => navigate("settings")}><Settings /> Inställningar</button>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
