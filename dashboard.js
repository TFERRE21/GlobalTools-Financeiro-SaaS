(()=>{"use strict";
/* Captura as ações de cadastro antes de qualquer outra rotina do painel. */
document.addEventListener("click",function(event){
 const el=event.target instanceof Element?event.target:null;if(!el)return;
 const button=el.closest("#newAccount,#newCard,#newCostCenter,#newPayable,#newEntry,[data-cancel-form]");
 if(!button)return;
 if(button.matches("[data-cancel-form]")){
   event.preventDefault();
   const formId=button.getAttribute("data-cancel-form");
   const panel=document.getElementById(formId);
   if(panel){panel.classList.add("hidden");panel.style.display="none";}
   return;
 }
 event.preventDefault();
 const panels={newAccount:"accountFormCard",newCard:"cardFormCard",newCostCenter:"costCenterFormCard",newPayable:"payableFormCard",newEntry:"formCard"};
 const panel=document.getElementById(panels[button.id]);
 if(panel){panel.classList.remove("hidden");panel.style.display="block";panel.scrollIntoView({behavior:"smooth",block:"start"});}
 if(button.id==="newPayable"){
   const form=document.getElementById("payableForm");
   if(form){const issue=form.querySelector('[name="issue_date"]'),due=form.querySelector('[name="due_date"]'),today=new Date().toISOString().slice(0,10);if(issue&&!issue.value)issue.value=today;if(due&&!due.value)due.value=today;}
 }
},true);
})();

(()=>{"use strict";const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],cfg=window.GLOBALTOOLS_CONFIG||{},fmt=n=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n||0),dateLabel=s=>{if(!s)return"—";let[y,m,d]=s.slice(0,10).split("-");return d+"/"+m+"/"+y},now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");let db,session,companyId,entries=[],editId=null,plan="não ativo";
let financialAccounts=[],creditCards=[],costCenters=[],payables=[];
let savedCategories=[];
/* Registra os salvamentos antes de inicialização de módulos opcionais; evita submit nativo e retorno à visão geral. */
$("#entryForm").addEventListener("submit",async e=>{e.preventDefault();let f=e.currentTarget,fd=new FormData(f),amount=Number(fd.get("amount")),description=String(fd.get("description")||"").trim(),date=String(fd.get("date")||"");if(!description||amount<=0||!date){msg("Para salvar, preencha descrição, valor maior que zero e data.",true);return}try{await ensureCompanyContext()}catch(contextError){msg("Não foi possível preparar o salvamento: "+(contextError?.message||contextError),true);return}let p={company_id:companyId,created_by:session.user.id,description,category:String(fd.get("category")||"").trim(),transaction_type:fd.get("type"),amount_cents:Math.round(amount*100),transaction_date:date,due_date:fd.get("due_date")||null,status:fd.get("status")||"paid",account_id:fd.get("account_id")||null,credit_card_id:fd.get("credit_card_id")||null,cost_center_id:fd.get("cost_center_id")||null,notes:String(fd.get("notes")||"").trim()},b=$("#saveEntry");b.disabled=true;const oldLabel=b.textContent;b.textContent="Salvando…";try{let r;if(editId){delete p.company_id;delete p.created_by;r=await db.from("transactions").update(p).eq("id",editId).eq("company_id",companyId).select().single()}else r=await db.from("transactions").insert(p).select().single();if(r.error)throw r.error;let x={id:r.data.id,description:r.data.description,category:r.data.category||"",type:r.data.transaction_type,amount:r.data.amount_cents/100,date:r.data.transaction_date,notes:r.data.notes||"",due_date:r.data.due_date||"",status:r.data.status||"paid",account_id:r.data.account_id||"",credit_card_id:r.data.credit_card_id||"",cost_center_id:r.data.cost_center_id||""};entries=editId?entries.map(z=>z.id===editId?x:z):[x,...entries];$("#formCard").classList.add("hidden");clearForm();render();view("transactions");msg(editId?"Lançamento atualizado.":"Lançamento salvo na nuvem.")}catch(err){msg("Falha ao salvar: "+err.message,true)}finally{b.disabled=false;b.textContent=oldLabel||"Salvar"}});$("#accountForm").addEventListener("submit",e=>saveManagedForm(e,"account"));
$("#cardForm").addEventListener("submit",e=>saveManagedForm(e,"card"));
$("#costCenterForm").addEventListener("submit",e=>saveManagedForm(e,"costcenter"));
$("#payableForm").addEventListener("submit",e=>saveManagedForm(e,"payable"));
function msg(t,err=false){let e=$("#message");e.classList.remove("hidden");e.textContent=t;e.className="notice"+(err?"":" ok")}function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}function sum(a,t){return a.filter(x=>x.type===t).reduce((s,x)=>s+x.amount,0)}function sorted(a){return[...a].sort((x,y)=>y.date.localeCompare(x.date))}function rows(a,actions=false){if(!a.length)return'<tr><td colspan="'+(actions?6:5)+'" class="empty">Nenhum lançamento encontrado.</td></tr>';return sorted(a).map(x=>'<tr><td><strong>'+esc(x.description)+'</strong>'+(x.notes?'<div>'+esc(x.notes)+'</div>':'')+'</td><td>'+esc(x.category||"Sem categoria")+'</td><td>'+dateLabel(x.date)+'</td><td><span class="pill '+(x.type==="expense"?"off":"")+'">'+(x.type==="income"?"Entrada":"Despesa")+'</span></td><td class="right '+(x.type==="expense"?"red":"")+'">'+(x.type==="expense"?"− ":"+ ")+fmt(x.amount)+'</td>'+(actions?'<td><button class="btn" data-edit="'+esc(x.id)+'">Editar</button> <button class="btn danger" data-delete="'+esc(x.id)+'">Excluir</button></td>':'')+'</tr>').join("")}function chart(){let c=$("#chart");if(!c)return;let w=c.clientWidth,h=c.clientHeight,dpr=devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;let x=c.getContext("2d");x.scale(dpr,dpr);x.clearRect(0,0,w,h);let ms=[];for(let i=5;i>=0;i--){let d=new Date(now.getFullYear(),now.getMonth()-i,1);ms.push({y:d.getFullYear(),m:d.getMonth(),label:d.toLocaleDateString("pt-BR",{month:"short"}).replace(".",""),income:0,expense:0})}entries.forEach(e=>{let d=new Date(e.date+"T12:00:00"),m=ms.find(z=>z.y===d.getFullYear()&&z.m===d.getMonth());if(m)m[e.type]+=e.amount});let max=Math.max(1,...ms.flatMap(m=>[m.income,m.expense]))*1.15,top=10,bottom=26,ph=h-top-bottom,slot=(w-16)/ms.length;x.strokeStyle="#e8eef5";x.fillStyle="#7a8aa0";x.font="10px Inter";for(let i=0;i<4;i++){let y=top+ph*i/3;x.beginPath();x.moveTo(8,y);x.lineTo(w-8,y);x.stroke()}ms.forEach((m,i)=>{let cx=8+slot*(i+.5),bw=Math.min(17,slot*.23),ih=m.income/max*ph,eh=m.expense/max*ph;x.fillStyle="#08a875";x.fillRect(cx-bw-2,top+ph-ih,bw,ih);x.fillStyle="#ef6873";x.fillRect(cx+2,top+ph-eh,bw,eh);x.textAlign="center";x.fillStyle="#71819a";x.fillText(m.label,cx,h-7)})}const DEFAULT_CATEGORIES=[
 ["Alimentação","expense"],["Moradia","expense"],["Transporte","expense"],["Saúde","expense"],["Educação","expense"],
 ["Lazer","expense"],["Compras","expense"],["Contas e serviços","expense"],["Assinaturas","expense"],["Impostos e taxas","expense"],
 ["Salário","income"],["Vendas","income"],["Serviços prestados","income"],["Investimentos","both"],["Outros","both"]
];
async function loadCategoryMaster(){
 const defaults=DEFAULT_CATEGORIES.map(([name,category_type])=>({company_id:companyId,name,category_type,is_default:true,created_by:session.user.id}));
 try{
  const seed=await db.from("categories").upsert(defaults,{onConflict:"company_id,name,category_type",ignoreDuplicates:true});
  if(seed.error)console.warn("Categorias sugeridas não puderam ser criadas automaticamente:",seed.error.message);
 }catch(err){console.warn("Falha ao preparar categorias sugeridas:",err?.message||err)}
 try{
  const result=await db.from("categories").select("id,name,category_type,is_default,created_at").eq("company_id",companyId).order("name");
  if(result.error)throw result.error;
  savedCategories=result.data||[];
 }catch(err){
  console.error("Não foi possível consultar categorias:",err);
  savedCategories=[];
  const out=$("#categoryMessage");
  if(out){out.textContent="Não foi possível carregar categorias salvas: "+(err?.message||String(err));out.classList.remove("hidden");out.classList.add("error")}
 }
 categories();
}
function categories(){
 let groups={};
 entries.forEach(e=>{let k=e.category||"Sem categoria";if(!groups[k])groups[k]={income:0,expense:0,count:0};groups[k][e.type]+=e.amount;groups[k].count++});
 let expenses=Object.entries(groups).filter(([k,v])=>v.expense>0).sort((a,b)=>b[1].expense-a[1].expense),max=expenses[0]?.[1].expense||1,total=expenses.reduce((s,[k,v])=>s+v.expense,0);
 $("#categoryBars").innerHTML=expenses.length?expenses.slice(0,7).map(([k,v])=>'<div class="barrow"><span>'+esc(k)+'</span><strong>'+fmt(v.expense)+'</strong><small>'+Math.round(v.expense/(total||1)*100)+'%</small><div class="bar"><span style="width:'+v.expense/max*100+'%"></span></div></div>').join(""):'<p class="empty">Sem despesas registradas.</p>';
 const categoryNames=[...new Set([...savedCategories.map(x=>x.name),...entries.map(e=>e.category).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,"pt-BR"));
 $("#categoryGrid").innerHTML=categoryNames.length?categoryNames.map(name=>{const row=savedCategories.find(x=>x.name===name),g=groups[name]||{income:0,expense:0,count:0};return '<article class="catitem"><div class="category-item-title"><span>'+esc(name)+'</span>'+(row?.is_default?'<small class="category-default">Sugerida</small>':'<button type="button" class="btn danger category-delete" data-delete-category="'+esc(row?.id||'')+'">Excluir</button>')+'</div><strong>'+fmt(g.income-g.expense)+'</strong><small>'+g.count+' lançamento(s)</small><p>Entradas '+fmt(g.income)+'<br>Despesas '+fmt(g.expense)+'</p><small class="muted">'+(row?({income:"Entradas",expense:"Despesas",both:"Entradas e despesas"}[row.category_type]||"Personalizada"):"Usada em lançamentos")+'</small></article>'}).join(""):'<article class="card empty">Nenhuma categoria cadastrada.</article>';
 $("#categoryCount").textContent=savedCategories.length+" categorias";
 $("#categoriesList").innerHTML=categoryNames.map(x=>'<option value="'+esc(x)+'"></option>').join("");
}
$("#categoryForm").addEventListener("submit",async e=>{
 e.preventDefault();const form=e.currentTarget,fd=new FormData(form),name=String(fd.get("name")||"").trim(),category_type=String(fd.get("category_type")||"both"),btn=$("#saveCategory"),out=$("#categoryMessage");
 if(!name){out.textContent="Informe o nome da categoria.";out.classList.remove("hidden");return}
 try{
  await ensureCompanyContext();
  const duplicate=savedCategories.some(x=>x.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR")&&x.category_type===category_type);
  if(duplicate)throw new Error("Essa categoria já está cadastrada com essa aplicação.");
  btn.disabled=true;btn.textContent="Salvando…";
  const result=await db.from("categories").insert({company_id:companyId,name,category_type,created_by:session.user.id}).select("id,name,category_type,is_default,created_at").single();
  if(result.error)throw result.error;
  savedCategories.push(result.data);form.reset();form.elements.category_type.value="both";categories();
  out.textContent="Categoria cadastrada e salva com sucesso.";out.classList.remove("hidden");out.classList.remove("error");
 }catch(err){out.textContent="Não foi possível salvar a categoria: "+(err?.message||String(err));out.classList.remove("hidden");out.classList.add("error")}
 finally{btn.disabled=false;btn.textContent="Adicionar categoria"}
});
$("#categoryGrid").addEventListener("click",async e=>{
 const btn=e.target.closest("[data-delete-category]");if(!btn||!btn.dataset.deleteCategory)return;
 const row=savedCategories.find(x=>x.id===btn.dataset.deleteCategory);if(!row||row.is_default)return;
 if(!confirm('Excluir a categoria "'+row.name+'"? Os lançamentos já registrados não serão apagados.'))return;
 btn.disabled=true;
 const result=await db.from("categories").delete().eq("id",row.id).eq("company_id",companyId);
 if(result.error){msg("Não foi possível excluir a categoria: "+result.error.message,true);btn.disabled=false;return}
 savedCategories=savedCategories.filter(x=>x.id!==row.id);categories();msg("Categoria excluída.");
});
function report(){let a=entries.filter(x=>(!$("#dateFrom").value||x.date>=$("#dateFrom").value)&&(!$("#dateTo").value||x.date<=$("#dateTo").value));$("#rIncome").textContent=fmt(sum(a,"income"));$("#rExpense").textContent=fmt(sum(a,"expense"));$("#rBalance").textContent=fmt(sum(a,"income")-sum(a,"expense"));$("#rCount").textContent=a.length;$("#reportRows").innerHTML=rows(a)}function render(){let i=sum(entries,"income"),o=sum(entries,"expense");$("#sumIncome").textContent=fmt(i);$("#sumExpense").textContent=fmt(o);$("#sumBalance").textContent=fmt(i-o);$("#sumCount").textContent=entries.length;$("#recentRows").innerHTML=rows(sorted(entries).slice(0,5));let f=$("#filterType").value,q=$("#searchEntry").value.toLowerCase().trim();$("#entryRows").innerHTML=rows(entries.filter(e=>(f==="all"||e.type===f)&&(!q||(e.description+" "+e.category).toLowerCase().includes(q))),true);categories();report();chart()}function csv(a){let lines=[["Descrição","Categoria","Data","Tipo","Valor","Observações"],...sorted(a).map(e=>[e.description,e.category,e.date,e.type==="income"?"Entrada":"Despesa",e.amount.toFixed(2).replace(".",","),e.notes])],content="\uFEFF"+lines.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n"),url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"})),aEl=document.createElement("a");aEl.href=url;aEl.download="base-financeira-"+today+".csv";aEl.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}function view(v){$(".view").forEach(e=>e.classList.toggle("active",e.id==="view-"+v));$("[data-view]").forEach(e=>e.classList.toggle("active",e.dataset.view===v));let t={overview:["Visão geral","Resumo da sua vida financeira."],transactions:["Lançamentos","Registre e gerencie entradas e despesas."],categories:["Categorias","Acompanhe os valores por categoria."],reports:["Relatórios","Filtre e analise seu período financeiro."],export:["Exportar dados","Baixe seus registros em CSV."],account:["Minha conta","Dados da conta e situação do plano."],billing:["Assinatura e pagamentos","Renove, atualize o pagamento ou cancele seu plano."]}[v];$("#pageTitle").textContent=t[0];$("#pageSub").textContent=t[1];window.scrollTo({top:0,behavior:"smooth"});if(v==="overview")chart()}// Navegação delegada no início para continuar disponível mesmo se um módulo secundário falhar.
document.addEventListener('click',function(ev){const nav=ev.target.closest('[data-view]');if(nav){ev.preventDefault();try{view(nav.dataset.view)}catch(err){console.error('Falha na navegação',err)}}const go=ev.target.closest('[data-go]');if(go){ev.preventDefault();try{view(go.dataset.go)}catch(err){console.error('Falha na navegação',err)}}});

async function runBillingAction(action){
 const out=$("#billingMessage");const btn=action==="checkout"?$("#startCheckout"):$("#manageBilling");
 if(!db||!session){out.textContent="Sua sessão ainda está carregando. Atualize a página e entre novamente.";return}
 btn.disabled=true;out.textContent="Conectando ao Stripe…";
 try{
  const {data,error}=await db.functions.invoke("billing",{body:{action}});
  if(error)throw error;
  if(!data?.url)throw new Error(data?.error||"O Stripe não retornou um link.");
  window.location.assign(data.url);
 }catch(err){
  const context=String(err?.message||err);
  out.textContent=context.includes("STRIPE_SECRET_KEY")||context.includes("Failed to send a request")?"A integração de cobrança ainda precisa de configuração no servidor. Entre em contato com o administrador.":context;
 }finally{btn.disabled=false}
}
$("#startCheckout").addEventListener("click",()=>runBillingAction("checkout"));
$("#manageBilling").addEventListener("click",()=>runBillingAction("portal"));

function clearForm(){editId=null;$("#entryForm").reset();$("#entryForm").elements.date.value=today;$("#formTitle").textContent="Novo lançamento";$("#saveEntry").textContent="Salvar"}function openForm(e){clearForm();if(e){editId=e.id;let f=$("#entryForm");f.elements.description.value=e.description;f.elements.type.value=e.type;f.elements.amount.value=e.amount;f.elements.date.value=e.date;f.elements.category.value=e.category;f.elements.notes.value=e.notes;f.elements.due_date.value=e.due_date||"";f.elements.status.value=e.status||"paid";f.elements.account_id.value=e.account_id||"";f.elements.credit_card_id.value=e.credit_card_id||"";f.elements.cost_center_id.value=e.cost_center_id||"";$("#formTitle").textContent="Editar lançamento";$("#saveEntry").textContent="Salvar alterações"}$("#formCard").classList.remove("hidden");$("#formCard").scrollIntoView({behavior:"smooth"})}async function init(){if(!window.supabase||!cfg.supabaseUrl||!cfg.supabaseAnonKey){location.replace("conta.html");return}db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);let s=await db.auth.getSession();if(!s.data.session){location.replace("conta.html");return}session=s.data.session;let name=session.user.user_metadata?.full_name||session.user.email.split("@")[0];$("#userName").textContent=name;$("#userEmail").textContent=session.user.email;$("#accountName").textContent=name;$("#accountEmail").textContent=session.user.email;let c=await db.from("companies").select("id,display_name").eq("owner_id",session.user.id).limit(1).maybeSingle();if(c.error)throw c.error;let company=c.data;if(!company){let r=await db.from("companies").insert({owner_id:session.user.id,display_name:name+" — empresa"}).select("id,display_name").single();if(r.error)throw r.error;company=r.data}companyId=company.id;$("#accountCompany").textContent=company.display_name;await loadCategoryMaster();let sr=await db.from("subscriptions").select("status,current_period_end,cancel_at_period_end").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();$("#billingPeriod").textContent="Nenhuma assinatura encontrada.";if(sr.error)plan="não foi possível verificar";else if(sr.data){let sub=sr.data;$("#billingPeriod").textContent=(sub.current_period_end?"Período atual até "+dateLabel(sub.current_period_end):"Data de renovação indisponível")+(sub.cancel_at_period_end?" · Cancelamento agendado":"");let valid=!sub.current_period_end||new Date(sub.current_period_end).getTime()>Date.now();plan=["active","trialing"].includes(sub.status)&&valid?(sub.status==="active"?"ativo":"em teste"):sub.status==="past_due"?"pagamento pendente":"inativo"}$("#sidePlan").textContent="Plano: "+plan;$("#accountPlan").textContent=plan;$("#billingStatus").textContent=plan;$("#billingStatus").textContent=plan;$("#planNotice").textContent="Plano: "+plan+". O painel básico está disponível. Recursos pagos só devem ser liberados após validação segura do pagamento.";let tr=await db.from("transactions").select("id,description,category,transaction_type,amount_cents,transaction_date,notes,due_date,status,account_id,cost_center_id,credit_card_id").eq("company_id",companyId).order("transaction_date",{ascending:false});if(tr.error)throw tr.error;entries=(tr.data||[]).map(e=>({id:e.id,description:e.description,category:e.category||"",type:e.transaction_type,amount:Number(e.amount_cents)/100,date:e.transaction_date,notes:e.notes||"",due_date:e.due_date||"",status:e.status||"paid",account_id:e.account_id||"",cost_center_id:e.cost_center_id||"",credit_card_id:e.credit_card_id||""}));await loadExtras();render()}$("#entryRows").addEventListener("click",async e=>{let ed=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(ed){let x=entries.find(z=>z.id===ed.dataset.edit);if(x)openForm(x)}if(del){let x=entries.find(z=>z.id===del.dataset.delete);if(!x||!confirm('Excluir "'+x.description+'"?'))return;let r=await db.from("transactions").delete().eq("id",x.id).eq("company_id",companyId);if(r.error){msg("Falha ao excluir: "+r.error.message,true);return}entries=entries.filter(z=>z.id!==x.id);render();msg("Lançamento excluído.")}});$("[data-view]").forEach(b=>b.addEventListener("click",()=>view(b.dataset.view)));$("[data-go]").forEach(b=>b.addEventListener("click",()=>view(b.dataset.go)));$("#newEntry").addEventListener("click",()=>openForm());$("#cancelForm").addEventListener("click",()=>{$("#formCard").classList.add("hidden");clearForm()});$("#filterType").addEventListener("change",render);$("#searchEntry").addEventListener("input",render);$("#exportEntries").addEventListener("click",()=>csv(entries));$("#exportAll").addEventListener("click",()=>csv(entries));$("#exportReport").addEventListener("click",()=>csv(entries.filter(e=>(!$("#dateFrom").value||e.date>=$("#dateFrom").value)&&(!$("#dateTo").value||e.date<=$("#dateTo").value))));$("#applyDates").addEventListener("click",report);$("#logout").addEventListener("click",async()=>{await db.auth.signOut();location.replace("conta.html")});let first=new Date(now.getFullYear(),now.getMonth(),1);$("#dateFrom").value=[first.getFullYear(),String(first.getMonth()+1).padStart(2,"0"),"01"].join("-");$("#dateTo").value=today;window.addEventListener("resize",()=>{if($("#view-overview").classList.contains("active"))chart()});
function loadRowsTable(id,items,cols,actions=true){const el=$(id);if(!items.length){el.innerHTML='<tr><td colspan="'+(cols+ (actions?1:0))+'" class="empty">Nenhum registro cadastrado.</td></tr>';return}el.innerHTML=items.map(x=>'<tr>'+x.cells.map(v=>'<td>'+v+'</td>').join('')+(actions?'<td>'+(x.kind==='payable'&&x.status==='pending'?'<button class="btn primary" data-paid="'+esc(x.id)+'">Marcar paga</button> ':'')+'<button class="btn danger" data-remove="'+esc(x.id)+'" data-kind="'+x.kind+'">Excluir</button></td>':'')+'</tr>').join('')}
function options(id,items,label){$(id).innerHTML='<option value="">Sem vínculo</option>'+items.map(x=>'<option value="'+esc(x.id)+'">'+esc(label(x))+'</option>').join('')}
async function loadExtras(){const results=await Promise.all([db.from('financial_accounts').select('*').eq('company_id',companyId).order('created_at'),db.from('credit_cards').select('*').eq('company_id',companyId).order('created_at'),db.from('cost_centers').select('*').eq('company_id',companyId).order('name'),db.from('payables').select('*').eq('company_id',companyId).order('due_date')]);const names=['contas financeiras','cartões','centros de custo','contas a pagar'];results.forEach((r,i)=>{if(r.error){console.error('Falha ao carregar '+names[i],r.error);msg('Alguns módulos não puderam carregar ('+names[i]+'): '+r.error.message,true)}});financialAccounts=results[0].error?[]:(results[0].data||[]);creditCards=results[1].error?[]:(results[1].data||[]);costCenters=results[2].error?[]:(results[2].data||[]);payables=results[3].error?[]:(results[3].data||[]);renderExtras()}
function renderExtras(){loadRowsTable('#accountsRows',financialAccounts.map(x=>({id:x.id,kind:'account',cells:['<strong>'+esc(x.name)+'</strong>',esc(x.institution||'—'),esc(({checking:'Conta corrente',savings:'Poupança',cash:'Caixa',investment:'Investimento',other:'Outra'})[x.account_type]||x.account_type),fmt(Number(x.opening_balance_cents||0)/100),x.is_active?'Ativa':'Inativa']})),5);loadRowsTable('#cardsRows',creditCards.map(x=>({id:x.id,kind:'card',cells:['<strong>'+esc(x.name)+'</strong>',esc(x.issuer||'—'),x.last_four?'•••• '+esc(x.last_four):'—',fmt(Number(x.credit_limit_cents||0)/100),String(x.closing_day),String(x.due_day)]})),6);loadRowsTable('#costCentersRows',costCenters.map(x=>({id:x.id,kind:'costcenter',cells:['<strong>'+esc(x.name)+'</strong>',esc(x.code||'—'),esc(x.description||'—')]})),3);const f=$('#payableFilter')?.value||'pending',today=new Date().toISOString().slice(0,10),filtered=payables.filter(x=>f==='all'||x.status===f||(f==='overdue'&&x.status==='pending'&&x.due_date<today));loadRowsTable('#payablesRows',filtered.map(x=>({id:x.id,kind:'payable',status:x.status,cells:['<strong>'+esc(x.description)+'</strong>',esc(x.supplier||'—'),dateLabel(x.due_date),esc(costCenters.find(z=>z.id===x.cost_center_id)?.name||'—'),x.status==='paid'?'<span class="pill">Paga</span>':x.status==='cancelled'?'<span class="pill off">Cancelada</span>':x.due_date<today?'<span class="pill off">Vencida</span>':'<span class="pill">Pendente</span>','<span class="right">'+fmt(Number(x.amount_cents)/100)+'</span>']})),6);options('#payableAccount',financialAccounts,x=>x.name);options('#payableCard',creditCards,x=>x.name);options('#payableCostCenter',costCenters,x=>x.name);options('#entryAccount',financialAccounts,x=>x.name);options('#entryCard',creditCards,x=>x.name);options('#entryCostCenter',costCenters,x=>x.name);const alerts=payables.filter(x=>x.status==='pending').sort((a,b)=>a.due_date.localeCompare(b.due_date));const alertHtml=alerts.length?alerts.map(x=>{const days=Math.ceil((new Date(x.due_date+'T12:00:00')-new Date(today+'T12:00:00'))/86400000),status=days<0?'VENCIDA':days===0?'VENCE HOJE':days<=7?'VENCE EM '+days+' DIA(S)':'A VENCER';return '<article class="card"><strong>'+esc(x.description)+'</strong><p>'+esc(x.supplier||'')+' · Vencimento: '+dateLabel(x.due_date)+'</p><p>'+fmt(Number(x.amount_cents)/100)+' · <span class="pill '+(days<=7?'off':'')+'">'+status+'</span></p></article>'}).join(''):'<article class="card empty">Nenhuma conta pendente cadastrada.</article>';$('#alertsList').innerHTML=alertHtml;$('#overviewAlerts').innerHTML=alerts.length?alerts.slice(0,4).map(x=>{let days=Math.ceil((new Date(x.due_date+'T12:00:00')-new Date(today+'T12:00:00'))/86400000);return '<p><strong>'+esc(x.description)+'</strong> — '+fmt(Number(x.amount_cents)/100)+' · '+dateLabel(x.due_date)+(days<0?' · VENCIDA':days===0?' · VENCE HOJE':days<=7?' · Próxima do vencimento':'')+'</p>'}).join(''):'Nenhuma conta pendente cadastrada.'}
function view(v){$$('.view').forEach(e=>e.classList.toggle('active',e.id==='view-'+v));$$('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===v));const t={overview:['Visão geral','Resumo da sua vida financeira.'],transactions:['Lançamentos','Registre e gerencie entradas e despesas.'],categories:['Categorias','Acompanhe os valores por categoria.'],reports:['Relatórios','Filtre e analise seu período financeiro.'],export:['Exportar dados','Baixe seus registros em CSV.'],account:['Minha conta','Dados da conta e situação do plano.'],accounts:['Contas financeiras','Gerencie bancos, caixas e saldos iniciais.'],cards:['Cartões de crédito','Controle limite, fechamento e vencimento.'],costcenters:['Centros de custo','Organize receitas e despesas por área.'],payables:['Contas a pagar','Acompanhe vencimentos e pagamentos.'],alerts:['Central de alertas','Veja contas vencidas e próximas do vencimento.']}[v]||['Painel','Gestão financeira'];$('#pageTitle').textContent=t[0];$('#pageSub').textContent=t[1];window.scrollTo({top:0,behavior:'smooth'});if(v==='overview')chart()}
async function ensureCompanyContext(){
 if(!window.supabase||!cfg.supabaseUrl||!cfg.supabaseAnonKey)throw new Error("A configuração do banco não carregou. Atualize o painel.");
 if(!db)db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 if(!session?.user?.id){const auth=await db.auth.getSession();if(auth.error)throw new Error("Não foi possível recuperar a sessão: "+auth.error.message);session=auth.data?.session;}
 if(!session?.user?.id)throw new Error("Sua sessão expirou. Entre novamente no painel.");
 if(!companyId){const userName=session.user.user_metadata?.full_name||session.user.email?.split("@")[0]||"Minha empresa";const found=await db.from("companies").select("id,display_name").eq("owner_id",session.user.id).limit(1).maybeSingle();if(found.error)throw new Error("Não foi possível localizar sua empresa: "+found.error.message);let company=found.data;if(!company){const created=await db.from("companies").insert({owner_id:session.user.id,display_name:userName+" — empresa"}).select("id,display_name").single();if(created.error)throw new Error("Não foi possível criar sua empresa: "+created.error.message);company=created.data;}companyId=company.id;const label=$("#accountCompany");if(label)label.textContent=company.display_name||"Minha empresa";}
 return {db,session,companyId};
}
async function insertManaged(table,payload){
 await ensureCompanyContext();
 if(!db||!session?.user?.id||!companyId)throw new Error("Sessão ou empresa não identificada. Saia da conta e entre novamente.");
 const clean={...payload,company_id:companyId};
 if(table!=="cost_centers")clean.created_by=session.user.id;
 const r=await db.from(table).insert(clean).select().single();
 if(r.error){const code=r.error.code||"sem código";throw new Error((r.error.message||"Erro ao gravar no banco")+" (código "+code+"). "+(r.error.details||r.error.hint||""))}
 if(!r.data)throw new Error("O banco não confirmou a gravação. Atualize a página e verifique as permissões.");
 return r.data
}
$('#backButton').addEventListener('click',()=>{location.href='index.html'});
$('#newAccount').addEventListener('click',()=>$('#accountFormCard').classList.remove('hidden'));
$('#newCard').addEventListener('click',()=>$('#cardFormCard').classList.remove('hidden'));
$('#newCostCenter').addEventListener('click',()=>$('#costCenterFormCard').classList.remove('hidden'));
$('#newPayable').addEventListener('click',()=>{$('#payableFormCard').classList.remove('hidden');const f=$('#payableForm');if(!f.elements.issue_date.value)f.elements.issue_date.value=today;if(!f.elements.due_date.value)f.elements.due_date.value=today});
$$('[data-cancel-form]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.cancelForm).classList.add('hidden')));
async function saveManagedForm(e,kind){
 e.preventDefault();const f=e.currentTarget,d=new FormData(f),submit=f.querySelector('button[type="submit"]')||f.querySelector('button:not([type])');
 const oldText=submit?.textContent;if(submit){submit.disabled=true;submit.textContent="Salvando…"}
 try{
  if(kind==="account"){
   const name=String(d.get("name")||"").trim();if(!name)throw new Error("Informe o nome da conta.");
   await insertManaged("financial_accounts",{name,account_type:String(d.get("account_type")||"checking"),institution:String(d.get("institution")||"").trim()||null,opening_balance_cents:Math.round(Number(d.get("balance")||0)*100)});
   f.reset();$("#accountFormCard").classList.add("hidden");await loadExtras();msg("Conta financeira cadastrada com sucesso.");
  }else if(kind==="card"){
   const name=String(d.get("name")||"").trim(),closing=Number(d.get("closing_day")),due=Number(d.get("due_day"));
   if(!name)throw new Error("Informe o nome do cartão.");if(closing<1||closing>31||due<1||due>31)throw new Error("Informe dias de fechamento e vencimento entre 1 e 31.");
   const last=String(d.get("last_four")||"").trim();if(last&&!/^\d{4}$/.test(last))throw new Error("Informe apenas os quatro últimos dígitos do cartão.");
   await insertManaged("credit_cards",{name,issuer:String(d.get("issuer")||"").trim()||null,last_four:last||null,credit_limit_cents:Math.round(Number(d.get("limit")||0)*100),closing_day:closing,due_day:due});
   f.reset();$("#cardFormCard").classList.add("hidden");await loadExtras();msg("Cartão cadastrado com sucesso.");
  }else if(kind==="costcenter"){
   const name=String(d.get("name")||"").trim();if(!name)throw new Error("Informe o nome do centro de custo.");
   await insertManaged("cost_centers",{name,code:String(d.get("code")||"").trim()||null,description:String(d.get("description")||"").trim()||null});
   f.reset();$("#costCenterFormCard").classList.add("hidden");await loadExtras();msg("Centro de custo cadastrado com sucesso.");
  }else if(kind==="payable"){
   const amount=Number(d.get("amount"));if(!(amount>0))throw new Error("Informe um valor positivo.");
   if(!d.get("issue_date")||!d.get("due_date"))throw new Error("Preencha a data de emissão e o vencimento.");
   await insertManaged("payables",{description:String(d.get("description")||"").trim(),supplier:String(d.get("supplier")||"").trim()||null,amount_cents:Math.round(amount*100),issue_date:d.get("issue_date"),due_date:d.get("due_date"),category:String(d.get("category")||"").trim()||null,account_id:d.get("account_id")||null,credit_card_id:d.get("credit_card_id")||null,cost_center_id:d.get("cost_center_id")||null,notes:String(d.get("notes")||"").trim()||null});
   f.reset();$("#payableFormCard").classList.add("hidden");await loadExtras();msg("Conta a pagar cadastrada com sucesso.");
  }
 }catch(err){
  const detail=err?.message||String(err);msg("Não foi possível salvar: "+(String(detail).includes("cost_centers_company_id_name_key")?"Já existe um centro de custo com esse nome nesta empresa. Confira a lista antes de tentar novamente.":detail),true);
  const box=$("#message");if(box){box.scrollIntoView({behavior:"smooth",block:"center"});box.style.display="block"}
 }finally{if(submit){submit.disabled=false;submit.textContent=oldText||"Salvar"}}
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
$('#payableFilter').addEventListener('change',renderExtras);
document.addEventListener('click',async e=>{const paid=e.target.closest('[data-paid]');if(paid){if(!confirm('Marcar esta conta como paga?'))return;const r=await db.from('payables').update({status:'paid',paid_at:new Date().toISOString()}).eq('id',paid.dataset.paid).eq('company_id',companyId);if(r.error){msg('Não foi possível marcar como paga: '+r.error.message,true);return}await loadExtras();msg('Conta marcada como paga.');return}const b=e.target.closest('[data-remove]');if(!b)return;const table={account:'financial_accounts',card:'credit_cards',costcenter:'cost_centers',payable:'payables'}[b.dataset.kind];if(!table||!confirm('Excluir este registro?'))return;try{if(b.dataset.kind==='payable'){const {error}=await db.from(table).update({status:'cancelled'}).eq('id',b.dataset.remove).eq('company_id',companyId);if(error)throw error}else{const {error}=await db.from(table).delete().eq('id',b.dataset.remove).eq('company_id',companyId);if(error)throw error}await loadExtras();msg(b.dataset.kind==='payable'?'Conta cancelada.':'Registro excluído.')}catch(err){msg('Não foi possível concluir: '+err.message,true)}});
const reportHead=$('#view-reports .head');if(reportHead&&!$('#printReport')){const p=document.createElement('button');p.id='printReport';p.className='btn';p.textContent='Imprimir / Salvar PDF';p.addEventListener('click',()=>window.print());reportHead.appendChild(p)}

/* Ações críticas com delegação global: funcionam mesmo se os handlers individuais falharem. */
document.addEventListener('click',function(ev){
 const target=ev.target instanceof Element?ev.target:null;if(!target)return;
 const openMap={
  newAccount:'#accountFormCard',
  newCard:'#cardFormCard',
  newCostCenter:'#costCenterFormCard',
  newPayable:'#payableFormCard',
  newEntry:'#formCard'
 };
 const opener=target.closest('#newAccount,#newCard,#newCostCenter,#newPayable,#newEntry');
 if(opener){
  ev.preventDefault();
  const panel=$(openMap[opener.id]);
  if(panel){panel.classList.remove('hidden');panel.style.display='block';panel.scrollIntoView({behavior:'smooth',block:'start'});}
  if(opener.id==='newPayable'){
   const form=$('#payableForm');if(form){if(!form.elements.issue_date.value)form.elements.issue_date.value=today;if(!form.elements.due_date.value)form.elements.due_date.value=today;}
  }
  if(opener.id==='newEntry'&&typeof openForm==='function'){try{openForm()}catch(err){console.error(err)}}
 }
 const cancel=target.closest('[data-cancel-form],#cancelForm');
 if(cancel){
  ev.preventDefault();
  const id=cancel.dataset.cancelForm;
  const panel=id?$('#'+id):$('#formCard');
  if(panel){panel.classList.add('hidden');panel.style.display='none';}
 }
},true);

init().then(()=>{if(new URLSearchParams(location.search).get("billing")==="subscribe")runBillingAction("checkout")}).catch(e=>{console.error(e);const text="Não foi possível carregar os dados financeiros: "+(e?.message||String(e))+" — verifique a conexão/permissões do Supabase e atualize a página.";const box=$("#loadError");if(box){box.textContent=text;box.classList.remove("hidden")}msg(text,true);$("#sidePlan").textContent="Plano indisponível";$("#userEmail").textContent=session?.user?.email||"Falha de conexão";})})();