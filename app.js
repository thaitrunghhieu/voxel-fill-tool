import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

const $=s=>document.querySelector(s), canvas=$('#canvas'), viewport=$('#viewport');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x101010);
const camera=new THREE.PerspectiveCamera(45,1,.01,2000); camera.position.set(8,6,10);
const controls=new OrbitControls(camera,canvas); controls.enableDamping=true;
// Maya-style navigation: Alt+LMB rotate, Alt+MMB pan, Alt+RMB dolly.
controls.mouseButtons.LEFT=null; controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN; controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
scene.add(new THREE.HemisphereLight(0xffffff,0x333333,2)); const dl=new THREE.DirectionalLight(0xffffff,3);dl.position.set(6,10,8);scene.add(dl);
const grid=new THREE.GridHelper(30,30,0x555555,0x292929);scene.add(grid);
let modelRoot=null, voxelMesh=null, meshes=[], sourceName='model', voxelPositions=[], voxelColors=[], sliceEnabled=false, xrayEnabled=false;
let exportDirectoryHandle=null;
const PALETTE={
 Blue:{color:'#45C9FF',shadow:'#2B3E89'}, Brown:{color:'#875530',shadow:'#89542B'},
 Green:{color:'#58D65A',shadow:'#2D4316'}, Orange:{color:'#FF952A',shadow:'#89632B'},
 PowerPink:{color:'#FF6490',shadow:'#892B52'}, Purple:{color:'#C18DFF',shadow:'#632B89'},
 Red:{color:'#FF5940',shadow:'#6C0D08'}, Yellow:{color:'#FFC845',shadow:'#C58400'}
};
let activeMat='Yellow', customColor=PALETTE.Yellow.color, customShadow=PALETTE.Yellow.shadow;
const raycaster=new THREE.Raycaster(); const dir=new THREE.Vector3(1,.000371,.000733).normalize();
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()} addEventListener('resize',resize);resize();
(function loop(){controls.update();renderer.render(scene,camera);requestAnimationFrame(loop)})();
function disposeObj(o){if(!o)return;o.traverse?.(x=>{x.geometry?.dispose?.();if(Array.isArray(x.material))x.material.forEach(m=>m.dispose());else x.material?.dispose?.()});scene.remove(o)}
function fit(){if(!modelRoot)return;const b=new THREE.Box3().setFromObject(modelRoot),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());const d=Math.max(s.x,s.y,s.z);controls.target.copy(c);camera.position.copy(c).add(new THREE.Vector3(1,0.75,1).normalize().multiplyScalar(d*2.2));camera.near=Math.max(d/1000,.001);camera.far=d*100;camera.updateProjectionMatrix();controls.update()}
async function loadFile(file){sourceName=file.name.replace(/\.[^.]+$/,''); $('#status').textContent='Loading…';disposeObj(modelRoot);disposeObj(voxelMesh);voxelMesh=null;meshes=[];const ext=file.name.split('.').pop().toLowerCase(),url=URL.createObjectURL(file);try{if(ext==='glb'||ext==='gltf'){const g=await new GLTFLoader().loadAsync(url);modelRoot=g.scene}else if(ext==='obj'){modelRoot=await new OBJLoader().loadAsync(url)}else if(ext==='fbx'){modelRoot=await new FBXLoader().loadAsync(url)}else if(ext==='stl'){const geo=await new STLLoader().loadAsync(url);modelRoot=new THREE.Group();modelRoot.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x999999,side:THREE.DoubleSide})))}else throw Error('Unsupported format');
modelRoot.traverse(o=>{if(o.isMesh){o.material=o.material?.clone?.()||new THREE.MeshStandardMaterial();o.material.side=THREE.DoubleSide;meshes.push(o)}});modelRoot.updateMatrixWorld(true);scene.add(modelRoot);fit();$('#voxelize').disabled=false;$('#export').disabled=true;$('#stats').textContent=`${file.name} · ${meshes.length} mesh(es)`;$('#status').textContent='Ready.';applyOriginal()}catch(e){console.error(e);$('#status').textContent='Could not load this model.'}finally{URL.revokeObjectURL(url)}}
function applyOriginal(){if(!modelRoot)return;modelRoot.visible=$('#original').checked;meshes.forEach(m=>m.material.wireframe=$('#wire').checked)}
function pointInside(p){let hits=[];for(const m of meshes){raycaster.set(p,dir);hits.push(...raycaster.intersectObject(m,false))}hits.sort((a,b)=>a.distance-b.distance);let unique=0,last=-Infinity;for(const h of hits){if(h.distance-last>1e-5){unique++;last=h.distance}}return unique%2===1}
function nearSurface(p,half){const dirs=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)];for(const d of dirs){raycaster.set(p,d);raycaster.far=half*1.05;for(const m of meshes)if(raycaster.intersectObject(m,false).length)return true}return false}
function makeBevelNormalMap(){
  const n=64,data=new Uint8Array(n*n*4),edge=.18;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const u=(x+.5)/n,v=(y+.5)/n;
    const dx=Math.min(u,1-u),dy=Math.min(v,1-v);
    let nx=0,ny=0,nz=1;
    if(dx<edge)nx=(u<.5?1:-1)*(1-dx/edge)*.62;
    if(dy<edge)ny=(v<.5?1:-1)*(1-dy/edge)*.62;
    nz=Math.sqrt(Math.max(.05,1-nx*nx-ny*ny));
    const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
    const i=(y*n+x)*4;data[i]=(nx*.5+.5)*255;data[i+1]=(ny*.5+.5)*255;data[i+2]=(nz*.5+.5)*255;data[i+3]=255;
  }
  const tex=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);
  tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.colorSpace=THREE.NoColorSpace;tex.needsUpdate=true;
  return tex;
}
const bevelNormalMap=makeBevelNormalMap();
function makeVoxelGeometry(size){
  const enabled=$('#roundingEnabled')?.checked!==false;
  const amount=enabled?Math.max(0,Math.min(.45,+($('#rounding')?.value||0))):0;
  if(amount<=.001)return new THREE.BoxGeometry(size,size,size);
  const radius=Math.min(.49,amount);
  // Minimum rounded topology: a single bevel segment. This matches the user's low-tris reference.
  let geo=new RoundedBoxGeometry(1,1,1,1,radius);
  geo.scale(size,size,size);
  // Low-poly bevel + weighted-style normals: keep the large cube faces visually flat
  // while smoothing the single bevel band. No extra geometry or texture memory.
  geo=toCreasedNormals(geo,Math.PI/3);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
async function voxelize(){if(!modelRoot)return;$('#voxelize').disabled=true;$('#export').disabled=true;$('#status').textContent='Calculating voxels…';await new Promise(r=>setTimeout(r,30));modelRoot.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(modelRoot),step=+$('#voxel').value,scale=+$('#cubeScale').value,mode=$('#mode').value;const size=box.getSize(new THREE.Vector3()), nx=Math.ceil(size.x/step),ny=Math.ceil(size.y/step),nz=Math.ceil(size.z/step),total=nx*ny*nz;if(total>1200000){$('#status').textContent=`Grid too dense (${total.toLocaleString()} cells). Increase voxel size.`;$('#voxelize').disabled=false;return}const positions=[];let n=0;for(let ix=0;ix<nx;ix++){const x=box.min.x+(ix+.5)*step;for(let iy=0;iy<ny;iy++){const y=box.min.y+(iy+.5)*step;for(let iz=0;iz<nz;iz++){const z=box.min.z+(iz+.5)*step,p=new THREE.Vector3(x,y,z);if(mode==='solid'?pointInside(p):nearSurface(p,step*.7))positions.push(p);n++}if(iy%5===0){$('#status').textContent=`Calculating… ${Math.round(n/total*100)}%`;await new Promise(r=>setTimeout(r,0))}}}
disposeObj(voxelMesh);const geo=makeVoxelGeometry(step*scale),mat=new THREE.MeshStandardMaterial({color:customColor,emissive:customShadow,emissiveIntensity:.16,roughness:.75});voxelMesh=new THREE.InstancedMesh(geo,mat,positions.length);voxelPositions=positions.map(p=>p.clone());voxelColors=positions.map(()=>customColor);const dummy=new THREE.Object3D(),baseCol=new THREE.Color(customColor);positions.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();voxelMesh.setMatrixAt(i,dummy.matrix);voxelMesh.setColorAt(i,baseCol)});voxelMesh.instanceMatrix.needsUpdate=true;if(voxelMesh.instanceColor)voxelMesh.instanceColor.needsUpdate=true;scene.add(voxelMesh);if(sliceEnabled)updateSlice();$('#stats').textContent=`${sourceName} · ${positions.length.toLocaleString()} voxels · ${((geo.index?geo.index.count:geo.attributes.position.count)/3*positions.length).toLocaleString()} tris · grid ${nx}×${ny}×${nz}`;$('#status').textContent='Done.';$('#voxelize').disabled=false;$('#export').disabled=positions.length===0}
let pendingExportFileHandle=null;
async function saveExportBlob(blob,name){
  if(pendingExportFileHandle){
    try{
      const handle=pendingExportFileHandle;
      pendingExportFileHandle=null;
      const writable=await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      $('#status').textContent='Saved: '+handle.name;
      return true;
    }catch(e){
      pendingExportFileHandle=null;
      console.warn('Direct save failed, trying folder/download fallback.',e);
    }
  }
  if(exportDirectoryHandle){
    try{
      const permission=await exportDirectoryHandle.requestPermission({mode:'readwrite'});
      if(permission==='granted'){
        const fileHandle=await exportDirectoryHandle.getFileHandle(name,{create:true});
        const writable=await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        $('#status').textContent='Saved to '+exportDirectoryHandle.name+'/'+name;
        return true;
      }
    }catch(e){console.warn('Folder save failed, using browser download.',e)}
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  $('#status').textContent='Downloaded '+name;
  return true;
}
async function downloadBlob(blob,name){return saveExportBlob(blob,name)}
async function exportGLB(){if(!voxelMesh)return;$('#status').textContent='Exporting GLB…';const group=new THREE.Group();group.add(voxelMesh.clone());new GLTFExporter().parse(group,async res=>{const blob=new Blob([res],{type:'model/gltf-binary'});await downloadBlob(blob,`${sourceName}_voxels.glb`)},e=>{$('#status').textContent='Export failed.';console.error(e)},{binary:true,onlyVisible:true})}
function applyVoxelMaterial(){if(!voxelMesh)return;voxelMesh.material.color.set(0xffffff);voxelMesh.material.emissive.set(customShadow);voxelMesh.material.normalMap=bevelNormalMap;voxelMesh.material.normalScale.set(.45,.45);voxelMesh.material.transparent=xrayEnabled;voxelMesh.material.opacity=xrayEnabled?(+$('#xrayOpacity').value/100):1;voxelMesh.material.depthWrite=!xrayEnabled;voxelMesh.material.needsUpdate=true}
function syncMatEditor(){const c=$('#colorPicker'),s=$('#shadowPicker'),ct=$('#colorHex'),st=$('#shadowHex');if(!c)return;c.value=customColor;s.value=customShadow;ct.value=customColor.toUpperCase();st.value=customShadow.toUpperCase()}
function validHex(v){v=v.trim();if(!v.startsWith('#'))v='#'+v;return /^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():null}
function setCustom(which,value){const v=validHex(value);if(!v)return;if(which==='color')customColor=v;else customShadow=v;syncMatEditor();applyVoxelMaterial()}
function buildPalette(){const el=$('#palette');for(const [name,p] of Object.entries(PALETTE)){const b=document.createElement('button');b.type='button';b.className='mat-swatch'+(name===activeMat?' active':'');b.title=`${name} · ${p.color} / ${p.shadow}`;b.innerHTML=`<span class="mat-ball" style="--c:${p.color};--s:${p.shadow}"></span><small>${name}</small>`;b.onclick=()=>{activeMat=name;customColor=p.color;customShadow=p.shadow;document.querySelectorAll('.mat-swatch').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#matInfo').innerHTML=`Preset: <b>${name}</b>`;syncMatEditor();applyVoxelMaterial()};el.appendChild(b)}const p=PALETTE[activeMat];$('#matInfo').innerHTML=`Preset: <b>${activeMat}</b>`;syncMatEditor()}
buildPalette();
$('#colorPicker').oninput=e=>setCustom('color',e.target.value);$('#shadowPicker').oninput=e=>setCustom('shadow',e.target.value);$('#colorHex').onchange=e=>setCustom('color',e.target.value);$('#shadowHex').onchange=e=>setCustom('shadow',e.target.value);
let paintEnabled=false,painting=false,paintThrough=false;
const paintRay=new THREE.Raycaster(),mouse=new THREE.Vector2();
function updateSlice(){if(!voxelMesh)return;const axis=$('#sliceAxis').value,dirn=+$('#sliceDir').value,percent=+$('#sliceDepth').value/100;const box=new THREE.Box3();voxelPositions.forEach(p=>box.expandByPoint(p));const min=box.min[axis],max=box.max[axis],cut=min+(max-min)*percent;const dummy=new THREE.Object3D();for(let i=0;i<voxelPositions.length;i++){const p=voxelPositions[i],show=!sliceEnabled||(dirn>0?p[axis]<=cut:p[axis]>=cut);dummy.position.copy(p);dummy.quaternion.identity();dummy.scale.setScalar(show?1:0);dummy.updateMatrix();voxelMesh.setMatrixAt(i,dummy.matrix)}voxelMesh.instanceMatrix.needsUpdate=true;voxelMesh.computeBoundingSphere();$('#sliceOut').value=Math.round(percent*100)}
function resetSliceMatrices(){if(!voxelMesh)return;const dummy=new THREE.Object3D();for(let i=0;i<voxelPositions.length;i++){dummy.position.copy(voxelPositions[i]);dummy.quaternion.identity();dummy.scale.set(1,1,1);dummy.updateMatrix();voxelMesh.setMatrixAt(i,dummy.matrix)}voxelMesh.instanceMatrix.needsUpdate=true}
function paintAt(ev){if(!paintEnabled||!voxelMesh)return;const rect=canvas.getBoundingClientRect();mouse.x=((ev.clientX-rect.left)/rect.width)*2-1;mouse.y=-((ev.clientY-rect.top)/rect.height)*2+1;paintRay.setFromCamera(mouse,camera);const hits=paintRay.intersectObject(voxelMesh,false);if(!hits.length)return;const first=hits.find(h=>h.instanceId!=null);if(!first)return;const radius=Math.max(0,+$('#brushSize').value|0),step=+$('#voxel').value,col=new THREE.Color(customColor),ids=new Set();if(paintThrough){const ray=paintRay.ray,brushWorld=Math.max(step*.55,radius*step+step*.55),depthSlider=$('#paintDepth'),depthValue=+depthSlider.value|0,maxDepth=depthValue>=+depthSlider.max?0:depthValue*step;const originT=ray.direction.dot(voxelPositions[first.instanceId].clone().sub(ray.origin));for(let i=0;i<voxelPositions.length;i++){const p=voxelPositions[i],v=p.clone().sub(ray.origin),t=v.dot(ray.direction);if(t<originT-step*.6)continue;if(maxDepth>0&&t>originT+maxDepth+step*.6)continue;const closest=ray.origin.clone().addScaledVector(ray.direction,t);if(p.distanceTo(closest)<=brushWorld)ids.add(i)}}else{const center=voxelPositions[first.instanceId];for(let i=0;i<voxelPositions.length;i++){const p=voxelPositions[i];if(Math.abs(p.x-center.x)<=radius*step+.001&&Math.abs(p.y-center.y)<=radius*step+.001&&Math.abs(p.z-center.z)<=radius*step+.001)ids.add(i)}}for(const i of ids){voxelMesh.setColorAt(i,col);voxelColors[i]=customColor}if(voxelMesh.instanceColor)voxelMesh.instanceColor.needsUpdate=true}
let mayaNav=false,navLastX=0,navLastY=0;
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(!paintEnabled)return;if(e.altKey&&e.button===0){e.preventDefault();painting=false;mayaNav=true;navLastX=e.clientX;navLastY=e.clientY;controls.enabled=false;canvas.setPointerCapture?.(e.pointerId);return}if(e.button===0){painting=true;controls.enabled=false;paintAt(e)}else{painting=false;controls.enabled=true}});
canvas.addEventListener('pointermove',e=>{if(mayaNav){e.preventDefault();const dx=e.clientX-navLastX,dy=e.clientY-navLastY;navLastX=e.clientX;navLastY=e.clientY;const off=camera.position.clone().sub(controls.target),sph=new THREE.Spherical().setFromVector3(off);sph.theta-=dx*0.008;sph.phi-=dy*0.008;sph.phi=Math.max(0.01,Math.min(Math.PI-0.01,sph.phi));off.setFromSpherical(sph);camera.position.copy(controls.target).add(off);camera.lookAt(controls.target);return}if(painting&&(e.buttons&1))paintAt(e)});
addEventListener('pointerup',()=>{painting=false;mayaNav=false;controls.enabled=true});
$('#paintMode').onchange=e=>{paintEnabled=e.target.checked;canvas.style.cursor=paintEnabled?'crosshair':'grab';$('#status').textContent=paintEnabled?'Paint: Left drag. Rotate: Middle drag or Alt+Left. Pan: Right drag. Wheel: Zoom.':'Paint mode off.'};
$('#brushSize').oninput=e=>$('#brushOut').value=e.target.value;
$('#paintThrough').onchange=e=>{paintThrough=e.target.checked;$('#paintThroughControls').classList.toggle('disabled',!paintThrough);$('#status').textContent=paintThrough?'Paint Through: brush paints from the visible hit into interior voxels along the camera ray.':'Paint Through off.'};
$('#paintDepth').oninput=e=>{
  const min=+e.target.min||0,max=+e.target.max||1,v=+e.target.value;
  $('#paintDepthOut').value=Math.round((v-min)/(max-min)*100);
};
$('#paintDepthOut').oninput=e=>{
  const slider=$('#paintDepth');
  const pct=Math.max(0,Math.min(100,+e.target.value||0));
  e.target.value=pct;
  const min=+slider.min||0,max=+slider.max||1;
  slider.value=min+(max-min)*(pct/100);
  slider.dispatchEvent(new Event('input',{bubbles:true}));
};
$('#sliceMode').onchange=e=>{sliceEnabled=e.target.checked;updateSlice();$('#status').textContent=sliceEnabled?'Slice mode: hidden voxels are not deleted. Paint the exposed inside.':'Slice mode off.'};
$('#sliceDepth').oninput=updateSlice;$('#sliceOut').onchange=e=>{const v=Math.max(0,Math.min(100,+e.target.value||0));e.target.value=v;$('#sliceDepth').value=v;updateSlice()};$('#sliceAxis').onchange=updateSlice;$('#sliceDir').onchange=updateSlice;
$('#xrayMode').onchange=e=>{xrayEnabled=e.target.checked;applyVoxelMaterial();$('#xrayControls').classList.toggle('disabled',!xrayEnabled);$('#status').textContent=xrayEnabled?'X-Ray: see interior colors while painting. Use Slice when you need to select a buried voxel.':'X-Ray off.'};
$('#xrayOut').onchange=e=>{const v=Math.max(5,Math.min(90,+e.target.value||5));e.target.value=v;$('#xrayOpacity').value=v;applyVoxelMaterial()};
$('#xrayOpacity').oninput=e=>{$('#xrayOut').value=e.target.value;applyVoxelMaterial()};
function buildExportGroup(){const group=new THREE.Group();if(!voxelMesh)return group;const geo=voxelMesh.geometry,mat=new THREE.Matrix4(),col=new THREE.Color();for(let i=0;i<voxelMesh.count;i++){voxelMesh.getMatrixAt(i,mat);const g=geo.clone();g.applyMatrix4(mat);if(voxelMesh.instanceColor)voxelMesh.getColorAt(i,col);const m=new THREE.MeshStandardMaterial({color:voxelMesh.instanceColor?col.clone():voxelMesh.material.color.clone(),roughness:.75});const mesh=new THREE.Mesh(g,m);mesh.name='voxel_'+i;group.add(mesh)}return group}
async function exportFBX(){if(!voxelMesh)return;$('#status').textContent='Preparing FBX…';try{const group=buildExportGroup();const mod=await import('https://cdn.jsdelivr.net/npm/@comfyorg/fbx-exporter-three@1.0.1/+esm');const Exporter=mod.FBXExporter;if(!Exporter)throw new Error('FBX exporter unavailable');const exporter=new Exporter();const data=exporter.parseSync(group,{preset:'maya',includeAnimations:false,embedTextures:false});if(!(data instanceof Uint8Array)||data.byteLength<27)throw new Error('Invalid FBX data');const magic=new TextDecoder().decode(data.slice(0,18));if(!magic.startsWith('Kaydara FBX Binary'))throw new Error('Invalid FBX header');const blob=new Blob([data],{type:'application/octet-stream'});await downloadBlob(blob,`${sourceName}_voxels.fbx`);group.traverse(o=>{o.geometry?.dispose?.();o.material?.dispose?.()})}catch(e){console.error(e);$('#status').textContent='FBX export failed in this browser.'}}
async function exportSelected(){
  const fmt=$('#exportFormat').value;
  const ext=fmt==='glb'?'glb':'fbx';
  const name=`${sourceName}_voxels.${ext}`;
  pendingExportFileHandle=null;

  if('showSaveFilePicker' in window){
    try{
      const mime=ext==='glb'?'model/gltf-binary':'application/octet-stream';
      pendingExportFileHandle=await window.showSaveFilePicker({
        suggestedName:name,
        types:[{description:ext.toUpperCase()+' file',accept:{[mime]:['.'+ext]}}]
      });
    }catch(e){
      if(e?.name==='AbortError'){
        $('#status').textContent='Export cancelled.';
        return;
      }
      console.warn('Save picker unavailable, using selected folder/download.',e);
    }
  }

  if(fmt==='glb')await exportGLB();
  else await exportFBX();
}
$('#file').onchange=e=>e.target.files[0]&&loadFile(e.target.files[0]);const drop=$('#drop');['dragenter','dragover'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>e.dataTransfer.files[0]&&loadFile(e.dataTransfer.files[0]));
$('#voxel').oninput=e=>$('#voxelOut').value=e.target.value;$('#cubeScale').oninput=e=>$('#scaleOut').value=e.target.value;$('#original').onchange=applyOriginal;$('#wire').onchange=applyOriginal;$('#voxelize').onclick=voxelize;$('#export').onclick=exportSelected;$('#reset').onclick=fit;
const chooseExportFolderBtn=$('#chooseExportFolder');
if(chooseExportFolderBtn){
  if('showDirectoryPicker' in window){
    chooseExportFolderBtn.onclick=async()=>{
      try{
        exportDirectoryHandle=await window.showDirectoryPicker({mode:'readwrite'});
        $('#exportFolderName').textContent=exportDirectoryHandle.name;
        $('#status').textContent='Export folder: '+exportDirectoryHandle.name;
      }catch(e){
        if(e?.name!=='AbortError')$('#status').textContent='Could not select export folder.';
      }
    };
  }else{
    chooseExportFolderBtn.disabled=true;
    chooseExportFolderBtn.title='This browser does not support choosing an export folder.';
    $('#exportFolderName').textContent='Browser download folder';
  }
}

function snapCameraView(view){
  const target=controls.target.clone();
  let distance=camera.position.distanceTo(target);
  if(!Number.isFinite(distance)||distance<0.001)distance=10;

  painting=false;
  mayaNav=false;
  controls.enabled=true;
  controls.enableRotate=true;
  controls.enablePan=true;
  controls.enableZoom=true;

  if(view==='perspective'){
    const dir=new THREE.Vector3(1,0.75,1).normalize();
    camera.up.set(0,1,0);
    camera.position.copy(target).addScaledVector(dir,distance);
    camera.lookAt(target);
    controls.target.copy(target);
    controls.update();
    document.querySelectorAll('#viewCube [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='perspective'));
    $('#status').textContent='3D Perspective: Alt + Left/Right drag to orbit.';
    return;
  }

  const dirs={
    front:new THREE.Vector3(0,0,1),
    back:new THREE.Vector3(0,0,-1),
    left:new THREE.Vector3(-1,0,0),
    right:new THREE.Vector3(1,0,0),
    top:new THREE.Vector3(0,1,0)
  };
  const dir=dirs[view];
  if(!dir)return;
  camera.up.set(0,1,0);
  if(view==='top')camera.up.set(0,0,-1);
  camera.position.copy(target).addScaledVector(dir,distance);
  camera.lookAt(target);
  controls.target.copy(target);
  controls.update();
  document.querySelectorAll('#viewCube [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('#status').textContent=view.toUpperCase()+' view · Alt + Left/Right to orbit';
}
document.querySelectorAll('#viewCube [data-view]').forEach(btn=>{
  btn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    snapCameraView(btn.dataset.view);
  });
});

function syncVoxelPercentControls(){
  const voxel=$('#voxel'), cube=$('#cubeScale');
  const vp=$('#voxelPct'), cp=$('#cubeScalePct');
  if(voxel&&vp)vp.value=Math.round((+voxel.value||0)*100);
  if(cube&&cp)cp.value=Math.round((+cube.value||0)*100);
}
if($('#voxelPct')){
  syncVoxelPercentControls();
  $('#voxel').addEventListener('input',()=>{$('#voxelPct').value=Math.round((+$('#voxel').value||0)*100)});
  $('#voxelPct').addEventListener('change',e=>{
    const slider=$('#voxel'), min=+slider.min||0.01, max=+slider.max||10;
    const pct=Math.max(min*100,Math.min(max*100,+e.target.value||100));
    e.target.value=Math.round(pct);
    slider.value=pct/100;
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    slider.dispatchEvent(new Event('change',{bubbles:true}));
  });
}
if($('#cubeScalePct')){
  $('#cubeScale').addEventListener('input',()=>{$('#cubeScalePct').value=Math.round((+$('#cubeScale').value||0)*100)});
  $('#cubeScalePct').addEventListener('input',e=>{
    const slider=$('#cubeScale'), min=+slider.min||0.01, max=+slider.max||2;
    const pct=Math.max(min*100,Math.min(max*100,+e.target.value||100));
    e.target.value=Math.round(pct);
    slider.value=pct/100;
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
}

function mayaOrbitMove(e){
  if(!mayaNav)return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const dx=e.clientX-navLastX,dy=e.clientY-navLastY;
  navLastX=e.clientX;navLastY=e.clientY;
  const off=camera.position.clone().sub(controls.target);
  const sph=new THREE.Spherical().setFromVector3(off);
  sph.theta-=dx*0.008;
  sph.phi-=dy*0.008;
  sph.phi=Math.max(0.01,Math.min(Math.PI-0.01,sph.phi));
  off.setFromSpherical(sph);
  camera.position.copy(controls.target).add(off);
  camera.up.set(0,1,0);
  camera.lookAt(controls.target);
}
canvas.addEventListener('pointerdown',e=>{
  if(!e.altKey||(e.button!==0&&e.button!==2))return;
  e.preventDefault();
  e.stopImmediatePropagation();
  painting=false;
  mayaNav=true;
  navLastX=e.clientX;
  navLastY=e.clientY;
  controls.enabled=false;
  canvas.setPointerCapture?.(e.pointerId);
},{capture:true});
canvas.addEventListener('pointermove',mayaOrbitMove,{capture:true});
canvas.addEventListener('pointerup',e=>{
  if(!mayaNav)return;
  e.preventDefault();
  e.stopImmediatePropagation();
  mayaNav=false;
  painting=false;
  controls.enabled=true;
  try{canvas.releasePointerCapture?.(e.pointerId)}catch(_){}
},{capture:true});
canvas.addEventListener('pointercancel',()=>{
  mayaNav=false;
  painting=false;
  controls.enabled=true;
},{capture:true});

function setupRangePercentEditors(){
  document.querySelectorAll('.range-percent[data-slider]').forEach(field=>{
    const slider=$('#'+field.dataset.slider);
    if(!slider)return;
    const sync=()=>{
      const min=Number(slider.min||0),max=Number(slider.max||100),v=Number(slider.value);
      field.value=Math.round(max===min?0:(v-min)/(max-min)*100);
    };
    slider.addEventListener('input',sync);
    field.addEventListener('input',()=>{
      let pct=Math.max(0,Math.min(100,Number(field.value)||0));
      field.value=pct;
      const min=Number(slider.min||0),max=Number(slider.max||100),step=Number(slider.step||0);
      let v=min+(max-min)*(pct/100);
      if(step>0)v=Math.round((v-min)/step)*step+min;
      slider.value=v;
      slider.dispatchEvent(new Event('input',{bubbles:true}));
    });
    sync();
  });
}
setupRangePercentEditors();

if($('#rounding')){
  const syncRound=()=>{$('#roundingPct').value=Math.round(+$('#rounding').value*100)};
  $('#rounding').oninput=e=>{syncRound()};
  $('#rounding').onchange=()=>{if(voxelMesh)voxelize()};
  $('#roundingPct').oninput=e=>{
    const pct=Math.max(0,Math.min(45,+e.target.value||0));
    e.target.value=pct;
    $('#rounding').value=pct/100;
  };
  $('#roundingPct').onchange=()=>{if(voxelMesh)voxelize()};
  syncRound();
}

if($('#roundingEnabled')){
  const updateRoundUI=()=>{
    const on=$('#roundingEnabled').checked;
    $('#rounding').disabled=!on;
    $('#roundingPct').disabled=!on;
  };
  $('#roundingEnabled').onchange=()=>{
    updateRoundUI();
    if(voxelMesh)voxelize();
  };
  updateRoundUI();
}
