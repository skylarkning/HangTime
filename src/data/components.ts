/**
 * The Bugzilla products and components the dashboard can file into, fetched
 * live so the override dropdown can never offer a component that has since been
 * renamed or retired (Core :: Graphics: Layers, for one, is already gone).
 *
 * Only the products a main-thread hang can plausibly belong to are fetched;
 * that keeps the response around 13 KB.
 */

import type { BugComponent } from "./componentMap";

const PRODUCTS = ["Core", "Firefox", "Toolkit", "DevTools", "WebExtensions"];
const QUERY =
  "https://bugzilla.mozilla.org/rest/product?" +
  PRODUCTS.map((p) => `names=${encodeURIComponent(p)}`).join("&") +
  "&include_fields=name,components.name,components.is_active";

export interface ProductComponents {
  product: string;
  components: string[];
}

interface BugzillaProduct {
  name: string;
  components: { name: string; is_active?: boolean }[];
}

export async function fetchComponents(): Promise<ProductComponents[]> {
  const res = await fetch(QUERY, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`Bugzilla component query failed: ${res.status}`);
  }
  const data = (await res.json()) as { products: BugzillaProduct[] };
  return PRODUCTS.flatMap((name) => {
    const product = data.products.find((p) => p.name === name);
    if (!product) {
      return [];
    }
    return [
      {
        product: name,
        components: product.components
          .filter((c) => c.is_active !== false)
          .map((c) => c.name)
          .sort(),
      },
    ];
  });
}

/** Whether a suggestion is still a real component in the fetched list. */
export function isKnownComponent(
  list: ProductComponents[] | undefined,
  target: BugComponent,
): boolean {
  if (!list) {
    return true; // nothing to check against; trust the rule table
  }
  return !!list
    .find((p) => p.product === target.product)
    ?.components.includes(target.component);
}
