import { serve } from "@hono/node-server";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: buildApp().fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
