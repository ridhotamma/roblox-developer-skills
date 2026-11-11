const R = require(require('path').join(__dirname, 'ranim.cjs'));
const ends = (rig, pose, extra={}) => {
  const c = R.compile(Object.assign({name:'t', rig, grounding:'off', keys:[{t:0,pose},{t:0.5,pose}]}, extra));
  if (c.errors.length) throw new Error(c.errors.join('\n'));
  const s = R.sample(c, 0), o = {};
  for (const n of Object.keys(c.rig.ends)) { const w = s.W[n]; o[n] = [w.c[0], w.c[1], -w.c[2]].map(x=>+x.toFixed(2)); }
  return {o, s, c};
};
const show = (label, rig, pose) => console.log(label.padEnd(34), JSON.stringify(ends(rig, pose).o));
console.log('positions are [right, up, forward] of part centres');
show('R15 rest', 'R15', {});
show('R15 RightUpperArm fwd 90', 'R15', {RightUpperArm:{fwd:90}});
show('R15 RightUpperArm out 90', 'R15', {RightUpperArm:{out:90}});
show('R15 LeftUpperArm out 90', 'R15', {LeftUpperArm:{out:90}});
show('R15 R arm fwd90 out45', 'R15', {RightUpperArm:{fwd:90,out:45}});
show('R15 L arm fwd90 out45', 'R15', {LeftUpperArm:{fwd:90,out:45}});
show('R15 RightLowerArm bend 90', 'R15', {RightLowerArm:{bend:90}});
show('R15 RightLowerLeg bend 90', 'R15', {RightLowerLeg:{bend:90}});
show('R15 RightUpperLeg fwd 90', 'R15', {RightUpperLeg:{fwd:90}});
show('R15 LeftUpperLeg out 45', 'R15', {LeftUpperLeg:{out:45}});
show('R15 UpperTorso bendFwd 45', 'R15', {UpperTorso:{bendFwd:45}});
show('R15 UpperTorso turnL 90', 'R15', {UpperTorso:{turnL:90}});
show('R15 UpperTorso leanR 30', 'R15', {UpperTorso:{leanR:30}});
show('R15 root moveFwd1 moveR1 up1', 'R15', {LowerTorso:{moveFwd:1,moveR:1,moveUp:1}});
show('R15 RightFoot fwd 30 (toes up)', 'R15', {RightFoot:{fwd:30}});
show('R6 rest', 'R6', {});
show('R6 Right Arm fwd 90', 'R6', {'Right Arm':{fwd:90}});
show('R6 Left Arm out 90', 'R6', {'Left Arm':{out:90}});
show('R6 Right Leg fwd 45', 'R6', {'Right Leg':{fwd:45}});
show('R6 Torso bendFwd 30', 'R6', {Torso:{bendFwd:30}});

// twist check: right arm twistOut 90 with elbow bent 90 -> forearm should point to the RIGHT (external rotation)
show('R15 R twistOut90 + elbow 90', 'R15', {RightUpperArm:{twistOut:90}, RightLowerArm:{bend:90}});
show('R15 L twistOut90 + elbow 90', 'R15', {LeftUpperArm:{twistOut:90}, LeftLowerArm:{bend:90}});

// ---- independent check of the Motor6D export: rebuild world CFrames the way Roblox does,
//      Part1 = Part0 * C0 * Transform * C1^-1, with the real (rotated) R6 C0/C1, and compare with the authored FK.
const qmul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qinv=q=>[-q[0],-q[1],-q[2],q[3]];
const qrot=(q,v)=>{const u=[q[0],q[1],q[2]],c=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];const t=c(u,v).map(x=>2*x),k=c(u,t);return v.map((x,i)=>x+q[3]*t[i]+k[i]);};
const cfmul=(A,B)=>({q:qmul(A.q,B.q),p:qrot(A.q,B.p).map((x,i)=>x+A.p[i])});
const cfinv=A=>{const q=qinv(A.q);return {q,p:qrot(q,A.p).map(x=>-x)};};
function robloxFK(rigName, pose) {
  const {c} = ends(rigName, pose), d = R.exportData(c), P = c.rig.parts, W = {HumanoidRootPart:{q:[0,0,0,1],p:[0,3,0]}};
  const tf = {}; d.poses.forEach((p,i)=>tf[p.name]=d.frames[0].tf[i]);
  for (const n in P) {
    const r0 = P[n].r0 || [0,0,0,1];
    const C0 = {q:r0,p:P[n].c0}, C1 = {q:r0,p:P[n].c1}, T = tf[n] || {q:[0,0,0,1],p:[0,0,0]};
    W[n] = cfmul(cfmul(cfmul(W[P[n].parent], C0), T), cfinv(C1));
  }
  const s = R.sample(c, 0); let worst = 0;
  for (const n in P) { for (let i=0;i<3;i++) worst=Math.max(worst,Math.abs(W[n].p[i]-s.W[n].c[i]));
    const dq = Math.abs(W[n].q[0]*s.W[n].q[0]+W[n].q[1]*s.W[n].q[1]+W[n].q[2]*s.W[n].q[2]+W[n].q[3]*s.W[n].q[3]); worst=Math.max(worst,1-dq); }
  return worst;
}
const wild6 = {Torso:{bendFwd:25,turnL:40,leanR:-10,moveR:0.3,moveUp:0.5,moveFwd:-0.7}, Head:{turnR:30,bendBack:10,leanL:5}, 'Right Arm':{fwd:110,out:25,twistIn:30}, 'Left Arm':{back:40,out:70,twistOut:15}, 'Right Leg':{fwd:60,in:10}, 'Left Leg':{back:35,out:20,twistOut:25}};
const wild15 = {LowerTorso:{bendFwd:15,turnR:30,moveUp:-0.4,moveFwd:0.5}, UpperTorso:{turnL:45,leanR:10}, Head:{turnL:20}, RightUpperArm:{fwd:95,out:20,twistIn:40}, RightLowerArm:{bend:80}, RightHand:{fwd:20,out:10}, LeftUpperLeg:{fwd:70,out:15}, LeftLowerLeg:{bend:100}, LeftFoot:{back:30}};
console.log('\nRoblox-formula FK vs authored FK, max error  R6:', robloxFK('R6', wild6).toExponential(2), ' R15:', robloxFK('R15', wild15).toExponential(2));
// known R6 fact: raising the right arm forward is a +Z rotation of the Right Shoulder Transform, -Z for the left
const t6 = ends('R6', {'Right Arm':{fwd:90}, 'Left Arm':{fwd:90}}); const d6 = R.exportData(t6.c);
d6.poses.forEach((p,i)=>{ if(/Arm/.test(p.name)) console.log(p.name, 'Transform quaternion', d6.frames[0].tf[i].q.map(x=>+x.toFixed(3))); });
