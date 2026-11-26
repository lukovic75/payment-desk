import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
	root,
	plugins: [react()],
	server: {
		port: 5173,
		proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: true } },
	},
	build: { outDir: "dist", emptyOutDir: true },
})
