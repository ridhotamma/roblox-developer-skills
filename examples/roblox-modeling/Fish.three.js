// Low-poly fish - three.js loader (roblox-modeling skill)
// Usage:
//   import { loadFish } from './Fish.three.js';
//   const fish = await loadFish(scene);           // adds it to the scene
//   fish.play('Swim');                         // cross-fades between clips
//   renderer.setAnimationLoop(() => { fish.update(clock.getDelta()); renderer.render(scene, camera); });
// Units are metres, +Y up, the model faces +Z. Needs three r150+ (GLTFLoader from three/addons).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CLIPS = [{"name":"Swim","loop":true,"duration":1},{"name":"Idle","loop":true,"duration":2},{"name":"Die","loop":false,"duration":2.6}];

export async function loadFish(parent, url = new URL('./Fish.glb', import.meta.url).href) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.flatShading = true; o.frustumCulled = !o.isSkinnedMesh; } });
  if (parent) parent.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
  for (const c of CLIPS) {
    const a = actions[c.name]; if (!a) continue;
    if (!c.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  let current = null;
  return {
    root, mixer, actions,
    play(name, fade = 0.2) {
      const next = actions[name]; if (!next) throw new Error('no clip ' + name);
      next.reset().play();
      if (current && current !== next) current.crossFadeTo(next, fade, false);
      current = next; return next;
    },
    update(dt) { mixer.update(dt); },
  };
}
