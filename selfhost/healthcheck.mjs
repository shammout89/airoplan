import http from 'node:http';
const origin=new URL(process.env.PUBLIC_URL||'http://localhost:8080');
const req=http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/healthz',headers:{Host:origin.host},timeout:4000},res=>{
  let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part});
  res.on('end',()=>{try{if(res.statusCode!==200||JSON.parse(body).status!=='ok')process.exitCode=1}catch{process.exitCode=1}});
});
req.on('timeout',()=>req.destroy(Error('Health check timeout')));
req.on('error',()=>{process.exitCode=1});
