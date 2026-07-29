import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Heart,
  Library,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
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
import {
  sortBooks,
  type LibrarySortOrder,
} from "./lib/bookSorting";
import {
  clearGoogleAuthorization,
  loadGoogleAuthorization,
  storeGoogleAuthorization,
  type GoogleAuthorization,
} from "./lib/googleSession";
import {
  hashForPage,
  pageFromHash,
  type AppPage as Page,
} from "./lib/pageRouting";
import { cn } from "./lib/utils";
import {
  createStillaSpreadsheet,
  isGoogleConfigured,
  pickStillaSpreadsheet,
  readStillaSpreadsheet,
  requestGoogleToken,
  writeStillaSpreadsheet,
} from "./services/googleSheets";
import {
  findBookCoverCandidates as findOpenLibraryCoverCandidates,
  shortenDescription,
} from "./services/openLibrary";
import type {
  BookCoverCandidate,
  BookMetadataCandidate,
} from "./services/bookCatalog";
import { findGoogleBookCoverCandidates } from "./services/googleBooks";
import {
  findLibrisMetadataCandidates,
  metadataFromLibrisCandidate,
  searchLibrisEditions,
} from "./services/libris";
import type {
  Book,
  BookStatus,
  CoverTone,
  Feedback,
  ManualBookField,
} from "./types";

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

const languageNames: Record<string, string> = {
  sv: "Svenska",
  swe: "Svenska",
  en: "Engelska",
  eng: "Engelska",
  nor: "Norska",
  dan: "Danska",
  fin: "Finska",
  isl: "Isländska",
  deu: "Tyska",
  ger: "Tyska",
  fra: "Franska",
  fre: "Franska",
  spa: "Spanska",
  ita: "Italienska",
};

function languageLabel(code: string) {
  return languageNames[code.toLocaleLowerCase("sv")] ?? code;
}

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
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash));
  const [books, setBooks] = useState<Book[]>(loadBooks);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [celebrating, setCelebrating] = useState<Book | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [sheetConnection, setSheetConnection] = useState<SheetConnection | null>(
    loadSheetConnection,
  );
  const [googleAuthorization, setGoogleAuthorization] =
    useState<GoogleAuthorization | null>(
      () => loadGoogleAuthorization(sessionStorage),
    );
  const googleToken = googleAuthorization?.accessToken ?? null;
  const [sheetReady, setSheetReady] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const skipNextSheetWrite = useRef(false);
  const shouldRestoreSheet = useRef(
    Boolean(sheetConnection && googleAuthorization),
  );
  const sheetWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const [goal, setGoal] = useState<number | null>(() => {
    const saved = localStorage.getItem("stilla-reading-goal");
    return saved ? Number(saved) : import.meta.env.DEV ? 12 : null;
  });

  useEffect(() => {
    localStorage.setItem("stilla-demo-books", JSON.stringify(books));
  }, [books]);

  useEffect(() => {
    function handleHashChange() {
      setPage(pageFromHash(window.location.hash));
      setMobileNav(false);
      setSelectedBook(null);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (goal) localStorage.setItem("stilla-reading-goal", String(goal));
    else localStorage.removeItem("stilla-reading-goal");
  }, [goal]);

  useEffect(() => {
    if (
      !shouldRestoreSheet.current ||
      !sheetConnection ||
      !googleToken
    ) {
      return;
    }
    shouldRestoreSheet.current = false;
    let cancelled = false;
    setSyncState("connecting");
    setSyncMessage("Återansluter till ditt Google Sheet…");

    readStillaSpreadsheet(googleToken, sheetConnection.spreadsheetId)
      .then((snapshot) => {
        if (cancelled) return;
        skipNextSheetWrite.current = true;
        setBooks(snapshot.books);
        setGoal(snapshot.goal);
        setSheetReady(true);
        setSyncState("synced");
        setSyncMessage("Ditt Google Sheet är anslutet.");
      })
      .catch((error) => {
        if (cancelled) return;
        clearGoogleAuthorization(sessionStorage);
        setGoogleAuthorization(null);
        setSyncState("error");
        setSyncMessage(
          error instanceof Error
            ? error.message
            : "Google-sessionen behöver anslutas igen.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [googleToken, sheetConnection]);

  useEffect(() => {
    if (!googleAuthorization) return;
    const refreshIn = Math.max(
      googleAuthorization.expiresAt - Date.now() - 60_000,
      0,
    );
    const timeout = window.setTimeout(async () => {
      try {
        const renewed = await requestGoogleToken("none");
        storeGoogleAuthorization(sessionStorage, renewed);
        setGoogleAuthorization(renewed);
      } catch {
        clearGoogleAuthorization(sessionStorage);
        setGoogleAuthorization(null);
        setSheetReady(false);
        setSyncState("idle");
        setSyncMessage(
          "Google behöver en kort återanslutning för att fortsätta synka.",
        );
      }
    }, refreshIn);

    return () => window.clearTimeout(timeout);
  }, [googleAuthorization]);

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
  }, [
    books,
    goal,
    googleToken,
    sheetConnection,
    sheetReady,
  ]);

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

  async function withWritableSheet(change: () => void) {
    if (!sheetConnection) {
      setSyncState("error");
      setSyncMessage(
        "Välj eller skapa ett Google Sheet innan du sparar ändringar.",
      );
      navigate("settings");
      return false;
    }

    if (!googleToken || !sheetReady) {
      setSyncState("connecting");
      setSyncMessage("Återansluter till Google innan ändringen sparas…");
      try {
        const token = rememberGoogleAuthorization(await requestGoogleToken());
        const snapshot = await readStillaSpreadsheet(
          token,
          sheetConnection.spreadsheetId,
        );
        skipNextSheetWrite.current = true;
        setBooks(snapshot.books);
        setGoal(snapshot.goal);
        setSheetReady(true);
      } catch (error) {
        clearGoogleAuthorization(sessionStorage);
        setGoogleAuthorization(null);
        setSheetReady(false);
        setSyncState("error");
        setSyncMessage(
          error instanceof Error
            ? error.message
            : "Google Sheet kunde inte anslutas. Ändringen sparades inte.",
        );
        return false;
      }
    }

    skipNextSheetWrite.current = false;
    change();
    setSyncState("syncing");
    setSyncMessage("Sparar stilla i ditt Google Sheet…");
    return true;
  }

  async function updateBook(id: string, changes: Partial<Book>) {
    const updatedAt = new Date().toISOString();
    return withWritableSheet(() => {
      setBooks((current) =>
        current.map((book) =>
          book.id === id
            ? { ...book, ...changes, updatedAt }
            : changes.isFeaturedReading && book.isFeaturedReading
              ? { ...book, isFeaturedReading: false, updatedAt }
              : book,
        ),
      );
      setSelectedBook((current) =>
        current?.id === id ? { ...current, ...changes, updatedAt } : current,
      );
    });
  }

  async function refreshOneBook(book: Book) {
    const candidates = await findLibrisMetadataCandidates(book);
    return candidates.length
      ? { status: "choose" as const, candidates }
      : { status: "not_found" as const, candidates: [] };
  }

  async function chooseBookCandidate(
    book: Book,
    candidate: BookMetadataCandidate,
  ) {
    const metadata = metadataFromLibrisCandidate(book, candidate);
    return updateBook(book.id, metadata);
  }

  async function changeStatus(book: Book, status: BookStatus) {
    const updatedAt = new Date().toISOString();
    return withWritableSheet(() => {
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
      setBooks((current) =>
        current.map((currentBook) =>
          currentBook.id === book.id
            ? { ...currentBook, ...changes, updatedAt }
            : changes.isFeaturedReading && currentBook.isFeaturedReading
              ? { ...currentBook, isFeaturedReading: false, updatedAt }
              : currentBook,
        ),
      );
    });
  }

  async function setFeedback(book: Book, feedback: Feedback) {
    const saved = await updateBook(book.id, { feedback });
    if (saved) setCelebrating(null);
  }

  function navigate(next: Page) {
    setPage(next);
    const nextHash = hashForPage(next);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rememberSheet(connection: SheetConnection) {
    setSheetConnection(connection);
    localStorage.setItem("stilla-sheet-connection", JSON.stringify(connection));
  }

  function rememberGoogleAuthorization(authorization: GoogleAuthorization) {
    storeGoogleAuthorization(sessionStorage, authorization);
    setGoogleAuthorization(authorization);
    return authorization.accessToken;
  }

  async function createSheet() {
    setSyncState("connecting");
    setSyncMessage("Öppnar Google…");
    try {
      const token = rememberGoogleAuthorization(await requestGoogleToken());
      const result = await createStillaSpreadsheet(token);
      const connection = {
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl:
          result.spreadsheetUrl ??
          `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`,
        title: result.properties?.title ?? "Stilla Books",
      };
      await writeStillaSpreadsheet(
        token,
        result.spreadsheetId,
        books,
        goal,
      );
      skipNextSheetWrite.current = true;
      rememberSheet(connection);
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
      const token = rememberGoogleAuthorization(await requestGoogleToken());
      const connection = await pickStillaSpreadsheet(token);
      const snapshot = await readStillaSpreadsheet(token, connection.spreadsheetId);
      skipNextSheetWrite.current = true;
      setBooks(snapshot.books);
      setGoal(snapshot.goal);
      rememberSheet(connection);
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
      const token = rememberGoogleAuthorization(await requestGoogleToken());
      const snapshot = await readStillaSpreadsheet(
        token,
        sheetConnection.spreadsheetId,
      );
      skipNextSheetWrite.current = true;
      setBooks(snapshot.books);
      setGoal(snapshot.goal);
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
            onAdd={(book) =>
              withWritableSheet(() => {
                setBooks((current) => [...current, book]);
                navigate("library");
              })
            }
          />
        )}
        {page === "settings" && (
          <SettingsPage
            goal={goal}
            setGoal={(nextGoal) => {
              void withWritableSheet(() => setGoal(nextGoal));
            }}
            connection={sheetConnection}
            configured={isGoogleConfigured()}
            syncState={syncState}
            syncMessage={syncMessage}
            createSheet={createSheet}
            connectSheet={connectExistingSheet}
            refreshSheet={refreshSheet}
          />
        )}
      </main>
      <footer className="page-shell pb-8 pt-12 text-xs text-muted">
        <div className="flex min-h-[76px] flex-col justify-between gap-4 border-t border-ink/40 pt-6 sm:flex-row sm:items-start">
          <div className="relative w-fit max-w-[calc(100%-3.5rem)]">
            <p>Stilla Books · En plats för reflektion mellan sidorna.</p>
            <FooterBookmark />
          </div>
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
        refreshBook={refreshOneBook}
        chooseBookCandidate={chooseBookCandidate}
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

function FooterBookmark() {
  return (
    <svg
      viewBox="0 0 75 86"
      className="absolute left-[calc(100%+0.5rem)] top-[-25px] h-[58px] w-[50px] overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="footer-bookmark-clip">
          <path d="M12 0 C17 -1 22 0 26 4 C28 17 36 27 45 38 C54 49 58 62 62 76 L54 71 L50 82 C46 68 42 57 34 47 C25 36 17 23 12 0 Z" />
        </clipPath>
      </defs>
      <path
        d="M12 0 C17 -1 22 0 26 4 C28 17 36 27 45 38 C54 49 58 62 62 76 L54 71 L50 82 C46 68 42 57 34 47 C25 36 17 23 12 0 Z"
        className="fill-paper stroke-ink/40"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g clipPath="url(#footer-bookmark-clip)">
        <path
          d="M22 13 C27 24 35 33 41 43 C47 52 50 61 52 68"
          className="fill-none stroke-sage"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path d="M32 30 C27 29 24 26 23 23 C27 22 31 24 33 27 C34 23 37 20 41 20 C41 24 38 28 33 30" className="fill-sage/75" />
        <path d="M43 49 C38 47 35 44 35 40 C39 40 43 42 44 46 C46 42 49 40 53 40 C52 44 49 48 44 49" className="fill-sage/75" />
        <g className="fill-sage/85">
          <ellipse cx="20" cy="10" rx="2.8" ry="5" />
          <ellipse cx="20" cy="10" rx="2.8" ry="5" transform="rotate(72 20 10)" />
          <ellipse cx="20" cy="10" rx="2.8" ry="5" transform="rotate(144 20 10)" />
          <ellipse cx="20" cy="10" rx="2.8" ry="5" transform="rotate(216 20 10)" />
          <ellipse cx="20" cy="10" rx="2.8" ry="5" transform="rotate(288 20 10)" />
          <circle cx="20" cy="10" r="1.7" className="fill-paper" />
        </g>
      </g>
    </svg>
  );
}

function TopLine({ value, hasGoal }: { value: number; hasGoal: boolean }) {
  return (
    <div className="paper-surface fixed inset-x-0 top-0 z-50 h-11" aria-hidden="true">
      <svg
        viewBox="0 0 1000 32"
        preserveAspectRatio="none"
        className="absolute left-0 top-0 h-8 w-[calc(100%-5rem)] overflow-visible md:w-[calc(100%-5.75rem)]"
      >
        <path
          d="M0 15 C140 13, 250 17, 380 14 S650 16, 815 14 S930 15, 1000 15"
          pathLength="1"
          className="line-draw fill-none stroke-ink/40"
          strokeWidth="1"
        />
        {hasGoal && (
          <path
            d="M0 15 C140 13, 250 17, 380 14 S650 16, 815 14 S930 15, 1000 15"
            pathLength="1"
            className="line-draw fill-none stroke-gold"
            strokeWidth="1.5"
            style={{ strokeDasharray: `${value} 1` }}
          />
        )}
      </svg>
      <svg
        viewBox="0 0 64 44"
        className="absolute right-4 top-0 h-11 w-16 overflow-visible md:right-7"
      >
        <path
          d="M0 15 C3 15 5.5 15.3 8 16"
          className="line-draw fill-none stroke-ink/40"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M8 16 C8.8 11 9 8.5 12 7 C18 4.5 26 6.2 31 12.5 L31 30.5 C24 25.5 15 25 7 29 L8 16 M31 12.5 C36 6.2 44 4.5 50 7 C53 8.5 53.2 11 54 16 L55 29 C47 25 38 25.5 31 30.5 M7 29 C15 27 24 27.5 31 33 C38 27.5 47 27 55 29"
          className="book-line fill-none stroke-ink/40"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M31 30.5 C31 33 32 34 34 34.5 C36 35 36.5 36 36 38"
          className="fill-none stroke-ink/40"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M34.7 37.5 H38.2 V43 L36.45 41.2 L34.7 43 Z"
          className="fill-sage"
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
          <button
            onClick={onLink}
            className="text-link ml-4 max-w-32 shrink-0 justify-end text-right sm:max-w-none"
          >
            {linkLabel}<ChevronRight className="size-4 shrink-0" />
          </button>
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
  const [sortOrder, setSortOrder] = useState<LibrarySortOrder>(() => {
    const saved = localStorage.getItem("stilla-library-sort");
    return ["recent", "title-asc", "title-desc"].includes(saved ?? "")
      ? (saved as LibrarySortOrder)
      : "recent";
  });

  useEffect(() => {
    localStorage.setItem("stilla-library-sort", sortOrder);
  }, [sortOrder]);

  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase("sv");
    const matching = books.filter(
      (book) =>
        book.status === tab &&
        (!needle ||
          [book.title, book.authors.join(" "), book.genres.join(" ")]
            .join(" ")
            .toLocaleLowerCase("sv")
            .includes(needle)),
    );
    return sortBooks(matching, sortOrder);
  }, [books, query, sortOrder, tab]);

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
        <div className="sort-control" aria-label="Sortera biblioteket">
          <span>Ordning</span>
          {[
            ["recent", "Senast tillagd"],
            ["title-asc", "A–Ö"],
            ["title-desc", "Ö–A"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="sort-option"
              data-active={sortOrder === value}
              aria-pressed={sortOrder === value}
              onClick={() =>
                setSortOrder(value as LibrarySortOrder)
              }
            >
              {label}
            </button>
          ))}
        </div>
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

function AddBookPage({
  existingBooks,
  onAdd,
}: {
  existingBooks: Book[];
  onAdd: (book: Book) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookMetadataCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingKey, setAddingKey] = useState("");
  const [error, setError] = useState("");

  async function searchBooks(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError("");
    try {
      const candidates = await searchLibrisEditions(query.trim());
      setResults(candidates);
      if (!candidates.length) {
        setError(
          "Libris hittade ingen tydlig bok. Prova titel tillsammans med författare.",
        );
      }
    } catch {
      setError("Sökningen nådde inte Libris. Försök igen om en liten stund.");
    } finally {
      setLoading(false);
    }
  }

  async function addResult(result: BookMetadataCandidate, status: BookStatus) {
    const today = new Date().toISOString().slice(0, 10);
    const authors = result.authors.length
      ? result.authors.slice(0, 3)
      : ["Okänd författare"];
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
    const description = result.description
      ? shortenDescription(result.description)
      : "Beskrivning saknas.";

    const candidate: Book = {
      id: crypto.randomUUID(),
      externalId: result.key,
      librisId: result.key,
      isbn13: result.isbn13,
      title: result.title,
      subtitle: result.subtitle,
      authors,
      translators: result.translators,
      coverSource: "stilla",
      description,
      genres: result.subjects,
      language: result.languages[0],
      publisher: result.publisher,
      publishedYear: result.publishedYear,
      pageCount: result.pageCount,
      edition: result.edition,
      status,
      isFeaturedReading:
        status === "reading" &&
        !existingBooks.some((book) => !book.archived && book.status === "reading"),
      startedAt: status === "reading" ? today : undefined,
      createdAt: today,
      updatedAt: new Date().toISOString(),
      metadataUpdatedAt: new Date().toISOString(),
      coverTone: "sage",
    };
    const saved = await onAdd(candidate);
    if (!saved) {
      setError(
        "Boken lades inte till eftersom Google Sheet inte kunde anslutas.",
      );
    }
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
              <div className="relative flex h-32 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-paper-soft">
                <BookOpen className="size-5 stroke-[1] text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-2xl leading-tight">{result.title}</h2>
                <p className="mt-1 text-xs text-muted">{result.authors.slice(0, 3).join(", ") || "Okänd författare"}</p>
                <p className="mt-3 text-xs text-muted">
                  {[result.publisher, result.publishedYear, result.languages[0] ? languageLabel(result.languages[0]) : undefined]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[10px] text-muted underline decoration-ink/20 underline-offset-2"
                >
                  Visa posten i Libris
                </a>
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
  createSheet,
  connectSheet,
  refreshSheet,
}: {
  goal: number | null;
  setGoal: (goal: number | null) => void;
  connection: SheetConnection | null;
  configured: boolean;
  syncState: SyncState;
  syncMessage: string;
  createSheet: () => void;
  connectSheet: () => void;
  refreshSheet: () => void;
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
      </div>
    </div>
  );
}

interface BookEditDraft {
  title: string;
  authors: string;
  description: string;
  genres: string;
  finishedAt: string;
}

function BookPanel({
  book,
  onClose,
  changeStatus,
  updateBook,
  refreshBook,
  chooseBookCandidate,
}: {
  book: Book | null;
  onClose: () => void;
  changeStatus: (book: Book, status: BookStatus) => Promise<boolean>;
  updateBook: (id: string, changes: Partial<Book>) => Promise<boolean>;
  refreshBook: (
    book: Book,
  ) => Promise<{
    status: "choose" | "not_found" | "error";
    candidates: BookMetadataCandidate[];
  }>;
  chooseBookCandidate: (
    book: Book,
    candidate: BookMetadataCandidate,
  ) => Promise<boolean>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshCandidates, setRefreshCandidates] = useState<
    BookMetadataCandidate[]
  >([]);
  const [choosingCandidate, setChoosingCandidate] = useState("");
  const [editing, setEditing] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<
    BookCoverCandidate[]
  >([]);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [coverMessage, setCoverMessage] = useState("");
  const [customCoverUrl, setCustomCoverUrl] = useState("");
  const [draft, setDraft] = useState<BookEditDraft>({
    title: "",
    authors: "",
    description: "",
    genres: "",
    finishedAt: "",
  });

  useEffect(() => {
    setRefreshing(false);
    setRefreshMessage("");
    setRefreshCandidates([]);
    setChoosingCandidate("");
    setEditing(false);
    setEditMessage("");
    setCoverPickerOpen(false);
    setCoverCandidates([]);
    setLoadingCovers(false);
    setCoverMessage("");
    setCustomCoverUrl("");
  }, [book?.id]);

  function beginEditing() {
    if (!book) return;
    setDraft({
      title: book.title,
      authors: book.authors.join(", "),
      description: book.description,
      genres: book.genres.join(", "),
      finishedAt: book.finishedAt ?? "",
    });
    setEditMessage("");
    setEditing(true);
  }

  async function saveEdits(event: React.FormEvent) {
    event.preventDefault();
    if (!book) return;
    const title = draft.title.trim();
    const authors = draft.authors
      .split(",")
      .map((author) => author.trim())
      .filter(Boolean);
    if (!title || authors.length === 0) {
      setEditMessage("Titel och minst en författare behöver finnas.");
      return;
    }
    const nextDescription = draft.description.trim();
    const nextGenres = draft.genres
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean);
    const changedManualFields = (
      [
        title !== book.title ? "title" : undefined,
        JSON.stringify(authors) !== JSON.stringify(book.authors)
          ? "authors"
          : undefined,
        nextDescription !== book.description ? "description" : undefined,
        JSON.stringify(nextGenres) !== JSON.stringify(book.genres)
          ? "genres"
          : undefined,
      ] as (ManualBookField | undefined)[]
    ).filter((field): field is ManualBookField => Boolean(field));
    const manualFields = [
      ...(book.manualFields ?? []),
      ...changedManualFields,
    ].filter((field, index, fields) => fields.indexOf(field) === index);
    const saved = await updateBook(book.id, {
      title,
      authors,
      description: nextDescription,
      genres: nextGenres,
      manualFields,
      ...(book.status === "read"
        ? { finishedAt: draft.finishedAt || undefined }
        : {}),
    });
    if (saved) {
      setEditing(false);
      setEditMessage("Ändringarna är sparade.");
    } else {
      setEditMessage("Ändringarna kunde inte sparas i Google Sheet.");
    }
  }

  async function openCoverPicker() {
    if (!book) return;
    setCoverPickerOpen(true);
    setLoadingCovers(true);
    setCoverMessage("");
    setCustomCoverUrl(book.coverUrl ?? "");
    try {
      const metadataCandidates = await findLibrisMetadataCandidates(book);
      const isbnCandidates = metadataCandidates
        .map((candidate) => candidate.isbn13)
        .filter((isbn): isbn is string => Boolean(isbn));
      const [googleResult, openLibraryResult] = await Promise.allSettled([
        findGoogleBookCoverCandidates(book, isbnCandidates),
        findOpenLibraryCoverCandidates(book),
      ]);
      const google =
        googleResult.status === "fulfilled" ? googleResult.value.slice(0, 4) : [];
      const openLibrary =
        openLibraryResult.status === "fulfilled"
          ? openLibraryResult.value
          : [];
      const candidates = [...google, ...openLibrary]
        .filter(
          (candidate, index, values) =>
            values.findIndex(
              (other) =>
                other.coverUrl.split("?")[0] ===
                candidate.coverUrl.split("?")[0],
            ) === index,
        )
        .slice(0, 6);
      setCoverCandidates(candidates);
      if (!candidates.length) {
        setCoverMessage(
          "Inga tydliga utgåveomslag hittades. Du kan välja ett av Stillas omslag eller använda en egen bild.",
        );
      } else if (googleResult.status === "rejected") {
        setCoverMessage(
          "Google Books kunde inte nås, men övriga omslagskällor visas.",
        );
      }
    } catch {
      setCoverCandidates([]);
      setCoverMessage(
        "Omslagskatalogen kunde inte nås just nu. Du kan fortfarande välja ett Stilla-omslag eller använda en egen bild.",
      );
    } finally {
      setLoadingCovers(false);
    }
  }

  async function chooseCover(
    changes: Partial<
      Pick<
        Book,
        | "coverUrl"
        | "coverTone"
        | "coverSource"
        | "coverSourceUrl"
        | "googleBooksId"
      >
    >,
  ) {
    if (!book) return;
    const saved = await updateBook(book.id, changes);
    if (saved) {
      setCoverPickerOpen(false);
      setCoverMessage("");
    } else {
      setCoverMessage("Omslaget kunde inte sparas i Google Sheet.");
    }
  }

  async function saveCustomCover(event: React.FormEvent) {
    event.preventDefault();
    const coverUrl = customCoverUrl.trim();
    if (!coverUrl.toLocaleLowerCase("sv").startsWith("https://")) {
      setCoverMessage("Länken till omslaget behöver börja med https://.");
      return;
    }
    await chooseCover({
      coverUrl,
      coverTone: undefined,
      coverSource: "custom",
      coverSourceUrl: undefined,
      googleBooksId: undefined,
    });
  }

  async function handleRefresh() {
    if (!book) return;
    setRefreshing(true);
    setRefreshMessage("");
    setRefreshCandidates([]);
    try {
      const result = await refreshBook(book);
      setRefreshCandidates(result.candidates);
      setRefreshMessage(
        result.status === "choose"
          ? "Välj den svenska utgåva som stämmer. Inget ändras innan du väljer."
          : result.status === "not_found"
              ? "Bokkatalogen hittade inga alternativ."
            : "Informationen kunde inte sparas i Google Sheet.",
      );
    } catch (error) {
      setRefreshMessage(
        error instanceof Error
          ? error.message
          : "Bokinformationen kunde inte hämtas just nu.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCandidateChoice(candidate: BookMetadataCandidate) {
    if (!book) return;
    setChoosingCandidate(candidate.key);
    setRefreshMessage("");
    try {
      const saved = await chooseBookCandidate(book, candidate);
      if (saved) {
        setRefreshCandidates([]);
        setRefreshMessage("Den valda bokinformationen är uppdaterad.");
        setEditing(false);
      } else {
        setRefreshMessage("Informationen kunde inte sparas i Google Sheet.");
      }
    } catch (error) {
      setRefreshMessage(
        error instanceof Error
          ? error.message
          : "Bokinformationen kunde inte hämtas just nu.",
      );
    } finally {
      setChoosingCandidate("");
    }
  }

  return (
    <Dialog.Root open={Boolean(book)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="book-dialog">
          {book && (
            <>
              <Dialog.Close className="dialog-close" aria-label="Stäng"><X className="size-5 stroke-[1.3]" /></Dialog.Close>
              {coverPickerOpen ? (
                <CoverPicker
                  book={book}
                  candidates={coverCandidates}
                  loading={loadingCovers}
                  message={coverMessage}
                  customCoverUrl={customCoverUrl}
                  setCustomCoverUrl={setCustomCoverUrl}
                  onBack={() => setCoverPickerOpen(false)}
                  onChooseCover={(candidate) =>
                    chooseCover({
                      coverUrl: candidate.coverUrl,
                      coverTone: undefined,
                      coverSource: candidate.source,
                      coverSourceUrl: candidate.sourceUrl,
                      googleBooksId:
                        candidate.source === "google_books"
                          ? candidate.id.replace(/^google:/, "")
                          : undefined,
                    })
                  }
                  onChooseTone={(coverTone) =>
                    chooseCover({
                      coverUrl: undefined,
                      coverTone,
                      coverSource: "stilla",
                      coverSourceUrl: undefined,
                      googleBooksId: undefined,
                    })
                  }
                  onSaveCustom={saveCustomCover}
                  onBrokenCandidate={(id) =>
                    setCoverCandidates((current) =>
                      current.filter((candidate) => candidate.id !== id),
                    )
                  }
                />
              ) : (
              <div className="book-dialog-grid">
                <div className="self-start">
                  <button
                    type="button"
                    className="mx-auto block w-40 rounded-[3px] text-left md:w-full"
                    onClick={openCoverPicker}
                    aria-label={`Byt omslag till ${book.title}`}
                  >
                    <BookCover book={book} className="w-full" />
                  </button>
                  {book.coverSourceUrl && (
                    <a
                      href={book.coverSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mx-auto mt-2 block w-40 text-center text-[9px] tracking-wide text-muted/80 underline decoration-ink/15 underline-offset-2 md:w-full"
                    >
                      {book.coverSource === "google_books"
                        ? "Omslag via Google Books"
                        : book.coverSource === "libris"
                          ? "Omslag via Libris"
                          : book.coverSource === "open_library"
                            ? "Omslag via Open Library"
                            : "Omslagskälla"}
                    </a>
                  )}
                </div>
                <div className="flex flex-col">
                  <p className="eyebrow">{statusLabel[book.status]}</p>
                  <div className="mt-3 flex items-start gap-3">
                    <Dialog.Title className="min-w-0 flex-1 font-serif text-4xl leading-none tracking-[-0.025em] md:text-5xl">{book.title}</Dialog.Title>
                    <Button
                      variant="icon"
                      className="shrink-0"
                      onClick={beginEditing}
                      aria-label="Redigera bokinformation"
                    >
                      <Pencil className="size-4 stroke-[1.4]" />
                    </Button>
                  </div>
                  <Dialog.Description className="mt-2 text-sm text-muted">{book.authors.join(", ")}</Dialog.Description>
                  {editing ? (
                    <BookEditForm
                      book={book}
                      draft={draft}
                      setDraft={setDraft}
                      message={editMessage}
                      save={saveEdits}
                      refreshing={refreshing}
                      refreshMessage={refreshMessage}
                      refreshCandidates={refreshCandidates}
                      choosingCandidate={choosingCandidate}
                      refresh={handleRefresh}
                      chooseCandidate={handleCandidateChoice}
                      cancel={() => {
                        setEditing(false);
                        setEditMessage("");
                        setRefreshMessage("");
                        setRefreshCandidates([]);
                      }}
                    />
                  ) : (
                    <>
                      <p className="mt-7 font-serif text-lg leading-relaxed text-ink/75">{book.description}</p>
                      {Boolean(
                        book.publisher ||
                          book.publishedYear ||
                          book.translators?.length,
                      ) && (
                        <p className="mt-4 text-[11px] leading-relaxed text-muted">
                          {[
                            book.publisher,
                            book.publishedYear,
                            book.translators?.length
                              ? `Översatt av ${book.translators.join(", ")}`
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {book.genres.length > 0 && <p className="mt-5 text-xs tracking-wide text-muted">{book.genres.join(" · ")}</p>}
                      {book.status === "read" && book.finishedAt && (
                        <p className="mt-4 text-xs tracking-wide text-muted">
                          Utläst {book.finishedAt}
                        </p>
                      )}
                      {book.feedback && <FeedbackLabel feedback={book.feedback} className="mt-6" />}
                    </>
                  )}
                  {!editing && editMessage && (
                    <p className="mt-4 text-xs leading-relaxed text-muted" role="status">
                      {editMessage}
                    </p>
                  )}
                  {!editing && (
                    <>
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
                        className="mt-10 self-start border-t border-ink/10 pt-5 text-xs text-muted underline decoration-ink/20 underline-offset-4 hover:text-ink"
                        onClick={async () => {
                          if (window.confirm("Ta bort boken från ditt bibliotek? Den kan återställas senare.")) {
                            const saved = await updateBook(book.id, { archived: true });
                            if (saved) onClose();
                          }
                        }}
                      >
                        Ta bort från mitt bibliotek
                      </button>
                    </>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const coverToneLabels: Record<CoverTone, string> = {
  sage: "Salvia",
  sand: "Sand",
  blue: "Blågrå",
  clay: "Lera",
  ink: "Bläck",
};

function CoverPicker({
  book,
  candidates,
  loading,
  message,
  customCoverUrl,
  setCustomCoverUrl,
  onBack,
  onChooseCover,
  onChooseTone,
  onSaveCustom,
  onBrokenCandidate,
}: {
  book: Book;
  candidates: BookCoverCandidate[];
  loading: boolean;
  message: string;
  customCoverUrl: string;
  setCustomCoverUrl: (value: string) => void;
  onBack: () => void;
  onChooseCover: (candidate: BookCoverCandidate) => void;
  onChooseTone: (tone: CoverTone) => void;
  onSaveCustom: (event: React.FormEvent) => void;
  onBrokenCandidate: (id: string) => void;
}) {
  const toneOrder: CoverTone[] = ["sage", "sand", "blue", "clay", "ink"];
  const shownCandidates = candidates.slice(0, 6);
  const shownTones = toneOrder.slice(
    0,
    Math.min(5, Math.max(2, 8 - shownCandidates.length)),
  );
  const cleanUrl = (value?: string) => value?.split("?")[0];
  const sourceOrder: BookCoverCandidate["source"][] = [
    "libris",
    "google_books",
    "open_library",
  ];
  const sourceHeadings: Record<BookCoverCandidate["source"], string> = {
    libris: "Svenska utgåvor från Libris",
    google_books: "Fler utgåvor från Google Books",
    open_library: "Fler utgåvor från Open Library",
  };

  return (
    <section className="mt-8">
      <button
        type="button"
        className="text-link text-xs"
        onClick={onBack}
      >
        <ArrowLeft className="size-4 stroke-[1.3]" />
        Tillbaka till boken
      </button>
      <p className="eyebrow mt-9">Omslag</p>
      <Dialog.Title className="mt-3 font-serif text-4xl tracking-[-0.025em] md:text-5xl">
        Välj det som känns rätt.
      </Dialog.Title>
      <Dialog.Description className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Förslagen kommer från olika utgåvor av boken. Ditt val ligger kvar när
        annan bokinformation uppdateras.
      </Dialog.Description>

      {loading ? (
        <div className="mt-10 flex items-center gap-3 text-sm text-muted">
          <RefreshCw className="size-4 animate-spin stroke-[1.3]" />
          Letar efter varsamt valda utgåvor…
        </div>
      ) : (
        <>
          <div className="mt-10 space-y-10">
            {sourceOrder.map((source) => {
              const sourceCandidates = shownCandidates.filter(
                (candidate) => candidate.source === source,
              );
              if (!sourceCandidates.length) return null;
              return (
                <section key={source}>
                  <div className="flex min-h-5 items-center justify-between gap-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
                      {sourceHeadings[source]}
                    </p>
                    {source === "google_books" && (
                      <img
                        src="https://books.google.com/googlebooks/images/poweredby.png"
                        alt="Powered by Google"
                        className="h-[12px] w-auto opacity-65"
                      />
                    )}
                  </div>
                  <div className="cover-choice-grid mt-4">
                    {sourceCandidates.map((candidate) => {
                      const selected =
                        cleanUrl(book.coverUrl) === cleanUrl(candidate.coverUrl);
                      const details = [
                        candidate.publisher,
                        candidate.publishDate,
                        candidate.language
                          ? languageLabel(candidate.language)
                          : undefined,
                      ].filter(Boolean);
                      return (
                        <article key={candidate.id} className="min-w-0">
                          <button
                            type="button"
                            className="cover-choice w-full"
                            data-selected={selected}
                            aria-pressed={selected}
                            onClick={() => onChooseCover(candidate)}
                          >
                            <img
                              src={candidate.coverUrl}
                              alt={`Omslagsförslag till ${book.title}`}
                              className="aspect-[2/3] w-full rounded-[3px] object-cover"
                              onLoad={(event) => {
                                if (
                                  event.currentTarget.naturalWidth < 120 ||
                                  event.currentTarget.naturalHeight < 180 ||
                                  event.currentTarget.naturalWidth /
                                    event.currentTarget.naturalHeight >
                                    0.82
                                ) {
                                  onBrokenCandidate(candidate.id);
                                }
                              }}
                              onError={() => onBrokenCandidate(candidate.id)}
                            />
                            <span className="mt-3 block font-serif text-base leading-tight">
                              {candidate.title}
                            </span>
                            {details.length > 0 && (
                              <span className="mt-1 block text-[10px] leading-relaxed text-muted">
                                {details.join(" · ")}
                              </span>
                            )}
                          </button>
                          {candidate.sourceUrl && (
                            <a
                              href={candidate.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1.5 block text-[9px] text-muted/80 underline decoration-ink/15 underline-offset-2"
                            >
                              Visa hos {candidate.sourceLabel}
                            </a>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <section className="mt-10">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted">
              Stillas egna omslag
            </p>
            <div className="cover-choice-grid mt-4">
            {shownTones.map((tone) => {
              const selected =
                !book.coverUrl && (book.coverTone ?? "sage") === tone;
              return (
                <button
                  key={tone}
                  type="button"
                  className="cover-choice"
                  data-selected={selected}
                  aria-pressed={selected}
                  onClick={() => onChooseTone(tone)}
                >
                  <BookCover
                    book={{ ...book, coverUrl: undefined, coverTone: tone }}
                    className="w-full"
                  />
                  <span className="mt-3 block font-serif text-base">
                    Stilla · {coverToneLabels[tone]}
                  </span>
                </button>
              );
            })}
            </div>
          </section>
          {message && (
            <p className="mt-6 max-w-xl text-xs leading-relaxed text-muted" role="status">
              {message}
            </p>
          )}
        </>
      )}

      <form
        className="mt-10 border-t border-ink/10 pt-7"
        onSubmit={onSaveCustom}
      >
        <label className="text-xs tracking-wide text-muted">
          Använd egen bild
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              className="edit-field mt-0 min-w-0 flex-1"
              value={customCoverUrl}
              onChange={(event) => setCustomCoverUrl(event.target.value)}
              placeholder="https://exempel.se/omslag.jpg"
            />
            <Button type="submit" variant="secondary">
              Använd bilden
            </Button>
          </div>
        </label>
      </form>
    </section>
  );
}

function MetadataCandidateList({
  candidates,
  choosingCandidate,
  onChoose,
}: {
  candidates: BookMetadataCandidate[];
  choosingCandidate: string;
  onChoose: (candidate: BookMetadataCandidate) => void;
}) {
  return (
    <div className="mt-5 divide-y divide-ink/10 border-y border-ink/10">
      {candidates.map((candidate) => {
        const details = [
          candidate.publisher,
          candidate.publishedYear,
          candidate.edition,
          candidate.isbn13 ? `ISBN ${candidate.isbn13}` : undefined,
          ...candidate.languages.slice(0, 2).map(languageLabel),
        ].filter(Boolean);
        return (
          <article key={candidate.key} className="flex items-center gap-4 py-4">
            <BookOpen className="size-4 shrink-0 stroke-[1] text-muted" />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-lg leading-tight">
                {candidate.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {candidate.authors.join(", ") || "Okänd författare"}
              </p>
              {details.length > 0 && (
                <p className="mt-1 text-[11px] text-muted">
                  {details.join(" · ")}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={Boolean(choosingCandidate)}
              onClick={() => onChoose(candidate)}
            >
              {choosingCandidate === candidate.key ? "Hämtar…" : "Välj"}
            </Button>
          </article>
        );
      })}
    </div>
  );
}

function BookEditForm({
  book,
  draft,
  setDraft,
  message,
  save,
  refreshing,
  refreshMessage,
  refreshCandidates,
  choosingCandidate,
  refresh,
  chooseCandidate,
  cancel,
}: {
  book: Book;
  draft: BookEditDraft;
  setDraft: React.Dispatch<React.SetStateAction<BookEditDraft>>;
  message: string;
  save: (event: React.FormEvent) => void;
  refreshing: boolean;
  refreshMessage: string;
  refreshCandidates: BookMetadataCandidate[];
  choosingCandidate: string;
  refresh: () => void;
  chooseCandidate: (candidate: BookMetadataCandidate) => void;
  cancel: () => void;
}) {
  return (
    <form className="mt-7 border-y border-ink/10 py-7" onSubmit={save}>
      <div className="grid gap-5">
        <label className="text-xs tracking-wide text-muted">
          Titel
          <input
            className="edit-field"
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            required
          />
        </label>
        <label className="text-xs tracking-wide text-muted">
          Författare
          <input
            className="edit-field"
            value={draft.authors}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                authors: event.target.value,
              }))
            }
            placeholder="Separera flera med kommatecken"
            required
          />
        </label>
        <label className="text-xs tracking-wide text-muted">
          Kort beskrivning
          <textarea
            className="edit-field min-h-28 resize-y"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </label>
        <div
          className={cn(
            "grid gap-5",
            book.status === "read" && "sm:grid-cols-[minmax(0,1fr)_180px]",
          )}
        >
          <label className="text-xs tracking-wide text-muted">
            Genrer
            <input
              className="edit-field"
              value={draft.genres}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  genres: event.target.value,
                }))
              }
              placeholder="Roman, poesi"
            />
          </label>
          {book.status === "read" && (
            <label className="text-xs tracking-wide text-muted">
              Utläst datum
              <input
                type="date"
                className="edit-field"
                value={draft.finishedAt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    finishedAt: event.target.value,
                  }))
                }
              />
            </label>
          )}
        </div>
        {book.status === "read" && (
          <p className="-mt-2 text-[11px] leading-relaxed text-muted">
            Året i datumet avgör vilket års läsmål boken räknas till.
          </p>
        )}
      </div>
      {message && (
        <p
          className="mt-4 text-xs leading-relaxed text-[#895e52]"
          role="alert"
        >
          {message}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="submit">Spara ändringar</Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          Avbryt
        </Button>
      </div>
      <div className="mt-8 border-t border-ink/10 pt-5">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-[11px] text-muted transition-colors hover:text-ink"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={cn(
              "size-3.5 stroke-[1.3]",
              refreshing && "animate-spin",
            )}
          />
          {refreshing
            ? "Hämtar bokinformation…"
            : "Hämta om bokinformationen"}
        </button>
        {refreshMessage && (
          <p
            className="mt-3 max-w-sm text-xs leading-relaxed text-muted"
            role="status"
          >
            {refreshMessage}
          </p>
        )}
        {refreshCandidates.length > 0 && (
          <MetadataCandidateList
            candidates={refreshCandidates}
            choosingCandidate={choosingCandidate}
            onChoose={chooseCandidate}
          />
        )}
      </div>
    </form>
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
