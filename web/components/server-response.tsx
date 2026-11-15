import type { Exchange } from '../lib/api';
import { Lang, messages } from '../lib/i18n';
import { codeOf, outcomeOf, reasonOf } from '../lib/outcome';
import './server-response.css';

// What the server sent back for each call a page made: whether it allowed
// the call, the status, and the body as it arrived. It decides nothing and
// leaves nothing out.
export function ServerResponse({
  exchanges,
  lang,
}: {
  exchanges: Exchange[];
  lang: Lang;
}) {
  const text = messages(lang);
  return (
    <aside
      className="response"
      data-testid="server-response"
      aria-labelledby="server-response-title"
    >
      <h2 id="server-response-title">{text['response.title']}</h2>
      <p className="response-note">{text['response.note']}</p>
      <ul className="response-list">
        {exchanges.map((exchange, index) => {
          const outcome = outcomeOf(exchange.status);
          return (
            <li key={index}>
              <article
                className="exchange"
                data-testid="exchange"
                data-method={exchange.method}
                data-path={exchange.path}
                data-status={exchange.status}
                data-code={codeOf(exchange)}
                data-outcome={outcome}
              >
                <p className="exchange-result">
                  <strong className={outcome} data-testid="exchange-outcome">
                    {text[`response.${outcome}`]}
                  </strong>
                  <span
                    className="exchange-status"
                    data-testid="exchange-status"
                  >
                    {exchange.status}
                  </span>
                </p>
                {outcome === 'refused' && (
                  <p className="exchange-reason">{reasonOf(exchange, text)}</p>
                )}
                {/* Code, so it reads left to right in both languages. */}
                <pre
                  className="exchange-raw"
                  data-testid="exchange-raw"
                  dir="ltr"
                  tabIndex={0}
                  aria-label={text['response.raw']}
                >
                  <span data-testid="exchange-request">
                    {exchange.method} {exchange.path}
                  </span>
                  {'\n'}
                  <span data-testid="exchange-status-line">
                    {exchange.status}
                  </span>
                  {'\n'}
                  <span data-testid="exchange-body">
                    {JSON.stringify(exchange.body, null, 2)}
                  </span>
                </pre>
              </article>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
