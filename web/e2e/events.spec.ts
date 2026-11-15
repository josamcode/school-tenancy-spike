import { expect, Page, test } from '@playwright/test';
import {
  demoFee,
  demoPending,
  demoSchools,
  userDemoPrincipal,
} from '../../db/seed';
import {
  exchange,
  expectDubaiTime,
  LANGS,
  schoolPath,
  sweepStyles,
  words,
} from './support/demo';
import { ARABIC_INDIC_DIGITS, Lang, signIn } from './support/session';
import { RECEIVER_URL, WEB_URL } from './support/stack';

const { ghadeer, murooj } = demoSchools;

// The only file that writes Ghadeer and Murooj. Each test accepts an
// application of its own: the first two of each school, one per language.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const applicationOf = (
  school: keyof typeof demoPending,
  lang: Lang,
): { id: string; applicantName: string } =>
  demoPending[school][lang === 'ar' ? 0 : 1];
const row = (page: Page, application: { id: string }) =>
  page.locator(
    `[data-testid="application"][data-application="${application.id}"]`,
  );
const step = (page: Page, name: string) =>
  page.locator(`[data-testid="trail-step"][data-step="${name}"]`);
const trailPath = (
  lang: Lang,
  school: { id: string },
  application: { id: string },
) => `${schoolPath(lang, school, 'admissions')}/${application.id}`;

async function accept(
  page: Page,
  lang: Lang,
  school: { id: string },
  application: { id: string; applicantName: string },
) {
  await page.goto(schoolPath(lang, school, 'admissions'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    words(lang)['admissions.title'],
  );
  await expect(row(page, application)).toHaveAttribute(
    'data-status',
    'pending',
  );
  await expect(row(page, application)).toContainText(application.applicantName);
  await row(page, application).getByTestId('accept').click();
  await expect(page).toHaveURL(WEB_URL + trailPath(lang, school, application));

  // What the API answered to the acceptance itself.
  const posted = exchange(
    page,
    'POST',
    `/schools/${school.id}/admissions/applications/${application.id}/accept`,
  );
  await expect(posted).toHaveAttribute('data-status', '201');
  await expect(posted.getByTestId('exchange-body')).toContainText(
    '"studentId"',
  );
  await expect(step(page, 'accepted')).toHaveAttribute('data-state', 'done');
}

test.beforeEach(async ({ context }) => {
  await signIn(context, userDemoPrincipal);
});

for (const lang of LANGS) {
  test(`follows an acceptance to the registration fee where finance is on, in ${lang}`, async ({
    page,
  }) => {
    const text = words(lang);
    const application = applicationOf('ghadeer', lang);
    await accept(page, lang, ghadeer, application);

    // The page asks the API again until the worker has handled the event.
    const routed = step(page, 'routed');
    await expect(routed).toHaveAttribute('data-routed-to', 'finance', {
      timeout: 60_000,
    });
    await expect(routed).toContainText(text['trail.routedToFinance']);
    await expect(step(page, 'dispatched')).toHaveAttribute(
      'data-state',
      'done',
    );

    const outcome = step(page, 'outcome');
    await expect(outcome).toHaveAttribute('data-state', 'done');
    await expect(outcome).toContainText(text['trail.feePosted']);
    const fee = outcome.getByTestId('fee-amount');
    await expect(fee.getByTestId('money-value')).toHaveText(demoFee.amount);
    await expect(fee.getByTestId('money-currency')).toHaveText(
      demoFee.currency,
    );
    await expect(page.getByTestId('attempt')).toHaveCount(0);
    // When it was accepted, sent and routed, each in the school's own time.
    expect(await expectDubaiTime(page.getByTestId('screen'), lang)).toBe(3);

    const event = exchange(
      page,
      'GET',
      `/schools/${ghadeer.id}/admissions/applications/${application.id}/event`,
    );
    await expect(event).toHaveAttribute('data-status', '200');
    await expect(event.getByTestId('exchange-body')).toContainText(
      '"routedTo": "finance"',
    );
    // The fee is read from the ledger, as the same user.
    await expect(
      exchange(page, 'GET', `/schools/${ghadeer.id}/ledger`),
    ).toHaveAttribute('data-status', '200');
    expect(await page.locator('body').innerText()).not.toMatch(
      ARABIC_INDIC_DIGITS,
    );

    // The acceptance is everywhere it should be.
    await page.goto(schoolPath(lang, ghadeer, 'admissions'));
    await expect(row(page, application)).toHaveAttribute(
      'data-status',
      'accepted',
    );
    await expect(row(page, application).getByTestId('accept')).toHaveCount(0);
    await page.goto(schoolPath(lang, ghadeer, 'students'));
    await expect(
      page
        .getByTestId('student-row')
        .filter({ hasText: application.applicantName }),
    ).toHaveCount(1);
    await page.goto(schoolPath(lang, ghadeer, 'ledger'));
    const owed = page
      .getByTestId('student-balance')
      .filter({ hasText: application.applicantName });
    await expect(owed).toHaveCount(1);
    await expect(owed.getByTestId('money-value')).toHaveText(demoFee.amount);
  });

  test(`follows an acceptance to the school’s own system where finance is off, in ${lang}`, async ({
    page,
    request,
  }) => {
    const text = words(lang);
    const application = applicationOf('murooj', lang);
    await accept(page, lang, murooj, application);

    const routed = step(page, 'routed');
    await expect(routed).toHaveAttribute('data-routed-to', 'webhook', {
      timeout: 60_000,
    });
    await expect(routed).toContainText(text['trail.routedToWebhook']);

    const outcome = step(page, 'outcome');
    await expect(outcome).toHaveAttribute('data-state', 'done', {
      timeout: 60_000,
    });
    await expect(outcome).toContainText(text['trail.delivered']);
    await expect(outcome).toContainText(`${RECEIVER_URL}/hooks`);
    const attempts = page.getByTestId('attempt');
    await expect(attempts).toHaveCount(1);
    await expect(attempts).toHaveAttribute('data-attempt', '1');
    await expect(attempts).toHaveAttribute('data-response', '200');
    await expect(page.getByTestId('fee-amount')).toHaveCount(0);
    // Accepted, sent, routed, delivered, and the one attempt: each in the
    // school's own time.
    expect(await expectDubaiTime(page.getByTestId('screen'), lang)).toBe(5);

    const event = exchange(
      page,
      'GET',
      `/schools/${murooj.id}/admissions/applications/${application.id}/event`,
    );
    await expect(event.getByTestId('exchange-body')).toContainText(
      '"status": "delivered"',
    );
    await expect(page.locator('body')).not.toContainText('whsec_');
    // Finance is off here, so the page does not ask for the ledger.
    await expect(
      exchange(page, 'GET', `/schools/${murooj.id}/ledger`),
    ).toHaveCount(0);

    // What the receiver itself recorded: one request, and its signature held.
    const eventId = await page.getByTestId('trail').getAttribute('data-event');
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    const recorded = await request.get(`${RECEIVER_URL}/received/${eventId}`);
    expect(recorded.status()).toBe(200);
    expect(await recorded.json()).toEqual([
      {
        id: eventId,
        receivedAt: expect.any(String),
        signatureValid: true,
        verdict: 'accepted',
      },
    ]);
    // The production build does not talk to the receiver.
    await expect(page.getByTestId('receiver-record')).toHaveCount(0);
  });
}

test('stops asking once the event has settled, and moves nothing for someone who asked for less motion', async ({
  page,
}) => {
  const application = applicationOf('murooj', 'ar');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(trailPath('ar', murooj, application));
  await expect(step(page, 'outcome')).toHaveAttribute('data-state', 'done');
  expect((await sweepStyles(page)).moving).toEqual([]);

  const calls: string[] = [];
  page.on('request', (sent) => calls.push(sent.url()));
  await page.waitForTimeout(3000);
  expect(calls).toEqual([]);
});

test('shows a pending application as not accepted yet, with the API’s 404 for its event', async ({
  page,
}) => {
  const application = demoPending.ghadeer[5];
  await page.goto(trailPath('ar', ghadeer, application));
  await expect(step(page, 'accepted')).toHaveAttribute('data-state', 'waiting');
  const event = exchange(
    page,
    'GET',
    `/schools/${ghadeer.id}/admissions/applications/${application.id}/event`,
  );
  await expect(event).toHaveAttribute('data-status', '404');
  await expect(event.getByTestId('exchange-body')).toContainText(
    'No event for this application',
  );
});
