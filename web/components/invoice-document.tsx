import { Fragment, type ReactNode } from 'react';
import type { Invoice } from '../lib/api';
import {
  formatAmount,
  formatGregorian,
  formatHijri,
  formatInvoiceNumber,
} from '../lib/format';
import { Lang, messages, PickedText, pickText } from '../lib/i18n';
import './invoice-document.css';

// The one template of an invoice. The screen and the print page that becomes
// the PDF both render it, so the two cannot differ.

// Replaces {name} in a sentence with the node given for it.
function fill(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((piece, index) => {
      const key = /^\{(\w+)\}$/.exec(piece)?.[1];
      return key && key in parts ? (
        <Fragment key={index}>{parts[key]}</Fragment>
      ) : (
        piece
      );
    });
}

// Content that may be in the other language is isolated, so its direction
// comes from its own letters and not from the sentence around it.
function Content({ value }: { value: PickedText }) {
  return <bdi lang={value.lang}>{value.text}</bdi>;
}

// The number first and the code after it, in both languages.
function Amount({
  amount,
  currency,
  testId,
}: {
  amount: string;
  currency: string;
  testId: string;
}) {
  return (
    <bdi dir="ltr" data-testid={testId}>
      <span data-testid={`${testId}-value`}>{formatAmount(amount)}</span>{' '}
      <span data-testid={`${testId}-currency`}>{currency}</span>
    </bdi>
  );
}

function DateBlock({
  label,
  date,
  lang,
  testId,
}: {
  label: string;
  date: NonNullable<Invoice['dueDate']>;
  lang: Lang;
  testId: string;
}) {
  return (
    <div className="invoice-date">
      <dt>{label}</dt>
      <dd data-testid={`${testId}-gregorian`}>
        {formatGregorian(date.gregorian, lang)}
      </dd>
      <dd data-testid={`${testId}-hijri`}>
        {date.hijri
          ? formatHijri(date.hijri, lang)
          : messages(lang)['invoice.hijriUnavailable']}
      </dd>
    </div>
  );
}

export function InvoiceDocument({
  invoice,
  lang,
}: {
  invoice: Invoice;
  lang: Lang;
}) {
  const text = messages(lang);
  const school = pickText(invoice.school.nameI18n, lang, invoice.school.name)!;
  const description = pickText(
    invoice.description,
    lang,
    text['invoice.defaultDescription'],
  )!;

  return (
    <article className="invoice" data-testid="invoice-document">
      <header className="invoice-header">
        <p className="invoice-school" data-testid="school-name">
          <Content value={school} />
        </p>
        <h1>{text['invoice.title']}</h1>
        <p>
          {text['invoice.number']}{' '}
          <bdi dir="ltr" data-testid="invoice-number">
            {formatInvoiceNumber(invoice.number)}
          </bdi>
        </p>
      </header>

      <p data-testid="issued-to">
        {fill(text['invoice.issuedTo'], {
          student: (
            <bdi data-testid="student-name">{invoice.student.fullName}</bdi>
          ),
          date: formatGregorian(invoice.issueDate.gregorian, lang),
        })}
      </p>

      <dl className="invoice-dates">
        <DateBlock
          label={text['invoice.issueDate']}
          date={invoice.issueDate}
          lang={lang}
          testId="issue-date"
        />
        {invoice.dueDate && (
          <DateBlock
            label={text['invoice.dueDate']}
            date={invoice.dueDate}
            lang={lang}
            testId="due-date"
          />
        )}
      </dl>

      <table className="invoice-lines">
        <thead>
          <tr>
            <th data-testid="description-heading">
              {text['invoice.description']}
            </th>
            <th className="invoice-amount" data-testid="amount-heading">
              {text['invoice.amount']}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-testid="description">
              <Content value={description} />
            </td>
            <td className="invoice-amount">
              <Amount
                amount={invoice.amount}
                currency={invoice.currency}
                testId="amount"
              />
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th>{text['invoice.total']}</th>
            <td className="invoice-amount">
              <Amount
                amount={invoice.amount}
                currency={invoice.currency}
                testId="total"
              />
            </td>
          </tr>
        </tfoot>
      </table>
    </article>
  );
}
