import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
    plugins: [svelte(), viteSingleFile()],
    resolve: {
        alias: {
            $components: path.resolve(__dirname, './src/components'),
            $pages: path.resolve(__dirname, './src/pages'),
            $lib: path.resolve(__dirname, './src/lib')
        }
    },
    root: './',
    server: {
        proxy: {
            '/ldraw-library/complete.zip': {
                target: 'https://library.ldraw.org',
                changeOrigin: true,
                rewrite: () => '/library/updates/complete.zip'
            }
        }
    },
    build: {
        outDir: 'dist',
        assetsInlineLimit: 1024 * 1024
    },
    publicDir: 'static'
});
