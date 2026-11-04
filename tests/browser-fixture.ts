import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

/** Exercise real renderer modules against a test-owned bridge on a private HTTP origin. */
export async function withBrowserFixture(
  name: string,
  source: string,
  run: (page: Page) => Promise<void>,
) {
  const virtualId = `\0${name}-fixture`;
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: `node_modules/.vite-${name}-test`,
    optimizeDeps: {
      include: [
        "react",
        "react-dom/client",
        "react/jsx-runtime",
        "lucide-react",
        "qrcode",
      ],
    },
    plugins: [
      react(),
      {
        name: `${name}-fixture`,
        resolveId(id) {
          if (id === virtualId) return id;
        },
        load(id) {
          if (id === virtualId) return source;
        },
        configureServer(vite) {
          vite.middlewares.use("/fixture", (request, response) => {
            response.setHeader("Content-Type", "text/html");
            void vite
              .transformIndexHtml(
                request.url || "/fixture",
                `<html><body><div id="root"></div><script type="module" src="/@id/__x00__${name}-fixture"></script></body></html>`,
              )
              .then(
                (html) => response.end(html),
                (error) => {
                  response.statusCode = 500;
                  response.end(String(error));
                },
              );
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 0,
      watch: {
        ignored: ["**/dist/**", "**/dist-electron/**", "**/release/**"],
      },
    },
  });
  try {
    await server.listen();
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1200, height: 900 },
      });
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture server did not open a TCP listener.");
      await page.goto(`http://127.0.0.1:${address.port}/fixture`);
      await page.locator("#root > *").first().waitFor({ state: "attached" });
      await run(page);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}
