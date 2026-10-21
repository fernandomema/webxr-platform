# Credits

Credits are the platform's currency. A published world can charge for things (`shop` component + `ctx.pay`), and players buy credits on the website (Stripe) or inside a Meta Quest headset (Meta in-app payments).

The design goal is one rule: **a code block can never take a player's credits without that player approving it.** Everything below exists to make that true even though world scripts are written by strangers.

## Why a script cannot spend credits on its own

1. **Scripts run in a sandbox** (`packages/engine/src/xr/sandbox/`, QuickJS compiled to WebAssembly). A script sees the standard language and `ctx`, nothing else: no `window`, `document`, `fetch`, cookies or storage. It cannot call our API with the player's session.
2. **`ctx.net` is closed to our own site** except `/api/feedback` (`packages/engine/src/xr/scriptNet.ts`), and external requests carry no cookies.
3. **The money lives only on the server.** The balance changes through the ledger (`services/creditLedger.ts`): conditional updates (`balance >= amount`), one `creditTransaction` per change with a unique idempotency key, per-day spending limits. The client never says how much to charge.
4. **Prices come from the published world.** A script names a product (`ctx.pay.request({ sku })`); the server reads the price from the world's published revision (`shop` component).
5. **The player approves in a window the world does not control.** `ui/purchasePrompt.ts` is not a slot (no script can see, move, hide or click it), is drawn in front of everything, follows the head, and shows the server's name, price and balance. The Pay button arms after a moment. Only a click on it sends the signed confirmation.
6. **The confirmation is a signed, single-use, short-lived challenge** (`server/creditChallenge.ts`) tied to the account, the world revision, the product and the price. The script never receives it: `ctx.pay.request` resolves with `{ ok, reason }` only.
7. **Prompt abuse is limited**: one prompt at a time, a gap between prompts, a cooldown after a refusal, and silence after three refusals in a row (`payments/paymentService.ts`); the server rate-limits challenges too.

## Using it in a world

Add a `shop` component to any slot:

```json
{ "type": "shop", "products": [{ "sku": "golden-sword", "name": "Golden sword", "price": 250 }] }
```

and ask for the purchase from a script (host/solo only; pass the player who triggered the event, e.g. `event.playerId` of `onTrigger`/`onEquip`; leaving `player` out asks the local player):

```js
async onTrigger(event) {
  if (event.phase !== 'press') return;
  const result = await ctx.pay.request({ sku: 'golden-sword', player: event.playerId });
  if (result.ok) { /* give the item */ }
}
```

`ctx.pay.owns(sku, player)` says whether someone already bought it (products are bought once unless `repeatable`). Payments only work in **published** worlds, for signed-in players. For guests, the host asks and the guest's own client prices and approves it with the guest's account; the host learns only the answer.

## Buying credits

`PaymentProviderAdapter` (`server/payments/types.ts`) has two implementations:

| Provider | Flow | Configuration |
|---|---|---|
| Stripe (`payments/stripe.ts`) | `/settings/credits` → Checkout → signed webhook `POST /api/credits/webhooks/stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Meta Quest (`payments/meta.ts`, client `xr/payments/metaPayments.ts`) | the ATM → Digital Goods API on the headset → `POST /api/credits/receipt` → server verifies with Meta and consumes the purchase | `META_APP_ID`, `META_APP_SECRET` |

A provider only returns a `CreditGrant`; the ledger applies it once per `idempotencyKey` (`stripe:<session id>`, `meta:<purchase token>`). The credits come from our pack catalog (`credits/catalog.ts`), and Stripe's paid amount must match the pack's price. Set `CREDITS_SECRET` (defaults to `BETTER_AUTH_SECRET`) and run `npm run db:push` for the new tables.

### The ATM and buying inside the headset

The lobby has an ATM (and the Starter Kit has one to place anywhere): an object with an `atm` component. Pressing any part of it opens the game's credits window (`ui/atmPanel.ts`, state in `payments/atmController.ts`): balance, the packs with the **store's own prices**, and a button per pack. Like the purchase prompt, the window belongs to the game, so a world can only place the machine, never change what it shows or does.

Buying follows Meta's guide for WebXR PWAs ([ps-iap](https://developers.meta.com/horizon/documentation/web/ps-iap/)), in `payments/metaPayments.ts`:

1. `getDigitalGoodsService('https://quest.meta.com/billing')`; where it rejects (not the Horizon Store build) the ATM says credits are bought on the website.
2. `getLoggedInUserId()` before anything is charged; without a Meta account (0 / not granted) the payment is not started.
3. `getDetails([sku])` for the store's title and price.
4. `PaymentRequest` with `{ supportedMethods: 'https://quest.meta.com/billing', data: { sku } }`; the `purchaseToken` is held, `complete('success')` is called (the headset blocks input until it is), and then the receipt goes to `POST /api/credits/receipt`.
5. `listPurchases()` when the ATM opens finishes any consumable that was paid but never credited.

The server (`payments/meta.ts`) calls Meta's `verify_entitlement`, then `consume_entitlement` (Meta refunds an unconsumed consumable after three days), and only then credits the pack once per purchase token. The first verified purchase links the Meta account to the player (`paymentIdentity`), after which receipts naming that Meta account are refused for anyone else.

Required in the Developer Center: three **consumable** add-ons with the SKUs `credits_500`, `credits_1200` and `credits_3000`, a Data Use Checkup that includes the User ID grant (`getLoggedInUserId`), and `META_APP_ID` / `META_APP_SECRET` on the server. Test users can pay before the checkup is approved.

Residual risk: the Meta user id in a receipt comes from the player's device. Consuming makes a purchase creditable once, and the account link stops a second player from using an id that is already linked, but until a Meta account is linked the first receipt that names it is trusted. Meta's web documentation does not offer a way to check the id against the purchase token.

## Limits (`credits/catalog.ts`)

Price 1–10,000 credits; 20,000 spent per account per day, 10,000 per world per day; balance cap 1,000,000; 10 prompts requested per minute.

## Not covered

Credits are a sink: they are not paid out to world authors, not transferable between players, and refunds are manual (a `refund` ledger row). Stripe refund/dispute webhooks are not handled yet.
