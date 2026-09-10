// Shared origin takes precedence; historical per-script variables remain supported.
if (process.env.VERIFY_BASE_URL) process.env.MEDIA_HTTP_URL = process.env.VERIFY_BASE_URL;
import { deleteFixtureUsers } from './fixture-cleanup';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mock } from 'node:test';
import { GET as serveMedia } from '../app/m/[id]/route';
import { apiError, ApiError } from '../lib/api/errors';
import { mediaUrl } from '../lib/media/url';
import { normalizeImage } from '../lib/media/image';
import { randomBytes, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, workspaces, workspaceMembers, subscriptions, brands, sessions, posts } from '../db/schema';
import { mediaAssets } from '../db/media-schema';
import { createApiKey } from '../lib/api/auth';
import { safeFetch, validatePublicUrl } from '../lib/publishers/safe-fetch';
import { downloadImage } from '../lib/publishers/http';
import { imageInfo } from '../lib/media/image';
const base = process.env.MEDIA_HTTP_URL || 'http://127.0.0.1:3996';
process.env.NEXT_PUBLIC_APP_URL = base; process.env.MEDIA_ALLOW_LOOPBACK = '1';
const legacyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII=', 'base64');
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
  const png = await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  assert(process.env.NODE_ENV !== 'production');
  const appBase = process.env.NEXT_PUBLIC_APP_URL;
  for (const origin of ['', 'not a URL', 'http://example.com']) {
    process.env.NEXT_PUBLIC_APP_URL = origin;
    assert.throws(() => mediaUrl('a'.repeat(43)),(e:unknown) => e instanceof ApiError && e.status === 422);
  }
  process.env.NEXT_PUBLIC_APP_URL = appBase;
  const logs: string[] = [];
  const logger = mock.method(console,'error',(line: string) => logs.push(line));
  try {
    const response = apiError(new TypeError('PRIVATE PAYLOAD'),'/api/media');
    assert.equal(response.status,500);
    const event = JSON.parse(logs[0]);
    assert.deepEqual(Object.keys(event).sort(),['authenticated','errorClass','event','fingerprint','message','requestId','route','status','timestamp']);
    assert.equal(event.errorClass,'TypeError'); assert.equal(event.route,'/api/media'); assert.equal(event.status,500);
    assert.equal(event.requestId,response.headers.get('x-request-id')); assert(!logs[0].includes('PRIVATE'));
  } finally {logger.mock.restore();}
  const db = getDb(), userId = randomUUID(), foreignId = randomUUID();
  try {
    await db.insert(users).values([{id:userId,name:'Media fixture'},{id:foreignId,name:'Foreign media fixture'}]);
    const [workspace] = await db.insert(workspaces).values({ownerUserId:userId,slug:'media-'+userId,name:'Media fixture'}).returning();
    const [foreign] = await db.insert(workspaces).values({ownerUserId:foreignId,slug:'media-'+foreignId,name:'Foreign fixture',createdAt:new Date(Date.now()-86400000)}).returning();
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
    assert.equal(asset.id.length,43); assert.equal(asset.width,1); assert.equal(asset.height,1); assert(asset.bytes > 0);
    const get = await fetch(asset.url); assert.equal(get.status,200); assert.equal(get.headers.get('content-type'),'image/png');
    assert.equal(get.headers.get('cache-control'),'private, no-store, max-age=0'); assert.equal(get.headers.get('x-content-type-options'),'nosniff');
    const stored = Buffer.from(await get.arrayBuffer());
    assert.deepEqual(await sharp(stored).raw().toBuffer(),await sharp(png).raw().toBuffer());
    const select = db.select.bind(db);
    const spy = mock.method(db, 'select', (...args: Parameters<typeof db.select>) => {
      assert(!args[0] || !('data' in args[0]), '304 must never select bytea');
      return select(...args);
    });
    try { assert.equal((await serveMedia(new Request(asset.url,{headers:{'if-none-match':get.headers.get('etag')!}}),{params:Promise.resolve({id:asset.id})})).status,304); } finally {spy.mock.restore();}
    assert.equal((await fetch(asset.url,{headers:{'If-None-Match':get.headers.get('etag')!}})).status,304);
    assert.equal((await upload(Buffer.from('This is text, not PNG'))).status,422);
    const gif = Buffer.from('474946383961ffffffff0000003b','hex');
    assert.equal((await upload(gif)).status,422);
    const validGif = await sharp(png).gif().toBuffer();
    assert.deepEqual((await normalizeImage(validGif)).data,validGif);
    const manyFrames = await sharp(randomBytes(201*3),{raw:{width:1,height:201,channels:3,pageHeight:1}}).gif({delay:Array(201).fill(100),keepDuplicateFrames:true}).toBuffer();
    await assert.rejects(normalizeImage(manyFrames));
    const frameBomb = await sharp({create:{width:5000,height:15000,pageHeight:5000,channels:3,background:'#fff'}}).gif({delay:[100,100,100],keepDuplicateFrames:true}).toBuffer();
    await assert.rejects(normalizeImage(frameBomb));
    for (const format of ['jpeg','webp'] as const) {
      const input = await sharp(png).toFormat(format).toBuffer();
      assert.equal((await normalizeImage(input)).mime,'image/'+format);
    }
    for (const input of [png,validGif]) assert.equal((await upload(Buffer.concat([input,Buffer.from('<svg/>')]))).status,422);

    assert.equal((await upload(Buffer.concat([legacyPng.subarray(0,33),legacyPng.subarray(-12)]))).status,422);
    const huge = await sharp({create:{width:6000,height:5000,channels:3,background:'#fff'}}).png().toBuffer();
    assert.equal((await upload(huge)).status,422);
    const exif = await sharp({create:{width:3,height:2,channels:3,background:'#f00'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const exifUpload = await upload(exif); assert.equal(exifUpload.status,201);
    const exifAsset = await exifUpload.json(); const cleanExif = await sharp(Buffer.from(await (await fetch(exifAsset.url)).arrayBuffer())).metadata();
    assert.equal(cleanExif.exif,undefined); assert.equal(cleanExif.orientation,undefined); assert.equal(cleanExif.width,2); assert.equal(cleanExif.height,3);
    for (const selector of ['-'.repeat(36),randomUUID()]) {
      const fallback = await upload(png,{Cookie:cookie.Cookie+'; sm_ws='+selector});
      assert.equal(fallback.status,201); assert.match(fallback.headers.get('set-cookie')!,/sm_ws=;/);
      const page = await fetch(base+'/app/brands',{headers:{Cookie:cookie.Cookie+'; sm_ws='+selector}});
      assert.equal(page.status,200); assert.match(page.headers.get('set-cookie')!,/sm_ws=;/);
    }
    // The editor owns an older personal workspace and selects the shared team.
    await db.insert(workspaceMembers).values({workspaceId:workspace.id,userId:foreignId,role:'editor'});
    const teamCookie = {Cookie:foreignCookie.Cookie+'; sm_ws='+workspace.id};
    const editorUpload = await upload(png,teamCookie); assert.equal(editorUpload.status,201);
    const editorAsset = await editorUpload.json();
    const [editorRow] = await db.select({workspaceId:mediaAssets.workspaceId}).from(mediaAssets).where(eq(mediaAssets.id,editorAsset.id));
    assert.equal(editorRow.workspaceId,workspace.id);
    assert.equal((await fetch(base+'/api/media/'+editorAsset.id,{method:'DELETE',headers:teamCookie})).status,204);

    assert.equal((await upload(Buffer.alloc(6*1024*1024))).status,413);
    // Accounted bytes simulate full storage without writing gigabytes to the test database.
    await db.update(mediaAssets).set({bytes:2147483647}).where(eq(mediaAssets.id,asset.id));
    assert.equal((await upload(png)).status,422);
    await db.update(mediaAssets).set({bytes:asset.bytes}).where(eq(mediaAssets.id,asset.id));
    assert.equal((await fetch(base+'/api/media/'+asset.id,{method:'DELETE',headers:foreignCookie})).status,404);
    const editorKey = await createApiKey(workspace.id,foreignId,'Editor workspace key',['brands:read']);
    const apiPage = await fetch(base+'/app/settings/api',{headers:cookie});
    assert.match(await apiPage.text(),/Created by:.*Foreign media fixture/);
    const teamPage = await fetch(base+'/app/settings/team',{headers:cookie});
    assert.match((await teamPage.text()).replace(/<!--.*?-->/g,''),/This member created 1 API keys/);
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspace.id),eq(workspaceMembers.userId,foreignId)));
    assert.equal((await fetch(base+'/api/v1/brands',{headers:{Authorization:'Bearer '+editorKey.token}})).status,200);
    const afterRemoval = await upload(png,teamCookie); assert.equal(afterRemoval.status,422);
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
    const downloadUrl = asset.url.replace('localhost','127.0.0.1');
    const configuredBase = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = base.replace('localhost','127.0.0.1');
    assert.equal((await safeFetch(downloadUrl,{},5*1024*1024)).status,200);
    assert.equal((await downloadImage('Fixture',downloadUrl,5*1024*1024)).size,asset.bytes);
    assert.equal((await normalizeImage(png)).mime,'image/png');
    const old = process.env.NODE_ENV; Object.assign(process.env,{NODE_ENV:'production'});
    await assert.rejects(validatePublicUrl(asset.url));
    if (old === undefined) Reflect.deleteProperty(process.env,"NODE_ENV"); else Object.assign(process.env,{NODE_ENV:old});
    await assert.rejects(validatePublicUrl('https://127.0.0.1/private'));
    process.env.NEXT_PUBLIC_APP_URL = configuredBase;
    const publicOrigin = 'https://postial.co/m/'+asset.id;
    await validatePublicUrl(publicOrigin);
    assert.deepEqual(await imageInfo(png),{mime:'image/png',width:1,height:1});
    for (const size of [0,8,20,30]) await assert.rejects(imageInfo(png.subarray(0,size)));
    console.log('PASS standalone session/API 201; truncated GIF, PNG without IDAT, 30 MP, appended payloads 422; GIF limits; EXIF/orientation; editor tenancy, key persistence/creator UI, cookie fallback/clearing; quota; 304 without bytea query; origin 422 and sanitized 500 log; production SSRF guard');
    const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox']});
    try {
      await mkdir((process.env.VERIFY_EVIDENCE_DIR || '../work') + '/fixer5-evidence',{recursive:true});
      await db.insert(workspaceMembers).values({workspaceId:workspace.id,userId:foreignId,role:'editor'});
      for (const width of [390,1280]) {
        const context = await browser.newContext({viewport:{width,height:1000}});
        await context.addCookies([{name:'authjs.session-token',value:foreignToken,url:base}]);
        const page = await context.newPage(); const errors:string[] = []; page.on('pageerror',(e:Error) => errors.push(e.message));
        await page.goto(base+'/app');
        if (width === 390) await page.getByText('Account',{exact:true}).click();
        await page.locator('select[name=workspace]:visible').selectOption(workspace.id);
        await Promise.all([page.waitForResponse((r: {request(): {method():string}}) => r.request().method() === 'POST'), page.locator('button:visible').filter({hasText:'Switch workspace'}).click()]);
        await page.goto(base+'/app/posts/new');
        assert.equal((await context.cookies()).find((c: {name:string}) => c.name === 'sm_ws')?.value,workspace.id);
        const chooser = page.locator('input[type=file]'); await chooser.waitFor();
        const uploadResponse = page.waitForResponse((r: {url():string;request():{method():string}}) => r.url().endsWith('/api/media') && r.request().method() === 'POST');
        await chooser.setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:previewPng()});
        const teamUploadResponse = await uploadResponse; assert.equal(teamUploadResponse.status(),201);
        const teamAsset = await teamUploadResponse.json();
        await page.getByAltText('Uploaded image 1',{exact:true}).waitFor();
        await page.waitForFunction(() => {const image = document.querySelector('img[alt="Uploaded image 1"]') as HTMLImageElement; return image?.complete && image.naturalWidth === 320;});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
        await page.screenshot({path:`${process.env.VERIFY_EVIDENCE_DIR || '../work'}/fixer5-evidence/composer-${width}.png`,fullPage:true});
        await page.getByRole('button',{name:'Remove image 1',exact:true}).click();
        assert.equal(await page.getByAltText('Uploaded image 1',{exact:true}).count(),0);
        assert.equal((await context.request.delete(base+'/api/media/'+teamAsset.id)).status(),204);
        await page.goto(base+'/api/oauth/x/callback?state=invalid');
        await page.getByRole('alert').filter({hasText:'expired'}).waitFor();
        for (const code of ['denied','provider_error']) {
          await page.goto(base+'/app/brands/'+brand.id+'?connect_error='+code);
          await page.locator('p[role=alert]').waitFor();
          await page.screenshot({path:`${process.env.VERIFY_EVIDENCE_DIR || '../work'}/fixer5-evidence/oauth-${code}-${width}.png`,fullPage:true});
        }
        assert.deepEqual(errors,[]); await context.close();
      }
    } finally { await browser.close(); }
    assert.equal((await fetch(base+'/api/media/'+asset.id,{method:'DELETE',headers:cookie})).status,204);
    assert.equal((await fetch(asset.url,{cache:'no-store'})).status,410);
    // Exhaust the per-process budget with rejected uploads; no additional stored images.
    let limited:Response|undefined;
    for(let i=0;i<31;i++) { limited = await upload(Buffer.from('invalid')); if(limited.status === 429) break; }
    assert.equal(limited?.status,429); assert(Number(limited?.headers.get('retry-after')) > 0);
    console.log('PASS Playwright 390/1280 upload/thumbnail/removal/no overflow, deletion, 30/minute limit');
  } finally {
    await deleteFixtureUsers(db).where(eq(users.id,userId)); await deleteFixtureUsers(db).where(eq(users.id,foreignId));
    console.log('PASS fixture cleanup');
  }
}
main().then(() => process.exit(0)).catch(e => {console.error('FAIL location',e instanceof Error?e.stack?.split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,4):[]);console.error('FAIL',e instanceof Error ? e.message.replace(/sm_live_[\w-]+/g,'[redacted]') : 'unknown');process.exit(1);});
