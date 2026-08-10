import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstagramMockup } from "./InstagramMockup";

describe("InstagramMockup", () => {
  it("renders real counts and never invents a number for one that's missing", () => {
    render(
      <InstagramMockup
        businessName="Empório Rei da Mussarela"
        handle="emporioreidamussarela"
        bio="Loja de frios e Fatiados."
        posts={20}
        followers={4388}
        following={null}
        highlights={[]}
        gridItems={[]}
      />,
    );

    // The business name legitimately appears twice (handle label + bio
    // block), mirroring the real Instagram profile layout being replicated.
    expect(screen.getAllByText("Empório Rei da Mussarela").length).toBeGreaterThan(0);
    expect(screen.getByText("Loja de frios e Fatiados.")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    // 4388 crosses the "K" formatting threshold — must show the rounded
    // real value, not the raw digits and not an invented one.
    expect(screen.getByText("4.4K")).toBeInTheDocument();
    // following is genuinely unknown — must read as "—", never "0" (which
    // would misreport a real fact that was never actually confirmed).
    const stats = screen.getAllByText("—");
    expect(stats.length).toBe(1);
  });

  it("renders the real highlight labels given, and nothing when there are none — no invented '+Novo' bubble", () => {
    const { rerender } = render(
      <InstagramMockup
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio=""
        posts={null}
        followers={null}
        following={null}
        highlights={[{ label: "Produtos" }, { label: "Pedidos" }, { label: "Sobre" }]}
        gridItems={[]}
      />,
    );

    expect(screen.getByText("Produtos")).toBeInTheDocument();
    expect(screen.getByText("Pedidos")).toBeInTheDocument();
    expect(screen.getByText("Sobre")).toBeInTheDocument();
    expect(screen.queryByText("Novo")).not.toBeInTheDocument();

    rerender(
      <InstagramMockup
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio=""
        posts={null}
        followers={null}
        following={null}
        highlights={[]}
        gridItems={[]}
      />,
    );
    expect(screen.queryByText("Produtos")).not.toBeInTheDocument();
  });

  it("renders exactly the grid items it was given, and a labelled empty state when there are none", () => {
    const { container, rerender } = render(
      <InstagramMockup
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio=""
        posts={null}
        followers={null}
        following={null}
        highlights={[]}
        gridItems={[
          <span key="1" data-testid="grid-tile" />,
          <span key="2" data-testid="grid-tile" />,
          <span key="3" data-testid="grid-tile" />,
        ]}
      />,
    );
    expect(screen.getAllByTestId("grid-tile")).toHaveLength(3);

    rerender(
      <InstagramMockup
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio=""
        posts={null}
        followers={null}
        following={null}
        highlights={[]}
        gridItems={[]}
      />,
    );
    expect(screen.getByText("Sem fotos ainda")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="grid-tile"]')).toHaveLength(0);
  });

  it("is a clean card with no phone/OS chrome (no fake status bar, no phone bezel)", () => {
    const { container } = render(
      <InstagramMockup
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio="Bio real"
        posts={9}
        followers={100}
        following={50}
        highlights={[{ label: "Produtos" }]}
        gridItems={[<span key="1" data-testid="grid-tile" />]}
      />,
    );
    expect(container.querySelector('[class*="phoneFrame"]')).toBeFalsy();
    expect(container.querySelector('[class*="statusBar"]')).toBeFalsy();
    expect(screen.queryByText("9:41")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar perfil")).not.toBeInTheDocument();
  });

  it("forwards its ref straight to the root card element, so the caller can export it (e.g. to PNG)", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <InstagramMockup
        ref={ref}
        businessName="Casa de Embalagem"
        handle="casadeembalagem"
        bio=""
        posts={null}
        followers={null}
        following={null}
        highlights={[]}
        gridItems={[]}
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.className).toMatch(/card/);
  });
});
