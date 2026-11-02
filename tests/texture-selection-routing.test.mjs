import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TEXTURE_SELECTION,resolveTextureSelection,textureReportUrl} from '../shared/texture-selection.mjs';
test('texture comparison retains an explicit original route and safe default',()=>{
 assert.equal(resolveTextureSelection(null),DEFAULT_TEXTURE_SELECTION);
 assert.equal(resolveTextureSelection('original'),'');
 assert.equal(resolveTextureSelection('../../elsewhere'),DEFAULT_TEXTURE_SELECTION);
 assert.equal(resolveTextureSelection('wall-coverage-all'),'wall-coverage-all');
 assert.equal(resolveTextureSelection('wall-coverage-refine2'),'wall-coverage-refine2');
 assert.equal(resolveTextureSelection('wall-coverage-refine2-all'),'wall-coverage-refine2-all');
});
test('display and provenance URLs share the same validated selection',()=>{
 assert.equal(textureReportUrl('tocho',''),'/assets/texture-poc/experimental/tocho.json');
 assert.equal(textureReportUrl('tokyo-tower','wall-coverage-all'),'/assets/texture-poc/experimental/selection/wall-coverage-all/tokyo-tower.json');
 assert.throws(()=>textureReportUrl('../tocho',''),/Invalid/);
 assert.throws(()=>textureReportUrl('tocho','../../elsewhere'),/Invalid/);
});
