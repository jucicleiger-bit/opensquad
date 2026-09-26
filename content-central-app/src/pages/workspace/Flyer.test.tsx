import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import type { OfferGroup, ProjectOffer } from "@/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(responses: Array<{ body: unknown; ok?: boolean }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: response.ok !== false,
        text: async () => JSON.stringify(response.body),
      });
    }),
  );
}

function projectState(offers: ProjectOffer[] = [], offerGroups: OfferGroup[] = []) {
  return {
    projects: [{ projectId: "boss-pizzaria", name: "Boss Pizzaria", contentStrategy: { offers, offerGroups } }],
    globalRules: {},
  };
}

function renderFlyer() {
  render(
    <MemoryRouter initialEntries={["/projects/boss-pizzaria/flyer"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Flyer", () => {
  it("selects a whole offer group and posts the flyer request", async () => {
    const groups: OfferGroup[] = [
      { id: "group-week", name: "Encarte da semana" },
      { id: "group-other", name: "Outras ofertas" },
    ];
    const offers: ProjectOffer[] = [
      { id: "offer-1", name: "Produto 1", type: "offer", active: true, groupId: "group-week", price: "R$ 10" },
      { id: "offer-2", name: "Produto 2", type: "offer", active: true, groupId: "group-week", price: "R$ 20" },
      { id: "offer-3", name: "Produto 3", type: "offer", active: true, groupId: "group-other", price: "R$ 30" },
      { id: "offer-4", name: "Produto 4", type: "offer", active: true, groupId: "group-other", price: "R$ 40" },
    ];
    stubFetchSequence([{ body: projectState(offers, groups) }, { body: { batch: { items: [] } } }]);
    renderFlyer();

    await screen.findByText("Encarte da semana");

    await userEvent.click(screen.getByLabelText("Encarte da semana"));
    expect(screen.getByText("2 de 12 produtos selecionados")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Instagram Feed"));
    await userEvent.type(screen.getByLabelText("Data de publicação"), "2026-09-30");
    await userEvent.click(screen.getByRole("button", { name: "Gerar flyer" }));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const request = calls.find(([url]) => String(url).endsWith("/generate-flyer"));
    expect(request).toBeDefined();
    const body = JSON.parse(String(request![1]?.body));
    expect(body.offerIds).toEqual(["offer-1", "offer-2"]);
    expect(body.channels).toEqual(["instagram_feed"]);
    expect(body.date).toBe("2026-09-30");
  });

  it("refuses more than 12 products", async () => {
    const offers: ProjectOffer[] = Array.from({ length: 13 }, (_, index) => ({
      id: `offer-${index + 1}`,
      name: `Produto ${index + 1}`,
      type: "offer",
      active: true,
    }));
    stubFetchSequence([{ body: projectState(offers, []) }]);
    renderFlyer();

    for (const offer of await screen.findAllByRole("checkbox", { name: /^Produto / })) {
      await userEvent.click(offer);
    }
    expect(screen.getByText("12 de 12 produtos selecionados")).toBeInTheDocument();
    // Enabling the button also needs a channel and a date — pick both so
    // this test isolates the 12-product cap, not the rest of the validation.
    await userEvent.click(screen.getByLabelText("Instagram Feed"));
    await userEvent.type(screen.getByLabelText("Data de publicação"), "2026-09-30");
    expect(screen.getByRole("button", { name: "Gerar flyer" })).toBeEnabled();
    // the 13th click was refused, not silently accepted
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(13);
  });

  it("requires at least one product and one channel before generating", async () => {
    stubFetchSequence([{ body: projectState([], []) }]);
    renderFlyer();

    await screen.findByText("0 de 12 produtos selecionados");
    expect(screen.getByRole("button", { name: "Gerar flyer" })).toBeDisabled();
  });
});
