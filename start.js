import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the optional prospecting env file before importing server.js (and its scheduler).
// Variables configured in the hosting panel take precedence over this file.
const envPath = fileURLToPath(new URL("./.env.prospecting", import.meta.url));
try {
  const source = await readFile(envPath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key] = match;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
  console.log("[startup] Arquivo .env.prospecting carregado (sem sobrescrever variáveis do painel).");
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error("[startup] Falha ao ler .env.prospecting:", error.message);
    process.exit(1);
  }
  console.log("[startup] .env.prospecting não encontrado; usando variáveis configuradas no painel da hospedagem.");
}

await import("./server.js");
