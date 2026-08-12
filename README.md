# shopify-event-booking

App proxy-backend til `sections/event-booking-run.liquid` (i "jonas ny"-temaet).
Håndterer ledige tider og bookinger, og opretter/opdaterer den tilsvarende
Shopify-kunde på intersport-dk, så en booking altid ender som et rigtigt
kundekort i Shopify.

## Hvorfor formularen ikke virkede

`event-booking-run.liquid` sender allerede requests til
`/apps/intersport-booking/slots` og `/apps/intersport-booking/bookings` — men
der var intet bagvedliggende app proxy-endpoint, der kunne svare, og ingen
kode der oprettede kunden i Shopify. Dette repo er det endpoint.

## Sådan virker det

- `GET /api/slots?event_id=...` — returnerer ledige tider og resterende
  pladser for et event (læst fra Postgres).
- `POST /api/bookings` — validerer, tjekker kapacitet, opretter/finder
  kunden i Shopify (`customerCreate`/`customerUpdate`), tagger kunden
  (`event-booking`, `event:<event_id>`) og gemmer booking-detaljer i et
  enkelt JSON-metafelt (`event_booking.bookings`) på kunden — ét samlefelt
  frem for ét metafelt pr. event, fordi intersport-dk allerede er tæt på
  Shopifys metafelt-loft. Bookingen gemmes desuden i Postgres til jeres eget
  overblik.
- Begge endpoints verificerer Shopifys App Proxy-signatur (`lib/verify-proxy.js`)
  så kun requests der reelt kommer igennem Shopify accepteres.

## Events og tider

Events/slots administreres ikke i Shopify-temaet (kun `event_id` og et
overordnet kapacitetstal ligger der) — de synces til Postgres med:

```bash
node scripts/sync-event.js events/run-event-2026.example.json
```

Kopiér filen, ret `event_id`/`title`/`slots`, og kør scriptet igen når I
opretter et nyt event eller ændrer tider/kapacitet.

## Opsætning (det du selv skal gøre)

1. **Vercel-projekt**: opret et nyt Vercel-projekt for dette repo, sæt en
   Postgres-database op (samme flow som `shopify-pause-tracking`), og
   tilføj miljøvariablerne fra `.env.example` i Vercel.
   - `SHOPIFY_ACCESS_TOKEN` skal have scope `write_customers` (og
     `read_customers`).
   - `SHOPIFY_API_SECRET` er den samme "Client secret" som jeres eksisterende
     custom app på intersport-dk bruger til webhook-verifikation.
2. **App proxy**: i Shopify Partner Dashboard for jeres custom app, under
   "App proxy", sæt:
   - Subpath prefix: `apps`
   - Subpath: `intersport-booking`
   - Proxy URL: `https://<vercel-domæne>/api`

   Det matcher `/apps/intersport-booking/slots` → `/api/slots` og
   `/apps/intersport-booking/bookings` → `/api/bookings`.
3. **Tema**: indsæt `sections/event-booking-run.liquid` i temaet (manuelt,
   som aftalt) og tilføj sektionen på event-siden.

Jeg kan ikke selv oprette Vercel-projektet, sætte hemmelighederne, eller
konfigurere app proxy'en i Partner Dashboard — det kræver jeres login. Sig
til hvis du vil have trinene gennemgået sammen.
