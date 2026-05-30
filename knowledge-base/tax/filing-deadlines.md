> Domain-knowledge seed — verify figures/dates against the cited IRS source before relying on it. The ingest/ refresh is the live-source path.

# Filing deadlines

This file describes the **rules** for federal return due dates and maps them to forms.
It does **not** assert exact calendar dates or dollar amounts — those shift year to
year and must be confirmed against the current IRS source named below.

## The base rule

Most federal income-tax returns are due on the **15th day of the Nth month after the
end of the tax year**, where N depends on the entity/return. For a calendar-year filer
(year-end December 31), "the Nth month after year-end" lands in the following calendar
year.

- **N = 3** → 15th day of the 3rd month after year-end.
- **N = 4** → 15th day of the 4th month after year-end.
- **N = 5** → 15th day of the 5th month after year-end.

## Weekend / holiday shift

If a statutory due date falls on a **Saturday, Sunday, or a legal holiday** (federal or
a holiday observed in the District of Columbia, e.g. Emancipation Day), the deadline
moves to the **next business day**. The `compute_deadline` tool applies this shift
mechanically over a seed holiday set, but always returns a "verify against the IRS
source" pointer — do not treat a computed date as final.

## Form map (rule, not dated)

| Form     | Who / what                          | Rule                                              |
|----------|-------------------------------------|---------------------------------------------------|
| 1040     | Individual income tax return        | 15th day of the 4th month after year-end          |
| 1120     | C-corporation income tax return     | 15th day of the 4th month after year-end          |
| 1120-S   | S-corporation income tax return     | 15th day of the 3rd month after year-end          |
| 1065     | Partnership return                  | 15th day of the 3rd month after year-end          |
| 990      | Exempt-organization return          | 15th day of the 5th month after year-end          |
| 1040-ES  | Individual estimated tax (quarterly)| Q1 keyed to the 4th-month date; further installments follow the quarterly schedule |
| 4868     | Individual automatic extension      | Request by the 1040 due date; extends the filing date, not payment |
| 7004     | Business automatic extension        | Request by the underlying return's due date; extends filing, not payment |

Notes:
- **Extensions extend time to file, not time to pay.** Estimated balances are generally
  still due by the original date.
- **Fiscal-year filers**: apply the same "Nth month after year-end" rule to the actual
  fiscal year-end, not December 31.
- Estimated-tax installment dates (1040-ES) follow a quarterly pattern; confirm each
  installment date for the year in question.

## IRS source

Verify all of the above against the current IRS guidance — primarily **"Tax Calendars"
(IRS Publication 509)** and the specific **form instructions** (e.g. Instructions for
Form 1040, 1120, 1120-S, 1065, 990, 7004, 4868) on the official IRS website. These are
the authoritative, year-specific sources for exact dates and any special shifts.
