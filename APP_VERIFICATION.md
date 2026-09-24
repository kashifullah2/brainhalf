# Verifying a generated BrainHalf app

Managed Workers apps can include `brainhalf.verify.json` at the project root. **Verify full stack** builds the saved revision, runs its test script, provisions a disposable D1 database, applies migrations, uploads the Worker, and checks the actual app. Successful verification is required before publishing that exact revision.

These checks run only against the disposable development release. They do not modify the project's development or production database. Test emails are captured in the project inbox. Real Google consent and email delivery must be validated separately.

## Example: a booking app

Adapt these routes, response fields, table names, and selectors to the generated application. The format is strict JSON; extra fields and unsupported actions fail validation before a build job starts.

```json
{
  "version": 1,
  "access": "private",
  "steps": [
    {
      "type": "request",
      "name": "Create booking",
      "path": "/api/bookings",
      "method": "POST",
      "body": { "day": "2026-10-01" },
      "status": 201,
      "capture": { "bookingId": "/booking/id" }
    },
    {
      "type": "database",
      "name": "Booking was saved",
      "sql": "SELECT day FROM bookings WHERE id=?",
      "params": ["{{bookingId}}"],
      "rows": 1,
      "assertions": [{ "pointer": "/0/day", "equals": "2026-10-01" }]
    },
    {
      "type": "request",
      "name": "Another user cannot read the booking",
      "path": "/api/bookings/{{bookingId}}",
      "as": "otherUser",
      "status": 404
    },
    {
      "type": "browser",
      "name": "Open bookings page",
      "action": "goto",
      "path": "/bookings"
    },
    {
      "type": "browser",
      "name": "Show the booked date",
      "action": "expectText",
      "selector": "[data-testid=booking-date]",
      "value": "2026-10-01"
    }
  ]
}
```

## Supported checks

- **Request:** `GET` (default), `POST`, `PUT`, `PATCH`, or `DELETE`, with an expected HTTP `status`. `as` selects `user` (default), `otherUser`, or `anonymous`. These identities are separate temporary app sessions. Requests pass through the runtime's identity checks and real generated Worker, independently of page JavaScript. Paths must begin with `/api/`; external URLs and Google consent navigation are excluded.
- **Assertions:** JSON pointers select exact values, including arrays. `/items/0/title` selects the first item's title; the empty pointer selects the entire JSON value. `equals` supports JSON values with structural equality. Missing fields fail the check.
- **Capture:** Store response fields under unique variable names. Use `{{variable}}` in later request bodies, paths, expected values, or database parameters. Values inserted into paths are URL-encoded; SQL uses bound parameters. Reassigning a variable is rejected.
- **Database:** One read-only `SELECT`, optional bound `params`, exact expected `rows`, and assertions against the resulting row array. The runtime queries the disposable database directly and caps returned rows. API success alone does not prove persistence.
- **Browser:** `goto` with a relative `path`; `click`, `fill`, `expectVisible`, or `expectText` with a CSS `selector`. `fill` and `expectText` require a `value`. Text checks wait for a visible matching element. The browser uses the first test user's session.

A plan has 3–40 uniquely named checks and is limited to 64 KB. It must include a successful API write and a direct database value assertion. Private apps must also check an anonymous or second-user request receiving 401, 403, or 404. Add specific checks for all important business rules; satisfying these minimums does not establish complete app correctness.

On failure, later checks stop and the failed result appears in Project Settings. Cancellation and job time limits still apply. Update the app or its test definition, then rerun verification; a changed revision cannot reuse an older passing result.

Older projects without this file retain the existing starter-specific checks for `/api/health`, `/api/items`, and `/api/contact`. New Workers scaffolds include an editable verification file. Custom apps should define their own checks before publication.
