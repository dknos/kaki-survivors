/**
 * Post-FX pipeline: bloom + chromatic aberration + Bayer dither + output.
 * Adapted from original game lines 2370-2473.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PostFXShader = {
  uniforms: {
    tDiffuse:  { value: null },
    chromatic: { value: 0.0008 },
    vignette:  { value: 0.45 },
    grain:     { value: 0.0 },
    time:      { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float chromatic, vignette, grain, time;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float dist = length(d);
      vec2 off = d * chromatic * dist * 2.0;
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      float vig = 1.0 - smoothstep(0.35, 0.95, dist * 1.4) * vignette;
      float n = (fract(sin(dot(vUv*time, vec2(12.9898,78.233)))*43758.5453)-0.5) * grain;
      gl_FragColor = vec4((r+n)*vig, (g+n)*vig, (b+n)*vig, 1.0);
    }
  `,
};

export function createComposer(renderer, scene, camera, W, H) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W * 0.5, H * 0.5), 1.2, 0.55, 0.22);
  composer.addPass(bloomPass);

  const postFXPass = new ShaderPass(PostFXShader);
  composer.addPass(postFXPass);

  composer.addPass(new OutputPass());
  return { composer, bloomPass, postFXPass };
}

export function resizeComposer(composer, bloomPass, postFXPass, W, H) {
  composer.setSize(W, H);
  bloomPass.setSize(W * 0.5, H * 0.5);
}
