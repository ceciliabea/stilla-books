import type { Book, BookStatus, Feedback } from "../types";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

type TokenResponse = { access_token?: string; error?: string };
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
] as const;

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

export async function requestGoogleToken(prompt: "" | "consent" = "consent") {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google OAuth-klient-ID saknas.");
  await loadGoogleIdentity();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error ?? "Google-inloggningen avbröts."));
      },
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

export function sheetRowToBook(row: string[]): Book | null {
  const values = Object.fromEntries(BOOK_HEADERS.map((header, index) => [header, row[index] ?? ""]));
  if (!values.id || !values.title) return null;
  return {
    id: values.id,
    externalId: values.externalId || undefined,
    title: values.title,
    authors: parseStringArray(values.authors),
    coverUrl: values.coverUrl || undefined,
    description: values.description,
    genres: parseStringArray(values.genres),
    language: values.language || undefined,
    status: parseStatus(values.status),
    feedback: parseFeedback(values.feedback),
    isFeaturedReading: parseBoolean(values.isFeaturedReading),
    archived: parseBoolean(values.archived),
    startedAt: values.startedAt || undefined,
    finishedAt: values.finishedAt || undefined,
    createdAt: values.createdAt || new Date().toISOString().slice(0, 10),
    updatedAt: values.updatedAt || new Date().toISOString().slice(0, 10),
  };
}

export function bookToSheetRow(book: Book) {
  const values: Record<(typeof BOOK_HEADERS)[number], string | boolean> = {
    id: book.id,
    externalId: book.externalId ?? "",
    title: book.title,
    authors: JSON.stringify(book.authors),
    coverUrl: book.coverUrl ?? "",
    description: book.description,
    genres: JSON.stringify(book.genres),
    language: book.language ?? "",
    status: book.status,
    feedback: book.feedback ?? "",
    isFeaturedReading: Boolean(book.isFeaturedReading),
    archived: Boolean(book.archived),
    startedAt: book.startedAt ?? "",
    finishedAt: book.finishedAt ?? "",
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
  return BOOK_HEADERS.map((header) => values[header]);
}

export async function readStillaSpreadsheet(token: string, spreadsheetId: string) {
  const result = await googleRequest<{
    valueRanges?: { values?: string[][] }[];
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values:batchGet?ranges=Books!A1:P&ranges=Settings!A1:B`,
    token,
  );
  const bookRows = result.valueRanges?.[0]?.values ?? [];
  const settingRows = result.valueRanges?.[1]?.values ?? [];
  const headers = bookRows[0] ?? [];
  if (!BOOK_HEADERS.every((header, index) => headers[index] === header)) {
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
  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodedId}/values:batchClear`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ ranges: ["Books!A2:P", "Settings!A2:B"] }),
    },
  );

  const data: { range: string; majorDimension: "ROWS"; values: (string | boolean | number)[][] }[] = [];
  if (books.length) {
    data.push({
      range: `Books!A2:P${books.length + 1}`,
      majorDimension: "ROWS",
      values: books.map(bookToSheetRow),
    });
  }
  if (goal) {
    data.push({
      range: "Settings!A2:B2",
      majorDimension: "ROWS",
      values: [[new Date().getFullYear(), goal]],
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
