const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90000,
  workers: 1,
  use: {
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:8090',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx http-server .. -p 8090 -a 127.0.0.1 -c-1 --silent',
    url: 'http://127.0.0.1:8090/app/index.html',
    reuseExistingServer: true,
  },
});
