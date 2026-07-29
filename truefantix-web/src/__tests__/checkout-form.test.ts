import { buildCheckoutHoldingUrl, buildCheckoutReturnUrl } from "@/components/CheckoutForm";

describe("CheckoutForm", () => {
  it("returns Stripe redirects to the existing checkout success route", () => {
    expect(buildCheckoutReturnUrl("https://truefantix-web.vercel.app", "order_123")).toBe(
      "https://truefantix-web.vercel.app/checkout/success?orderId=order_123"
    );
  });

  it("URL-encodes the order id in the Stripe return URL", () => {
    expect(buildCheckoutReturnUrl("https://example.com", "order/with space")).toBe(
      "https://example.com/checkout/success?orderId=order%2Fwith%20space"
    );
  });

  it("routes completed purchases to My Tickets Holding", () => {
    expect(buildCheckoutHoldingUrl("order/with space")).toBe(
      "/account/tickets/holding?purchase=success&orderId=order%2Fwith%20space"
    );
  });
});
