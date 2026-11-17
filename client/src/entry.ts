import { Effect, Schema } from "effect";
import { Runtime } from "foldkit";
import type { Update } from "foldkit";
import type { Document as FoldkitDocument, HtmlBuilder } from "foldkit/html";

const Model = Schema.Struct({ title: Schema.String, now: Schema.Number });
export type Model = typeof Model.Type;

export type Message = { _tag: "Navigated"; url: string };

const init = (): Update.Return<Model, Message, never> => ({
  model: { title: "optkit dashboard", now: Date.now() },
  commands: [],
});

const update = (model: Model): Update.Return<Model, Message, never> => ({
  model,
  commands: [],
});

const view = (model: Model, h: HtmlBuilder<Message>): FoldkitDocument => ({
  title: model.title,
  body: h.div([h.Class("root")], [`optkit dashboard loaded at ${model.now}`]),
});

const containerElement = (globalThis as unknown as { document: { getElementById(id: string): never } }).document.getElementById("root") as never;
if (!containerElement) throw new Error("#root missing");
const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: containerElement,
  devTools: false,
});

Runtime.run(application);
