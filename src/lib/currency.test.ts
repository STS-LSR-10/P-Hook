import { afterEach, describe, expect, it } from "vitest";
import { HOME_CURRENCIES, currencyLabel, isHomeCurrency } from "./currency";
import { currencySymbol, currentCurrency, money, setCurrencySource } from "./money";

afterEach(() => setCurrencySource(null));

describe("the person's currency", () => {
  it("is the baht unless set", () => {
    expect(currentCurrency()).toBe("THB");
    expect(money(125_000)).toBe("฿1,250");
    expect(money(5050)).toBe("฿50.50");
    expect(currencySymbol()).toBe("฿");
  });

  it("shows amounts with its own sign", () => {
    setCurrencySource(() => "USD");
    expect(money(1250)).toBe("$12.50");
    setCurrencySource(() => "EUR");
    expect(money(100_000)).toBe("€1,000");
    setCurrencySource(() => "CHF");
    expect(money(100_000)).toBe("CHF 1,000");
  });

  it("a currency without cents shows whole units", () => {
    setCurrencySource(() => "JPY");
    expect(money(150_050)).toBe("¥1,501");
    setCurrencySource(() => "KRW");
    expect(money(1_000_000)).toBe("₩10,000");
  });

  it("a negative amount keeps its sign in front", () => {
    setCurrencySource(() => "USD");
    expect(money(-1250)).toBe("-$12.50");
  });

  it("one we do not offer is the baht", () => {
    setCurrencySource(() => "XYZ");
    expect(currentCurrency()).toBe("THB");
  });
});

describe("the currencies to pick from", () => {
  it("start with the baht, each once, each one the rate source knows", () => {
    expect(HOME_CURRENCIES[0]).toBe("THB");
    expect(new Set(HOME_CURRENCIES).size).toBe(HOME_CURRENCIES.length);
    expect(isHomeCurrency("USD")).toBe(true);
    expect(isHomeCurrency("VND")).toBe(false);
    expect(currencyLabel("THB")).toBe("Thai Baht (฿)");
    expect(currencyLabel("USD")).toBe("US Dollar ($)");
  });

  it("are the ones the parser and the rate source know", async () => {
    const { SUPPORTED_CURRENCIES } = await import("./parse/currency");
    expect(HOME_CURRENCIES.slice(1)).toEqual([...SUPPORTED_CURRENCIES]);
  });
});
