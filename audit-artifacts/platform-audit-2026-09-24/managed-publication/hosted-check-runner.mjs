import {chromium,expect} from '/home/kashifullah/brainhalf/node_modules/@playwright/test/index.mjs';
import {writeFileSync} from 'node:fs';
const directory='/home/kashifullah/brainhalf/audit-artifacts/platform-audit-2026-09-24/managed-publication';
const origin='https://96f64707e493d216204ad9c6819e1a3c.apps.brainhalf.com';
const context=await chromium.launchPersistentContext('/tmp/brainhalf-platform-audit-browser',{channel:'chrome',headless:true});
const result={samples:[],checks:[],errors:[]};
try{
 const state=await (await context.request.get('https://brainhalf.com/api/projects/proj-0978089d-6817-4a1c-a648-03ca63075d39/runtime/status?environment=development')).json();
 result.verification=state.verification;
 expect(result.verification?.passed).toBe(true);
 for(const [path,status] of [['/api/health',200],['/api/items',401]])for(let i=0;i<3;i++){
  const start=Date.now();const response=await context.request.get(origin+path);await response.body();
  result.samples.push({path,status:response.status(),ms:Date.now()-start});expect(response.status()).toBe(status);
 }
 const config=await (await context.request.get(origin+'/api/auth/config')).json();result.authConfig=config;
 expect(config.googleReady).toBe(true);expect(config.passwordEnabled).toBe(false);
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto(origin,{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Brainhalf Task Board'})).toBeVisible();await page.getByRole('link',{name:'Sign in to manage tasks'}).click();
 await expect(page.getByRole('link',{name:/Google/})).toBeVisible({timeout:20000});
 result.signInText=await page.locator('body').innerText();
 expect(result.signInText).toMatch(/Google/);
 result.checks.push('Published task board opens its managed Google sign-in screen');
 await page.screenshot({path:directory+'/published-sign-in.png'});
 await page.setViewportSize({width:390,height:844});await page.goto(origin,{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Brainhalf Task Board'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 result.checks.push('Published task board fits mobile width');
 await page.screenshot({path:directory+'/published-mobile.png'});
 expect(result.errors).toEqual([]);result.passed=true;
}catch(error){result.error=error.message;process.exitCode=1;}finally{writeFileSync(directory+'/hosted-check.json',JSON.stringify(result,null,2));await context.close();}
console.log(JSON.stringify(result,null,2));
