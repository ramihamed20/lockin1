export const durations={idle:Infinity,wave:2.8,explain:3.8,saved:1.9};
const clamp=x=>Math.max(0,Math.min(1,x));
export const ease=x=>{const t=clamp(x);return t*t*t*(t*(t*6-15)+10)};
const pulse=(t,a,b,c,d)=>ease((t-a)/(b-a))*(1-ease((t-c)/(d-c)));
export function sampleGesture(kind,time,character){
 const t=Math.max(0,time),girl=character==='girl',p={y:0,sx:1,sy:1,head:0,armL:0,armR:0,tail:0,tilt:0,spark:0};
 if(kind==='wave'){
  const w=pulse(t,0,.5,2.15,2.8),wave=Math.sin((t-.5)*9)*pulse(t,.4,.65,1.9,2.2);
  p.armL=(girl?82:24)*w+(girl?10:12)*wave;p.head=-3*w+1.2*wave;p.tilt=1.1*w;p.tail=5*w;p.y=-1.2*w;
 }else if(kind==='explain'){
  const a=pulse(t,0,.65,1.35,1.9),b=pulse(t,1.75,2.3,3.05,3.8);
  p.armR=-(girl?37:28)*a-(girl?23:18)*b;p.armL=(girl?9:6)*b;p.head=2*a-2.3*b;p.tail=4*a-3*b;p.y=-.8*(a+b);
 }else if(kind==='saved'){
  const crouch=pulse(t,0,.12,.16,.3),air=pulse(t,.15,.4,.55,.95),land=pulse(t,.83,.98,1.06,1.35),w=pulse(t,.12,.4,.85,1.6);
  p.y=3*crouch-13*air+2*land;p.sx=1+.025*crouch-.018*air+.025*land;p.sy=1-.045*crouch+.025*air-.035*land;
  p.armL=(girl?100:35)*w;p.armR=-(girl?100:73)*w;p.head=2.2*Math.sin(t*8)*w;p.tail=10*w;p.spark=pulse(t,.25,.5,1.05,1.8);
 }
 return p;
}
export function blendGesture(a,b,weight){const w=ease(weight);return Object.fromEntries(Object.keys(b).map(k=>[k,a[k]+(b[k]-a[k])*w]))}
