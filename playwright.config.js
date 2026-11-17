const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e',
  testIgnore: ['**/tests/**'],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'node src/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  }
});
