import { cookies } from 'next/headers';
import { cache } from 'react';
import type { HijriDate } from './format';
import type { I18nText } from './i18n';

export const SESSION_COOKIE = 'session';

const API_URL = process.env.API_URL ?? 'http://localhost:3100';

export interface ApiProblem {
  statusCode?: number;
  code?: string;
  message?: string;
}

// One call to the API, as it went: what was asked and what came back. The
// server response panel shows these and adds nothing.
export interface Exchange {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  body: unknown;
}

export type ApiResult<T> = (
  { ok: true; data: T } | { ok: false; status: number; problem: ApiProblem }
) & { exchange: Exchange };

interface DualDate {
  gregorian: string;
  // Null when the API could not work it out.
  hijri: HijriDate | null;
}

export interface Invoice {
  id: string;
  number: number;
  school: { name: string; nameI18n: I18nText | null };
  student: { fullName: string };
  description: I18nText | null;
  amount: string;
  currency: string;
  issueDate: DualDate;
  dueDate: DualDate | null;
}

export interface InvoiceSummary {
  id: string;
  number: number;
  issueDate: string;
}

export interface School {
  id: string;
  name: string;
  nameI18n: I18nText | null;
  // Null when the user holds only grants in the school.
  role: string | null;
  grants: string[];
}

export interface Student {
  id: string;
  fullName: string;
}

export interface Ledger {
  baseCurrency: string | null;
  currencyTotals: { currency: string; total: string }[];
  studentBalances: {
    studentId: string;
    fullName: string | null;
    currency: string;
    balance: string;
  }[];
  fxPositions: {
    currency: string;
    held: string;
    baseCurrency: string;
    bookValue: string;
  }[];
  fxGainLoss: { currency: string; gain: string }[];
  periods: {
    year: string;
    startDate: string;
    endDate: string;
    status: string;
  }[];
}

export interface Application {
  id: string;
  applicantName: string;
  status: string;
  studentId: string | null;
  acceptedAt: string | null;
}

export interface EventTrail {
  event: {
    id: string;
    type: string;
    createdAt: string;
    dispatchedAt: string | null;
  };
  routedTo: string | null;
  routedAt: string | null;
  delivery: {
    status: string;
    url: string | null;
    finishedAt: string | null;
    attempts: {
      attemptNo: number;
      startedAt: string;
      responseStatus: number | null;
      error: string | null;
    }[];
  } | null;
  failure: { failedAt: string; error: string } | null;
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

// Every screen gets its data here: from the API, as the signed-in user. The
// token goes to the API as it is. The API decides what it is worth.
async function call<T>(
  method: Exchange['method'],
  path: string,
): Promise<ApiResult<T>> {
  const token = await sessionToken();
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
  } catch {
    const exchange = { method, path, status: 502, body: null };
    return { ok: false, status: 502, problem: {}, exchange };
  }
  const body: unknown = await response.json().catch(() => null);
  const exchange = { method, path, status: response.status, body };
  return response.ok
    ? { ok: true, data: body as T, exchange }
    : {
        ok: false,
        status: response.status,
        problem: (body ?? {}) as ApiProblem,
        exchange,
      };
}

const segment = encodeURIComponent;
const school = (schoolId: string) => `/schools/${segment(schoolId)}`;

// Asked once per page, however many parts of the page need it.
export const getMySchools = cache(() => call<School[]>('GET', '/me/schools'));

export const getStudents = (schoolId: string) =>
  call<Student[]>('GET', `${school(schoolId)}/students`);

export const getInvoices = (schoolId: string) =>
  call<InvoiceSummary[]>('GET', `${school(schoolId)}/invoices`);

export const getInvoice = (schoolId: string, invoiceId: string) =>
  call<Invoice>('GET', `${school(schoolId)}/invoices/${segment(invoiceId)}`);

export const getLedger = (schoolId: string) =>
  call<Ledger>('GET', `${school(schoolId)}/ledger`);

export const getApplications = (schoolId: string) =>
  call<Application[]>('GET', `${school(schoolId)}/admissions/applications`);

export const getApplicationEvent = (schoolId: string, applicationId: string) =>
  call<EventTrail>(
    'GET',
    `${school(schoolId)}/admissions/applications/${segment(applicationId)}/event`,
  );

export const acceptApplication = (schoolId: string, applicationId: string) =>
  call<{ applicationId: string; studentId: string }>(
    'POST',
    `${school(schoolId)}/admissions/applications/${segment(applicationId)}/accept`,
  );
