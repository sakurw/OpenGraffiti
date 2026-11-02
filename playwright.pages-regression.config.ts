import {defineConfig} from '@playwright/test';
import base from './playwright.pv.config';
export default defineConfig({...base,testMatch:['revision.spec.ts','workflow.spec.ts','expansion.spec.ts','mural-wrap.spec.ts'],timeout:180000,use:{...base.use,baseURL:'http://127.0.0.1:3114'},webServer:{...base.webServer,command:`"${process.execPath}" server/index.mjs`,url:'http://127.0.0.1:3114/api/v1/clock',env:{PORT:'3114',MOCK_TEST_MODE:'1',MOCK_FIXTURE:'0',MOCK_DATA_DIR:'data/pages-regression',OPEN_GRAFFITI_DEMO_TOKEN:'graffiti-demo'}},outputDir:'test-results/pages-regression'});
