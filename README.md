# AIM - Auction Import Margin

One shared core, two apps:

| Part | What | Who |
|---|---|---|
| `packages/core` (`@aim/core`) | duty and docket rules, AI docket pick + decision, feature search, market stats and margin, offer / deep pricing | both apps and the scraper |
| `apps/aim` (to build) | full app, sold to AP holders: margin analysis, Today for you, feature search, bid pipeline, calculator | paying AP holders |
| `apps/lite` (to build) | marketplace of USS / ASNET cars with prices in RM and bid orders, different UI | the boss, free |
| `services/scraper` (to move in from the old `auction` repo) | USS scrape, Claude sheet reading | feeds both |

Mobile and the Android APK (Capacitor) are designed in from the start, like CarzNexus.

## Rules that define the product
- **Docket**: the free rule and Claude both pick. Same docket = used. Different, or only one picks = a person checks. A confirmed pick is remembered (`confirmKey`). Never a docket on a guess.
- **Features**: Claude lists every feature on the sheet (with factory / dealer / aftermarket); each is mapped to a catalog key so cars are searchable (JBL + GR kit in a Vellfire).
- **Margin**: Malaysian market range comes from CarzNexus listings as aggregated ASKING prices with a confidence level. Everything shown is an estimate and labelled so.

## Try it
```
node tests/v2-core.test.mjs      # new v2 core
npm test                         # all tests
```
`design/aim-mockup.html` is the approved clickable mockup (open it in a browser).
`supabase/migrations/01-17` are the current database as it is; `18_aim_*.sql` adds the v2 tables to the SAME Supabase project (additive, not applied yet).
