// The shelf, shared by the web app and the browser extension. Transcribed from
// the counter photos and matched to Amazon listings.
//
// match: "exact" = listing title matches the bottle spec exactly.
//        "close" = right product, but the listing has size/bundle variants —
//                  worth a glance on Amazon before checking out.
//        "none"  = no listing found; falls back to an Amazon search.

export const SHELF = [
  {
    id: "alpha-gpc", brand: "Nutricost", name: "Alpha GPC 600mg",
    size: "120 capsules · 60 servings", asin: "B076XNXLR2", match: "exact",
    search: "Nutricost Alpha GPC 600mg 120 capsules",
  },
  {
    id: "caffeine-theanine", brand: "SmarterVitamins", name: "Caffeine 200mg + L-Theanine",
    size: "50 liquid softgels · with MCT oil", asin: "B07FP4KS3R", match: "exact",
    search: "SmarterVitamins caffeine L-theanine MCT 50 softgels",
  },
  {
    id: "probiotic", brand: "Proriginal", name: "Probiotic 100 Billion CFU",
    size: "35 strains + 5 prebiotics · 60 capsules", asin: "B0BGRD3Q1D", match: "close",
    note: "Brand sells 60ct and 120ct — confirm the count.",
    search: "Proriginal probiotics 100 billion CFU 35 strains 60 capsules",
  },
  {
    id: "iron", brand: "Nature Made", name: "Iron 65mg",
    size: "325mg ferrous sulfate · 365 tablets", asin: "B01LB6808U", match: "close",
    note: "Several 365ct listings exist, some bundled with junk.",
    search: "Nature Made Iron 65mg 365 tablets",
  },
  {
    id: "nad-resveratrol", brand: "Deal Supplement", name: "NAD+ Resveratrol 1,000mg",
    size: "120 vegetarian capsules", asin: "B0DJWRXKPX", match: "exact",
    search: "Deal Supplement NAD+ resveratrol 1000mg 120 veggie capsules",
  },
  {
    id: "lions-mane", brand: "Real Mushrooms", name: "Lion's Mane Extract",
    size: "120 capsules", asin: "B078SZX3ML", match: "exact",
    search: "Real Mushrooms Lions Mane capsules 120ct",
  },
  {
    id: "k2-d3", brand: "Nutricost", name: "Vitamin K2 (MK7) + D3",
    size: "100mcg K2 / 5000 IU D3 · 120 softgels", asin: "B07K3VFVJC", match: "exact",
    search: "Nutricost vitamin K2 D3 120 softgels",
  },
  {
    id: "joint-defend", brand: "Clean Nutraceuticals", name: "Joint Defend",
    size: "Glucosamine · Chondroitin · MSM · 120 capsules", asin: "B0CGFC5RCQ", match: "close",
    note: "Single bottle vs. 2-pack listings look nearly identical.",
    search: "Clean Nutraceuticals Joint Defend glucosamine chondroitin MSM 120",
  },
  {
    id: "turmeric-ginger", brand: "Qunol", name: "Turmeric + Ginger 2400mg",
    size: "Enhanced absorption · 105 capsules", asin: "B09YGG58LZ", match: "exact",
    search: "Qunol turmeric ginger black pepper 2400mg 105 capsules",
  },
  {
    id: "omega-3", brand: "MAV Nutrition", name: "Triple Strength Omega-3 3,600mg",
    size: "1300mg EPA / 860mg DHA · 120 softgels", asin: "B01NBTJFJB", match: "exact",
    search: "MAV Nutrition triple strength omega 3 fish oil 3600mg 120 softgels",
  },
  {
    id: "tongkat-ali", brand: "ELMNT", name: "Tongkat Ali + Fadogia Agrestis",
    size: "200:1 extract · 90 capsules", asin: "B0C4NV7Q2B", match: "close",
    note: "ELMNT lists this without the brand name in the title.",
    search: "ELMNT tongkat ali fadogia agrestis 200x strength",
  },
  {
    id: "unknown-white", brand: "Unidentified", name: "White bottle, back right",
    size: "120 count · label cut off in the photo", asin: null, match: "none",
    note: "Send a clearer photo and this gets a real listing.",
    search: "supplement",
  },
];

// Overridable so the extension can be pointed at a local mock storefront in tests.
export const AMAZON = "https://www.amazon.com";
export const CART_VIEW = `${AMAZON}/gp/cart/view.html`;

export function productUrl(item, base = AMAZON) {
  return item.asin
    ? `${base}/dp/${item.asin}`
    : `${base}/s?k=${encodeURIComponent(item.search || item.name)}`;
}

// Accepts a bare ASIN or any Amazon product URL.
export function parseAsin(input) {
  const s = (input || "").trim();
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/(?:\/dp\/|\/gp\/product\/|\/product\/|[?&]asin=)([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}
