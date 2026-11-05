import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Ctx, type Services } from "@/shared/infra/services-context";
import { useAttached, useDrones } from "@/shared/infra/use-services";

/**
 * The dossier threw a hydration error whenever its lazily loaded page hydrated after the store
 * had attached: the server rendered the seed catalogue, the client's first render read the live
 * one, and React discarded the server markup. A page must hydrate from what the server rendered
 * and only then show the live data.
 */
function fakeServices(names: string[], attached: boolean, seed: string[]) {
  const repo = {
    items: names,
    fns: new Set<() => void>(),
    subscribe(f: () => void) {
      repo.fns.add(f);
      return () => repo.fns.delete(f);
    },
    list: () => repo.items,
  };
  const services = { drones: repo, seed: { drones: seed }, attached } as unknown as Services;
  return { repo, services };
}

function Page() {
  const drones = useDrones() as unknown as string[];
  const attached = useAttached();
  return <p>{attached ? `live: ${drones.join(",")}` : `loading: ${drones.join(",")}`}</p>;
}

describe("hydrating a page after the store has attached", () => {
  it("starts from the server's markup and then shows the live data", async () => {
    const server = fakeServices(["seed"], false, ["seed"]);
    const html = renderToString(
      <Ctx.Provider value={server.services}>
        <Page />
      </Ctx.Provider>,
    );
    expect(html).toContain("loading: seed");

    // The client attached before this page's chunk finished loading.
    const client = fakeServices(["stored-1", "stored-2"], true, ["seed"]);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    await act(async () => {
      hydrateRoot(
        container,
        <Ctx.Provider value={client.services}>
          <Page />
        </Ctx.Provider>,
        { onRecoverableError },
      );
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("live: stored-1,stored-2");
    container.remove();
  });

  it("keeps reading the live repository once hydrated", async () => {
    const { repo, services } = fakeServices(["a"], true, ["a"]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <Ctx.Provider value={services}>
          <Page />
        </Ctx.Provider>,
      );
    });
    await act(async () => {
      repo.items = ["a", "b"];
      repo.fns.forEach((f) => f());
    });
    expect(container.textContent).toBe("live: a,b");
    container.remove();
  });
});
