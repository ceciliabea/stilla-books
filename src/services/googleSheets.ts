import type {
  Book,
  BookStatus,
  CoverSource,
  CoverTone,
  Feedback,
  ManualBookField,
} from "../types";
import type { GoogleAuthorization } from "../lib/googleSession";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type PickerDocument = { id?: string; name?: string; url?: string };

interface PickerView {
  setMode(mode: string): PickerView;
  setMimeTypes(mimeTypes: string): PickerView;
}

interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setCallback(callback: (data: { action?: string; docs?: PickerDocument[] }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string }) => void;
          }): { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
      picker?: {
        ViewId: { SPREADSHEETS: string };
        DocsViewMode: { LIST: string };
        DocsView: new (viewId: string) => PickerView;
        PickerBuilder: new () => PickerBuilder;
      };
    };
    gapi?: {
      load(api: string, callback: () => void): void;
    };
  }
}

export const BOOK_HEADERS = [
  "id",
  "externalId",
  "title",
  "authors",
  "coverUrl",
  "description",
  "genres",
  "language",
  "status",
  "feedback",
  "isFeaturedReading",
  "archived",
  "startedAt",
  "finishedAt",
  "createdAt",
  "updatedAt",
  "coverTone",
  "isbn13",
  "librisId",
  "googleBooksId",
  "coverSource",
  "coverSourceUrl",
  "subtitle",
  "translators",
  "publisher",
  "publishedYear",
  "pageCount",
  "edition",
  "metadataUpdatedAt",
  "manualFields",
] as const;
const REQUIRED_BOOK_HEADERS = BOOK_HEADERS.slice(0, 16);
const BOOK_LAST_COLUMN = "AD";

const SETTINGS_HEADERS = ["year", "readingGoal"] as const;

let identityScriptPromise: Promise<void> | null = null;
let pickerScriptPromise: Promise<void> | null = null;

function loadScript(src: string, ready: () => boolean, errorMessage: string) {
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(errorMessage)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });
}

function loadGoogleIdentity() {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (!identityScriptPromise) {
    identityScriptPromise = loadScript(
      "https://accounts.google.com/gsi/client",
      () => Boolean(window.google?.accounts.oauth2),
      "Google-inloggningen kunde inte laddas.",
    );
  }
  return identityScriptPromise;
}

async function loadGooglePicker() {
  if (window.google?.picker) return;
  if (!pickerScriptPromise) {
    pickerScriptPromise = loadScript(
      "https://apis.google.com/js/api.js",
      () => Boolean(window.gapi),
      "Googles filväljare kunde inte laddas.",
    ).then(
      () =>
        new Promise<void>((resolve) => {
          window.gapi!.load("picker", resolve);
        }),
    );
  }
  await pickerScriptPromise;
}

export function isGoogleConfigured() {
  return Boolean(
    import.meta.env.VITE_GOOGLE_CLIENT_ID &&
      import.meta.env.VITE_GOOGLE_API_KEY &&
      import.meta.env.VITE_GOOGLE_APP_ID,
  );
}

export async function requestGoogleToken(
  prompt: "" | "consent" | "none" = "",
): Promise<GoogleAuthorization> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google OAuth-klient-ID saknas.");
  await loadGoogleIdentity();
  return new Promise<GoogleAuthorization>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          resolve({
            accessToken: response.access_token,
            expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          });
        } else {
          reject(new Error(response.error ?? "Google-inloggningen avbröts."));
        }
      },
      error_callback: (error) =>
        reject(new Error(error.type ?? "Google-inloggningen kunde inte öppnas.")),
    });
    client.requestAccessToken({ prompt });
  });
}

export async function pickStillaSpreadsheet(token: string) {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  const appId = import.meta.env.VITE_GOOGLE_APP_ID;
  if (!apiKey || !appId) throw new Error("Konfigurationen för Googles filväljare saknas.");
  await loadGooglePicker();

  return new Promise<{ spreadsheetId: string; spreadsheetUrl: string; title: string }>(
    (resolve, reject) => {
      const picker = window.google!.picker!;
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
        .setMode(picker.DocsViewMode.LIST)
        .setMimeTypes(GOOGLE_SHEETS_MIME_TYPE);

      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setOrigin(window.location.origin)
        .setCallback((data) => {
          if (data.action === "cancel") {
            reject(new Error("Filvalet avbröts."));
            return;
          }
          if (data.action !== "picked") return;
          const document = data.docs?.[0];
          if (!document?.id) {
            reject(new Error("Det valda kalkylarket kunde inte läsas."));
            return;
          }
          resolve({
            spreadsheetId: document.id,
            spreadsheetUrl:
              document.url ?? `https://docs.google.com/spreadsheets/d/${document.id}/edit`,
            title: document.name ?? "Stilla Books",
          });
        })
        .build()
        .setVisible(true);
    },
  );
}

async function googleRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      response.status === 401
        ? "Google-sessionen har gått ut. Anslut igen för att fortsätta."
        : `Google kunde inte slutföra åtgärden (${response.status}). ${detail}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function createStillaSpreadsheet(token: string) {
  return googleRequest<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
  }>("https://sheets.googleapis.com/v4/spreadsheets", token, {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "Stilla Books" },
      sheets: [
        {
          properties: { title: "Books", gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: BOOK_HEADERS.map((value) => ({
                    userEnteredValue: { stringValue: value },
                    userEnteredFormat: { textFormat: { bold: true } },
                  })),
                },
              ],
            },
          ],
        },
        {
          properties: { title: "Settings", gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: SETTINGS_HEADERS.map((value) => ({
                    userEnteredValue: { stringValue: value },
                    userEnteredFormat: { textFormat: { bold: true } },
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  });
}

function parseStringArray(value = "") {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }
}

function parseBoolean(value = "") {
  return ["true", "yes", "1", "ja"].includes(value.toLocaleLowerCase("sv"));
}

function parseStatus(value: string): BookStatus {
  return ["want_to_read", "reading", "read"].includes(value)
    ? (value as BookStatus)
    : "want_to_read";
}

function parseFeedback(value: string): Feedback | undefined {
  return ["not_for_me", "liked", "loved"].includes(value)
    ? (value as Feedback)
    : undefined;
}

function parseCoverTone(value: string): CoverTone | undefined {
  return ["sage", "clay", "ink", "sand", "blue"].includes(value)
    ? (value as CoverTone)
    : undefined;
}

function parseCoverSource(value: string): CoverSource | undefined {
  return ["libris", "google_books", "open_library", "custom", "stilla"].includes(
    value,
  )
    ? (value as CoverSource)
    : undefined;
}

function parseManualFields(value: string): ManualBookField[] | undefined {
  const fields = parseStringArray(value).filter((field): field is ManualBookField =>
    [
      "title",
      "subtitle",
      "authors",
      "translators",
      "description",
      "genres",
      "language",
      "publisher",
      "publishedYear",
      "pageCount",
      "edition",
    ].includes(field),
  );
  return fields.length ? fields : undefined;
}

function hasCompatibleBookHeaders(headers: string[]) {
  return (
    REQUIRED_BOOK_HEADERS.every((header, index) => headers[index] === header) &&
    headers.every(
      (header, index) =>
        !header || index >= BOOK_HEADERS.length || header === BOOK_HEADERS[index],
    )
  );
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function sheetRowToBook(row: string[]): Book | null {
  const values = Object.fromEntries(BOOK_HEADERS.map((header, index) => [header, row[index] ?? ""]));
  if (!values.id || !values.title) return null;
  return {
    id: values.id,
    externalId: values.externalId || undefined,
    librisId: values.librisId || undefined,
    googleBooksId: values.googleBooksId || undefined,
    isbn13: values.isbn13 || undefined,
    title: values.title,
    subtitle: values.subtitle || undefined,
    authors: parseStringArray(values.authors),
    translators: parseStringArray(values.translators),
    coverUrl: values.coverUrl || undefined,
    coverSource: parseCoverSource(values.coverSource),
    coverSourceUrl: values.coverSourceUrl || undefined,
    description: values.description,
    genres: parseStringArray(values.genres),
    language: values.language || undefined,
    publisher: values.publisher || undefined,
    publishedYear: values.publishedYear || undefined,
    pageCount: values.pageCount ? Number(values.pageCount) : undefined,
    edition: values.edition || undefined,
    status: parseStatus(values.status),
    feedback: parseFeedback(values.feedback),
    isFeaturedReading: parseBoolean(values.isFeaturedReading),
    archived: parseBoolean(values.archived),
    startedAt: values.startedAt || undefined,
    finishedAt: values.finishedAt || undefined,
    createdAt: values.createdAt || new Date().toISOString().slice(0, 10),
    updatedAt: values.updatedAt || new Date().toISOString().slice(0, 10),
    metadataUpdatedAt: values.metadataUpdatedAt || undefined,
    manualFields: parseManualFields(values.manualFields),
    coverTone: parseCoverTone(values.coverTone),
  };
}

export function bookToSheetRow(book: Book) {
  const values: Record<(typeof BOOK_HEADERS)[number], string | boolean> = {
    id: book.id,
    externalId: book.externalId ?? "",
    librisId: book.librisId ?? "",
    googleBooksId: book.googleBooksId ?? "",
    isbn13: book.isbn13 ?? "",
    title: book.title,
    subtitle: book.subtitle ?? "",
    authors: JSON.stringify(book.authors),
    translators: JSON.stringify(book.translators ?? []),
    coverUrl: book.coverUrl ?? "",
    coverSource: book.coverSource ?? "",
    coverSourceUrl: book.coverSourceUrl ?? "",
    description: book.description,
    genres: JSON.stringify(book.genres),
    language: book.language ?? "",
    publisher: book.publisher ?? "",
    publishedYear: book.publishedYear ?? "",
    pageCount: book.pageCount?.toString() ?? "",
    edition: book.edition ?? "",
    status: book.status,
    feedback: book.feedback ?? "",
    isFeaturedReading: Boolean(book.isFeaturedReading),
    archived: Boolean(book.archived),
    startedAt: book.startedAt ?? "",
    finishedAt: book.finishedAt ?? "",
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    metadataUpdatedAt: book.metadataUpdatedAt ?? "",
    manualFields: JSON.stringify(book.manualFields ?? []),
    coverTone: book.coverTone ?? "",
  };
  return BOOK_HEADERS.map((header) => values[header]);
}

export async function readStillaSpreadsheet(token: string, spreadsheetId: string) {
  const result = await googleRequest<{
    valueRanges?: { values?: string[][] }[];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values:batchGet?ranges=Books!A1:${BOOK_LAST_COLUMN}&ranges=Settings!A1:B`,
    token,
  );
  const bookRows = result.valueRanges?.[0]?.values ?? [];
  const settingRows = result.valueRanges?.[1]?.values ?? [];
  const headers = bookRows[0] ?? [];
  if (
    !hasCompatibleBookHeaders(headers)
  ) {
    throw new Error(
      "Arket har inte Stilla Books struktur. Välj ett ark som skapats av appen.",
    );
  }
  const currentYear = String(new Date().getFullYear());
  const goalRow = settingRows.slice(1).find((row) => row[0] === currentYear);
  return {
    books: bookRows
      .slice(1)
      .map(sheetRowToBook)
      .filter((book): book is Book => Boolean(book)),
    goal: goalRow?.[1] ? Number(goalRow[1]) : null,
  };
}

export async function writeStillaSpreadsheet(
  token: string,
  spreadsheetId: string,
  books: Book[],
  goal: number | null,
) {
  const encodedId = encodeURIComponent(spreadsheetId);
  const current = await googleRequest<{
    valueRanges?: { values?: string[][] }[];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodedId}/values:batchGet?ranges=Books!A1:${BOOK_LAST_COLUMN}&ranges=Settings!A1:B`,
    token,
  );

  const bookRows = current.valueRanges?.[0]?.values ?? [];
  const settingRows = current.valueRanges?.[1]?.values ?? [];
  const bookHeaders = bookRows[0] ?? [];
  const settingHeaders = settingRows[0] ?? [];
  if (
    !hasCompatibleBookHeaders(bookHeaders)
  ) {
    throw new Error(
      "Arket har inte Stilla Books struktur. Synkningen avbröts utan att ändra någon data.",
    );
  }
  if (
    !SETTINGS_HEADERS.every(
      (header, index) => settingHeaders[index] === header,
    )
  ) {
    throw new Error(
      "Inställningsfliken har inte Stilla Books struktur. Synkningen avbröts utan att ändra någon data.",
    );
  }

  const data: {
    range: string;
    majorDimension: "ROWS";
    values: (string | boolean | number)[][];
  }[] = [];
  if (bookHeaders.length < BOOK_HEADERS.length) {
    const firstMissingIndex = Math.max(bookHeaders.length, REQUIRED_BOOK_HEADERS.length);
    data.push({
      range: `Books!${columnName(firstMissingIndex)}1:${BOOK_LAST_COLUMN}1`,
      majorDimension: "ROWS",
      values: [BOOK_HEADERS.slice(firstMissingIndex)],
    });
  }
  const remoteById = new Map<
    string,
    { book: Book; rowNumber: number }
  >();
  bookRows.slice(1).forEach((row, index) => {
    const remoteBook = sheetRowToBook(row);
    if (remoteBook && !remoteById.has(remoteBook.id)) {
      remoteById.set(remoteBook.id, {
        book: remoteBook,
        rowNumber: index + 2,
      });
    }
  });

  let nextBookRow = Math.max(bookRows.length + 1, 2);
  books.forEach((book) => {
    const remote = remoteById.get(book.id);
    if (remote) {
      const localUpdatedAt = Date.parse(book.updatedAt);
      const remoteUpdatedAt = Date.parse(remote.book.updatedAt);
      const localIsNewer =
        Number.isFinite(localUpdatedAt) &&
        (!Number.isFinite(remoteUpdatedAt) ||
          localUpdatedAt > remoteUpdatedAt);
      if (!localIsNewer) return;
      data.push({
        range: `Books!A${remote.rowNumber}:${BOOK_LAST_COLUMN}${remote.rowNumber}`,
        majorDimension: "ROWS",
        values: [bookToSheetRow(book)],
      });
      return;
    }

    data.push({
      range: `Books!A${nextBookRow}:${BOOK_LAST_COLUMN}${nextBookRow}`,
      majorDimension: "ROWS",
      values: [bookToSheetRow(book)],
    });
    nextBookRow += 1;
  });

  const currentYear = String(new Date().getFullYear());
  const goalRowIndex = settingRows
    .slice(1)
    .findIndex((row) => row[0] === currentYear);
  if (goalRowIndex >= 0) {
    data.push({
      range: `Settings!A${goalRowIndex + 2}:B${goalRowIndex + 2}`,
      majorDimension: "ROWS",
      values: [[Number(currentYear), goal ?? ""]],
    });
  } else if (goal) {
    const nextSettingRow = Math.max(settingRows.length + 1, 2);
    data.push({
      range: `Settings!A${nextSettingRow}:B${nextSettingRow}`,
      majorDimension: "ROWS",
      values: [[Number(currentYear), goal]],
    });
  }

  if (!data.length) return;

  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodedId}/values:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    },
  );
}
