import { Chat } from "@/ui/Chat";
import { env } from "@/env";
import { stitchCatalog } from "@/adapters/stitch/catalog";
import { rangeLabel } from "@/core/periods";

export const dynamic = "force-dynamic";

export default function Page() {
  const e = env();
  return (
    <Chat
      backends={{ decide: e.DECIDE_BACKEND === "record" ? `record via ${e.RECORD_VIA}` : e.DECIDE_BACKEND, system2: e.SYSTEM2_BACKEND }}
      dataNote={`${stitchCatalog.sourceName} · data through ${rangeLabel(stitchCatalog.asOf, stitchCatalog.asOf)}`}
    />
  );
}
