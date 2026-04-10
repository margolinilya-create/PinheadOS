import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--no-proxy-server'],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile',  use: { viewport: { width: 375,  height: 812 } } },
  ],
});
