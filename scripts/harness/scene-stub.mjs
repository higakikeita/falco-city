/* Stands in for src/scene.js.

   scene.js constructs a THREE.WebGLRenderer, which needs a real canvas and a
   GL context — the one thing a Node harness genuinely cannot fake. Everything
   else in the graph (geometries, materials, Vector3 math, the layout engine)
   runs fine off-screen, so only this module is replaced.

   Exports mirror src/scene.js exactly. If that export list changes,
   check-imports will not catch it — this file will simply throw on import,
   which is the failure we want. */
import * as THREE from 'three';
import { fakeCanvas } from './env.mjs';

const scene = new THREE.Scene();
const world = new THREE.Group();
scene.add(world);

const camera = new THREE.PerspectiveCamera(38, 1.6, 0.5, 1100);
const renderer = {
  domElement: fakeCanvas,
  setPixelRatio(){}, setSize(){}, setClearColor(){}, render(){},
  shadowMap: {enabled:false}
};
const controls = {
  target: new THREE.Vector3(), enabled: true,
  update(){}, saveState(){}, reset(){}, addEventListener(){}
};

const HOME_TGT = new THREE.Vector3(7, 4, -3);
const HOME_DIR = new THREE.Vector3(-0.40, 0.53, 0.75).normalize();
const CITY_BOX = new THREE.Box3(new THREE.Vector3(-60,0,-60), new THREE.Vector3(140,60,60));

const homeView = () => ({pos:[120, 70, 120], tgt: HOME_TGT.clone()});
const homeCam  = () => {};
const goHome   = () => {};
const onResize = () => {};
const flyTo    = () => {};
const tickFlight = () => {};

export {
  renderer, scene, camera, controls, world,
  CITY_BOX, HOME_TGT, HOME_DIR,
  homeView, homeCam, goHome, onResize, flyTo, tickFlight
};
