# Vitamin Reorder — Chrome extension

Adds your usual vitamins to your Amazon cart in one click.

## Why an extension and not a link

Amazon binds add-to-cart to a session CSRF token that only pages on
`amazon.com` can read. That is deliberate — if any website could add items to
your cart, that would be a cross-site request forgery hole. The old
`/gp/aws/cart/add.html` bulk endpoint was the sanctioned exception for
Associates, and it is now gated to the point of doing nothing.

An extension runs *inside* amazon.com with your own signed-in session, so it can
do what a website can't: click the real Add to Cart button, once per bottle, in
a background tab.

## Install

Desktop Chrome or Edge only. iOS and Android can't load unpacked extensions —
use the web app's guided flow on a phone.

1. Unzip this folder somewhere permanent (the browser loads it from disk).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. **Load unpacked** → pick the `extension` folder.
5. Pin the extension so its icon is visible.

## Use

1. Sign in to Amazon first. Signed out, items land in a guest cart, and the
   run will report the cart count as unreadable.
2. Click the extension icon.
3. Tick the bottles that ran out, set quantities, click **Add N to cart**.
4. A background tab walks the list. Watch progress in the popup, or close it —
   the run keeps going. It ends on your cart.
5. Review the cart and check out yourself. The extension never places an order.

## What each result means

| Result | Meaning |
| --- | --- |
| `added` | Clicked, and Amazon's header cart count went up. |
| `unconfirmed` | Clicked, but the count didn't move or wasn't readable. Check that one — usually means signed out, or the listing needed an option picked. |
| `attention` | No Add to Cart button: out of stock, or the listing needs a size/flavour chosen. |
| `failed` | The page didn't load or the script couldn't run. |

Nothing is reported as added unless the cart count actually moved.

## Permissions

- `host_permissions: https://www.amazon.com/*` — the only site it touches.
- `tabs` + `scripting` — open the working tab and click the button on it.
- `storage` — your list, quantities, and order dates, all local.

No analytics, no network calls anywhere except Amazon, no account access.

## When Amazon changes its markup

The click targets `#add-to-cart-button` with several fallbacks. If a run starts
reporting `attention` on everything, Amazon has renamed something: open
`chrome://extensions` → the extension's **service worker** → Console, or read
the `debug` key in its storage. The trail names the step that failed. The
selectors live at the top of `background.js`.

## Shared shelf

`shelf.js` is the single source of truth for the bottle list and is shared with
the web app at `/vitamin-reorder/`. Edit it once and rebuild to update both.
