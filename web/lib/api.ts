import { cookies } from 'next/headers';
import type { HijriDate } from './format';
import type { I18nText } from './i18n';

export const SESSION_COOKIE = 'session';

const API_URL = process.env.API_URL ?? 'http://localhost:3100';

export interface ApiProblem {
  statusCode?: number;
  code?: string;
  message?: string;
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; problem: ApiProblem };

interface DualDate {
  gregorian: string;
  hijri: HijriDate;
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

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

// Every screen gets its data here: from the API, as the signed-in user. The
// token goes to the API as it is. The API decides what it is worth.
async function get<T>(path: string): Promise<ApiResult<T>> {
  const token = await sessionToken();
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 502, problem: {} };
  }
  const body: unknown = await response.json().catch(() => ({}));
  return response.ok
    ? { ok: true, data: body as T }
    : { ok: false, status: response.status, problem: body as ApiProblem };
}

const segment = encodeURIComponent;

export const getInvoices = (schoolId: string) =>
  get<InvoiceSummary[]>(`/schools/${segment(schoolId)}/invoices`);

export const getInvoice = (schoolId: string, invoiceId: string) =>
  get<Invoice>(`/schools/${segment(schoolId)}/invoices/${segment(invoiceId)}`);
