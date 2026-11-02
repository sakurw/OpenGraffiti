import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/pages',workers:1,timeout:180000,expect:{timeout:30000},use:{baseURL:process.env.PAGES_TEST_URL||'http://127.0.0.1:3115/OpenGraffiti/',channel:'chrome',headless:true,viewport:{width:1440,height:900},trace:'retain-on-failure'},outputDir:'test-results/pages',reporter:'list'});
