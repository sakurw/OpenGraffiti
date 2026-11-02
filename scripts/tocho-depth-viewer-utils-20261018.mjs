export function configureStableDepth(html,{qa=false}={}){
 const mode=qa?"new URLSearchParams(location.search).get('depth') || 'logarithmic'":"'logarithmic'";
 html=html.replace('const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });',`const depthMode = ${mode};
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: depthMode === 'logarithmic' });`);
 html=html.replace('const canvas = renderer.domElement;',`const canvas = renderer.domElement;
      canvas.dataset.depthMode = depthMode;
      canvas.dataset.depthBits = String(renderer.getContext().getParameter(renderer.getContext().DEPTH_BITS));
      canvas.dataset.logarithmicDepth = String(renderer.capabilities.logarithmicDepthBuffer);`);
 html=html.replace('camera.near = Math.max(.1, span / 20000);\n        camera.far = Math.max(20000, distance + span * 20);',`camera.near = depthMode === 'legacy' ? Math.max(.1, span / 20000) : Math.max(.05, Math.min(3, distance / 1000));
        camera.far = depthMode === 'legacy' ? Math.max(20000, distance + span * 20) : Math.max(1000, distance + span * 2);`);
 html=html.replace('controls.update(); renderer.render(scene, camera); state.renderCount++;',`controls.update();
          if(depthMode !== 'legacy') {
            const bounds = districtBox || tochoBox;
            const center = bounds ? bounds.getCenter(new THREE.Vector3()) : controls.target;
            const radius = bounds ? bounds.getSize(new THREE.Vector3()).length() / 2 : 600;
            const near = Math.max(.05, Math.min(3, camera.position.distanceTo(controls.target) / 1000));
            const far = Math.max(1000, camera.position.distanceTo(center) + radius * 1.5 + 50);
            if(Math.abs(camera.near-near)>.00001 || Math.abs(camera.far-far)>.001) {
              camera.near=near; camera.far=far; camera.updateProjectionMatrix();
            }
          }
          canvas.dataset.depthNear = camera.near.toFixed(6);
          canvas.dataset.depthFar = camera.far.toFixed(6);
          canvas.dataset.eyeDistance = camera.position.distanceTo(controls.target).toFixed(3);
          renderer.render(scene, camera); state.renderCount++;`);
 html=html.replace('configureDisplayBase(object);',`configureDisplayBase(object);
            for(const mat of (Array.isArray(object.material)?object.material:[object.material])) {
              if(mat?.map) mat.map.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
            }`);
 if(!html.includes('logarithmicDepthBuffer: depthMode'))throw Error('Renderer patch did not match');
 return html;
}
