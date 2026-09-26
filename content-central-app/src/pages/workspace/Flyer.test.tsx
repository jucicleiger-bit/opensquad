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

function projectState(
  offers: ProjectOffer[] = [],
  offerGroups: OfferGroup[] = [],
  contentSettings?: Record<string, unknown>,
) {
  return {
    projects: [
      {
        projectId: "boss-pizzaria",
        name: "Boss Pizzaria",
        contentStrategy: { offers, offerGroups },
        ...(contentSettings ? { contentSettings } : {}),
      },
    ],
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

  it("caps a group selection at 12 without dropping already-selected individual offers", async () => {
    const groups: OfferGroup[] = [{ id: "group-big", name: "Grupo grande" }];
    const individualOffers: ProjectOffer[] = Array.from({ length: 10 }, (_, index) => ({
      id: `offer-ind-${index + 1}`,
      name: `Individual ${index + 1}`,
      type: "offer",
      active: true,
    }));
    const groupOffers: ProjectOffer[] = Array.from({ length: 5 }, (_, index) => ({
      id: `offer-grp-${index + 1}`,
      name: `Grupo item ${index + 1}`,
      type: "offer",
      active: true,
      groupId: "group-big",
    }));
    stubFetchSequence([{ body: projectState([...individualOffers, ...groupOffers], groups) }]);
    renderFlyer();

    await screen.findByText("Grupo grande");
    for (const offer of individualOffers) {
      await userEvent.click(screen.getByLabelText(`Produto ${offer.name}`));
    }
    expect(screen.getByText("10 de 12 produtos selecionados")).toBeInTheDocument();

    // The group has 5 members but only 2 slots remain — selecting it must
    // stop at the cap, not drop the 10 individually-selected offers to make
    // room, and not silently ignore the group click either.
    await userEvent.click(screen.getByLabelText("Grupo grande"));
    expect(screen.getByText("12 de 12 produtos selecionados")).toBeInTheDocument();

    for (const offer of individualOffers) {
      expect(screen.getByLabelText(`Produto ${offer.name}`)).toBeChecked();
    }
    expect(screen.getByLabelText("Produto Grupo item 1")).toBeChecked();
    expect(screen.getByLabelText("Produto Grupo item 2")).toBeChecked();
    expect(screen.getByLabelText("Produto Grupo item 3")).not.toBeChecked();
    expect(screen.getByLabelText("Produto Grupo item 4")).not.toBeChecked();
    expect(screen.getByLabelText("Produto Grupo item 5")).not.toBeChecked();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(12);
  });

  it("requires at least one product and one channel before generating", async () => {
    stubFetchSequence([{ body: projectState([], []) }]);
    renderFlyer();

    await screen.findByText("0 de 12 produtos selecionados");
    expect(screen.getByRole("button", { name: "Gerar flyer" })).toBeDisabled();
  });

  it("uses the project's configured default post time when set", async () => {
    stubFetchSequence([{ body: projectState([], [], { defaultPostTime: "14:30" }) }]);
    renderFlyer();

    await screen.findByText("0 de 12 produtos selecionados");
    expect(screen.getByLabelText("Horário")).toHaveValue("14:30");
  });

  it("falls back to 09:00 when the project has no configured default post time", async () => {
    stubFetchSequence([{ body: projectState([], []) }]);
    renderFlyer();

    await screen.findByText("0 de 12 produtos selecionados");
    expect(screen.getByLabelText("Horário")).toHaveValue("09:00");
  });
});
