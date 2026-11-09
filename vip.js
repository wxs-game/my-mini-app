
const icons={refresh:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M26 12A11 11 0 1 0 27 18"/><path d="M26 4v9h-9"/></svg>',gift:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="5" y="13" width="22" height="15" rx="2"/><path d="M3 10h26v6H3zM16 10v18M16 10C4 9 7 1 12 4c2 1 4 6 4 6Zm0 0c12-1 9-9 4-6-2 1-4 6-4 6Z"/></svg>',star:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="m16 3 4 8 9 1.4-6.5 6.4 1.5 9-8-4.2-8 4.2 1.5-9L3 12.4 12 11Z"/></svg>',bolt:'<svg viewBox="0 0 32 32" fill="currentColor"><path d="M19 2 6 18h9l-2 12 13-17h-9z"/></svg>'};const tiers=[{name:'Без ранга',min:0,max:100,daily:.1},{name:'Дерево',min:100,max:500,daily:.15},{name:'Серебро',min:500,max:1250,daily:.2},{name:'Золото',min:1250,max:2000,daily:.25},{name:'Платина',min:2000,max:3000,daily:.3},{name:'Легенда',min:3000,max:5555.56,daily:.35},{name:'Бог',min:5555.56,max:null,daily:.4}];const details={rake:['Рейкбек','По описанию программы: 1.5% от подходящих ставок с коэффициентом выше ×1.35. Начисление рейкбека пока не подключено.'],cash:['Кешбек','По описанию программы: 5% от проигранной суммы за последние 48 часов с возможностью получения раз в два дня. Здесь показаны только условия.'],daily:['Ежедневка','Размер ежедневного бонуса зависит от ранга: от 0.10 $ до 0.40 $. Ежедневные начисления пока не подключены.'],boost:['Буст','Дополнительный множитель к ежедневному бонусу за ранг. Значения множителя пока не настроены.']};document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icons[el.dataset.icon]);let active=0;let actualTurnover=0;let rewards=[];let claiming=false;const fmt=n=>n.toFixed(2);function render(){let t=tiers[active],val=actualTurnover,p=t.max===null?100:Math.max(0,Math.min(100,Math.round((val-t.min)/(t.max-t.min)*100)));document.getElementById('rank').textContent=t.name;document.getElementById('turnover').textContent='Оборот: '+fmt(val)+' $';document.getElementById('pct').textContent=p+'%';document.getElementById('fill').style.width=p+'%';document.getElementById('daily').textContent=fmt(t.daily)+' $';document.getElementById('nextTier').textContent=t.max===null?'Высший ранг':'Далее: '+tiers[active+1].name;const milestones=document.getElementById('milestones');milestones.replaceChildren();
rewards.filter(r=>r.rank_name===t.name).forEach(r=>{
 const button=document.createElement('button');button.className='milestone';
 button.innerHTML='<span class="gift-icon">'+icons.gift+'</span>';
 const label=document.createElement('span');label.textContent=r.rank_name+' '+['I','II','III'][r.milestone-1];button.append(label);
 const amount=document.createElement('small');amount.textContent=fmt(Number(r.reward_amount))+' $';button.append(amount);
 const status=document.createElement('em');status.textContent=r.claimed?'Получено':r.reached?'Забрать':'Оборот '+fmt(Number(r.threshold))+' $';button.append(status);
 button.disabled=claiming||r.claimed||!r.reached;
 button.onclick=()=>{claiming=true;render();parent.postMessage({type:'WXS_VIP_CLAIM',key:r.key},location.origin)};
 milestones.append(button);
});
document.getElementById('ranks').innerHTML=tiers.map((r,i)=>'<button class="'+(i===active?'active':'')+'" data-rank="'+i+'">'+r.name+'</button>').join('');document.querySelectorAll('[data-rank]').forEach(b=>b.onclick=()=>{active=Number(b.dataset.rank);render()})}render();const shade=document.getElementById('shade'),sheet=document.getElementById('sheet');function close(){shade.classList.remove('open');document.body.style.overflow=''}document.querySelectorAll('[data-info]').forEach(b=>b.onclick=()=>{let d=details[b.dataset.info];document.getElementById('sheetSymbol').innerHTML=icons[b.dataset.info==='rake'?'refresh':b.dataset.info==='cash'?'gift':b.dataset.info==='daily'?'star':'bolt'];document.getElementById('sheetTitle').textContent=d[0];document.getElementById('sheetBody').textContent=d[1];shade.classList.add('open');document.body.style.overflow='hidden'});document.getElementById('close').onclick=close;shade.addEventListener('click',e=>{if(e.target===shade)close()});document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});let sy=0;sheet.addEventListener('touchstart',e=>{sy=e.touches[0].clientY},{passive:true});sheet.addEventListener('touchend',e=>{if(e.changedTouches[0].clientY-sy>90)close()},{passive:true});


window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin)return;
 const data=event.data;
 if(data?.type==='WXS_VIP_TURNOVER'){
  const n=Number(data.turnover);if(!Number.isFinite(n)||n<0)return;
  actualTurnover=n;active=tiers.reduce((idx,t,i)=>n>=t.min?i:idx,0);render();
 }
 if(data?.type==='WXS_VIP_STATE'){
  const state=data.state;
  if(!state||!Number.isFinite(Number(state.turnover))||!Array.isArray(state.milestones))return;
  actualTurnover=Number(state.turnover);rewards=state.milestones;claiming=false;
  active=tiers.reduce((idx,t,i)=>actualTurnover>=t.min?i:idx,0);
  document.getElementById('rewardStatus').textContent=data.message||'Награды за достигнутые этапы можно забрать один раз.';
  document.getElementById('retryRewards').hidden=true;render();
 }
 if(data?.type==='WXS_VIP_ERROR'){
  claiming=false;document.getElementById('rewardStatus').textContent=data.message;
  document.getElementById('retryRewards').hidden=false;render();
 }
});
document.getElementById('retryRewards').onclick=()=>parent.postMessage({type:'WXS_VIP_READY'},location.origin);
parent.postMessage({type:'WXS_VIP_READY'},location.origin);

// Растягиваем same-origin iframe по контенту: прокрутка остаётся одна,
// на странице приложения, а не конфликтует с жестами во вложенном окне.
const postHeight=()=>parent.postMessage({type:'WXS_VIP_HEIGHT',height:Math.ceil(document.documentElement.scrollHeight)},location.origin);
if(window.ResizeObserver)new ResizeObserver(postHeight).observe(document.body);
window.addEventListener('load',postHeight);
requestAnimationFrame(postHeight);
