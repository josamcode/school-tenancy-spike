import type { ApiProblem } from '../lib/api';
import { Lang, messages } from '../lib/i18n';

// What the API refused, said in the page's language. Nothing else is shown.
export function ApiError({
  status,
  problem,
  lang,
}: {
  status: number;
  problem: ApiProblem;
  lang: Lang;
}) {
  const text = messages(lang);
  const message =
    problem.code === 'MODULE_DISABLED'
      ? text['error.moduleDisabled']
      : problem.code === 'PERMISSION_DENIED'
        ? text['error.permissionDenied']
        : status === 401
          ? text['error.401']
          : status === 403
            ? text['error.403']
            : status === 404
              ? text['error.404']
              : text['error.other'];
  return (
    <p
      className="error"
      role="alert"
      data-testid="error"
      data-status={status}
      data-code={problem.code}
    >
      {message}
    </p>
  );
}
