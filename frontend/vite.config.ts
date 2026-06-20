import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "OpenJarvis",
				short_name: "Jarvis",
				description: "On-device AI assistant",
				theme_color: "#161618",
				background_color: "#161618",
				display: "standalone",
				icons: [
					{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
					{ src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
				navigateFallbackDenylist: [
					/^\/v1\//,
					/^\/health/,
					/^\/dashboard/,
					/^\/api\//,
				],
			},
		}),
	],
	build: {
		outDir: "../src/openjarvis/server/static",
		emptyOutDir: true,
		minify: "oxc",
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
					if (id.includes("node_modules/react-markdown") || id.includes("node_modules/rehype-highlight") || id.includes("node_modules/remark-gfm")) return "markdown";
					if (id.includes("node_modules/recharts")) return "charts";
					if (id.includes("node_modules/react-router")) return "router";
				},
			},
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/v1": process.env.VITE_API_URL || "http://localhost:8000",
			"/health": process.env.VITE_API_URL || "http://localhost:8000",
			"/api": process.env.VITE_API_URL || "http://localhost:8000",
		},
	},
});
