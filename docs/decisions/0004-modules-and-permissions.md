# 4. Modules and permissions: deny by default, areas, roles as data, grants, and groups that give no access

## Context

Schools use different parts of the platform. One person may work in two
schools with one login, and a group of schools may have an administrator who
should see some things in some of its schools. Each of these can fail open: a
module that is on because nobody said it was off, a role in one school that
counts in another, or a group membership that quietly grants access.

## Decision

- **A module is off unless a row says it is on.** A school has a module only
  when `tenant_modules` holds a row for it with `enabled = true`. A missing row
  means off.
- **Every area is declared as core or as a module, in one typed map**
  (`src/entitlements/areas.ts`). Nothing is core by default: a permission whose
  area is missing from the map does not compile, and the start-up check stops
  the application if one reaches runtime.
- **A permission is an area and an action,** such as `students:read`. A route
  declares one permission. Its area decides whether the module check runs, and
  its action is what the user must hold.
- **Module names, permissions and roles are catalogs with foreign keys.** A
  misspelt module on a school, permission in a grant or role on a membership
  is refused by the database.
- **There are two ways to hold a permission in a school, and no third:** a
  membership whose role has it (`role_permissions`), or an explicit grant of
  user, school and permission (`grants`).
- **The school is part of both branches of the permission query.** A role in
  one school gives nothing in another, and a grant in one school gives nothing
  in another.
- **Roles are data.** What a role holds is a row, not code.
- **A group gives no access.** `groups`, `group_schools` and `group_admins`
  only record who administers what. A school added to a group gives its
  administrator nothing until a grant exists.
- **Nothing is cached.** Access, module and permission are read on every
  request, so removing a membership or a grant, or switching a module, takes
  effect on the next request.
- **Only the owner role writes access.** The runtime role can read
  memberships, role permissions and grants, and cannot write any of them, so
  nobody grants themselves access through the application.

## Alternatives considered

- **Feature flags in configuration.** A flag is set per deployment, not per
  school, and a change needs a release.
- **Permissions inside the token.** They are fast to check and stale until the
  token expires. A revoked grant would keep working for hours.
- **Access inherited from a group.** It is convenient and implicit: adding a
  school to a group would hand its data to someone without a decision about
  that school. We require a grant per school and permission.
- **A core area by default.** Our first version treated any area that was not
  a module as core. A new area with a forgotten module entry would then be on
  for every school. The typed map makes that a compile error.
- **Two declarations per route,** one for the module and one for the
  permission. Two declarations that must agree can disagree.
- **A cache of memberships and modules.** It trades a query per request for a
  window in which a revocation does not apply.

## Consequences

- Each request to a module's route costs three small reads: access, module,
  permission.
- A new permission must be added in three places, and tests keep them equal:
  the code list, the `permissions` table, and what `school_admin` holds.
- A user with a grant in a school can learn that a module is off there. A
  grant is real access to the school, so that is accepted.

## Known limits

- A membership has exactly one role, and roles are the same for all schools.
  Schools will want roles of their own.
- No route switches a module or writes a grant. Both are done as the owner.
- The module names in code and in the `modules` table are kept equal by a
  test, not by construction.

## Evidence

- Pull requests: [#3](https://github.com/josamcode/school-tenancy-spike/pull/3),
  [#4](https://github.com/josamcode/school-tenancy-spike/pull/4).
- Modules over HTTP, including a switch that takes effect on the next request:
  `test/api/entitlements.e2e-spec.ts`.
- One login across schools, grants, groups, revocation, and a fixture for each
  branch of the permission query where the condition holds in the wrong
  school: `test/api/access.e2e-spec.ts`.
- Catalogs and who may write them: `test/db/modules.spec.ts`,
  `test/db/access.spec.ts`, `test/db/module-list.spec.ts`,
  `test/db/permission-list.spec.ts`.
- On the screen: `web/e2e/permissions.spec.ts`.
- `pnpm prove` rows: `modules.no-module-check`, `modules.undeclared-route`,
  `permissions.role-any-school`, `permissions.grant-any-school`.
