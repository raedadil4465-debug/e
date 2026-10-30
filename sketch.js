
const W = 900, H = 660;
const FIELD = {left:60,right:840,top:100,bottom:632};
const GOAL_W = 210, GOAL_D = 26;
const GOAL_LEFT = W/2-GOAL_W/2;
const GOAL_RIGHT = W/2+GOAL_W/2;
const MAX_CONCEDED = 2;
const MAX_FOULS = 2;
const WAVE_LIMIT = 9;

const TYPES = [
  {name:'THE VAMPIRE',tag:'A blood-red blur with a taste for the goal.',
   costume:'vampire',
   col:[255,190,62],num:11,pace:3.25,sprint:5.1,
   feint:65,feintRate:2.1,shootRange:210,evade:.42,fake:.22},
  {name:'THE WEREWOLF',tag:'One moonlit howl. Then he is gone.',
   costume:'werewolf',
   col:[255,96,96],num:7,pace:4.1,sprint:6.3,
   feint:35,feintRate:1.6,shootRange:220,evade:.4,fake:.12},
  {name:'THE WITCH',tag:'Every tackle is cursed. Every feint a spell.',
   costume:'witch',
   col:[188,124,255],num:10,pace:3.4,sprint:5.2,
   feint:90,feintRate:2.7,shootRange:220,evade:.72,fake:.75},
  {name:'THE SKELETON',tag:'A bone-rattling shot from anywhere.',
   costume:'skeleton',
   col:[92,228,255],num:9,pace:3.4,sprint:4.8,
   feint:40,feintRate:1.5,shootRange:360,evade:.35,fake:.35}
];
const BOSS = {
  name:'THE GRIM REAPER',tag:'He already knows how your story ends.',
  costume:'reaper',
  col:[255,255,255],num:10,pace:4.2,sprint:6.2,
  feint:95,feintRate:2.5,shootRange:350,
  boss:true,evade:.85,fake:.85
};

// ---------- STATE ----------
let defender,attacker,ball,keeper,mate=null;
let particles=[],floaters=[],trail=[];
let state='start',waveState='intro';
let wave=0,waveScale=1,curType=TYPES[0];
let score=0,best=0,tackles=0,blocks=0,conceded=0;
let combo=0,bestCombo=0;
let introTimer=0,outroTimer=0,waveTimer=0;
let tackleCooldown=0,tackleTimer=0,tackleHit=false;
let recovery=0,lunge={x:0,y:0};
let stamina=100,exhausted=false;
let shake=0,flash=0,flashCol=[255,255,255];
let slowmo=0,netPulse=0;
let paused=false,muted=false,newBest=false,lastOutcome='';
let fouls=0,redCard=false,advantage=0;
let pitchLayer,audioCtx=null,masterGain=null,noiseBuf=null;
let gameClock=0;

// Adaptive AI tracks your habits.
let habits={tackles:0,early:0,chasing:0,camping:0};

// ---------- SETUP ----------
function setup(){
  const c=createCanvas(W,H);
  c.style('max-width','100vw');
  c.style('max-height','100vh');
  c.style('width','auto');
  c.style('height','auto');
  pixelDensity(min(2,window.devicePixelRatio||1));
  textFont('Arial');
  buildPitchLayer();
  best=loadBest();
  resetGame();
  state='start';
  window.addEventListener('blur',()=>{
    if(state==='play')paused=true;
  });
}

function draw(){
  const dt=min(deltaTime/16.667,2);
  let step=dt;
  if(slowmo>0){
    slowmo=max(0,slowmo-dt);
    step=dt*.25;
  }
  if(state==='play'&&!paused)updateGame(step);
  updateFx(dt);

  image(pitchLayer,0,0,W,H);
  drawHauntings();
  push();
  if(shake>.3)translate(random(-shake,shake),random(-shake,shake));
  drawIndicators();
  drawGoal();
  drawKeeper();
  drawShotTrail();
  if(mate)drawAttacker(mate);
  if(attacker.y<defender.y){
    drawAttacker();
    drawDefender();
  }else{
    drawDefender();
    drawAttacker();
  }
  drawBall();
  drawParticles();
  drawFloaters();
  pop();

  if(flash>0){
    noStroke();
    fill(...flashCol,flash*3.2);
    rect(0,0,W,H);
  }
  drawHud();
  if(state==='play'&&waveState==='intro')drawBanner();
  if(state==='start')drawStartScreen();
  else if(state==='over')drawOverScreen();
  else if(paused)drawPauseScreen();
}

function updateFx(dt){
  shake*=pow(.86,dt);
  flash=max(0,flash-3*dt);
  netPulse=max(0,netPulse-.025*dt);
  for(let i=particles.length-1;i>=0;i--){
    let p=particles[i];
    p.x+=p.vx*dt;p.y+=p.vy*dt;
    p.vx*=pow(p.drag,dt);
    p.vy*=pow(p.drag,dt);
    p.life-=dt;
    if(p.life<=0)particles.splice(i,1);
  }
  for(let i=floaters.length-1;i>=0;i--){
    let f=floaters[i];
    f.y-=.7*dt;f.life-=dt;
    if(f.life<=0)floaters.splice(i,1);
  }
  if(!(ball&&ball.shot)&&trail.length)trail.shift();
}

// ---------- GAME FLOW ----------
function resetGame(){
  wave=0;score=0;tackles=0;blocks=0;
  conceded=0;combo=0;bestCombo=0;
  fouls=0;redCard=false;advantage=0;mate=null;
  stamina=100;exhausted=false;paused=false;newBest=false;
  tackleCooldown=0;tackleTimer=0;recovery=0;
  slowmo=0;shake=0;flash=0;netPulse=0;
  particles=[];floaters=[];trail=[];
  habits={tackles:0,early:0,chasing:0,camping:0};
  gameClock=0;
  defender={x:450,y:400,vx:0,vy:0,face:-HALF_PI,run:0};
  keeper={x:450,y:FIELD.top+16,reaction:0,diving:0};
  ball={x:450,y:520,vx:0,vy:0,free:false,shot:false,spin:0};
  attacker=makeAttacker(TYPES[0]);
  startWave();
}

function typeForWave(w){
  if(w%5===0)return BOSS;
  return TYPES[(w-1-floor((w-1)/5))%TYPES.length];
}

function makeAttacker(type){
  return {
    x:450+random(-170,170),y:FIELD.bottom-40,
    vx:random(-.5,.5),vy:-1,face:-HALF_PI,
    phase:random(TWO_PI),feintDir:random()<.5?-1:1,
    feintTimer:random(20,45),sprinting:false,
    sprintTimer:random(20,55),burstCd:50,
    touch:random(TWO_PI),run:0,state:'run',
    down:0,windup:0,aimX:450,hasBall:true,
    celebrate:0,type,jink:0,passCd:45,
    fake:false,noShoot:0,windupMax:12,
    side:random()<.5?-1:1,dodgeCd:0
  };
}

function startWave(){
  wave++;
  curType=typeForWave(wave);
  waveScale=min(1.65,1.12+.045*(wave-1));
  attacker=makeAttacker(curType);
  attacker.y=max(FIELD.top+270,FIELD.bottom-65-advantage);
  advantage=0;mate=null;

  const chance=curType.boss?1:
    wave>=2?min(.9,.25+wave*.065):0;

  if(random()<chance){
    mate=makeAttacker(curType);
    mate.hasBall=false;
    mate.side=-attacker.side;
    mate.type={...curType,num:(curType.num%11)+1};
    mate.x=constrain(attacker.x+mate.side*160,
      FIELD.left+40,FIELD.right-40);
    mate.y=attacker.y-35;
  }

  defender.x=450;defender.y=390;
  defender.vx=0;defender.vy=0;defender.face=-HALF_PI;
  keeper.x=450;keeper.reaction=0;keeper.diving=0;
  ball={x:attacker.x,y:attacker.y-15,vx:0,vy:0,
    free:false,shot:false,spin:0,pass:false};
  trail=[];
  tackleCooldown=0;tackleTimer=0;recovery=0;
  waveTimer=0;introTimer=65;waveState='intro';
  sfx('wave');
}

function endWave(outcome,delay=70){
  if(waveState==='outro')return;
  waveState='outro';
  lastOutcome=outcome;
  outroTimer=delay;
}

function startOrRestart(){
  initAudio();
  resetGame();
  state='play';
  sfx('whistle');
}

function gameOver(){
  state='over';
  if(score>best){
    best=score;newBest=true;saveBest(best);
  }
  sfx('end');
}

// ---------- MAIN UPDATE ----------
function updateGame(step){
  gameClock+=step/60;
  tackleCooldown=max(0,tackleCooldown-step);
  recovery=max(0,recovery-step);
  updateDefender(step);
  updateKeeper(step);

  if(waveState==='intro'){
    introTimer-=step;
    carryBall(step);
    if(introTimer<=0){
      waveState='live';
      sfx('whistle');
    }
  }else if(waveState==='live'){
    waveTimer+=step/60;
    updateAttacker(step);
    if(mate)updateRunner(mate,step);
    updateBall(step);
    if(defender.y<FIELD.top+175)habits.camping+=step;
    if(dist(defender.x,defender.y,attacker.x,attacker.y)<85)
      habits.chasing+=step;
  }else{
    updateAttackerOutro(step);
    updateBall(step);
    outroTimer-=step;
    if(outroTimer<=0){
      if(conceded>=MAX_CONCEDED||redCard)gameOver();
      else startWave();
    }
  }
}

function moveInput(){
  let mx=0,my=0;
  if(keyIsDown(LEFT_ARROW)||keyIsDown(65))mx--;
  if(keyIsDown(RIGHT_ARROW)||keyIsDown(68))mx++;
  if(keyIsDown(UP_ARROW)||keyIsDown(87))my--;
  if(keyIsDown(DOWN_ARROW)||keyIsDown(83))my++;
  return {mx,my};
}

function updateDefender(step){
  const d=defender;
  if(tackleTimer>0){
    const k=.35+tackleTimer/9;
    d.vx=lunge.x*k;d.vy=lunge.y*k;
    tackleTimer-=step;

    if(!tackleHit&&waveState==='live'&&
       attacker.hasBall&&attacker.down<=0){
      const reach=ballExposed()?25:11;
      if(dist(d.x,d.y,ball.x,ball.y)<reach)
        winBall();
    }
    if(!tackleHit&&waveState==='live'&&
       attacker.hasBall&&attacker.down<=0&&
       dist(d.x,d.y,attacker.x,attacker.y)<25)
      commitFoul();

    if(tackleTimer<=0){
      tackleTimer=0;
      if(!tackleHit){
        recovery=48;
        addFloater('MISSED',d.x,d.y-36,[255,200,120],14);
        sfx('miss');
      }
    }
  }else{
    const {mx,my}=moveInput();
    const moving=mx!==0||my!==0;
    const wantSprint=moving&&keyIsDown(SHIFT)&&!exhausted;

    if(wantSprint&&stamina>0){
      stamina=max(0,stamina-.85*step);
      if(stamina<=0)exhausted=true;
    }else{
      stamina=min(100,stamina+.13*step);
      if(exhausted&&stamina>40)exhausted=false;
    }
    const sprinting=wantSprint&&stamina>0;
    const speed=(sprinting?4.35:2.95)*
      (recovery>0?.32:1);

    if(moving){
      const m=Math.hypot(mx,my);
      const tx=mx/m*speed,ty=my/m*speed;
      d.vx=lerp(d.vx,tx,min(1,.35*step));
      d.vy=lerp(d.vy,ty,min(1,.35*step));
      d.face=angLerp(d.face,atan2(d.vy,d.vx),
        min(1,.3*step));
      if(sprinting&&frameCount%4===0)dust(d.x,d.y+12,1);
    }else{
      d.vx*=pow(.72,step);d.vy*=pow(.72,step);
    }
  }
  d.x=constrain(d.x+d.vx*step,FIELD.left+16,FIELD.right-16);
  d.y=constrain(d.y+d.vy*step,FIELD.top+46,FIELD.bottom-14);
  d.run+=Math.hypot(d.vx,d.vy)*.11*step;
}

function updateKeeper(step){
  const k=keeper;
  let target,speed=1.65;
  if(ball.shot){
    const t=(ball.y-FIELD.top)/max(.001,-ball.vy);
    target=ball.x+ball.vx*t;
    if(k.reaction>0){
      k.reaction-=step;
      target=k.x;
    }else{
      speed=3.6;
      k.diving=12;
    }
  }else{
    const ax=attacker&&attacker.hasBall?attacker.x:450;
    target=lerp(450,ax,.5);
  }
  target=constrain(target,GOAL_LEFT+22,GOAL_RIGHT-22);
  k.x+=constrain(target-k.x,-speed*step,speed*step);
  k.diving=max(0,k.diving-step);
}

// ---------- INTELLIGENT AI ----------
function predictDefender(frames=12){
  return {
    x:constrain(defender.x+defender.vx*frames*.65,
      FIELD.left+16,FIELD.right-16),
    y:constrain(defender.y+defender.vy*frames*.65,
      FIELD.top+46,FIELD.bottom-14)
  };
}

function chooseAttackLane(a){
  const future=predictDefender(14);
  const left=350,right=550;
  const leftDanger=abs(future.x-left);
  const rightDanger=abs(future.x-right);
  let lane=leftDanger>rightDanger?left:right;

  // Punish defenders who camp in the box.
  if(habits.camping>150&&defender.y<280){
    lane=defender.x<450?570:330;
  }
  return lane;
}

function dodgeTackle(a){
  if(tackleTimer<=0||tackleHit)return false;
  const futureX=defender.x+lunge.x*4;
  const futureY=defender.y+lunge.y*4;
  if(dist(a.x,a.y,futureX,futureY)>105)return false;

  const side=a.x>=defender.x?1:-1;
  a.vx=side*(6.8+min(2,wave*.08));
  a.vy=-max(3.2,a.type.pace);
  a.x=constrain(a.x+side*13,FIELD.left+20,FIELD.right-20);
  a.y-=5;
  a.jink=18;a.sprinting=true;a.sprintTimer=25;
  a.burstCd=70;a.feintDir=side;a.dodgeCd=32;
  addFloater('READ YOUR TACKLE!',a.x,a.y-42,
    [255,110,110],14);
  return true;
}

function ballExposed(){return carryOffset()>24;}

function carryOffset(){
  const a=attacker;
  if(a.windup>0)return 13;
  return 15+15*max(0,sin(a.touch))+(a.sprinting?3:0);
}

function carryBall(step){
  const a=attacker;
  if(!a.hasBall)return;
  const off=carryOffset();
  ball.x=a.x+cos(a.face)*off;
  ball.y=a.y+sin(a.face)*off;
  ball.spin+=off*.01*step;
}

function updateAttacker(step){
  const a=attacker,T=a.type;
  a.run+=Math.hypot(a.vx,a.vy)*.12*step;

  if(a.down>0){
    a.down-=step;
    a.vx*=pow(.9,step);a.vy*=pow(.9,step);
    return;
  }
  if(a.state==='kicked'){
    a.celebrate=max(0,a.celebrate-step);
    a.vx*=pow(.85,step);a.vy*=pow(.85,step);
    a.x+=a.vx*step;a.y+=a.vy*step;
    return;
  }
  if(!a.hasBall){updateRunner(a,step);return;}

  a.dodgeCd=max(0,a.dodgeCd-step);
  if(tackleTimer>0&&a.dodgeCd<=0){
    const chance=T.evade*.13*step;
    if(random()<chance&&dodgeTackle(a)){
      carryBall(step);
      return;
    }
  }

  if(a.jink>0)a.jink-=step;
  else a.touch+=step*(a.sprinting?.3:.2);

  const dxD=a.x-defender.x,dyD=a.y-defender.y;
  const dD=max(.001,Math.hypot(dxD,dyD));
  const panic=waveTimer>WAVE_LIMIT*.7;

  if(a.windup>0){
    a.windup-=step;
    a.vx*=pow(.8,step);a.vy*=pow(.8,step);
    a.face=angLerp(a.face,
      atan2(FIELD.top-a.y,a.aimX-a.x),.4*step);
    carryBall(step);

    if(a.fake&&a.windup>0&&
       a.windup<a.windupMax*.5){
      const dir=a.x>=defender.x?1:-1;
      a.windup=0;a.fake=false;a.noShoot=30;
      a.jink=12;a.sprinting=true;a.sprintTimer=28;
      a.burstCd=100;a.feintDir=dir;
      a.vx=dir*6.5;
      addFloater('DUMMY!',a.x,a.y-38,[255,226,140],14);
      return;
    }
    if(a.windup<=0)shoot();
    return;
  }

  a.feintTimer-=step;a.sprintTimer-=step;
  a.burstCd-=step;a.noShoot-=step;a.passCd-=step;

  if(a.feintTimer<=0){
    a.feintDir=random()<.5?-1:1;
    a.feintTimer=random(18,42);
  }
  if(a.sprintTimer<=0){
    a.sprinting=!a.sprinting;
    a.sprintTimer=a.sprinting?random(20,35):random(25,55);
  }
  if(dD<110&&a.burstCd<=0){
    a.sprinting=true;a.sprintTimer=28;a.burstCd=85;
    a.feintDir=dxD>=0?1:-1;
  }

  const lane=lerp(
    450+sin(gameClock*1.8+a.phase)*90,
    chooseAttackLane(a),.78
  );
  const feint=sin(gameClock*6.5*T.feintRate+a.phase)*
    T.feint*a.feintDir;
  let avoid=0;
  if(dD<150&&defender.y<a.y+35)
    avoid=(dxD>=0?1:-1)*(150-dD)*1.35;

  const targetX=constrain(lane+feint+avoid,
    FIELD.left+35,FIELD.right-35);
  const desiredX=constrain((targetX-a.x)*.14,
    -4.5*waveScale,4.5*waveScale);

  let pace=(a.sprinting?T.sprint:T.pace)*waveScale;
  if(dD<70&&defender.y<a.y)pace*=1.12;
  if(panic)pace=T.sprint*waveScale;

  a.vx=lerp(a.vx,desiredX,min(1,.16*step));
  a.vy=lerp(a.vy,-pace,min(1,.085*step));
  a.x=constrain(a.x+a.vx*step,FIELD.left+20,FIELD.right-20);
  a.y+=a.vy*step;

  if(dD<20){
    a.x+=(dxD/dD)*(20-dD)*.5;
    a.y+=(dyD/dD)*(20-dD)*.5;
  }
  a.face=angLerp(a.face,atan2(a.vy,a.vx),
    min(1,.24*step));
  if(a.sprinting&&frameCount%4===0)dust(a.x,a.y+12,1);
  carryBall(step);

  // Fast passes under pressure.
  if(mate&&a.passCd<=0&&dD<125&&
     defender.y<a.y+35&&random()<.12*step){
    passBall();
    return;
  }

  // Shooting decisions.
  const inRange=a.y<FIELD.top+T.shootRange;
  if(a.noShoot<=0&&
    (inRange||(panic&&a.y<FIELD.top+T.shootRange+150))){
    const tooClose=a.y<FIELD.top+40;
    const laneDist=pointSegDist(defender.x,defender.y,
      ball.x,ball.y,450,FIELD.top);
    const blocked=laneDist<20&&defender.y<a.y&&
      !tooClose&&!panic;
    if(!blocked)beginShot();
  }

  // Hard time limit: shoot regardless of position.
  if(waveTimer>=WAVE_LIMIT&&a.hasBall&&
     a.windup<=0&&a.noShoot<=0&&a.state!=='kicked')
    beginShot();
}

function beginShot(){
  const a=attacker;
  a.windupMax=max(5,(a.type.boss?8:12)-wave*.3);
  a.windup=a.windupMax;

  const pressure=dist(a.x,a.y,defender.x,defender.y);
  a.fake=pressure<180&&random()<min(.92,
    (a.type.fake||.15)+wave*.018);

  const side=keeper.x>=450?-1:1;
  a.aimX=450+side*random(GOAL_W*.35,GOAL_W/2-9);
  if(random()<.22)
    a.aimX=450-side*random(25,65);
  sfx('windup');
}

function shoot(){
  const a=attacker;
  a.windup=0;a.state='kicked';a.hasBall=false;
  a.celebrate=20;
  const sp=min(20,14.5+wave*.28);
  const ang=atan2(FIELD.top-6-ball.y,a.aimX-ball.x);
  ball.free=true;ball.shot=true;ball.pass=false;
  ball.vx=cos(ang)*sp;ball.vy=sin(ang)*sp;
  keeper.reaction=max(8,15-wave*.25);
  shake=max(shake,3);
  sfx('kick');
}

function updateRunner(p,step){
  const T=p.type;
  const tx=constrain(450+p.side*150+
    sin(gameClock*1.5+p.phase)*55,
    FIELD.left+40,FIELD.right-40);
  const ty=max(FIELD.top+105,ball.y-65);
  const dvx=constrain((tx-p.x)*.11,-4.5,4.5);
  const dvy=constrain((ty-p.y)*.085,
    -T.sprint*waveScale,T.sprint*waveScale);
  p.vx=lerp(p.vx,dvx,min(1,.15*step));
  p.vy=lerp(p.vy,dvy,min(1,.15*step));
  p.x=constrain(p.x+p.vx*step,FIELD.left+20,FIELD.right-20);
  p.y+=p.vy*step;
  p.face=angLerp(p.face,
    Math.hypot(p.vx,p.vy)>.3?atan2(p.vy,p.vx):-HALF_PI,
    min(1,.2*step));
  p.run+=Math.hypot(p.vx,p.vy)*.12*step;
}

function updateAttackerOutro(step){
  const a=attacker;
  a.run+=Math.hypot(a.vx,a.vy)*.12*step;
  if(a.down>0)a.down-=step;
  a.vx*=pow(.9,step);a.vy*=pow(.9,step);
  a.x+=a.vx*step;a.y+=a.vy*step;
  if(a.state==='celebrate')a.celebrate+=step;
}

// ---------- BALL PHYSICS ----------
function updateBall(step){
  const b=ball;
  if(!b.free){carryBall(step);return;}
  const oldX=b.x,oldY=b.y;
  b.x+=b.vx*step;b.y+=b.vy*step;
  b.spin+=Math.hypot(b.vx,b.vy)*.08*step;

  if(b.pass){
    if(!mate){b.pass=false;return;}
    b.passTimer-=step;
    const ang=atan2(mate.y-b.y,mate.x-b.x);
    b.vx=cos(ang)*10;b.vy=sin(ang)*10;
    if(pointSegDist(defender.x,defender.y,
       oldX,oldY,b.x,b.y)<17+(tackleTimer>0?8:0)){
      interceptPass();return;
    }
    if(dist(b.x,b.y,mate.x,mate.y)<18||b.passTimer<=0)
      receivePass();
    return;
  }

  if(b.shot){
    trail.push({x:b.x,y:b.y});
    if(trail.length>10)trail.shift();

    const reach=17+(tackleTimer>0?10:0);
    if(pointSegDist(defender.x,defender.y,
       oldX,oldY,b.x,b.y)<reach){
      blockShot();return;
    }

    // Continuous keeper collision: fast shots cannot
    // skip straight through the goalkeeper.
    const ky=keeper.y+5;
    if(oldY>=ky&&b.y<=ky){
      const t=constrain((oldY-ky)/(oldY-b.y||1),0,1);
      const crossX=lerp(oldX,b.x,t);
      const kReach=keeper.diving>0?31:23;
      if(abs(crossX-keeper.x)<kReach){
        b.x=crossX;b.y=ky;
        saveShot();return;
      }
    }

    if(b.y<=FIELD.top){
      const t=constrain((oldY-FIELD.top)/
        (oldY-b.y||1),0,1);
      const crossX=lerp(oldX,b.x,t);
      b.x=crossX;b.y=FIELD.top;
      if(crossX>GOAL_LEFT+4&&crossX<GOAL_RIGHT-4)
        concedeGoal();
      else wideShot();
      return;
    }
  }else{
    b.vx*=pow(.97,step);b.vy*=pow(.97,step);
    if(b.x<FIELD.left+6||b.x>FIELD.right-6){
      b.vx*=-.6;
      b.x=constrain(b.x,FIELD.left+6,FIELD.right-6);
    }
    if(b.y>FIELD.bottom-6){
      b.vy*=-.6;b.y=FIELD.bottom-6;
    }
    if(b.y<FIELD.top+8&&waveState!=='outro'){
      b.vy*=-.6;b.y=FIELD.top+8;
    }
  }
}

// ---------- TACKLES / PASSES ----------
function attemptTackle(){
  if(state!=='play'||paused||waveState!=='live')return;
  if(tackleCooldown>0||tackleTimer>0||recovery>0)return;

  tackleCooldown=65;tackleTimer=9;tackleHit=false;
  habits.tackles++;
  const d=defender;
  let dir=d.face;

  if((attacker.hasBall||ball.free)&&
     dist(d.x,d.y,ball.x,ball.y)<160)
    dir=atan2(ball.y-d.y,ball.x-d.x);

  d.face=dir;
  lunge={x:cos(dir)*7.2,y:sin(dir)*7.2};
  sfx('lunge');

  const a=attacker;
  if(a.hasBall&&a.windup<=0&&a.down<=0&&
     dist(d.x,d.y,a.x,a.y)<110){
    const chance=(a.type.evade||.15)+min(.2,wave*.01);
    if(random()<chance*(ballExposed()?.35:1)){
      habits.early++;
      doJink();
    }
  }
}

function doJink(){
  const a=attacker;
  const sgn=a.x>=defender.x?1:-1;
  a.jink=16;a.touch=-HALF_PI;
  a.sprinting=true;a.sprintTimer=26;a.burstCd=90;
  a.vx=sgn*6.5;a.feintDir=sgn;
  a.dodgeCd=28;
  addFloater('SKIPPED PAST',a.x,a.y-38,
    [255,200,120],13);
}

function passBall(){
  const a=attacker,m=mate;
  if(!m||dist(m.x,m.y,defender.x,defender.y)<65)return;
  a.hasBall=false;a.passCd=100;
  ball.free=true;ball.shot=false;
  ball.pass=true;ball.passTimer=65;
  const ang=atan2(m.y-ball.y,m.x-ball.x);
  ball.vx=cos(ang)*10;ball.vy=sin(ang)*10;
  sfx('pass');
}

function receivePass(){
  ball.pass=false;ball.free=false;
  ball.vx=0;ball.vy=0;
  const old=attacker;
  attacker=mate;mate=old;
  curType=attacker.type;
  attacker.hasBall=true;
  attacker.touch=-HALF_PI;
  attacker.passCd=55;
  attacker.noShoot=0;
  mate.hasBall=false;
}

function interceptPass(){
  ball.pass=false;
  ball.vx=random(-3,3);ball.vy=random(1,3);
  combo++;bestCombo=max(bestCombo,combo);tackles++;
  const pts=round(125*mult());
  score+=pts;
  addFloater('INTERCEPTED! +'+pts,
    defender.x,defender.y-40,[163,255,194],17);
  burst(ball.x,ball.y,[164,255,203],20,4);
  shake=8;slowmo=18;flash=7;
  flashCol=[140,255,190];
  sfx('tackle');
  endWave('tackle',60);
}

// ---------- OUTCOMES ----------
function mult(){return 1+.25*min(combo-1,8);}

function winBall(){
  tackleHit=true;
  const perfect=attacker.windup>0;
  attacker.hasBall=false;attacker.down=55;
  attacker.windup=0;attacker.state='down';
  ball.free=true;ball.shot=false;ball.pass=false;
  ball.vx=random(-5,5);ball.vy=random(1,3);
  combo++;bestCombo=max(bestCombo,combo);tackles++;
  const pts=round((100+(perfect?75:0))*mult());
  score+=pts;
  addFloater((perfect?'WELL TIMED! +':'CLEAN TACKLE +')+pts,
    defender.x,defender.y-40,[163,255,194],17);
  burst(ball.x,ball.y,[164,255,203],22,4.5);
  shake=9;slowmo=22;flash=8;
  flashCol=[140,255,190];
  sfx('tackle');
  endWave('tackle',60);
}

function blockShot(){
  ball.shot=false;
  ball.vx=random(-4,4);ball.vy=random(3,6);
  combo++;bestCombo=max(bestCombo,combo);blocks++;
  const pts=round(150*mult());
  score+=pts;
  addFloater('BLOCKED! +'+pts,
    defender.x,defender.y-40,[120,220,255],18);
  burst(ball.x,ball.y,[140,225,255],20,4);
  shake=8;slowmo=18;flash=7;
  flashCol=[120,210,255];
  sfx('block');
  endWave('block',60);
}

function saveShot(){
  ball.shot=false;
  ball.vx=random(-3,3);ball.vy=random(3,5);
  addFloater('KEEPER SAVES',450,FIELD.top+70,
    [255,235,140],16);
  burst(ball.x,ball.y,[255,240,160],12,3);
  shake=4;sfx('save');
  endWave('save',60);
}

function wideShot(){
  ball.shot=false;
  addFloater('WIDE!',450,FIELD.top+70,
    [255,200,120],16);
  sfx('miss');
  endWave('wide',55);
}

function concedeGoal(){
  conceded++;combo=0;
  ball.shot=false;
  ball.vx*=.15;ball.vy=-.5;
  attacker.state='celebrate';attacker.celebrate=0;
  netPulse=1;shake=15;slowmo=34;
  flash=22;flashCol=[255,80,70];
  burst(ball.x,FIELD.top,[255,255,255],26,5);
  addFloater('GOAL CONCEDED',450,FIELD.top+90,
    [255,130,110],24);
  sfx('goal');
  endWave('goal',95);
}

// ---------- FOULS ----------
function commitFoul(){
  tackleHit=true;fouls++;combo=0;
  const a=attacker;
  const inBox=a.y<FIELD.top+150&&abs(a.x-450)<200;
  shake=8;flash=10;flashCol=[255,220,80];
  slowmo=14;sfx('foul');

  if(fouls>=MAX_FOULS){
    redCard=true;
    addFloater('RED CARD!',a.x,a.y-44,
      [255,90,80],26);
    a.hasBall=false;a.down=50;a.state='down';
    ball.free=true;ball.shot=false;
    ball.vx=0;ball.vy=0;
    endWave('red',90);
    return;
  }

  addFloater(inBox?'FOUL: PENALTY!':'FOUL! YELLOW CARD',
    a.x,a.y-44,[255,226,90],20);
  a.down=40;
  if(inBox)penalty();
  else{
    a.hasBall=false;a.state='down';
    ball.free=true;ball.vx=0;ball.vy=0;
    advantage=110;
    endWave('foul',75);
  }
}

function penalty(){
  const a=attacker;
  mate=null;
  a.hasBall=false;a.down=0;
  a.state='kicked';a.celebrate=20;a.windup=0;
  a.x=450;a.y=FIELD.top+132;
  a.vx=0;a.vy=0;a.face=-HALF_PI;
  defender.x=570;defender.y=FIELD.top+215;
  defender.vx=0;defender.vy=0;
  ball.x=450;ball.y=FIELD.top+108;
  ball.free=true;ball.shot=true;ball.pass=false;
  const side=random()<.5?-1:1;
  const tx=450+side*random(35,GOAL_W/2-12);
  const ang=atan2(FIELD.top-6-ball.y,tx-ball.x);
  ball.vx=cos(ang)*15;ball.vy=sin(ang)*15;
  keeper.reaction=10;
  sfx('kick');
}

// ---------- EFFECTS ----------
function burst(x,y,col,n,spd){
  for(let i=0;i<n;i++){
    const a=random(TWO_PI),s=random(1,spd);
    particles.push({x,y,vx:cos(a)*s,vy:sin(a)*s,
      life:random(18,36),max:36,col,
      size:random(3,6),drag:.96});
  }
}

function dust(x,y,n){
  for(let i=0;i<n;i++)
    particles.push({
      x:x+random(-4,4),y,
      vx:random(-.3,.3),vy:random(-.2,.3),
      life:random(12,20),max:20,
      col:[210,255,210],size:random(2,4),
      drag:.95,soft:true
    });
}

function addFloater(txt,x,y,col,size=16){
  floaters.push({
    text:txt,x:constrain(x,120,W-120),y,
    col,size,life:60,max:60
  });
}

// ---------- PITCH ----------
function buildPitchLayer(){
  const g=createGraphics(W,H);
  g.pixelDensity(min(2,window.devicePixelRatio||1));
  g.background(13,8,22);
  g.noStroke();
  randomSeed(11);

  const crowd=[
    [255,125,54],[174,92,235],[255,220,112],
    [226,220,202],[135,220,122],[214,70,94]
  ];
  for(let i=0;i<1900;i++){
    const x=random(W),y=random(H);
    const inside=x>FIELD.left-14&&x<FIELD.right+14&&
      y>FIELD.top-GOAL_D-12&&y<FIELD.bottom+14;
    if(inside||y<66)continue;
    const c=random(crowd);
    g.fill(12,8,20,180);
    g.ellipse(x,y+3,random(4,7),random(5,8));
    g.fill(c[0],c[1],c[2],random(100,210));
    g.ellipse(x,y,random(3,5.5));
  }

  // Blood moon and distant haunted-house silhouettes.
  g.fill(255,92,54,34);
  g.ellipse(W-150,110,142,142);
  g.fill(255,210,120,190);
  g.ellipse(W-150,110,88,88);
  g.fill(255,230,180,75);
  g.ellipse(W-150,110,120,120);
  g.noStroke();g.fill(18,9,22,220);
  g.rect(65,49,46,46);g.triangle(58,50,88,25,118,50);
  g.rect(728,57,51,39);g.triangle(720,58,753,31,787,58);
  g.fill(255,132,55,210);
  g.rect(80,63,7,12);g.rect(95,63,7,12);
  g.rect(742,67,8,12);g.rect(759,67,8,12);

  g.fill(30,18,39);
  g.rect(FIELD.left-14,FIELD.top-GOAL_D-12,
    FIELD.right-FIELD.left+28,
    FIELD.bottom-FIELD.top+GOAL_D+26,10);
  g.fill(70,34,41);
  g.rect(FIELD.left-8,FIELD.top-GOAL_D-6,
    FIELD.right-FIELD.left+16,
    FIELD.bottom-FIELD.top+GOAL_D+14,6);

  g.fill(45,34,66);
  g.rect(FIELD.left,FIELD.top-GOAL_D,
    FIELD.right-FIELD.left,
    FIELD.bottom-FIELD.top+GOAL_D);

  const sh=(FIELD.bottom-FIELD.top)/12;
  for(let i=0;i<12;i++){
    if(i%2===0){
      g.fill(167,112,211,15);
      g.rect(FIELD.left,FIELD.top+i*sh,
        FIELD.right-FIELD.left,sh);
    }
  }
  for(let i=0;i<1600;i++){
    g.fill(random()<.5?210:135,random()<.5?95:170,
      random()<.5?82:205,10);
    g.rect(random(FIELD.left,FIELD.right),
      random(FIELD.top,FIELD.bottom),2,random(2,5));
  }

  g.noFill();g.stroke(190,151,216,190);g.strokeWeight(2);
  g.rect(FIELD.left,FIELD.top,
    FIELD.right-FIELD.left,FIELD.bottom-FIELD.top);
  g.rect(250,FIELD.top,400,150);
  g.rect(350,FIELD.top,200,52);
  g.arc(450,FIELD.top+108,130,90,0,PI);
  g.arc(450,FIELD.bottom,150,150,PI,TWO_PI);
  g.arc(FIELD.left,FIELD.top,26,26,0,HALF_PI);
  g.arc(FIELD.right,FIELD.top,26,26,HALF_PI,PI);
  g.noStroke();g.fill(255,140,66,230);
  g.ellipse(450,FIELD.top+108,6);

  // Tiny gravestones, jack-o'-lanterns and webs frame the pitch.
  for(let x=14;x<58;x+=22){
    g.fill(54,48,66,240);
    g.rect(x,210,13,22,3);g.arc(x+6.5,210,13,13,PI,TWO_PI);
    g.stroke(255,155,90,160);g.strokeWeight(1);
    g.line(x+6.5,216,x+6.5,225);g.line(x+3,220,x+10,220);
    g.noStroke();
  }
  for(let x=846;x<890;x+=22){
    g.fill(54,48,66,240);
    g.rect(x,410,13,22,3);g.arc(x+6.5,410,13,13,PI,TWO_PI);
    g.stroke(255,155,90,160);g.strokeWeight(1);
    g.line(x+6.5,416,x+6.5,425);g.line(x+3,420,x+10,420);
    g.noStroke();
  }
  for(const x of [25,875]){
    g.fill(245,108,38,235);g.ellipse(x,568,22,19);
    g.fill(30,12,22);g.triangle(x-7,564,x-3,570,x-9,570);
    g.triangle(x+7,564,x+3,570,x+9,570);
    g.triangle(x-2,573,x+2,573,x,577);
    g.fill(115,190,72);g.rect(x-2,555,4,6);
  }
  g.stroke(210,186,225,145);g.strokeWeight(1);
  for(const x of [8,892]){
    g.line(x,66,x,112);g.line(x,66,x+28,66);
    g.line(x,66,x+26,88);g.line(x,66,x+28,108);
    g.line(x,66,x+14,82);g.line(x+28,66,x+14,82);
    g.line(x+14,82,x,66);
  }
  const ctx=g.drawingContext;
  const gr=ctx.createRadialGradient(450,H*.48,H*.28,
    450,H*.48,H*.95);
  gr.addColorStop(0,'rgba(20,12,24,0)');
  gr.addColorStop(1,'rgba(13,7,23,0.72)');
  ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
  pitchLayer=g;
}

// ---------- WORLD DRAWING ----------
function drawHauntings(){
  const t=frameCount;
  for(let i=0;i<7;i++){
    const x=((t*(.8+i*.08)+i*143)%(W+80))-40;
    const y=76+sin(t*.035+i*2)*10+(i%3)*7;
    drawBat(x,y,.65+(i%3)*.12,180);
  }
  const wisps=[
    [31,157,1,.65],[870,184,.9,.52],
    [31,350,.82,.48],[870,315,1,.62],
    [31,506,1,.56],[870,520,.82,.5]
  ];
  for(let i=0;i<wisps.length;i++){
    const w=wisps[i];
    drawGhost(w[0]+sin(t*.025+i)*4,
      w[1]+sin(t*.04+i*2)*5,w[2],w[3]);
  }
}

function drawBat(x,y,s,alpha){
  push();translate(x,y);scale(s);
  const flap=sin(frameCount*.32+x)*5;
  noStroke();fill(18,10,26,alpha);
  ellipse(0,0,9,13);
  triangle(-2,0,-15,-7-flap,-12,6);
  triangle(2,0,15,-7+flap,12,6);
  triangle(-1,-3,-9,-12,-6,-1);
  triangle(1,-3,9,-12,6,-1);
  fill(255,118,55,alpha);
  ellipse(-2,-2,1.5);ellipse(2,-2,1.5);
  pop();
}

function drawGhost(x,y,s,alpha){
  push();translate(x,y);scale(s);
  const bob=sin(frameCount*.08+x)*2;
  noStroke();fill(210,223,236,alpha*120);
  ellipse(0,bob,24,28);
  rect(-12,bob,24,22);
  for(let i=0;i<4;i++)
    ellipse(-9+i*6,bob+20+sin(frameCount*.12+i)*2,7,7);
  fill(23,14,34,alpha*220);
  ellipse(-4,bob-1,3,5);ellipse(4,bob-1,3,5);
  arc(0,bob+6,5,4,0,PI);
  pop();
}

function drawIndicators(){
  if(state!=='play')return;
  if(waveState==='live'||waveState==='intro'){
    const y=FIELD.top+curType.shootRange;
    stroke(255,120,100,70);strokeWeight(2);
    for(let x=FIELD.left+6;x<FIELD.right-6;x+=22)
      line(x,y,x+10,y);
    noStroke();fill(255,130,110,110);
    textAlign(LEFT,CENTER);textSize(9);textStyle(BOLD);
    text('DANGER ZONE',FIELD.left+8,y-8);
    textStyle(NORMAL);
  }
  if(waveState==='live'&&attacker.windup>0){
    const p=1-attacker.windup/attacker.windupMax;
    stroke(255,70,60,120+100*sin(frameCount*.6));
    strokeWeight(2+p*4);
    line(ball.x,ball.y,attacker.aimX,FIELD.top);
    noStroke();fill(255,70,60,140);
    ellipse(attacker.aimX,FIELD.top,12);
  }
  if(waveState==='live'&&attacker.hasBall&&
     attacker.down<=0&&ballExposed()){
    noFill();stroke(120,255,170,200);strokeWeight(2);
    ellipse(ball.x,ball.y,26+sin(frameCount*.5)*3);
    noStroke();
  }
}

function drawGoal(){
  const gx=GOAL_LEFT,gy=FIELD.top-GOAL_D;
  noStroke();fill(20,14,18,85);
  rect(gx,gy,GOAL_W,GOAL_D);
  stroke(255,175,110,60+netPulse*140);
  strokeWeight(1);
  const wob=netPulse*sin(frameCount*.9)*4;
  for(let x=gx;x<=gx+GOAL_W;x+=10)
    line(x+wob,gy,x+wob*.4,gy+GOAL_D);
  for(let y=gy;y<=gy+GOAL_D;y+=8)
    line(gx,y,gx+GOAL_W,y+wob*.3);
  noFill();stroke(255,200,140);strokeWeight(5);
  beginShape();
  vertex(gx,FIELD.top);vertex(gx,gy);
  vertex(gx+GOAL_W,gy);vertex(gx+GOAL_W,FIELD.top);
  endShape();
  noStroke();fill(255,200,120);
  ellipse(gx,FIELD.top,9);
  ellipse(gx+GOAL_W,FIELD.top,9);
}

function drawPlayer(x,y,face,o){
  const s=o.scale||1;
  push();translate(x,y);
  noStroke();fill(0,0,0,60);
  ellipse(0,8,32*s,16*s);
  if(o.glow){
    fill(...o.glow,45);
    ellipse(0,0,58,58);
  }
  scale(s);
  rotate(face+HALF_PI+
    (o.down?sin(frameCount*.25)*.25:0));
  if(o.down)scale(1,.85);
  const sw=sin(o.run||0)*5;
  const spread=o.arms||0;

  if(o.costume==='vampire'||o.costume==='reaper'){
    fill(o.costume==='reaper'?[23,17,35]:[72,12,34]);
    triangle(-16,-12,0,20,16,-12);
    triangle(-12,-16,-19,-29,-6,-22);
    triangle(12,-16,19,-29,6,-22);
  }
  fill(...o.shorts);
  ellipse(-8,13+sw,9,18);
  ellipse(8,13-sw,9,18);
  fill(20,24,30);
  ellipse(-8,21+sw,8,7);
  ellipse(8,21-sw,8,7);

  fill(...o.skin);
  ellipse(-(19+spread*12),2-sw*.6-spread*6,
    8,15+spread*6);
  ellipse(19+spread*12,2+sw*.6-spread*6,
    8,15+spread*6);

  fill(...o.shirt);
  ellipse(0,0,35,39);
  if(o.costume==='skeleton'){
    stroke(235,231,205);strokeWeight(2);
    line(-9,-7,9,-7);line(-11,-1,11,-1);
    line(-9,5,9,5);line(-7,11,7,11);
    noStroke();fill(235,231,205);
    ellipse(-12,0,4);ellipse(12,0,4);
  }else if(o.costume==='reaper'){
    fill(205,194,174,220);
    ellipse(0,-7,8,7);
    stroke(205,194,174,220);strokeWeight(2);
    line(-8,0,8,0);line(-7,5,7,5);
    noStroke();
  }else if(o.costume==='witch'){
    fill(255,190,70,200);
    ellipse(0,-1,5,5);
    stroke(255,190,70,180);strokeWeight(1);
    line(-10,6,10,6);noStroke();
  }
  fill(255,255,255,60);
  rect(-2,-14,4,26,2);
  fill(...o.skin);
  ellipse(0,-21,19,19);
  fill(...o.hair);
  arc(0,-24,20,13,PI,TWO_PI);
  if(o.costume==='vampire'){
    fill(74,8,30);triangle(-10,-19,0,-11,10,-19);
    fill(255,245,225);triangle(-4,-13,-2,-8,0,-13);
    triangle(4,-13,2,-8,0,-13);
  }else if(o.costume==='werewolf'){
    fill(...o.hair);
    triangle(-10,-28,-12,-40,-3,-29);
    triangle(10,-28,12,-40,3,-29);
    fill(238,213,167);ellipse(0,-17,13,8);
    fill(30,18,24);ellipse(-4,-22,2.5);ellipse(4,-22,2.5);
  }else if(o.costume==='witch'){
    fill(24,16,39);triangle(-15,-27,0,-48,15,-27);
    ellipse(0,-27,31,5);
    fill(255,137,47);rect(-9,-29,18,3);
    fill(255,221,126);ellipse(-4,-21,2.5);ellipse(4,-21,2.5);
  }else if(o.costume==='skeleton'||o.costume==='reaper'){
    fill(232,226,205);ellipse(0,-21,19,18);
    fill(24,16,30);ellipse(-4,-22,4,5);ellipse(4,-22,4,5);
    triangle(-2,-16,2,-16,0,-12);
    stroke(24,16,30);strokeWeight(1);
    line(-4,-13,-4,-10);line(0,-13,0,-10);line(4,-13,4,-10);
    noStroke();
    if(o.costume==='reaper'){
      fill(28,19,42);arc(0,-25,24,24,PI,TWO_PI);
      fill(255,120,54,220);ellipse(-4,-22,2);ellipse(4,-22,2);
    }
  }else if(o.costume==='pumpkin'){
    fill(255,131,38);ellipse(0,-21,22,20);
    fill(38,19,24);triangle(-8,-24,-3,-20,-9,-19);
    triangle(8,-24,3,-20,9,-19);
    triangle(-3,-15,3,-15,0,-11);
    fill(104,179,60);rect(-2,-33,4,5);
  }else if(o.costume==='zombie'){
    fill(132,193,111);ellipse(0,-21,19,19);
    fill(31,35,24);ellipse(-4,-22,3,5);ellipse(4,-22,3,4);
    fill(92,30,39);rect(-3,-15,6,2);
  }

  rotate(-(face+HALF_PI));
  fill(255,255,255,220);
  textAlign(CENTER,CENTER);textStyle(BOLD);textSize(11);
  text(o.num,0,3);
  textStyle(NORMAL);
  pop();
}

function drawDefender(){
  const d=defender;
  const lean=constrain(d.vx*.04,-.2,.2);
  drawPlayer(d.x,d.y,d.face+lean,{
    shirt:[255,145,78],shorts:[41,30,48],
    skin:[235,199,157],hair:[57,36,46],
    num:5,run:d.run,costume:'pumpkin',
    glow:recovery>0?[255,180,90]:
      tackleTimer>0?[255,180,120]:null
  });
  if(tackleTimer>0){
    noFill();stroke(255,180,120,170);strokeWeight(3);
    ellipse(d.x,d.y,55+(9-tackleTimer)*3);
    noStroke();
  }
}

function drawAttacker(p){
  const a=p||attacker,c=a.type.col;
  const celeb=a.state==='celebrate';
  const bob=celeb?-abs(sin(a.celebrate*.25))*10:0;
  drawPlayer(a.x,a.y+bob,celeb?HALF_PI:a.face,{
    shirt:c,shorts:[32,30,40],
    skin:[250,220,179],hair:[40,35,30],
    num:a.type.num,run:a.run,costume:a.type.costume,
    down:a.down>0,arms:celeb?1:0,
    glow:a.sprinting&&a.down<=0?[255,226,143]:null
  });
  if(a.down>0){
    noStroke();fill(255,235,120);
    for(let i=0;i<3;i++){
      const ang=frameCount*.12+i*TWO_PI/3;
      ellipse(a.x+cos(ang)*14,
        a.y-28+sin(ang)*4,5);
    }
  }
}

function drawKeeper(){
  drawPlayer(keeper.x,keeper.y,HALF_PI,{
    shirt:[150,88,255],shorts:[34,30,42],
    skin:[235,199,157],hair:[30,30,30],
    num:1,run:frameCount*.05,costume:'zombie',
    arms:keeper.diving>0?1:.15,scale:.95
  });
}

function drawShotTrail(){
  if(!trail.length)return;
  noFill();
  for(let i=1;i<trail.length;i++){
    stroke(255,255,255,i/trail.length*150);
    strokeWeight(1+i/trail.length*5);
    line(trail[i-1].x,trail[i-1].y,
      trail[i].x,trail[i].y);
  }
  noStroke();
}

function drawBall(){
  const b=ball,size=11;
  noStroke();fill(26,18,24,70);
  ellipse(b.x+2,b.y+4,size+2,size*.7);
  fill(255,180,80);ellipse(b.x,b.y,size,size);
  push();translate(b.x,b.y);rotate(b.spin);
  fill(64,40,24);
  ellipse(0,0,size*.3);
  for(let i=0;i<5;i++){
    const a=i*TWO_PI/5;
    ellipse(cos(a)*size*.34,
      sin(a)*size*.34,size*.17);
  }
  pop();
}

function drawParticles(){
  noStroke();
  for(const p of particles){
    const al=map(p.life,0,p.max,0,p.soft?110:230);
    fill(...p.col,al);
    ellipse(p.x,p.y,p.size);
  }
}

function drawFloaters(){
  textAlign(CENTER,CENTER);textStyle(BOLD);
  for(const f of floaters){
    const al=min(255,f.life*8);
    textSize(f.size);
    stroke(5,20,14,al*.7);strokeWeight(4);
    fill(...f.col,al);
    text(f.text,f.x,f.y);
  }
  noStroke();textStyle(NORMAL);
}

// ---------- HUD ----------
function drawHud(){
  noStroke();  fill(17,9,25,245);
  rect(0,0,W,64);
  fill(255,126,56,130);rect(0,62,W,2);

  textAlign(LEFT,CENTER);textStyle(BOLD);
  textSize(17);fill(255,164,92);
  text('THE HAUNTED CUP',24,20);
  textStyle(NORMAL);textSize(10);fill(199,166,206);
  text(state==='play'?'WAVE '+wave+'  ·  '+curType.name:
    'HALLOWEEN NIGHT',24,42);

  textAlign(CENTER,CENTER);textStyle(BOLD);
  textSize(28);fill(255,194,103);
  text(score.toLocaleString(),450,25);
  textStyle(NORMAL);textSize(10);fill(199,166,206);
  text('BEST '+best,450,49);

  textAlign(RIGHT,CENTER);textSize(10);
  fill(255,127,91);
  text('CONCEDED',W-24,14);
  for(let i=0;i<MAX_CONCEDED;i++){
    const cx=W-36-(MAX_CONCEDED-1-i)*24,cy=31;
    if(i<conceded){
      stroke(255,90,80);strokeWeight(3);
      line(cx-6,cy-6,cx+6,cy+6);
      line(cx+6,cy-6,cx-6,cy+6);
      noStroke();
    }else{
      fill(255,146,64);ellipse(cx,cy,14);
    }
  }

  textAlign(CENTER,CENTER);textSize(10);
  fill(207,163,232);textStyle(NORMAL);
  text('FOULS',W-170,14);
  for(let i=0;i<MAX_FOULS;i++){
    const cx=W-188+i*18;
    if(i<fouls)fill(i===MAX_FOULS-1?
      color(255,80,70):color(255,153,67));
    else fill(255,255,255,40);
    rect(cx,24,11,15,2);
  }
  if(combo>=2){
    textStyle(BOLD);textSize(11);
    fill(255,226,120);textAlign(RIGHT,CENTER);
    text('COMBO '+combo+'  ×'+mult().toFixed(2),
      W-24,52);
    textStyle(NORMAL);
  }

  if(state==='play'&&waveState==='live'){
    const p=constrain(waveTimer/WAVE_LIMIT,0,1);
    fill(p>.7?color(255,110,90):color(255,180,90));
    rect(0,64,W*(1-p),3);
  }

  fill(34,19,39,220);rect(24,H-22,130,8,4);
  fill(exhausted?color(255,110,90):
    stamina>25?color(255,155,66):color(255,105,78));
  rect(24,H-22,130*stamina/100,8,4);
  textAlign(LEFT,CENTER);textSize(9);
  fill(255,232,200);
  text(exhausted?'WINDED':'SPRINT',24,H-34);

  const cx=W-44,cy=H-40;
  noFill();stroke(201,157,222,100);
  strokeWeight(2);ellipse(cx,cy,26);
  const ready=1-constrain(tackleCooldown/65,0,1);
  stroke(ready>=1?color(255,190,90):
    color(201,157,222,210));
  strokeWeight(3);
  arc(cx,cy,26,26,-HALF_PI,
    -HALF_PI+TWO_PI*ready);
  noStroke();fill(255,176,104,220);
  textAlign(CENTER,CENTER);textSize(8);
  text('SPACE',cx,cy);

  textSize(9);fill(216,184,222,130);
  text('P  PAUSE   ·   M  SOUND '+(muted?'OFF':'ON'),
    450,H-14);
}

// ---------- SCREENS ----------
function panel(w,h){
  noStroke();fill(7,4,15,215);
  rect(0,64,W,H-64);
  fill(24,12,32,250);
  rect(450-w/2,330-h/2,w,h,18);
  noFill();stroke(255,132,67,125);
  strokeWeight(2);
  rect(450-w/2,330-h/2,w,h,18);
  stroke(190,112,232,55);strokeWeight(1);
  rect(450-w/2+7,330-h/2+7,w-14,h-14,13);
  noStroke();
}

function drawBanner(){
  const t=introTimer;
  const al=constrain(min(t,65-t)*12,0,255);
  const c=curType.col;
  noStroke();fill(17,8,25,al*.82);
  rect(0,H/2-70,W,130);
  textAlign(CENTER,CENTER);textStyle(BOLD);
  fill(255,145,78,al);textSize(13);
  text(curType.boss?'BOSS WAVE '+wave:'WAVE '+wave,
    450,H/2-44);
  fill(...c,al);textSize(40);
  text(curType.name,450,H/2-10);
  textStyle(NORMAL);fill(255,228,196,al);
  textSize(13);text(curType.tag,450,H/2+28);
  textSize(10);fill(255,182,126,al);
  text(mate?'TWO ATTACKERS. WATCH THE PASS.':
    'GET BETWEEN HIM AND THE GOAL',450,H/2+46);
}

function drawStartScreen(){
  panel(560,500);
  textAlign(CENTER,CENTER);textStyle(BOLD);
  fill(255,145,74);textSize(12);
  text('ONE NIGHT. WAVE AFTER WAVE OF NIGHTMARES.',450,140);
  fill(255,225,182);textSize(42);
  text('THE HAUNTED CUP',450,180);
  textStyle(NORMAL);fill(208,170,224);textSize(14);
  text('Vampires, witches & worse are coming for your goal.',450,220);

  fill(255,228,191);textSize(14);
  const lines=[
    'WASD / ARROWS   move',
    'SHIFT   sprint  (limited stamina)',
    'SPACE   lunge tackle',
    '',
    'Pumpkin armor vs vampires, werewolves, witches & skeletons.',
    'Ghosts haunt the touchline. Bats circle overhead.',
    'Beware a second monster from wave 2.',
    'Miss a tackle and the graveyard grows.',
    'Every fifth wave: THE GRIM REAPER.'
  ];
  lines.forEach((l,i)=>text(l,450,259+i*25));

  fill(255,174,90);textSize(13);
  text('BEST  '+best,450,525);
  textStyle(BOLD);textSize(12);fill(255,144,76);
  text('CLICK OR PRESS ENTER TO KICK OFF',
    450,558+sin(frameCount*.1)*2);
  textStyle(NORMAL);
}

function drawOverScreen(){
  panel(500,400);
  textAlign(CENTER,CENTER);textStyle(BOLD);
  fill(255,168,110);textSize(12);
  text(redCard?'BANISHED FROM THE HAUNTED CUP':
    'THE MONSTERS CLAIM THE PITCH',450,170);
  fill(255,233,184);textSize(40);
  text('GAME OVER',450,210);
  fill(255,174,88);textSize(46);
  text(score.toLocaleString(),450,268);
  fill(newBest?color(255,226,120):color(255,190,140));
  textSize(14);
  text(newBest?'NEW BEST!':'BEST '+best,450,302);
  textStyle(NORMAL);fill(255,220,190);textSize(14);
  text('Reached wave '+wave,450,342);
  text(tackles+' tackles  ·  '+blocks+' blocks  ·  '+
    fouls+' fouls  ·  best combo '+bestCombo,450,372);
  fill(255,196,146);textSize(12);
  text('Tip: anticipate the run, not just the ball.',
    450,416);
  textStyle(BOLD);fill(255,176,94);textSize(12);
  text('CLICK OR PRESS ENTER TO PLAY AGAIN',450,480);
  textStyle(NORMAL);
}

function drawPauseScreen(){
  panel(300,150);
  textAlign(CENTER,CENTER);textStyle(BOLD);
  fill(255,222,185);textSize(30);
  text('TIME IS FROZEN',450,312);
  textStyle(NORMAL);fill(206,165,222);textSize(12);
  text('Press P or click to return to the haunted pitch',450,354);
}

// ---------- HELPERS ----------
function angLerp(a,b,t){
  const d=((b-a+PI)%TWO_PI+TWO_PI)%TWO_PI-PI;
  return a+d*t;
}

function pointSegDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  const l2=dx*dx+dy*dy||1;
  const t=constrain(
    ((px-x1)*dx+(py-y1)*dy)/l2,0,1);
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

function loadBest(){
  try{
    return parseInt(
      localStorage.getItem('lastDefenderHardcoreBest')||'0',10
    )||0;
  }catch(e){return 0;}
}
function saveBest(v){
  try{
    localStorage.setItem('lastDefenderHardcoreBest',String(v));
  }catch(e){}
}

// ---------- INPUT ----------
function keyPressed(){
  if(keyCode===ENTER||keyCode===RETURN){
    if(state!=='play')startOrRestart();
    return false;
  }
  if(keyCode===32){
    attemptTackle();return false;
  }
  if(keyCode===80&&state==='play'){
    paused=!paused;return false;
  }
  if(keyCode===77){
    muted=!muted;return false;
  }
  if([UP_ARROW,DOWN_ARROW,LEFT_ARROW,RIGHT_ARROW]
     .includes(keyCode))return false;
}

function mousePressed(){
  if(state==='start'||state==='over')startOrRestart();
  else if(paused)paused=false;
}

// ---------- WEB AUDIO ----------
function initAudio(){
  if(audioCtx){
    if(audioCtx.state==='suspended')audioCtx.resume();
    return;
  }
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    audioCtx=new AC();
    masterGain=audioCtx.createGain();
    masterGain.gain.value=.35;
    masterGain.connect(audioCtx.destination);
    const len=audioCtx.sampleRate*2;
    noiseBuf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
    const data=noiseBuf.getChannelData(0);
    for(let i=0;i<len;i++)
      data[i]=Math.random()*2-1;
  }catch(e){audioCtx=null;}
}

function tone(freq,dur,type='sine',vol=.3,slideTo,delay=0){
  if(!audioCtx||muted)return;
  const t=audioCtx.currentTime+delay;
  const o=audioCtx.createOscillator();
  const g=audioCtx.createGain();
  o.type=type;
  o.frequency.setValueAtTime(freq,t);
  if(slideTo)
    o.frequency.exponentialRampToValueAtTime(slideTo,t+dur);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol,t+.01);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g);g.connect(masterGain);
  o.start(t);o.stop(t+dur+.05);
}

function noise(dur,vol=.3,freq=1000,q=1,delay=0){
  if(!audioCtx||muted||!noiseBuf)return;
  const t=audioCtx.currentTime+delay;
  const s=audioCtx.createBufferSource();
  s.buffer=noiseBuf;
  const f=audioCtx.createBiquadFilter();
  f.type='bandpass';f.frequency.value=freq;f.Q.value=q;
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol,t+.02);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  s.connect(f);f.connect(g);g.connect(masterGain);
  s.start(t);s.stop(t+dur+.05);
}

function sfx(name){
  if(!audioCtx||muted)return;
  switch(name){
    case 'whistle':
      tone(2300,.18,'sine',.25,2700);
      tone(2500,.25,'sine',.25,2300,.18);break;
    case 'wave':
      tone(520,.12,'triangle',.2,780);break;
    case 'lunge':
      noise(.18,.25,1400,.8);break;
    case 'tackle':
      tone(150,.25,'sine',.55,50);
      noise(.25,.4,500,.7);
      noise(.9,.12,900,.4,.05);break;
    case 'miss':
      tone(240,.22,'sawtooth',.12,110);break;
    case 'windup':
      tone(300,.25,'square',.07,520);break;
    case 'kick':
      tone(230,.15,'sine',.5,80);
      noise(.1,.35,1800,1);break;
    case 'block':
      tone(200,.2,'sine',.5,70);
      noise(.2,.35,700,.8);
      noise(1,.14,900,.4,.05);break;
    case 'foul':
      tone(2600,.3,'sine',.3);
      tone(2400,.4,'sine',.3,null,.35);break;
    case 'pass':
      tone(480,.1,'triangle',.15,700);break;
    case 'save':
      tone(420,.12,'triangle',.25);
      tone(330,.2,'triangle',.25,null,.1);break;
    case 'goal':
      noise(1.4,.35,700,.3);
      tone(440,.25,'sawtooth',.2,180);
      tone(330,.5,'sawtooth',.2,110,.2);break;
    case 'end':
      tone(392,.25,'triangle',.3);
      tone(330,.25,'triangle',.3,null,.25);
      tone(262,.6,'triangle',.3,200,.5);break;
  }
}
