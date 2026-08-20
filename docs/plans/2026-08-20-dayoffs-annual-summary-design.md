# Dayoffs annual summary design

## Goal

Show the total dayoffs used in the calendar year of the selected month. When
an employee is selected, a panel below that employee's monthly records shows
the annual Vacation, Sick Leave, Personal Day, and combined totals.

## Scope and rules

- The selected calendar month supplies the year; changing from December to
  January changes the summary year.
- The calendar and record list remain month-scoped.
- Annual totals use saved dayoff records as created, with their inclusive
  calendar-day duration. No working-day recalculation or leave-type conversion
  is introduced.
- The annual panel is shown only for a selected employee. It shows every leave
  type, including zero totals.
- Mutations reload the existing calendar response, so the month and annual
  totals remain consistent.

## Design

Extend the existing authenticated `GET /api/dayoffs?year=&month=` response
with a `year_totals` collection. The service obtains the normal active
employees and month-intersecting records, then performs a grouped aggregate
for the selected year. The aggregate returns per-employee totals for each
leave type and is initialized to zero for active employees without records.

The frontend API mapper exposes the totals in camelCase. The Pinia store
retains them as part of the same winning load request as the calendar data,
which prevents quick month navigation from rendering stale totals. The shell
passes the selected employee's totals and the selected year to the record-list
component. That component renders an accessible annual-summary panel above
the existing month-only records.

## Alternatives considered

Fetching all twelve month endpoints in the client would duplicate intersecting
ranges and add unnecessary latency. A separate summary endpoint would require
two coordinated requests and independent loading and error states. Extending
the current response keeps the calendar view atomic and requires one request.

## Verification

Add backend coverage for each leave type, zero-valued active employees, and
year selection. Add frontend API and store mapping tests, plus component tests
that verify the selected employee panel, zero values, and refresh on year
navigation.
