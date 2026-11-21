import * as THREE from 'three/webgpu';
import { uv, vec3, smoothstep } from 'three/tsl';
import { FlakesTexture } from 'three/addons/textures/FlakesTexture.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLES } from './vehicles.js';

const glass = new THREE.MeshPhysicalMaterial({ color: '#273b45', transparent: true, opacity: .82, depthWrite: false, forceSinglePass: true, roughness: 0.12, metalness: 0.10, envMapIntensity: 1.16, clearcoat: 1, clearcoatRoughness: 0.13, side: THREE.DoubleSide });
const rubber = new THREE.MeshStandardMaterial({ color: '#222724', roughness: 0.94 });
const trim = new THREE.MeshStandardMaterial({ color: '#404642', roughness: 0.6 });
const alloy = new THREE.MeshStandardMaterial({ color: '#b9c3bc', roughness: 0.33, metalness: 0.83 });
const tail = new THREE.MeshPhysicalMaterial({ color: '#962018', roughness: 0.30, clearcoat: 1, emissive: '#c72c1d', emissiveIntensity: 0.21 });
const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.66 });
const gasket = new THREE.MeshStandardMaterial({ color: '#1b2423', roughness: 0.63 });

function plateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e3e7d4';
  ctx.fillRect(0, 0, 256, 72);
  ctx.fillStyle = '#324b65';
  ctx.fillRect(0, 0, 20, 72);
  ctx.font = 'bold 46px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#232821';
  ctx.fillText('FJ 2714', 137, 37);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function box(parent, material, size, position, radius = 0) {
  const shape = radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(shape, material);
  mesh.position.set(...position);
  parent.add(mesh);
}

function wheelParts(radius, width, id) {
  const trail = id === 'trail';
  const style = { wagon: [8, 0.88, 0.047], retro: [5, 0.98, 0.050], hyper: [10, 1.06, 0.037], trail: [6, 0.76, 0.073] };
  const [spokes, size, cut] = style[id];
  const rimRadius = radius * 0.68 * size;
  const tireProfile = [
    [rimRadius, -0.42], [radius * 0.77, -0.51], [radius * 0.91, -0.48], [radius * 0.985, -0.34], [radius, -0.22],
    [radius, 0.22], [radius * 0.985, 0.34], [radius * 0.91, 0.48], [radius * 0.77, 0.51], [rimRadius, 0.42],
  ];
  const lathe = profile => new THREE.LatheGeometry(profile.map(([r, w]) => new THREE.Vector2(r, w * width)), 36).rotateZ(-Math.PI / 2);
  const tread = [lathe(tireProfile)];
  for (let tooth = 0; trail && tooth < 28; tooth++) {
    for (const side of [-1, 1]) {
      tread.push(new THREE.BoxGeometry(width * 0.44, radius * 0.065, radius * 0.15)
        .rotateY(side * 0.38).translate(side * width * 0.27, radius * 0.985, 0)
        .rotateX((tooth + (side === 1 ? 0.47 : 0)) * Math.PI / 14));
    }
  }
  const rims = [lathe([
    [rimRadius * 0.96, -0.42], [rimRadius, -0.46], [rimRadius * 1.04, -0.48], [rimRadius * 1.07, -0.41],
    [rimRadius * 1.07, 0.41], [rimRadius * 1.04, 0.48], [rimRadius, 0.46], [rimRadius * 0.96, 0.42],
  ])];
  for (const side of [-1, 1]) {
    for (let index = 0; index < spokes; index++) {
      rims.push(new THREE.BoxGeometry(0.023, rimRadius * 0.79, cut)
        .rotateY(id === 'hyper' ? 0.34 : 0.06).rotateZ(side * 0.16)
        .translate(side * width * 0.443, rimRadius * 0.55, 0).rotateX(index * Math.PI * 2 / spokes));
    }
  }
  const ring = new THREE.CylinderGeometry(rimRadius * 0.37, rimRadius * 0.37, width * 0.92, 12).rotateZ(Math.PI / 2);
  rims.push(ring);
  return [
    [mergeGeometries(tread), rubber], [mergeGeometries(rims), alloy],
    [new THREE.CylinderGeometry(rimRadius * 0.91, rimRadius * 0.91, width * 0.61, 24).rotateZ(Math.PI / 2), trim],
  ];
}

function addWheel(parts, center, tires, root, front) {
  const pivot = new THREE.Group();
  const wheel = new THREE.Group();
  pivot.position.set(...center);
  for (const [geometry, material] of parts) wheel.add(new THREE.Mesh(geometry, material));
  pivot.add(wheel);
  root.add(pivot);
  tires.push({ pivot, wheel, front });
}

function exhaust(body, x, y, z, radius) {
  const pipe = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.85, radius * 0.15, 7, 20), alloy);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.23,20,1,true).rotateX(Math.PI/2),alloy);
  sleeve.position.set(x,y,z-.114);
  body.add(sleeve);
  const lining = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.81, 20), gasket);
  pipe.position.set(x, y, z);
  lining.position.set(x, y, z - 0.006);
  body.add(pipe, lining);
}

function finishModel(root, tires, brakeLamp, width, length) {
  root.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const distance = uv().sub(0.5).abs().mul(2);
  shadowMaterial.colorNode = vec3(0.019, 0.025, 0.021);
  shadowMaterial.opacityNode = smoothstep(0.16, 1, distance.x.pow(3).add(distance.y.pow(4))).oneMinus().mul(0.53);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), shadowMaterial);
  shadow.position.y = 0.084;
  root.add(shadow);
  root.rotation.order = 'YXZ';
  return { root, tires, brake: active => { brakeLamp.emissiveIntensity = active ? 1.65 : 0.19; } };
}

// Body stations run nose to tail. Each defines longitudinal position, half-width,
// sill height and crown height. The greenhouse has its own independent profile.
const DESIGNS = {
  wagon: {
    color: '#476b70', body: [[-2.37,.71,.36,.69],[-2.22,.86,.29,.80],[-1.53,.94,.27,.88],[-.85,.93,.24,.94],[.37,.93,.25,.96],[1.39,.96,.27,1.00],[2.12,.92,.32,.96],[2.30,.81,.40,.89]],
    cabin: [[-.99,.76,.87,.93],[-.60,.83,.9,1.30],[-.22,.83,.91,1.49],[.90,.84,.94,1.50],[1.63,.81,.95,1.44],[2.04,.76,.91,1.02]],
    roof: [.27,.79], pillar: [.46,.72], front: .63, rear: .76,
  },
  retro: {
    color: '#903c40', body: [[-2.32,.68,.31,.46],[-2.12,.86,.24,.57],[-1.45,.96,.22,.69],[-.59,.91,.22,.74],[.52,.90,.23,.75],[1.32,.98,.26,.82],[1.91,.94,.29,.79],[2.13,.83,.37,.74]],
    cabin: [[-.85,.72,.69,.74],[-.53,.76,.69,.98],[-.10,.75,.72,1.21],[.44,.74,.73,1.24],[.88,.72,.74,1.14],[1.48,.66,.77,.80]],
    roof: [.32,.64], pillar: [.62], front: .42, rear: .61,
  },
  hyper: {
    color: '#c87532', body: [[-2.33,.67,.19,.33],[-2.12,.91,.16,.41],[-1.45,1.03,.17,.56],[-.88,.90,.18,.54],[.26,.86,.16,.57],[.90,.99,.18,.65],[1.46,1.06,.22,.73],[1.99,1.02,.24,.66],[2.23,.88,.33,.64]],
    cabin: [[-1.46,.57,.47,.50],[-.96,.66,.49,.77],[-.46,.71,.54,1.01],[.15,.70,.58,1.09],[.62,.66,.62,1.02],[1.26,.50,.65,.71]],
    roof: [.42,.62], pillar: [], front: .31, rear: .53,
  },
  trail: {
    color: '#bfab82', body: [[-1.94,.78,.53,.98],[-1.78,.89,.47,1.11],[-1.23,.96,.45,1.19],[-.69,.88,.47,1.18],[.68,.90,.48,1.16],[1.27,.96,.46,1.19],[1.73,.92,.51,1.18],[1.92,.82,.59,1.12]],
    cabin: [[-.76,.77,1.12,1.19],[-.56,.81,1.14,1.63],[-.36,.81,1.15,1.80],[.59,.83,1.13,1.84],[1.31,.82,1.14,1.82],[1.65,.79,1.13,1.73],[1.76,.76,1.12,1.19]],
    roof: [.22,.84], pillar: [.48,.70], front: .90, rear: .93,
  },
};

const point = (x,y,z) => new THREE.Vector3(x,y,z);
const carbon = new THREE.MeshStandardMaterial({color:'#232a29',roughness:.52,metalness:.25,side:THREE.DoubleSide});
const pearl = new THREE.MeshStandardMaterial({color:'#dce9e8',emissive:'#ffe6c1',emissiveIntensity:.62});
const lerp = THREE.MathUtils.lerp;
const clamp01 = x => THREE.MathUtils.clamp(x,0,1);

// Smooth interpolation between the designer's stations, with an exact endpoint.
function section(rows, z) {
  let i = 0;
  while (i < rows.length - 2 && rows[i+1][0] < z) i++;
  const a = rows[i], b = rows[i+1], prev = rows[Math.max(0,i-1)], next = rows[Math.min(rows.length-1,i+2)];
  const dz = b[0]-a[0], t = clamp01((z-a[0])/dz), t2=t*t, t3=t2*t;
  return a.slice(1).map((value,k) => {
    const j=k+1;
    return (2*t3-3*t2+1)*value + (t3-2*t2+t)*dz*(b[j]-prev[j])/(b[0]-prev[0])
      + (3*t2-2*t3)*b[j] + (t3-t2)*dz*(next[j]-a[j])/(next[0]-a[0]);
  });
}

function surface(group, material, columns, rows, evaluate) {
  const vertices=[], indices=[], uvCoords=[];
  for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++) {
    const p=evaluate(i/columns,j/rows);
    vertices.push(p.x,p.y,p.z);
    uvCoords.push(i/columns,j/rows);
    if(i&&j) {
      const d=j*(columns+1)+i, a=d-columns-2;
      indices.push(a,d-1,a+1,a+1,d-1,d);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvCoords,2));
  g.setIndex(indices);
  g.computeVertexNormals();
  group.add(new THREE.Mesh(g,material));
}

function piping(body, material, coords, radius) {
  const curve=new THREE.CatmullRomCurve3(coords);
  body.add(new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,coords.length*3),radius,7,false),material));
}

const flakes = new THREE.CanvasTexture(new FlakesTexture(256,256));
flakes.wrapS = flakes.wrapT = THREE.RepeatWrapping;
flakes.repeat.set(5,10);

export function makeVehicle(id) {
  const d=DESIGNS[id], spec=VEHICLES[id], trail=id==='trail', hyper=id==='hyper', retro=id==='retro';
  const root=new THREE.Group(), body=new THREE.Group();
  root.add(body);
  const finish=new THREE.MeshPhysicalMaterial({color:d.color,normalMap:flakes,normalScale:new THREE.Vector2(.065,.065),metalness:trail?.28:.58,roughness:trail?.36:.24,clearcoat:.95,clearcoatRoughness:.13,side:THREE.DoubleSide});
  const brake=tail.clone();
  const nose=d.body[0][0], stern=d.body.at(-1)[0];
  const radius=spec.radius, axle=spec.wheelbase/2;
  function contours(z) {
    const [width,sill,crown]=section(d.body,z);
    const axleDistance=Math.abs(Math.abs(z)-axle);
    const archRadius=radius*1.15;
    const opening=axleDistance<archRadius ? radius+Math.sqrt(archRadius**2-axleDistance**2) : sill;
    const bottom=Math.max(sill,opening);
    const shoulder=Math.max(crown-.065,bottom+.051, crown-.095+.105*Math.exp(-(axleDistance**2)/.26));
    return {width,sill,crown,bottom,shoulder};
  }
  function swept(z,u) {
    const end=z<0?nose:stern;
    return z-Math.sign(z)*Math.pow(Math.abs(z/end),6)*Math.pow(Math.abs(u),2.6)*(trail?.13:.31);
  }
  function deck(z,u) {
    const {width,crown,shoulder}=contours(z);
    const a=Math.abs(u);
    const fender=Math.exp(-((Math.abs(z)-axle)**2)/.30)*Math.exp(-((a-.79)**2)/.036);
    const y=lerp(crown,shoulder,a**(hyper?1.55:2.45))+fender*(hyper?.062:.043)+.028*(1-a*a);
    return point(u*width,y,swept(z,u));
  }
  surface(body,finish,24,80,(u,v)=>deck(lerp(nose,stern,v),2*u-1));
  for(const side of [-1,1]) {
    surface(body,finish,8,80,(u,v)=>{
      const z=lerp(nose,stern,v), c=contours(z), top=deck(z,side);
      const width=c.width+Math.sin(u*Math.PI)*.035-u*u*.055;
      return point(side*width,lerp(top.y,c.bottom,u),top.z);
    });
    // Dark wheel wells provide a recessed return under each painted fender.
    surface(body,carbon,2,80,(u,v)=>{
      const z=lerp(nose,stern,v), c=contours(z);
      return point(side*(c.width-.055-.16*u),c.bottom-.032*u,swept(z,1));
    });
    for(const zc of [-axle,axle]) {
      const outline=Array.from({length:19},(_,i)=>{
        const a=i*Math.PI/18, z=zc+radius*1.15*Math.cos(a), c=contours(z);
        return point(side*(c.width-.036),Math.max(c.sill,radius+radius*1.15*Math.sin(a))+.012,swept(z,1));
      });
      piping(body,trail?carbon:finish,outline,trail?.048:.019);
    }
  }
  for(const z of [nose,stern]) {
    surface(body,finish,24,8,(u,v)=>{
      const across=2*u-1, p=deck(z,across), c=contours(z);
      p.y=lerp(p.y,c.sill,v);
      p.x=across*(c.width+Math.sin(v*Math.PI)*.035-v*v*.055);
      return p;
    });
  }
  surface(body,carbon,4,44,(u,v)=>{
    const z=lerp(nose,stern,v), c=contours(z);
    return point((2*u-1)*(c.width-.09),c.sill-.026,swept(z,2*u-1));
  });
  const cabinStart=d.cabin[0][0], cabinEnd=d.cabin.at(-1)[0];
  function canopy(u,v,lift=0) {
    const z=lerp(cabinStart,cabinEnd,v), [width,belt,roof]=section(d.cabin,z);
    const y=belt+(roof-belt)*(1-Math.pow(Math.abs(u),trail?8:4));
    return point(width*u,y+lift,z);
  }
  surface(body,glass,28,42,(u,v)=>canopy(u*2-1,v));
  // Sweep the sail panels into the rear deck and frame the hatch glass.
  for(const side of [-1,1]) {
    surface(body,finish,7,18,(u,v)=>{
      const t=lerp(d.roof[1],1,v);
      const outer=lerp(.81,.99,v);
      const inner=outer-(trail?.16:hyper?.29:.18)*Math.sin(Math.PI*v*.88)-.045;
      return canopy(side*lerp(inner,outer,u),t,.018);
    });
  }
  for(const end of [0,1]) {
    surface(body,finish,24,3,(u,v)=>{
      const lateral=u*2-1, p=canopy(lateral,end);
      const shoulder=deck(p.z,p.x/contours(p.z).width);
      p.y=lerp(p.y,shoulder.y-.004,v);
      return p;
    });
  }
  // A real cabin gives the glazing depth when the sky reflection rolls off it.
  const interior=new THREE.MeshStandardMaterial({color:trail?'#443e32':'#252c30',roughness:.88});
  surface(body,carbon,14,28,(u,v)=>{
    const z=lerp(cabinStart+.075,cabinEnd-.06,v), [w,belt]=section(d.cabin,z);
    const lateral=(u*2-1)*w*.96, c=contours(z);
    const p=deck(z,lateral/c.width);
    p.y=Math.max(p.y+.014,belt);
    return p;
  });
  const cushionZ=trail?.10:hyper?-.18:.02;
  const seatBase=section(d.cabin,cushionZ)[1];
  const topHeight=section(d.cabin,cushionZ)[2];
  const seatHeight=topHeight-seatBase;
  for(const side of [-1,1]) {
    box(body,interior,[.43,seatHeight*.68,.17],[side*.36,seatBase+seatHeight*.32,cushionZ],.068);
    box(body,interior,[.235,seatHeight*.25,.13],[side*.36,seatBase+seatHeight*.75,cushionZ+.045],.045);
    if(id==='wagon'||trail) box(body,interior,[.29,.16,.16],[side*.36,seatBase+.24,cushionZ+.79],.053);
  }
  const dashZ=lerp(cabinStart,cabinEnd,.16), dashHeight=section(d.cabin,dashZ)[1];
  box(body,interior,[section(d.cabin,dashZ)[0]*1.66,.12,.25],[0,dashHeight+.045,dashZ],.053);
  const steeringWheel=new THREE.Mesh(new THREE.TorusGeometry(.136,.017,8,26),carbon);
  steeringWheel.rotation.x=-.43;
  steeringWheel.position.set(-.35,dashHeight+.10,dashZ+.19);
  body.add(steeringWheel);
  const roofMaterial=trail||hyper?carbon:finish;
  surface(body,roofMaterial,20,24,(u,v)=>canopy((u*2-1)*(trail?.855:.76),lerp(...d.roof,v),.014));
  for(const side of [-1,1]) {
    const rail=Array.from({length:21},(_,i)=>{
      const v=i/20, inset=Math.sin(Math.PI*v)**.65;
      return canopy(side*(.965-.19*inset),v,.014);
    });
    piping(body,finish,rail,trail?.047:.029);
    piping(body,alloy,Array.from({length:15},(_,i)=>canopy(side*.997,i/14,.015)),.012);
    for(const v of d.pillar) piping(body,carbon,Array.from({length:8},(_,i)=>canopy(side*lerp(.77,1,i/7),v+i*.001,.018)),trail?.035:.024);
    // Stamped door shut lines, flush pulls and an inset rocker below the sill.
    function sidePoint(z, depth) {
      const c=contours(z);
      const w=c.width+Math.sin(depth*Math.PI)*.035-depth*depth*.055;
      return point(side*(w+.006),lerp(deck(z,side).y,c.bottom,depth),swept(z,1));
    }
    const doorEnds = id==='wagon'?[-.78,.16,1.01]:[trail?-.69:-.72,trail?.60:.80];
    for(const z of doorEnds) piping(body,carbon,[sidePoint(z,.08),sidePoint(z+.015,.28),sidePoint(z-.035,.65),sidePoint(z-.12,.85)],.007);
    for(const z of doorEnds.slice(1)) piping(body,alloy,[sidePoint(z-.24,.22),sidePoint(z-.16,.215),sidePoint(z-.10,.22)],.012);
    surface(body,hyper?carbon:trim,4,28,(u,v)=>sidePoint(lerp(-axle+radius,axle-radius,v),.83+.14*u));
    const hoodEnd=d.cabin[0][0]-.02;
    piping(body,carbon,Array.from({length:13},(_,i)=>{
      const v=i/12;
      return deck(lerp(nose+.21,hoodEnd,v),side*lerp(.47,.73,v)).add(point(0,.007,0));
    }),.006);
    const mirror=canopy(side*.985,.24);
    piping(body,carbon,[mirror,mirror.clone().add(point(side*.08,.025,.015)),mirror.clone().add(point(side*.14,.045,.03))],.018);
    const shell=new THREE.Mesh(new THREE.SphereGeometry(1,18,10),finish);
    shell.scale.set(.116,.054,.089);
    shell.position.copy(mirror).add(point(side*.17,.052,.026));
    body.add(shell);
  }
  // Rear and front fascia ribbons follow the same swept surface as the deck.
  function fascia(z,y,start,end,height,material,offset,curve=0) {
    const width=contours(z).width;
    surface(body,material,22,2,(u,v)=>{
      const a=lerp(start,end,z>0?1-u:u);
      return point(a*width,y+curve*Math.abs(a)**2+height*v,swept(z,a)+Math.sign(z)*offset);
    });
  }
  for(const z of [nose,stern]) {
    const c=contours(z);
    fascia(z,c.sill-.035,-.97,.97,trail?.13:.086,carbon,.016,.024);
  }
  for(const side of [-1,1]) {
    const span=(a,b)=>side===1?[a,b]:[-b,-a];
    if(!trail) fascia(nose,d.front-.028,...span(.38,.94),trail?.131:.069,carbon,.019,.033);
    if(!trail) fascia(nose,d.front+.003,...span(.44,.92),trail?.054:.026,pearl,.032,.034);
    fascia(stern,d.rear-.048,...span(hyper?.02:.32,.96),trail?.15:.105,carbon,.021,.031);
    if(!retro) fascia(stern,d.rear+.005,...span(hyper?.045:.38,.93),trail?.067:.032,brake,.034,.030);
    if(trail) fascia(stern,d.rear-.029,...span(.45,.87),.014,brake,.032,.029);
  }
  if(trail) fascia(nose,.807,-.94,.94,.224,carbon,.024,.022);
  for(const side of [-1,1]) {
    if(trail) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.106,.106,.045,30).rotateX(Math.PI/2),carbon);
      head.position.set(side*.57,.941,swept(nose,.73)-.046);
      body.add(head);
      const halo=new THREE.Mesh(new THREE.TorusGeometry(.082,.012,7,28),pearl);
      halo.position.copy(head.position);halo.position.z-=.026;body.add(halo);
    } else {
      const length=hyper?.52:retro?.34:.39;
      const lensPoint=(u,v)=>{
        const z=nose+.06+v*length+u*.058;
        return deck(z,side*(.53+v*.17+u*(.31-.18*v))).add(point(0,.013,0));
      };
      surface(body,carbon,7,12,lensPoint);
      piping(body,pearl,Array.from({length:9},(_,i)=>lensPoint(.88,i/8).add(point(0,.009,0))),.012);
      if(retro) piping(body,alloy,[lensPoint(.04,.94),lensPoint(.50,.94),lensPoint(.96,.94)],.011);
    }
  }
  if(retro) {
    fascia(stern,.508,-.94,.94,.212,carbon,.018,.02);
    for(const x of [-.68,-.47,.47,.68]) {
      const lateral=x/contours(stern).width;
      const lens=new THREE.Mesh(new THREE.CylinderGeometry(.072,.073,.030,30).rotateX(Math.PI/2),brake);
      lens.position.set(x,.630,swept(stern,lateral)+.041);
      body.add(lens);
      const bezel=new THREE.Mesh(new THREE.TorusGeometry(.077,.008,6,24),trim);
      bezel.position.copy(lens.position);bezel.position.z+=.015;
      body.add(bezel);
    }
  }
  if(id==='wagon') {
    for(const side of [-1,1]) {
      fascia(stern,.675,side===1?.80:-.94,side===1?.94:-.80,.116,brake,.035,.032);
    }
    fascia(stern,.64,-.23,.23,.021,alloy,.023);
  }
  if(hyper) {
    for(const side of [-1,1]) {
      surface(body,carbon,5,20,(u,v)=>{
        const z=lerp(.24,.98,v), c=contours(z);
        const depth=lerp(.31,.73,u)*Math.sin(Math.PI*.91*v)**.58;
        return point(side*(c.width+.051-depth*.014),c.crown-.032-depth*.30,z);
      });
    }
    for(const x of [-.56,-.34,0,.34,.56]) box(body,carbon,[.029,.124,.40],[x,.29,1.99],.009);
  }
  const frontSill=contours(nose).sill;
  fascia(nose,frontSill+.074,-.39,.39,trail?.21:.066,carbon,.023);
  if(trail) {
    for(const x of [-.24,-.16,-.08,0,.08,.16,.24]) {
      box(body,trim,[.024,.135,.033],[x,frontSill+.32,swept(nose,x/contours(nose).width)-.039],.007);
    }
  }
  box(body,plate,[.36,.093,.02],[0,contours(stern).sill+.12,stern+.012],.009);
  if(hyper) {
    for(const side of [-1,1]) {
      surface(body,carbon,8,16,(u,v)=>deck(lerp(.79,1.88,v),side*lerp(.48,.77,u)).add(point(0,.014,0)));
      for(let i=0;i<5;i++) piping(body,trim,[deck(1.04+i*.14,side*.51),deck(1.04+i*.14,side*.64),deck(1.04+i*.14,side*.73)].map(p=>p.add(point(0,.033,0))),.015);
      exhaust(body,side*.46,.42,stern+.012,.060);
    }
  } else if(retro) {
    surface(body,finish,24,5,(u,v)=>{const a=2*u-1;return point(.88*a,.83+.062*(1-a*a)+.018*Math.sin(v*Math.PI),1.77+.23*v-.13*a*a);});
    for(const side of [-1,1]) box(body,finish,[.056,.12,.16],[side*.63,.814,1.82],.023);
    exhaust(body,-.53,.32,stern-.005,.059);
  } else if(trail) {
    for(const side of [-1,1]) {
      box(body,carbon,[.19,.083,1.37],[side*.94,.48,.035],.034);
      piping(body,alloy,[point(side*.57,1.77,-.32),point(side*.57,1.90,-.18),point(side*.57,1.92,1.12),point(side*.57,1.81,1.38)],.030);
    }
    for(const z of [-.12,1.01]) box(body,carbon,[1.22,.046,.092],[0,1.92,z],.018);
  } else {
    for(const side of [-1,1]) {
      const mounts=[.32,.71].map(v=>canopy(side*.59,v,.019));
      const bar=mounts.map(p=>p.clone().add(point(0,.079,0)));
      piping(body,trim,[mounts[0],bar[0],bar[1],mounts[1]],.028);
    }
    exhaust(body,-.55,.34,stern-.025,.047);
  }
  const wheels=wheelParts(radius,trail?.28:.246,id), tires=[];
  if(trail) {
    const spare=new THREE.Group();
    for(const [geometry,material] of wheels) spare.add(new THREE.Mesh(geometry,material));
    spare.position.set(-.22,1.04,stern+.12);
    spare.rotation.y=Math.PI/2;
    body.add(spare);
    // Move the registration plate beside the rear carrier.
    body.children.find(o=>o.material===plate).position.x=.46;
  }
  for(const side of [-1,1]) for(const z of [-axle,axle]) addWheel(wheels,[side*(contours(z).width-.094),radius,z],tires,root,z<0);
  return finishModel(root,tires,brake,spec.width*1.56,stern-nose+.86);
}
