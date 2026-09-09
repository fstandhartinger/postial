import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces, workspaceMembers, subscriptions, brands, sessions, posts } from '../db/schema';
import { mediaAssets } from '../db/media-schema';
import { createApiKey } from '../lib/api/auth';
import { safeFetch, validatePublicUrl } from '../lib/publishers/safe-fetch';
import { downloadImage } from '../lib/publishers/http';
import { imageInfo } from '../lib/media/image';
const base = process.env.MEDIA_HTTP_URL || 'http://127.0.0.1:3996';
process.env.NEXT_PUBLIC_APP_URL = base; process.env.MEDIA_ALLOW_LOOPBACK = '1';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=', 'base64');
function previewPng() {
  const width = 320, height = 180;
  const raw = Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=y*(width*3+1)+1+x*3;
    raw[p]=20+Math.floor(x/3); raw[p+1]=100+Math.floor(y/2); raw[p+2]=170;
  }
  const chunk = (type:string,data:Buffer) => {
    const content = Buffer.concat([Buffer.from(type),data]); let crc=0xffffffff;
    for(const byte of content) {crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const size=Buffer.alloc(4),sum=Buffer.alloc(4); size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([size,content,sum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function main() {
  assert(process.env.NODE_ENV !== 'production');
  const db = getDb(), userId = randomUUID(), foreignId = randomUUID();
  try {
    await db.insert(users).values([{id:userId,name:'Media fixture'},{id:foreignId,name:'Foreign media fixture'}]);
    const [workspace] = await db.insert(workspaces).values({ownerUserId:userId,slug:'media-'+userId,name:'Media fixture'}).returning();
    const [foreign] = await db.insert(workspaces).values({ownerUserId:foreignId,slug:'media-'+foreignId,name:'Foreign fixture'}).returning();
    await db.insert(workspaceMembers).values([{workspaceId:workspace.id,userId,role:'owner'},{workspaceId:foreign.id,userId:foreignId,role:'owner'}]);
    await db.insert(subscriptions).values({workspaceId:workspace.id,plan:'agency',status:'active',stripeSubscriptionId:'media_fixture_'+userId,currentPeriodEnd:new Date(Date.now()+86400000)});
    const [brand] = await db.insert(brands).values({workspaceId:workspace.id,name:'Media test brand',slug:'media'}).returning();
    const token = randomBytes(32).toString('base64url'), foreignToken = randomBytes(32).toString('base64url');
    await db.insert(sessions).values([{sessionToken:token,userId,expires:new Date(Date.now()+600000)},{sessionToken:foreignToken,userId:foreignId,expires:new Date(Date.now()+600000)}]);
    const cookie = {'Cookie':'authjs.session-token='+token}, foreignCookie = {'Cookie':'authjs.session-token='+foreignToken};
    const upload = (data:Buffer, headers:Record<string,string> = cookie) => {
      const body = new FormData(); body.set('file',new Blob([new Uint8Array(data)],{type:'image/png'}),'test.png'); body.set('brand_id',brand.id);
      return fetch(base+'/api/media',{method:'POST',headers,body});
    };
    assert.equal((await upload(png,{})).status,401);
    assert.equal((await upload(png,{...cookie,Origin:'https://evil.invalid'})).status,403);
    const uploaded = await upload(png); assert.equal(uploaded.status,201); const asset = await uploaded.json();
    assert.equal(asset.id.length,43); assert.equal(asset.width,1); assert.equal(asset.height,1); assert.equal(asset.bytes,png.length);
    const get = await fetch(asset.url); assert.equal(get.status,200); assert.equal(get.headers.get('content-type'),'image/png');
    assert.equal(get.headers.get('cache-control'),'public, max-age=31536000, immutable'); assert.equal(get.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await get.arrayBuffer()),png);
    assert.equal((await fetch(asset.url,{headers:{'If-None-Match':get.headers.get('etag')!}})).status,304);
    assert.equal((await upload(Buffer.from('This is text, not PNG'))).status,422);
    assert.equal((await upload(Buffer.alloc(6*1024*1024))).status,413);
    // Accounted bytes simulate full storage without writing gigabytes to the test database.
    await db.update(mediaAssets).set({bytes:2147483647}).where(eq(mediaAssets.id,asset.id));
    assert.equal((await upload(png)).status,422);
    await db.update(mediaAssets).set({bytes:png.length}).where(eq(mediaAssets.id,asset.id));
    assert.equal((await fetch(base+'/api/media/'+asset.id,{method:'DELETE',headers:foreignCookie})).status,404);
    const key = await createApiKey(workspace.id,userId,'Media fixture',['posts:write']);
    const apiHeaders = {Authorization:'Bearer '+key.token,'Content-Type':'application/json'};
    const apiUpload = await fetch(base+'/api/v1/media',{method:'POST',headers:apiHeaders,body:JSON.stringify({data:png.toString('base64'),brand_id:brand.id})});
    assert.equal(apiUpload.status,201);
    const multipart = new FormData(); multipart.set('file',new Blob([new Uint8Array(png)]),'test.png');
    assert.equal((await fetch(base+'/api/v1/media',{method:'POST',headers:{Authorization:'Bearer '+key.token},body:multipart})).status,201);
    const readKey = await createApiKey(workspace.id,userId,'Read fixture',['posts:read']);
    assert.equal((await fetch(base+'/api/v1/media',{method:'POST',headers:{Authorization:'Bearer '+readKey.token},body:'{}'})).status,403);
    const post = (urls:string[]) => fetch(base+'/api/v1/posts',{method:'POST',headers:apiHeaders,body:JSON.stringify({brand_id:brand.id,body:'Media draft',media_urls:urls})});
    assert.equal((await post(Array(5).fill(asset.url))).status,422);
    const saved = await post([asset.url + "?download=1#preview"]); assert.equal(saved.status,201); const savedPost = await saved.json(); assert.deepEqual(savedPost.media_urls,[asset.url]);
    assert.equal((await fetch(base+'/api/media/'+asset.id,{method:'DELETE',headers:cookie})).status,422);
    await db.delete(posts).where(eq(posts.id,savedPost.id));
    assert.equal((await safeFetch(asset.url,{},5*1024*1024)).status,200);
    assert.equal((await downloadImage('Fixture',asset.url,5*1024*1024)).size,png.length);
    const old = process.env.NODE_ENV; Object.assign(process.env,{NODE_ENV:'production'});
    await assert.rejects(validatePublicUrl(asset.url));
    if (old === undefined) Reflect.deleteProperty(process.env,"NODE_ENV"); else Object.assign(process.env,{NODE_ENV:old});
    await assert.rejects(validatePublicUrl('https://127.0.0.1/private'));
    const publicOrigin = 'https://socialmint.app.mintapis.com/m/'+asset.id;
    await validatePublicUrl(publicOrigin);
    assert.deepEqual(imageInfo(png),{mime:'image/png',width:1,height:1});
    for (const size of [0,8,20,30]) assert.throws(() => imageInfo(png.subarray(0,size)));
    console.log('PASS session/API upload, magic bytes, 413 size, 422 quota, tenancy, four-image limit, referenced deletion, bytea roundtrip, cache/ETag, provider download and production SSRF guard');
    const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
    try {
      await mkdir('work/media-evidence',{recursive:true});
      for (const width of [390,1280]) {
        const context = await browser.newContext({viewport:{width,height:1000}});
        await context.addCookies([{name:'authjs.session-token',value:token,url:base}]);
        const page = await context.newPage(); const errors:string[] = []; page.on('pageerror',(e:Error) => errors.push(e.message));
        await page.goto(base+'/app/posts/new');
        const chooser = page.locator('input[type=file]'); await chooser.waitFor();
        await chooser.setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:previewPng()});
        await page.getByAltText('Uploaded image 1',{exact:true}).waitFor();
        await page.waitForFunction(() => {const image = document.querySelector('img[alt="Uploaded image 1"]') as HTMLImageElement; return image?.complete && image.naturalWidth === 320;});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
        await page.screenshot({path:`work/media-evidence/composer-${width}.png`,fullPage:true});
        await page.getByRole('button',{name:'Remove image 1',exact:true}).click();
        assert.equal(await page.getByAltText('Uploaded image 1',{exact:true}).count(),0);
        assert.deepEqual(errors,[]); await context.close();
      }
    } finally { await browser.close(); }
    assert.equal((await fetch(base+'/api/media/'+asset.id,{method:'DELETE',headers:cookie})).status,204);
    assert.equal((await fetch(asset.url,{cache:'no-store'})).status,404);
    // Exhaust the per-process budget with rejected uploads; no additional stored images.
    let limited:Response|undefined;
    for(let i=0;i<31;i++) { limited = await upload(Buffer.from('invalid')); if(limited.status === 429) break; }
    assert.equal(limited?.status,429); assert(Number(limited?.headers.get('retry-after')) > 0);
    console.log('PASS Playwright 390/1280 upload/thumbnail/removal/no overflow, deletion, 30/minute limit');
  } finally {
    await db.delete(users).where(eq(users.id,userId)); await db.delete(users).where(eq(users.id,foreignId));
    console.log('PASS fixture cleanup');
  }
}
main().then(() => process.exit(0)).catch(e => {console.error('FAIL',e instanceof Error ? e.message.replace(/sm_live_[\w-]+/g,'[redacted]') : 'unknown');process.exit(1);});
