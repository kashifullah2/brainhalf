import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startTripPlanner } from './trip-planner-harness.mjs';

const original = process.argv.includes('--original');
const root = resolve('audit-artifacts/2026-09-23/trip-planner');
const results = []; const errors = [];
const stateDirectory = await mkdtemp('/tmp/brainhalf-trip-browser-');
const app = await startTripPlanner({ appDirectory: resolve(root, original ? 'original' : 'app'), stateDirectory });
let browser;
async function check(name, action) {
  try { await action(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); console.log('FAIL', name, error.message.slice(0,500)); }
}
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  const login = await context.request.post(app.origin + '/__test/login', { headers: { Origin: app.origin }, data: { user: 'alice' } });
  assert.equal(login.status(), 200);
  await page.goto(app.origin); await page.waitForLoadState('networkidle');
  await writeFile(resolve(root, original ? 'original-dom.html' : 'reviewed-dom.html'), await page.content());
  const request = async (path, method='GET', body) => {
    const response = await context.request.fetch(app.origin + path, { method, headers: { Origin: app.origin }, data: body });
    return { status: response.status(), data: await response.json() };
  };
  let tripId;
  await check('Create trip and saved destination through real HTTP; reload persists both', async () => {
    await page.getByLabel('Trip title', { exact: true }).fill('Hunza field trip');
    await page.getByLabel('Capacity', { exact: true }).fill('3');
    await page.getByLabel('Budget ($)', { exact: true }).fill('5000.01');
    await page.getByRole('button', { name: 'Create Trip', exact: true }).click();
    await expect(page.locator('.trip-title')).toHaveText('Hunza field trip');
    await page.getByLabel('Destination', { exact: true }).fill('Attabad Lake');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.item-title')).toHaveText('Attabad Lake');
    await page.reload(); await page.waitForLoadState('networkidle');
    await expect(page.locator('.trip-title')).toHaveText('Hunza field trip');
    await expect(page.locator('.item-title')).toHaveText('Attabad Lake');
    const trips = (await request('/api/trips')).data.trips;
    tripId = trips[0].id; assert.equal(trips[0].budget_cents, 500001);
    await page.locator('.trip-row').getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('#trip-detail-title')).toHaveText('Hunza field trip');
  });
  if (!tripId) throw new Error('Browser setup could not create the trip');
  await check('Owner invites teammate and books a seat', async () => {
    await page.locator('#member-id').fill('bob'); await page.locator('#invite-btn').click();
    await expect(page.locator('.member-row')).toHaveCount(2);
    await page.locator('#booking-seats').fill('1'); await page.locator('#book-btn').click();
    await expect(page.locator('.booking-row')).toHaveCount(1);
  });
  await check('Lost booking response retries with same key and creates no duplicate', async () => {
    const keys=[]; let intercepted=0;
    await page.route(`**/api/trips/${tripId}/bookings`, async route => {
      keys.push(route.request().headers()['idempotency-key']);
      if (++intercepted === 1) { const saved = await route.fetch(); assert.equal(saved.status(),201); await route.abort('failed'); }
      else await route.continue();
    });
    try {
      await page.locator('#booking-seats').fill('1'); await page.locator('#book-btn').click();
      await expect(page.locator('#booking-result')).toContainText(/fetch|network/i);
      await page.locator('#book-btn').click();
      await expect(page.locator('.booking-row')).toHaveCount(2);
      assert.equal(keys.length,2); assert.equal(keys[0],keys[1]);
      assert.equal((await request(`/api/trips/${tripId}`)).data.trip.reserved_seats,2);
    } finally { await page.unroute(`**/api/trips/${tripId}/bookings`); }
  });
  await check('Fractional seat input is rejected before a network mutation', async () => {
    const before=(await request(`/api/trips/${tripId}`)).data.bookings.length;
    await page.locator('#booking-seats').fill('1.5'); await page.locator('#book-btn').click();
    await expect(page.locator('#booking-result')).toContainText(/integer/i);
    assert.equal((await request(`/api/trips/${tripId}`)).data.bookings.length,before);
  });
  await check('Fractional cents are rejected; valid decimal amount is saved exactly', async () => {
    const before=(await request(`/api/trips/${tripId}`)).data.expenses.length;
    await page.locator('#expense-description').fill('Invalid rounding'); await page.locator('#expense-amount').fill('1.005');
    await page.locator('#add-expense-btn').click();
    await expect(page.locator('#expense-result')).toContainText(/decimal|cents/i);
    assert.equal((await request(`/api/trips/${tripId}`)).data.expenses.length,before);
    await page.locator('#expense-description').fill('Mountain jeep'); await page.locator('#expense-amount').fill('10.01');
    await page.locator('#add-expense-btn').click();
    await expect(page.locator('.expense-row')).toContainText('Mountain jeep');
    assert.equal((await request(`/api/trips/${tripId}`)).data.expenses.find(e=>e.description==='Mountain jeep').amount_cents,1001);
  });
  await check('Cancel requires in-page confirmation and Keep booking preserves the seat', async () => {
    const before=(await request(`/api/trips/${tripId}`)).data.trip.reserved_seats;
    await page.locator('.cancel-booking-btn').first().click();
    await expect(page.locator('#cancel-confirmation')).toBeVisible();
    await page.getByRole('button',{name:'Keep booking',exact:true}).click();
    assert.equal((await request(`/api/trips/${tripId}`)).data.trip.reserved_seats,before);
    await page.locator('.cancel-booking-btn').first().click();
    await page.getByRole('button',{name:'Cancel booking',exact:true}).click();
    await expect.poll(async()=>(await request(`/api/trips/${tripId}`)).data.trip.reserved_seats).toBe(before-1);
  });
  await check('Owner can read persisted audit events', async () => {
    await page.locator('#load-audit-btn').click(); await expect(page.locator('.audit-row').first()).toBeVisible();
    await expect(page.locator('#audit-list')).toContainText('booking_created');
  });
  await check('Stale edit shows conflict and preserves unsaved title', async () => {
    const version=(await request(`/api/trips/${tripId}`)).data.trip.version;
    assert.equal((await request(`/api/trips/${tripId}`,'PATCH',{title:'Updated elsewhere',version})).status,200);
    await page.locator('#rename-title').fill('My unsaved edit'); await page.locator('#rename-btn').click();
    await expect(page.locator('#rename-result')).toContainText(/conflict/i);
    await expect(page.locator('#rename-title')).toHaveValue('My unsaved edit');
    await page.locator('.trip-row').getByRole('button',{name:'View',exact:true}).click();
  });
  await check('Contact form recognizes actual captured status and records no production email', async () => {
    await page.getByLabel('Name',{exact:true}).fill('Trip visitor');
    await page.getByLabel('Email',{exact:true}).fill('trip-visitor@example.test');
    await page.getByLabel('Message',{exact:true}).fill('Can we move the departure to sunrise?');
    await page.locator('#contact-btn').click();
    await expect(page.locator('#contact-result')).toContainText(/captured/i);
    await expect(page.locator('#contact-result')).toContainText(/no email/i);
    const inbox=await (await app.control('/inbox')).json(); assert.ok(inbox.messages.some(m=>m.email==='trip-visitor@example.test'));
  });
  await check('Injected HTML and attribute text render without executable DOM', async () => {
    const title='Trip" autofocus onfocus="window.__waypoint_xss=1';
    const version=(await request(`/api/trips/${tripId}`)).data.trip.version;
    assert.equal((await request(`/api/trips/${tripId}`,'PATCH',{title,version})).status,200);
    await page.locator('.trip-row').getByRole('button',{name:'View',exact:true}).click();
    await expect(page.locator('#trip-detail-title')).toHaveText(title);
    await page.locator('#rename-title').focus();
    assert.equal(await page.locator('#rename-title').getAttribute('onfocus'),null);
    assert.equal(await page.evaluate(()=>window.__waypoint_xss),undefined);
    assert.equal(await page.locator('#rename-title').inputValue(),title);
  });
  // Restore a readable title for the screenshots.
  const latest=(await request(`/api/trips/${tripId}`)).data.trip.version;
  await request(`/api/trips/${tripId}`,'PATCH',{title:'Hunza field trip',version:latest});
  await page.reload(); await page.waitForLoadState('networkidle');
  await page.locator('.trip-row').getByRole('button',{name:'View',exact:true}).click();
  await check('Dynamic inputs have persistent visible labels and accessible names', async () => {
    for (const [id,name] of [['rename-title','New trip title'],['member-id','Teammate user ID'],['booking-seats','Seats to book'],['expense-description','Expense description'],['expense-amount','Amount in dollars']]) {
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
      await expect(page.locator('#'+id)).toHaveAccessibleName(name);
    }
  });
  await check('Desktop and narrow mobile layout fit the viewport', async () => {
    await mkdir(resolve(root,'screenshots'),{recursive:true});
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.screenshot({path:resolve(root,`screenshots/${original?'original':'reviewed'}-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`Overflow at ${width}px`);
    }
  });
  await check('Teammate has no owner controls; outsider sees no private trip',async()=>{
    for(const user of ['bob','eve']){
      const other=await browser.newContext();
      await other.request.post(app.origin+'/__test/login',{headers:{Origin:app.origin},data:{user}});
      const p=await other.newPage(); await p.goto(app.origin); await p.waitForLoadState('networkidle');
      if(user==='bob'){
        await p.locator('.trip-row').getByRole('button',{name:'View',exact:true}).click();
        await expect(p.locator('#booking-seats')).toBeVisible();
        await expect(p.locator('#rename-btn,#invite-btn,#load-audit-btn')).toHaveCount(0);
        await expect(p.locator('.cancel-booking-btn')).toHaveCount(0);
      }else await expect(p.locator('.trip-row')).toHaveCount(0);
      await other.close();
    }
  });
  await check('No uncaught browser errors',async()=>assert.deepEqual(errors,[]));
} finally {
  if(browser) await browser.close();
  await app.close();
  const report={scope:'Browser → loopback HTTP → generated Worker → real local D1; contact → actual BrainHalf runtime SQLite. Fixture identities, no Google consent or email sending.',passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,errors,results};
  await writeFile(resolve(root,original?'original-browser-results.json':'browser-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,failed:report.failed}));
  if(report.failed) process.exitCode=1;
}
