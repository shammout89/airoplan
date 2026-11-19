let currentEpoch='initial';
export function setDataEpoch(epoch:string){currentEpoch=epoch}
export function apiFetch(input:RequestInfo|URL,init?:RequestInit){const headers=new Headers(init?.headers);if(init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase()))headers.set('X-AeroPlan-Epoch',currentEpoch);return fetch(input,{...init,headers})}
