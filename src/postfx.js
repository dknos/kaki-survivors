/**
 * Post-FX pipeline:
 *   1) `bloomComposer` renders the scene with camera layer mask = BLOOM_LAYER only,
 *      then UnrealBloomPass. Output is a bloom-only texture.
 *   2) `composer` renders the scene normally, then a composite ShaderPass adds the
 *      bloom texture over the base, then chromatic/vignette/dither, then OutputPass.
 *
 * Net effect: only objects on layer 1 contribute glow. Hero/enemies/ground stay
 * un-bloomed regardless of brightness. The "deliberate glow not accidental" pattern.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Public — set `mesh.layers.enable(BLOOM_LAYER)` on anything that should bloom.
export const BLOOM_LAYER = 1;

const PostFXShader = {
  uniforms: {
    tDiffuse:  { value: null },
    chromatic: { value: 0.0008 },
    vignette:  { value: 0.45 },
    grain:     { value: 0.0 },
    time:      { value: 0 },
    fogTint:   { value: new THREE.Color(0x3a4a44) },
    fogAmount: { value: 0.18 },
    // LGG color grade (Lift/Gamma/Gain). Defaults nudge shadows cool, highlights warm.
    lift:      { value: new THREE.Vector3(0.00, 0.00, 0.02) },
    gamma:     { value: new THREE.Vector3(1.00, 1.00, 1.05) },
    gain:      { value: new THREE.Vector3(1.02, 1.00, 0.98) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float chromatic, vignette, grain, time, fogAmount;
    uniform vec3 fogTint, lift, gamma, gain;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float dist = length(d);
      vec2 off = d * chromatic * dist * 2.0;
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, g, b);
      // Height fog: blend toward fogTint based on screen Y (top of screen heavier).
      float hFog = smoothstep(0.0, 0.7, 1.0 - vUv.y) * fogAmount;
      col = mix(col, fogTint, hFog);
      // LGG color grade
      col = pow(max(col + lift, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.001))) * gain;
      float vig = 1.0 - smoothstep(0.35, 0.95, dist * 1.4) * vignette;
      float n = (fract(sin(dot(vUv*time, vec2(12.9898,78.233)))*43758.5453)-0.5) * grain;
      gl_FragColor = vec4((col + n) * vig, 1.0);
    }
  `,
};

const BloomCompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    bloomTex: { value: null },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTex;
    varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 bloom = texture2D(bloomTex, vUv);
      gl_FragColor = vec4(base.rgb + bloom.rgb, base.a);
    }
  `,
};

export function createComposer(renderer, scene, camera, W, H) {
  // ── Bloom-only composer (renders just layer 1, then bloom) ──
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  // threshold 0 — everything on the bloom layer blooms. Strength + radius shape the glow.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W * 0.5, H * 0.5), 0.70, 0.50, 0.0);
  bloomComposer.addPass(bloomPass);

  // ── Main composer ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const compositePass = new ShaderPass(BloomCompositeShader);
  compositePass.uniforms.bloomTex.value = bloomComposer.renderTarget2.texture;
  composer.addPass(compositePass);
  const postFXPass = new ShaderPass(PostFXShader);
  composer.addPass(postFXPass);
  composer.addPass(new OutputPass());

  return { composer, bloomComposer, bloomPass, postFXPass };
}

export function resizeComposer(composer, bloomPass, postFXPass, W, H, bloomComposer) {
  composer.setSize(W, H);
  if (bloomComposer) {
    bloomComposer.setSize(W, H);
  }
  bloomPass.setSize(W * 0.5, H * 0.5);
}
