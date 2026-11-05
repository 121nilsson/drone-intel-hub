import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/entities/normalization/language";

describe("detecting the language of a post", () => {
  it("reads the Ukrinform summary that was translated into Ukrainian as English", () => {
    // The real text from the Zircon dossier: it was sent to a translator and came back Ukrainian.
    const text =
      "Ukrinform - Ukrainian National News Agency\n\nUkraine's Defence Forces destroyed more than 8,000 Russian drones and missiles while repelling large-scale enemy attacks in October 2026. They also neutralised several cruise missiles.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("reads Russian and Ukrainian apart by the letters only Ukrainian has", () => {
    expect(
      detectLanguage("ВСУ сообщили, что ударные беспилотники атаковали Одессу ночью, потерь нет"),
    ).toBe("ru");
    expect(
      detectLanguage(
        "Збройні Сили України знищили понад 8000 російських дронів і ракет, відбиваючи атаки",
      ),
    ).toBe("uk");
  });

  it("does not call another Latin-script language English", () => {
    expect(
      detectLanguage(
        "Siły Zbrojne Ukrainy zniszczyły ponad 8000 rosyjskich dronów i rakiet w październiku, odpierając ataki",
      ),
    ).toBe("unknown");
    expect(
      detectLanguage(
        "Die ukrainischen Streitkräfte haben im Oktober mehr als 8000 russische Drohnen und Raketen zerstört",
      ),
    ).toBe("unknown");
  });

  it("is unknown for text too short to judge, and for a bare name", () => {
    expect(detectLanguage("")).toBe("unknown");
    expect(detectLanguage("Zircon")).toBe("unknown");
    expect(detectLanguage("Geran-2 RU")).toBe("unknown");
  });

  it("keeps English that quotes a Russian name", () => {
    expect(
      detectLanguage(
        "The system, known in Russian as Герань, was used against the port and the power grid in the south",
      ),
    ).toBe("en");
  });
});
