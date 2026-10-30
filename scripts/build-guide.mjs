import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const articles = readdirSync("src/guide")
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const raw = readFileSync("src/guide/" + file, "utf8");
    if (/<\/?[a-z]|!\[|https?:\/\//i.test(raw))
      throw Error("Guide must contain plain, local Markdown: " + file);
    const [header, ...parts] = raw.split("\n---\n");
    const metadata = JSON.parse(header);
    const body = parts.join("\n---\n");
    const blocks = [];
    let code = false;
    let buffer = [];
    const flush = () => {
      if (buffer.length) {
        blocks.push({
          type: code ? "code" : "paragraph",
          text: buffer.join("\n"),
          anchor: "",
        });
        buffer = [];
      }
    };
    for (const line of body.split("\n")) {
      if (line.startsWith("```")) {
        flush();
        code = !code;
      } else if (!code && line.startsWith("## ")) {
        flush();
        const text = line.slice(3);
        blocks.push({
          type: "heading",
          text,
          anchor: text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-$/, ""),
        });
      } else if (!code && !line.trim()) flush();
      else buffer.push(line);
    }
    flush();
    if (code) throw Error("Unclosed code fence");
    const anchors = blocks.filter((b) => b.anchor).map((b) => b.anchor);
    if (new Set(anchors).size !== anchors.length)
      throw Error("Duplicate anchor");
    return { ...metadata, blocks };
  })
  .sort((a, b) => a.order - b.order);
if (new Set(articles.map((a) => a.id)).size !== articles.length)
  throw Error("Duplicate guide ID");
writeFileSync("src/guide/generated.json", JSON.stringify(articles));
writeFileSync(
  "src/guide/manifest.json",
  JSON.stringify(
    articles.map(({ id, title, order }) => ({ id, title, order })),
    null,
    2,
  ),
);
console.log(
  `Validated and compiled ${articles.length} offline Guide articles.`,
);
