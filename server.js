
const express=require("express"),http=require("http"),{WebSocketServer}=require("ws"),crypto=require("crypto"),fs=require("fs"),path=require("path");
const app=express(); app.use(express.json({limit:"20kb"})); app.use(express.static(path.join(__dirname,"public")));
const server=http.createServer(app),wss=new WebSocketServer({server});
const DATA=path.join(__dirname,"data.json");
let db={users:[],rooms:[
{id:"general",name:"الغرفة العامة",icon:"💬",welcome:"أهلًا بكم في لمّتنا ❤️"},
{id:"music",name:"أغاني وسهر",icon:"🎵",welcome:"استمتعوا بالسهرة 🎶"},
{id:"friends",name:"أصدقاء لمّتنا",icon:"👥",welcome:"أهلًا بالأصحاب 🤝"},
{id:"games",name:"الألعاب",icon:"🎮",welcome:"يلا نلعب 🎮"}],messages:[]};
if(fs.existsSync(DATA)){try{db=JSON.parse(fs.readFileSync(DATA,"utf8"))}catch{}}
const save=()=>fs.writeFileSync(DATA,JSON.stringify(db,null,2));
const hash=p=>crypto.createHash("sha256").update(p).digest("hex");
const cleanName=x=>String(x||"").trim().replace(/[<>]/g,"").slice(0,24);
const appRoom=new Map(), sockets=new Map(), online=new Map();
for(const r of db.rooms) appRoom.set(r.id,new Set());
const send=(w,o)=>w.readyState===1&&w.send(JSON.stringify(o));
const isAdmin=u=>u&&["مالك","أدمن"].includes(u.role);
const members=id=>[...(appRoom.get(id)||[])].map(w=>({name:w.user.name,role:w.user.role}));
const broadcast=(id,o)=>{for(const w of appRoom.get(id)||[])send(w,o)};
function leave(w){if(w.room&&appRoom.has(w.room)){appRoom.get(w.room).delete(w);broadcast(w.room,{type:"members",members:members(w.room)})}}
function join(w,id){if(!appRoom.has(id))return;leave(w);w.room=id;appRoom.get(id).add(w);let r=db.rooms.find(x=>x.id===id);send(w,{type:"room",room:r,history:db.messages.filter(x=>x.room===id).slice(-50)});broadcast(id,{type:"members",members:members(id)})}
function info(u){return{name:u.name,role:u.role,banned:!!u.banned}}
function adminData(){return{users:db.users.map(info),rooms:db.rooms}}
function notifyAdmins(){for(const w of sockets.values())if(isAdmin(w.user))send(w,{type:"adminData",...adminData()})}

app.get("/api/health",(q,s)=>s.json({ok:true,service:"lametna"}));
app.post("/api/register",(q,s)=>{
 const n=cleanName(q.body.name),p=String(q.body.password||"");
 if(n.length<2||p.length<6)return s.status(400).json({error:"الاسم غير صالح أو كلمة المرور أقل من 6 أحرف"});
 if(db.users.some(u=>u.name.toLowerCase()===n.toLowerCase()))return s.status(409).json({error:"الاسم مستخدم بالفعل"});
 const role=db.users.length?"عضو":"مالك";db.users.push({name:n,pass:hash(p),role,banned:false,createdAt:Date.now()});save();s.json({name:n,role});
});
app.post("/api/login",(q,s)=>{
 const n=cleanName(q.body.name),p=String(q.body.password||"");const u=db.users.find(x=>x.name.toLowerCase()===n.toLowerCase()&&x.pass===hash(p));
 if(!u)return s.status(401).json({error:"بيانات الدخول غير صحيحة"});if(u.banned)return s.status(403).json({error:"الحساب محظور"});s.json(info(u));
});

wss.on("connection",w=>w.on("message",raw=>{
 let m;try{m=JSON.parse(raw)}catch{return}
 if(m.type==="login"){
  const n=cleanName(m.name),p=String(m.password||"");const u=db.users.find(x=>x.name.toLowerCase()===n.toLowerCase()&&x.pass===hash(p));
  if(!u||u.banned)return send(w,{type:"error",message:"فشل تسجيل الدخول"});
  w.user=u;sockets.set(u.name,w);online.set(u.name,w);join(w,"general");send(w,{type:"ready",user:info(u),rooms:db.rooms});if(isAdmin(u))notifyAdmins();return;
 }
 if(!w.user)return;
 if(m.type==="join")return join(w,String(m.room||""));
 if(m.type==="chat"){
  const text=String(m.text||"").trim().slice(0,500);if(!text)return;
  const x={room:w.room,name:w.user.name,role:w.user.role,text,at:Date.now()};db.messages.push(x);db.messages=db.messages.slice(-1500);save();broadcast(w.room,{type:"chat",...x});
 }
 if(m.type==="private"){
  const text=String(m.text||"").trim().slice(0,500),to=online.get(cleanName(m.to));
  if(to&&text){send(to,{type:"private",from:w.user.name,text});send(w,{type:"private",from:w.user.name,text})}
 }
 if(["voice-offer","voice-answer","voice-ice"].includes(m.type)){const to=online.get(cleanName(m.to));if(to)send(to,{type:m.type,from:w.user.name,data:m.data})}
 if(m.type==="voice-join")broadcast(w.room,{type:"voice-presence",name:w.user.name,action:"join"});
 if(m.type==="voice-leave")broadcast(w.room,{type:"voice-presence",name:w.user.name,action:"leave"});
 if(m.type==="admin"&&isAdmin(w.user)){
  const a=m.action,u=db.users.find(x=>x.name===cleanName(m.target));
  if(a==="refresh"){notifyAdmins();return}
  if(a==="setRole"&&u&&u.role!=="مالك"&&["عضو","مشرف","أدمن"].includes(m.role)){u.role=m.role;save();if(sockets.get(u.name))sockets.get(u.name).user=u}
  if(a==="ban"&&u&&u.role!=="مالك"){u.banned=true;save();sockets.get(u.name)?.close()}
  if(a==="unban"&&u){u.banned=false;save()}
  if(a==="kick"&&u&&u.role!=="مالك")sockets.get(u.name)?.close()
  if(a==="createRoom"){const id=String(m.id||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,20),name=String(m.name||"").trim().slice(0,30);if(id&&name&&!db.rooms.some(r=>r.id===id)){db.rooms.push({id,name,icon:String(m.icon||"💬").slice(0,2),welcome:"أهلًا بكم في "+name});appRoom.set(id,new Set());save()}}
  if(a==="deleteRoom"&&m.id!=="general"){db.rooms=db.rooms.filter(r=>r.id!==m.id);appRoom.delete(m.id);db.messages=db.messages.filter(x=>x.room!==m.id);save()}
  for(const x of sockets.values())send(x,{type:"rooms",rooms:db.rooms});notifyAdmins();
 }
}));
wss.on("connection",w=>w.on("close",()=>{if(w.user){broadcast(w.room,{type:"voice-presence",name:w.user.name,action:"leave"});leave(w);sockets.delete(w.user.name);online.delete(w.user.name)}}));
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log("LAMTNA V7 on "+PORT));
