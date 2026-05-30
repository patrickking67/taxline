> Domain-knowledge seed — verify figures/dates against the cited IRS source before relying on it. The ingest/ refresh is the live-source path.

# Forms by document type

What an inbound document is, and what it typically feeds. One line each. Box/line
specifics must be confirmed against the current IRS form instructions.

- **W-2 — Wage and Tax Statement**: employee wages and withholding; feeds the wage line of the individual return (1040).
- **1099-NEC — Nonemployee Compensation**: payments to non-employees (contractors); feeds self-employment income (Schedule C / 1040).
- **1099-MISC — Miscellaneous Information**: rents, royalties, other income; feeds the relevant income lines (e.g. Schedule E, 1040).
- **1099-INT — Interest Income**: interest paid to the recipient; feeds taxable interest (Schedule B / 1040).
- **1099-DIV — Dividends and Distributions**: ordinary/qualified dividends and capital gain distributions; feeds dividend income (Schedule B / 1040).
- **1099-B — Proceeds From Broker and Barter Exchange**: securities sales proceeds and basis; feeds capital gains/losses (Form 8949 / Schedule D).
- **Schedule K-1**: a partner's/shareholder's/beneficiary's share of income, deductions, and credits — K-1 (Form 1065) for partnerships, K-1 (Form 1120-S) for S-corps, K-1 (Form 1041) for estates/trusts; feeds the recipient's return.
- **1098 — Mortgage Interest Statement**: mortgage interest, points, and related amounts; feeds itemized deductions (Schedule A) when applicable.
- **Brokerage composite (consolidated 1099)**: a single statement bundling 1099-INT, 1099-DIV, and 1099-B for one account; split it into its component forms before extraction.

Verify against the current IRS form instructions for each document type.
