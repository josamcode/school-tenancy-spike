'use client';

import { usePathname } from 'next/navigation';

// The pages of a school, by the path segment after the school's id. The
// school's own page shows the user's permissions.
const PAGES = [
  ['students', 'students'],
  ['permissions', ''],
  ['invoices', 'invoices'],
  ['ledger', 'ledger'],
  ['admissions', 'admissions'],
] as const;

type PageName = (typeof PAGES)[number][0];

export interface SchoolChoice {
  id: string;
  name: string;
  // The language the name is in, when it is not the page's.
  lang?: string;
}

// The user's schools, as the API listed them, and the pages of the current
// one. Changing school keeps the page.
export function SchoolBar({
  lang,
  schoolId,
  schools,
  labels,
}: {
  lang: string;
  schoolId: string;
  schools: SchoolChoice[];
  labels: { schools: string; pages: string } & Record<PageName, string>;
}) {
  const segment = usePathname().split('/')[4] ?? '';
  const current = PAGES.find(([, path]) => path === segment) ?? PAGES[1];
  const pathOf = (id: string, path: string) =>
    `/${lang}/schools/${id}${path && `/${path}`}`;

  return (
    <div className="school-bar">
      {schools.length > 0 && (
        <nav aria-label={labels.schools} data-testid="school-switcher">
          <p className="bar-label">{labels.schools}</p>
          <ul className="link-list">
            {schools.map((school) => (
              <li key={school.id}>
                <a
                  href={pathOf(school.id, current[1])}
                  aria-current={school.id === schoolId ? 'page' : undefined}
                  data-testid="school-link"
                  data-school={school.id}
                >
                  <bdi lang={school.lang}>{school.name}</bdi>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <nav aria-label={labels.pages} data-testid="school-nav">
        <ul className="link-list">
          {PAGES.map(([name, path]) => (
            <li key={name}>
              <a
                href={pathOf(schoolId, path)}
                aria-current={name === current[0] ? 'page' : undefined}
                data-testid="nav-link"
                data-page={name}
              >
                {labels[name]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
