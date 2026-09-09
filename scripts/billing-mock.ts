import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import './test-runtime';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { stripe } from '../lib/stripe';
/** In-process SDK fixture: no Stripe socket or login. Real handlers + Auth.js DB sessions + Next request context. */
export async function installBillingMock() {
  process.env.STRIPE_PRICE_STARTER='price_fixture_starter';
  process.env.STRIPE_PRICE_AGENCY='price_fixture_agency';
  process.env.STRIPE_PORTAL_CONFIG='bpc_fixture';
  const client=stripe(), customers=new Map<string,Record<string,unknown>>(), checkouts=new Map<string,Record<string,unknown>>();
  const list=(data:unknown[])=>({object:'list',data,has_more:false});
  Object.assign(client.customers,{
    async search({query}:{query:string}) {const id=query.match(/workspace_id'\]:'([^']+)'/)?.[1];return list([...customers.values()].filter(c=>(c.metadata as {workspace_id:string})?.workspace_id===id));},
    async create(data:Record<string,unknown>){const row={id:'cus_fixture_'+randomUUID(),...data};customers.set(row.id,row);return row;},
    async del(id:string){customers.delete(id);return {id,deleted:true};},
  });
  Object.assign(client.subscriptions,{async list(){return list([]);}});
  Object.assign(client.checkout.sessions,{
    async list({customer,status}:{customer:string;status:string}){return list([...checkouts.values()].filter(c=>c.customer===customer&&c.status===status));},
    async create(data:Record<string,unknown>){
      const {subscription_data,...rest}=data;void subscription_data;
      const id='cs_fixture_'+randomUUID(),row={...rest,id,status:'open',subscription:null,url:'https://checkout.stripe.com/c/pay/'+id};checkouts.set(id,row);return row;
    },
    async retrieve(id:string){return checkouts.get(id);},
    async expire(id:string){const row=checkouts.get(id)!;row.status='expired';return row;},
  });
  Object.assign(client.billingPortal.sessions,{async create(){return {id:'bps_fixture',url:'https://billing.stripe.com/p/session/fixture'};}});
  const checkout=await import('../app/api/stripe/checkout/route'),portal=await import('../app/api/stripe/portal/route');
  const original=globalThis.fetch;
  globalThis.fetch=async (input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(init?.method!=='POST'||!['/api/stripe/checkout','/api/stripe/portal'].includes(url.pathname)) return original(input,init);
    const request=new NextRequest(url,{...init,signal:init?.signal??undefined});
    const store=createRequestStoreForAPI(request,{pathname:url.pathname,search:url.search},{tags:[],expirationsByCacheKind:new Map()},undefined,undefined,undefined);
    return workAsyncStorage.run({route:url.pathname,page:url.pathname,isStaticGeneration:false} as WorkStore,()=>
      workUnitAsyncStorage.run(store,()=>url.pathname.endsWith('/checkout')?checkout.POST(request):portal.POST(request)));
  };
  return ()=>{globalThis.fetch=original;};
}
