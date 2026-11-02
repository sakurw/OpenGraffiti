import base from './playwright.pv.config';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testMatch:['expansion.spec.ts','mural-wrap.spec.ts'],timeout:180000});
