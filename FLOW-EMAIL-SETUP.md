# Sæt Shopify Flow op til at sende bekræftelsesmails

Booking-appen skriver nu fire felter på kunden ved hver booking:

- `event_booking.last_event_title` — eventets titel
- `event_booking.last_slot_label` — det valgte tidspunkt (fx "12. sep kl. 17:00")
- `event_booking.last_party_size` — antal personer i tilmeldingen (inkl. dig selv)
- `event_booking.last_notes` — evt. allergier/noter

Metafelt-definitionerne er allerede oprettet i Shopify admin, så Flow kan finde dem i sin picker.

## Trin i Shopify Flow

1. Gå til **Shopify admin → Apps → Flow** (installér Flow-appen først, hvis I ikke allerede har den — den er gratis).
2. **Create workflow** → vælg trigger **"Customer metafield value changed"**.
3. Sæt filteret til: Namespace `event_booking`, Key `last_event_title`.
4. Tilføj action **"Send email"**:
   - **To**: `{{customer.email}}`
   - **Subject**: fx `Din tilmelding til {{customer.metafields.event_booking.last_event_title.value}} er bekræftet`
   - **Body** (eksempel):
     ```
     Hej {{customer.first_name}},

     Din tilmelding er bekræftet:

     Event: {{customer.metafields.event_booking.last_event_title.value}}
     Tidspunkt: {{customer.metafields.event_booking.last_slot_label.value}}
     Antal personer: {{customer.metafields.event_booking.last_party_size.value}}
     {% if customer.metafields.event_booking.last_notes.value != blank %}Noter: {{customer.metafields.event_booking.last_notes.value}}{% endif %}

     Vi glæder os til at se dig!
     INTERSPORT
     ```
5. **Turn on** workflowet.

## Vigtigt at vide

- Trigger'en fyrer **hver gang** feltet opdateres — dvs. hver gang samme kunde booker et *nyt* event. Booker de samme event/tidspunkt igen, blokerer booking-appen det allerede (fejl "Du er allerede tilmeldt"), så der kommer ikke dubletter.
- Hvis kunden booker to forskellige events lige efter hinanden, kan begge trigge Flow — det er forventet og korrekt, da hvert Flow-kald sender mail for *det* events data på det tidspunkt feltet blev opdateret.
- Vil I have et andet layout/branding, kan I redigere e-mailen frit i Flow's builder — det er almindelig Shopify-mailskabelon, ikke noget appen styrer.
