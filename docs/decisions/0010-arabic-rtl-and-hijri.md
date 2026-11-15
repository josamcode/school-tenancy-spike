# 10. Arabic, RTL and Hijri: Western digits, per-country month starts and a display-only conversion

## Context

An invoice is read by parents in Arabic and by finance staff in Arabic or
English. It carries a Gregorian date and a Hijri date. The calculated Hijri
calendar can differ by a day from what a country announces, because a month
starts when the moon is sighted. Arabic text must be shaped and ordered
correctly on the screen and in the PDF, with Latin names and numbers inside
it.

## Decision

- **The language is the first segment of the address** (`/ar`, then `/en`),
  and it alone sets the page's language and direction.
- **Styles use logical properties only.** There is no left or right in any
  stylesheet or style prop, so one stylesheet serves both directions.
- **Digits are Western (0 to 9) in both languages.** Every number is built as
  a string, and tests find no Arabic-Indic digit on a screen, in a PDF or in
  the catalogs.
- **The stored date is Gregorian. The Hijri date is for display.** It is
  computed when the invoice is read and never stored.
- **The calculated calendar is the runtime's Umm al-Qura calendar**
  (`src/calendar/hijri.ts`). Six published month starts are pinned in a test,
  and the API refuses to start on a runtime without the calendar.
- **A country's official month start overrides the calculation.** Overrides
  are reference data per country, in `hijri_month_overrides`: readable by
  every school, written only by the owner. A school with no country gets the
  calculated calendar.
- **An override must be plausible.** It must be within two days of the
  calculated start and leave the month before it 29 or 30 days. Otherwise the
  conversion throws and names the override that is probably missing.
- **A Hijri date that cannot be worked out does not fail the invoice.** The
  route converts with `HijriCalendar.forDisplay`
  (`src/calendar/hijri-calendar.ts`): a conversion that throws is logged with
  the date, the country, the month, the override and the reason, and that
  date's Hijri value is `null`. The screen and the PDF show the Gregorian date
  and say that the Hijri date is unavailable. Each date stands alone.
- **Translated content is JSON on the row,** `{ "ar": …, "en": … }`, for an
  invoice's description and a school's name. A check allows those two keys
  only. Student names are shown as entered.
- **Fonts are bundled.** The web app carries the Noto Sans and Noto Sans
  Arabic files and refers to no other host.

## Alternatives considered

- **Arabic-Indic digits in Arabic.** Finance staff in the region type and
  read amounts in Western digits, and mixed digit sets in one document invite
  mistakes. One set also halves the formatting cases.
- **A Hijri library with its own tables.** The runtime already ships the
  calendar. A second source could disagree with it, and it would be a
  dependency to keep current.
- **Storing the Hijri date.** A correction to an override would then leave
  old rows wrong. Computed on read, a correction applies everywhere at once.
- **Failing the request when a conversion fails.** Our first version did. One
  wrong override row then made every invoice of that country unreadable for
  dates up to twelve months after it. A value that is only displayed must not
  stop the document that displays it.
- **Clamping an implausible override silently.** The reader would see a date
  that nobody announced. Saying that the date is unavailable is honest, and
  the log names the row to fix.
- **A translation table per entity.** Two fixed languages read and written
  with their row need no join and no second policy.
- **A CSS framework with direction variants.** Class names would hide a
  physical side from the test that guards the styles.

## Consequences

- One template, one stylesheet and one set of fonts serve both languages and
  both outputs (see [decision 11](0011-the-web-app.md)).
- Adding an announced month start is one row, as the owner.
- A wrong override is quiet for the reader and visible in the log.

## Known limits

- An override is checked when a date is converted, not when the row is
  written. Nothing counts the log lines or alerts anyone.
- The calculation is the runtime's ICU data. A different ICU version could
  move a month start; the pinned test would then fail.
- The limits of two days and twelve months are ours, not a published rule.
- A Hijri day starts at midnight here, not at sunset.
- The Arabic copy was written by engineers. It needs a read by someone who
  works in a school office.
- `tenants.name` and `tenants.name_i18n` are two sources for one name.

## Evidence

- Pull request: [#7](https://github.com/josamcode/school-tenancy-spike/pull/7).
- The conversion and its overrides: `src/calendar/hijri.spec.ts`,
  `test/calendar/hijri-calendar.spec.ts`.
- What the route returns, including a date that cannot be converted:
  `test/api/invoice.e2e-spec.ts`.
- Reference tables and translated text: `test/db/invoice-rules.spec.ts`.
- Direction, logical properties and digits: `web/e2e/direction.spec.ts`,
  `web/test/logical-css.spec.ts`, `web/test/format.spec.ts`,
  `web/test/messages.spec.ts`.
- The screen and the PDF, read from the file itself: `web/e2e/invoice.spec.ts`,
  `web/e2e/pdf.spec.ts`.
- Bundled fonts: `web/e2e/production-build.spec.ts`.
- `pnpm prove` rows: `calendar.override-ignored`, `web.no-bundled-fonts`.
