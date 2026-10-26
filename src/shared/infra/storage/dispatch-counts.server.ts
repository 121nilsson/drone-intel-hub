import { cloudConfigured } from "@/shared/infra/cloud/cloud-store.server";

/**
 * Archive-truth counters for the intel feed header. The dispatch repository caps its load at
 * the newest 3000 documents so the browser cache stays bounded, which is a view bound, not a
 * count - the page can only tally what it has loaded. This counts the whole archive the way
 * each configured backend knows how: PostgreSQL via the hot status column (indexed, see
 * /migrations 003_dispatches.sql), Lovable Cloud via a service-role head count on the mirrored
 * status column.
 *
 * Null means no server storage backend is configured: the caller falls back to its loaded
 * window, which is exact whenever the archive fits the cap. DATABASE_URL wins over Cloud, the
 * same precedence store.functions.ts applies to every storage read.
 */
export interface DispatchCounts {
  total: number;
  pending: number;
}

export async function dispatchCounts(): Promise<DispatchCounts | null> {
  if (process.env["DATABASE_URL"]) {
    const { db } = await import("@/shared/infra/postgres/db.server");
    const conn = db();
    const [row] = await conn<DispatchCounts[]>`
      select count(*)::int as total,
             count(*) filter (where status = 'pending')::int as pending
        from dispatches`;
    return row ?? null;
  }
  if (cloudConfigured()) {
    // The tables are generic document tables; the typed client adds nothing here.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // A head count answers without rows: the count itself lives on the response.
    interface HeadCount {
      count: number | null;
      error: { message: string } | null;
    }
    interface HeadQuery extends PromiseLike<HeadCount> {
      eq(col: string, val: string): HeadQuery;
    }
    const admin = supabaseAdmin as unknown as {
      from(t: string): {
        select(cols: string, opts: { count: "exact"; head: true }): HeadQuery;
      };
    };
    const count = async (whereStatus: string | null) => {
      let q = admin.from("dispatches").select("id", { count: "exact", head: true });
      if (whereStatus) q = q.eq("status", whereStatus);
      const { count: n, error } = await q;
      if (error) throw new Error(error.message);
      return n ?? 0;
    };
    return { total: await count(null), pending: await count("pending") };
  }
  return null;
}
