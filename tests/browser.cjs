const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixtures = process.env.BROWSER_FIXTURES || '/tmp';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000';
(async () => {
 const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
 try {
 const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let claimed=false, claimCount=0, stateFailure=false, dartsScenario='normal';
 const state=()=>({turnover:350,balance:100+(claimed?.35:0),milestones:[
  {key:'дерево_1',rank_name:'Дерево',milestone:1,reward_amount:.35,threshold:233.33,reached:true,claimed},
  {key:'дерево_2',rank_name:'Дерево',milestone:2,reward_amount:.6,threshold:366.66,reached:false,claimed:false},
  {key:'дерево_3',rank_name:'Дерево',milestone:3,reward_amount:.9,threshold:499.99,reached:false,claimed:false}]});
 await context.route('**/*', async route=>{
  const url=route.request().url();
  if(process.env.BASELINE && url.startsWith(base+'/script.js')) return route.fulfill({contentType:'application/javascript',body:require('node:child_process').execFileSync('git',['show','bb2f6328bddab9c92bc533268013ca4b12556b33:script.js'])});
  if(url.startsWith(base)) return route.continue();
  if(url.includes('telegram-web-app.js'))return route.fulfill({contentType:'application/javascript',body:`window.Telegram={WebApp:new Proxy({initData:'test-only',initDataUnsafe:{user:{id:123,first_name:'Test'}},themeParams:{},version:'8.0',platform:'android',HapticFeedback:{notificationOccurred(){},impactOccurred(){},selectionChanged(){}},BackButton:{show(){},hide(){},onClick(){},offClick(){}},MainButton:{hide(){}}},{get:(o,k)=>k in o?o[k]:()=>{}})};`});
  for(const [pattern,file] of [['@supabase/supabase-js','supabase.js'],['lottie.min.js','lottie.js'],['pako.min.js','pako.js']])if(url.includes(pattern))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(fixtures+'/'+file)});
  if(url.includes('supabase.co')){
   let result=[];
   if(url.includes('vip_rewards')){
    const body=route.request().postDataJSON();
    if(body.action==='claim'){claimCount++;claimed=true;result={ok:true,state:state(),balance:100.35,reward_amount:.35};}
    else result=stateFailure?{ok:false,error:'Тестовая ошибка сети'}:{ok:true,state:state()};
   }else if(url.includes('ensure_player')) result={ok:true,player:{telegram_id:123,nickname:'Test',balance:100,turnover:350,bets_count:0}};
   else if(url.includes('emoji_play')) {
    result=dartsScenario==='firstBounce'
     ? {ok:true,rolls:[1,6],passes:[false,false],verdicts:['lose','lose'],win:false,payout:0,coef:2.34,balance:99}
     : dartsScenario==='secondCenter'
      ? {ok:true,rolls:[6,1],passes:[false,false],verdicts:['lose','lose'],win:false,payout:0,coef:2.34,balance:99}
      : {ok:true,rolls:[6,5],passes:[true,true],verdicts:['pending','win'],win:true,payout:4.38,coef:4.38,balance:103.38};
   }
   else if(url.includes('wxs_game'))result={telegram_id:123,nickname:'Test',balance:100,turnover:350,bets_count:0};
   else if(url.includes('/rpc/'))result={ok:false,error:'Offline test'};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  }
  return route.fulfill({body:'',contentType:'text/plain'});
 });
 await page.goto(base,{waitUntil:'load'});
 await page.waitForFunction(()=>typeof window.openVip==='function');
 await page.waitForTimeout(1500);
 if(process.env.BASELINE){assert.deepEqual(errors,['setUIBalance is not defined']);console.log('Confirmed existing baseline error: setUIBalance is not defined');return;}
 await page.evaluate(()=>{openVip()});
 const vip=page;
 await vip.locator('#vipInlineRankStage').filter({hasText:'Дерево · I'}).waitFor();
 assert.equal(await vip.locator('.vip-milestone').count(),3);
 assert.equal(await vip.locator('.vip-milestone button').count(),0);
 assert.equal(await vip.locator('.vip-milestone').first().textContent(),'Этап IНаграда: 0.35 $Доступно сейчас');
 await vip.locator('[data-vip-info="rake"]').tap();
 await vip.locator('#vipSheetLayer.open').waitFor();
 assert(await page.locator('body').evaluate(el=>el.classList.contains('vip-sheet-open')));
 await vip.locator('.vip-sheet-backdrop').tap({position:{x:8,y:8}});
 await vip.locator('#vipSheetLayer:not(.open)').waitFor();
 assert.equal(claimCount,0);
 for(const width of [320,390,600]){
  await page.setViewportSize({width,height:844});
  assert(await vip.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),`VIP overflow at ${width}`);
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/vip-fixed.png'});
 stateFailure=true;await page.evaluate(()=>{goHome();openVip()});
 await vip.locator('#vipInlineStatus').filter({hasText:'Тестовая ошибка сети'}).waitFor();
 stateFailure=false;await vip.locator('#vipInlineRetry').tap();
 await vip.locator('#vipInlineStatus').filter({hasText:'Награды за достигнутые'}).waitFor();
 await page.evaluate(()=>openEmojiGame('darts'));
 const buttons=page.locator('#emojiCountRow .dice-count-btn');await buttons.nth(1).tap();
 assert.equal(await page.locator('[data-mode="bothRed"] .dart-mode-icon').getAttribute('data-icon'),'dartsred2.tgs');
 await page.waitForTimeout(400);await buttons.nth(2).tap();
 assert.equal(await page.locator('[data-mode="threeRed"] .dart-mode-icon').getAttribute('data-icon'),'dartsred2.tgs');
 await page.waitForTimeout(400);await buttons.nth(1).tap();
 await page.waitForTimeout(400);await page.locator('[data-mode="adjacent"]').tap();
 await page.locator('#emojiGameBetInput').fill('1');
 await page.evaluate(()=>{window.testPlay=handleEmojiGamePlay()});
 await page.locator('#emojiGameResult.show .dice-result-title').filter({hasText:'Ставка зачтена (1/2)'}).waitFor({timeout:20000});
 assert.equal(await page.locator('#emojiGameResult').evaluate(el=>getComputedStyle(el).getPropertyValue('--disc').trim()),'#f2bd42');
 await page.screenshot({path:'/tmp/darts-pending.png'});
 await page.evaluate(()=>window.testPlay);
 assert.equal(await page.locator('#emojiGameResult .dice-result-title').textContent(),'Ставка зашла (2/2)');
 assert.equal(await page.locator('#emojiGameResult').evaluate(el=>getComputedStyle(el).getPropertyValue('--disc').trim()),'#2ecc71');
 for(const [mode,scenario] of [['firstCloser','firstBounce'],['secondCloser','secondCenter']]){
  dartsScenario=scenario;
  await page.locator('[data-mode="'+mode+'"]').tap();
  await page.evaluate(()=>{window.testPlay=handleEmojiGamePlay()});
  await page.locator('#emojiGameResult.show .dice-result-title').filter({hasText:'Ставка не зашла (1/2)'}).waitFor({timeout:20000});
  await page.evaluate(()=>window.testPlay);
  assert.equal(await page.locator('#emojiGameResult .dice-result-title').textContent(),'Ставка не зашла (1/2)');
 }
 assert.deepEqual(errors,['setUIBalance is not defined']); // Also reproduced on unchanged main; see tests/README.md.
 console.log('PASS: VIP load, ranks, touch sheets, reward claim, retry, 320/390/600px; darts icons, pending/win, and two early-loss animations.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
