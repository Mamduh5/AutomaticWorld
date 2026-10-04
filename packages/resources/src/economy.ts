import { createHash, randomUUID } from 'node:crypto';
import type { WorldRepository } from '../../persistence/src/repository.js';
import { OWNER_ID } from '../../shared/src/index.js';

export const RESOURCE_TYPES = ['COGNITION_CREDIT', 'LOCAL_COMPUTE'] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];
export type ValueKind = 'RESOURCE' | 'CAPITAL';
export interface Balance { total:number; reserved:number; available:number; }
export interface Movement {
  kind:ValueKind; unit:string; amount:number; from:string|null; to:string|null;
  category:string; initiator:string; key:string; reference?:string;
  relatedAgent?:string; artifact?:string; proposal?:string;
}
export interface PurchaseRequest {
  id:string; agent_id:string; resource:string; amount:number; funding_account:string;
  currency:string|null; max_spend:number|null; reason:string; status:'PENDING'|'APPROVED'|'DENIED'|'SETTLED'|'CANCELLED';
  created_tick:number; created_at:string; settlement_id:string|null;
}
export interface PurchaseRequestSummary {
  id:string;resource:string;amount:number;status:PurchaseRequest['status'];createdTick:number;reason:string;
}
const summarizeRequest=(r:PurchaseRequest):PurchaseRequestSummary=>({id:r.id,resource:r.resource,amount:r.amount,status:r.status,createdTick:r.created_tick,reason:r.reason});
export function integer(value:number, positive=false):number {
  if(!Number.isSafeInteger(value)||value<(positive?1:0))throw new Error(`Amount must be a ${positive?'positive':'non-negative'} safe integer`);
  return value;
}
export function currencyCode(value:string):string {
  if(!/^[A-Z]{3}$/.test(value))throw new Error('Currency must be a three-letter uppercase ISO-style code');
  return value;
}
function checkedSum(a:number,b:number):number { integer(a);integer(b);const result=BigInt(a)+BigInt(b);if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Amount exceeds safe integer bounds');return Number(result); }
function difference(a:number,b:number):number {return integer(Number(BigInt(a)-BigInt(b)));}
// Authoritative arithmetic uses integers. Formatting never participates in settlement math.
export function formatCapital(currency:string,amount:number):string {
  currencyCode(currency);integer(amount);
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
  const scale=10n**BigInt(digits),n=BigInt(amount);
  return `${currency} ${n/scale}${digits?'.'+(n%scale).toString().padStart(digits,'0'):''}`;
}
function safeText(value:string, limit=500):string {
  if(value.length>limit||Array.from(value).some(c=>c.charCodeAt(0)<32)||/Bearer\s|\bsk-[\w-]+|(?:api[_ -]?key|password|secret|credential|access[_ -]?token)\s*[:=]|https?:\/\//i.test(value))throw new Error('Use a bounded non-secret reference or memo');
  for(const [key,secret] of Object.entries(process.env))if(/KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL/.test(key)&&secret&&secret.length>=4&&value.includes(secret))throw new Error('Economic metadata cannot contain credentials');
  return value;
}

export class InsufficientReservationBalanceError extends Error {
  constructor(readonly kind:ValueKind,readonly unit:string,readonly requiredReservation:number,readonly available:number){super('Insufficient available balance to reserve');}
}

/** Kernel-owned value boundary. Agent actions only call transfer/request with a fenced actor. */
export class EconomyService {
  constructor(readonly repo:WorldRepository) {}
  get db(){return this.repo.db;}
  version():number {
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='resource_model'").get())return 1;
    return (this.db.prepare('SELECT version FROM resource_model WHERE id=1').get() as {version:number}|undefined)?.version??1;
  }
  requireModel():void { if(this.version()!==2)throw new Error('Resource migration required. Preview with: world resources migrate-legacy --preview; apply explicitly while paused.'); }
  private atomic<T>(fn:()=>T):T {return this.db.transaction(fn).immediate();}
  private schema():void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resource_model(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=2),applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS value_accounts(kind TEXT NOT NULL CHECK(kind IN ('RESOURCE','CAPITAL')),unit TEXT NOT NULL,account TEXT NOT NULL,total INTEGER NOT NULL DEFAULT 0 CHECK(typeof(total)='integer' AND total BETWEEN 0 AND 9007199254740991),reserved INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved)='integer' AND reserved BETWEEN 0 AND total),PRIMARY KEY(kind,unit,account));
      CREATE TABLE IF NOT EXISTS value_ledger(id TEXT PRIMARY KEY,kind TEXT NOT NULL,unit TEXT NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 9007199254740991),from_account TEXT,to_account TEXT,category TEXT NOT NULL,initiator TEXT NOT NULL,tick INTEGER NOT NULL,created_at TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,reference TEXT,related_agent TEXT,artifact TEXT,proposal TEXT,CHECK(from_account IS NOT NULL OR to_account IS NOT NULL));
      CREATE TABLE IF NOT EXISTS value_reservations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,unit TEXT NOT NULL,account TEXT NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 9007199254740991),purpose TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('RESERVED','CONSUMED','RELEASED')),created_at TEXT NOT NULL,resolved_at TEXT);
      CREATE TABLE IF NOT EXISTS reservation_journal(id INTEGER PRIMARY KEY AUTOINCREMENT,reservation_id TEXT NOT NULL REFERENCES value_reservations(id),transition TEXT NOT NULL,amount INTEGER NOT NULL,kind TEXT NOT NULL,unit TEXT NOT NULL,account TEXT NOT NULL,purpose TEXT NOT NULL,tick INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(reservation_id,transition));
      CREATE TABLE IF NOT EXISTS resource_purchase_requests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),resource TEXT NOT NULL,amount INTEGER NOT NULL,funding_account TEXT NOT NULL,currency TEXT,max_spend INTEGER,reason TEXT NOT NULL,status TEXT NOT NULL,created_tick INTEGER NOT NULL,created_at TEXT NOT NULL,settlement_id TEXT);
      CREATE TABLE IF NOT EXISTS resource_run_snapshots(run_id TEXT PRIMARY KEY REFERENCES autonomy_runs(id),initial_cognition INTEGER NOT NULL,initial_local INTEGER NOT NULL,ending_cognition INTEGER,ending_local INTEGER,max_cognition INTEGER,max_local INTEGER,start_ledger_id INTEGER NOT NULL,end_ledger_id INTEGER);
      CREATE TABLE IF NOT EXISTS cognition_opportunities(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),tick INTEGER NOT NULL,context TEXT NOT NULL,output TEXT,status TEXT NOT NULL,action_id TEXT NOT NULL UNIQUE,action_done INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS action_outcomes(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),action TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS execution_outcomes(id TEXT PRIMARY KEY REFERENCES value_reservations(id),result TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_value_ledger_update BEFORE UPDATE ON value_ledger BEGIN SELECT RAISE(ABORT,'Immutable value ledger'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_value_ledger_delete BEFORE DELETE ON value_ledger BEGIN SELECT RAISE(ABORT,'Immutable value ledger'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_reservation_journal_update BEFORE UPDATE ON reservation_journal BEGIN SELECT RAISE(ABORT,'Immutable reservation journal'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_reservation_journal_delete BEFORE DELETE ON reservation_journal BEGIN SELECT RAISE(ABORT,'Immutable reservation journal'); END;
      CREATE UNIQUE INDEX IF NOT EXISTS one_compensation_per_transaction ON value_ledger(artifact) WHERE category='COMPENSATION';
    `);
    for(const [table,column] of [['descendant_proposals','proposer_cognition_contribution'],['descendant_operations','acceptor_cognition_contribution'],['descendant_operations','child_cognition']] as const){
      if(!(this.db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(r=>r.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  }
  initializeNewWorld():void {
    if(this.repo.listAgents().length||this.version()===2)throw new Error('New resource model initialization requires an empty new world');
    this.atomic(()=>{this.schema();this.db.prepare('INSERT INTO resource_model VALUES(1,2,?)').run(new Date().toISOString());this.ensureAccount('RESOURCE','COGNITION_CREDIT','WORLD_RESERVE');this.ensureAccount('RESOURCE','LOCAL_COMPUTE','WORLD_RESERVE');});
  }
  private validateAccount(kind:ValueKind,account:string):void {
    if(account===(kind==='RESOURCE'?'WORLD_RESERVE':'WORLD_TREASURY'))return;
    if(!account.startsWith('AGENT:')||!this.repo.getAgent(account.slice(6))||this.repo.getAgent(account.slice(6))!.id!==account.slice(6))throw new Error('Invalid account; use a world account or AGENT:<existing UUID>');
  }
  private validateUnit(kind:ValueKind,unit:string):void {
    if(kind==='CAPITAL')currencyCode(unit);else if(!RESOURCE_TYPES.includes(unit as ResourceType))throw new Error('Unsupported resource type');
  }
  ensureAccount(kind:ValueKind,unit:string,account:string):void {
    this.validateUnit(kind,unit);this.validateAccount(kind,account);
    this.db.prepare('INSERT OR IGNORE INTO value_accounts(kind,unit,account) VALUES(?,?,?)').run(kind,unit,account);
  }
  ensureAgent(agentId:string):void {this.requireModel();for(const unit of RESOURCE_TYPES)this.ensureAccount('RESOURCE',unit,`AGENT:${agentId}`);}
  balance(kind:ValueKind,unit:string,account:string):Balance {
    this.requireModel();this.validateUnit(kind,unit);this.validateAccount(kind,account);
    const row=this.db.prepare('SELECT total,reserved FROM value_accounts WHERE kind=? AND unit=? AND account=?').get(kind,unit,account) as {total:number;reserved:number}|undefined;
    return {...(row??{total:0,reserved:0}),available:difference(row?.total??0,row?.reserved??0)};
  }
  self(agentId:string){
    const account=`AGENT:${agentId}`;
    return {cognitionCredits:this.balance('RESOURCE','COGNITION_CREDIT',account),localCompute:this.balance('RESOURCE','LOCAL_COMPUTE',account),capital:this.capital(account),cognitionDormant:this.cognitionCapacity(account)<1};
  }
  private cognitionCapacity(account:string):number {
    // An existing logical opportunity can use its own hold. Other holds cannot fund cognition.
    const ongoing=this.db.prepare("SELECT amount FROM value_reservations WHERE account=? AND kind='RESOURCE' AND unit='COGNITION_CREDIT' AND purpose='COGNITION' AND status='RESERVED'").all(account) as {amount:number}[];
    return ongoing.reduce((sum,r)=>checkedSum(sum,r.amount),this.balance('RESOURCE','COGNITION_CREDIT',account).available);
  }
  capital(account:string):Record<string,Balance> {
    this.requireModel();this.validateAccount('CAPITAL',account);
    return Object.fromEntries((this.db.prepare("SELECT unit,total,reserved FROM value_accounts WHERE kind='CAPITAL' AND account=? ORDER BY unit").all(account) as {unit:string;total:number;reserved:number}[]).map(r=>[r.unit,{total:r.total,reserved:r.reserved,available:difference(r.total,r.reserved)}]));
  }
  accounts(kind?:ValueKind):unknown[] {this.requireModel();return kind?this.db.prepare('SELECT *,total-reserved available FROM value_accounts WHERE kind=? ORDER BY account,unit').all(kind):this.db.prepare('SELECT *,total-reserved available FROM value_accounts ORDER BY kind,account,unit').all();}
  ledger(kind?:ValueKind):unknown[] {this.requireModel();return kind?this.db.prepare('SELECT * FROM value_ledger WHERE kind=? ORDER BY rowid').all(kind):this.db.prepare('SELECT * FROM value_ledger ORDER BY rowid').all();}
  private dormancy(account:string,before:number,after:number):void {
    if(account.startsWith('AGENT:')&&(before<1)!==(after<1))this.repo.addEvent(after<1?'COGNITION_DORMANT':'COGNITION_RESTORED',this.repo.getWorld()!.currentTick,null,account.slice(6),{cognitionDormant:after<1});
  }
  private move(input:Movement,skipDormancyAccount?:string):string {
    integer(input.amount);this.validateUnit(input.kind,input.unit);safeText(input.key,200);if(!input.key)throw new Error('Idempotency key is required');safeText(input.category,80);safeText(input.initiator,100);
    for(const text of [input.reference,input.artifact,input.proposal,input.relatedAgent])if(text!==undefined)safeText(text);
    if(!input.from&&!input.to)throw new Error('Movement requires an account');if(input.from===input.to)throw new Error('Source and recipient must differ');
    for(const account of [input.from,input.to])if(account)this.validateAccount(input.kind,account);
    const fingerprint=createHash('sha256').update(JSON.stringify([input.kind,input.unit,input.amount,input.from,input.to,input.category,input.initiator,input.reference??null,input.artifact??null,input.proposal??null,input.relatedAgent??null])).digest('hex');
    const old=this.db.prepare('SELECT id,fingerprint FROM value_ledger WHERE idempotency_key=?').get(input.key) as {id:string;fingerprint:string}|undefined;
    if(old){if(old.fingerprint!==fingerprint)throw new Error('Idempotency key conflicts with an existing event');return old.id;}
    if(input.kind==='RESOURCE'&&input.from===null)checkedSum(this.total(input.unit as ResourceType),input.amount);
    const before=new Map<string,number>();
    for(const account of [input.from,input.to])if(account){this.ensureAccount(input.kind,input.unit,account);before.set(account,input.kind==='RESOURCE'&&input.unit==='COGNITION_CREDIT'?this.cognitionCapacity(account):this.balance(input.kind,input.unit,account).total);}
    if(input.from){const balance=this.balance(input.kind,input.unit,input.from);if(balance.available<input.amount)throw new Error('Insufficient available balance (reserved value cannot be transferred)');this.db.prepare('UPDATE value_accounts SET total=? WHERE kind=? AND unit=? AND account=?').run(difference(balance.total,input.amount),input.kind,input.unit,input.from);}
    if(input.to){const balance=this.balance(input.kind,input.unit,input.to);this.db.prepare('UPDATE value_accounts SET total=? WHERE kind=? AND unit=? AND account=?').run(checkedSum(balance.total,input.amount),input.kind,input.unit,input.to);}
    const id=randomUUID();this.db.prepare('INSERT INTO value_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.kind,input.unit,input.amount,input.from,input.to,input.category,input.initiator,this.repo.getWorld()!.currentTick,new Date().toISOString(),input.key,fingerprint,input.reference??null,input.relatedAgent??null,input.artifact??null,input.proposal??null);
    if(input.kind==='RESOURCE'&&input.unit==='COGNITION_CREDIT')for(const [account,total] of before)if(account!==skipDormancyAccount)this.dormancy(account,total,this.cognitionCapacity(account));
    return id;
  }
  injectResource(input:{resource:ResourceType;amount:number;to:string;source:string;key:string;reference?:string}):string {
    this.requireModel();integer(input.amount,true);if(!['OWNER_RESOURCE_INJECTION','PROVIDER_FREE_ALLOWANCE','PURCHASE_SETTLEMENT','REFUND'].includes(input.source))throw new Error('Unsupported authoritative capacity source');
    return this.atomic(()=>{const id=this.move({kind:'RESOURCE',unit:input.resource,amount:input.amount,from:null,to:input.to,category:input.source,initiator:OWNER_ID,key:input.key,...(input.reference?{reference:input.reference}:{})});if(this.db.prepare('SELECT id FROM events WHERE type=\'RESOURCE_INJECTED\' AND json_extract(payload,\'$.transactionId\')=?').get(id)===undefined)this.repo.addEvent('RESOURCE_INJECTED',this.repo.getWorld()!.currentTick,OWNER_ID,input.to.startsWith('AGENT:')?input.to.slice(6):null,{transactionId:id,resource:input.resource,amount:input.amount,source:input.source});return id;});
  }
  recordCapital(input:{currency:string;amount:number;to:string;key:string;reference?:string;relatedAgent?:string;artifact?:string},revenue=false):string {
    this.requireModel();integer(input.amount,true);if(revenue&&!input.reference)throw new Error('Verified revenue requires an external source/reference');
    if(input.relatedAgent&&!this.repo.getAgent(input.relatedAgent))throw new Error('Related agent not found');
    return this.atomic(()=>{const category=revenue?'EXTERNAL_REVENUE_RECORDED':'CAPITAL_INJECTED',id=this.move({kind:'CAPITAL',unit:input.currency,amount:input.amount,from:null,to:input.to,category,initiator:OWNER_ID,key:input.key,...(input.reference?{reference:input.reference}:{}),...(input.relatedAgent?{relatedAgent:input.relatedAgent}:{}),...(input.artifact?{artifact:input.artifact}:{})});if(!this.db.prepare('SELECT id FROM events WHERE type=? AND json_extract(payload,\'$.transactionId\')=?').get(category,id))this.repo.addEvent(category,this.repo.getWorld()!.currentTick,OWNER_ID,input.to.startsWith('AGENT:')?input.to.slice(6):null,{transactionId:id,currency:input.currency,amount:input.amount});return id;});
  }
  transfer(kind:ValueKind,unit:string,amount:number,from:string,to:string,key:string,actor=OWNER_ID):string {
    this.requireModel();integer(amount,true);if(actor!==OWNER_ID&&from!==`AGENT:${actor}`)throw new Error('Only the owner of this account can transfer its value');
    return this.atomic(()=>{const category=kind==='RESOURCE'?'RESOURCE_TRANSFERRED':'CAPITAL_TRANSFERRED',id=this.move({kind,unit,amount,from,to,category,initiator:actor,key});if(!this.db.prepare('SELECT id FROM events WHERE type=? AND json_extract(payload,\'$.transactionId\')=?').get(category,id))this.repo.addEvent(category,this.repo.getWorld()!.currentTick,actor,to.startsWith('AGENT:')?to.slice(6):null,{transactionId:id,unit,amount,from,to});return id;});
  }
  compensate(transactionId:string,key:string,reference:string):string {
    this.requireModel();safeText(reference);if(!reference)throw new Error('Compensation requires a factual reference');
    return this.atomic(()=>{const entry=this.db.prepare('SELECT * FROM value_ledger WHERE id=?').get(transactionId) as {kind:ValueKind;unit:string;amount:number;from_account:string|null;to_account:string|null;category:string}|undefined;if(!entry)throw new Error('Original ledger transaction not found');if(entry.category==='COMPENSATION')throw new Error('Compensate the original transaction, not a compensation');return this.move({kind:entry.kind,unit:entry.unit,amount:entry.amount,from:entry.to_account,to:entry.from_account,category:'COMPENSATION',initiator:OWNER_ID,key,reference,artifact:transactionId});});
  }
  reservation(id:string){return this.db.prepare('SELECT * FROM value_reservations WHERE id=?').get(id) as {id:string;kind:ValueKind;unit:string;account:string;amount:number;purpose:string;status:'RESERVED'|'RELEASED'|'CONSUMED';created_at:string;resolved_at:string|null}|undefined;}
  reserve(id:string,kind:ValueKind,unit:string,account:string,amount:number,purpose:string):void {
    this.requireModel();integer(amount);safeText(id,200);safeText(purpose,80);
    this.atomic(()=>{const old=this.reservation(id);if(old){if(old.kind!==kind||old.unit!==unit||old.account!==account||old.amount!==amount||old.purpose!==purpose)throw new Error('Reservation identity conflict');return;}
      this.ensureAccount(kind,unit,account);const cognitive=kind==='RESOURCE'&&unit==='COGNITION_CREDIT',before=cognitive?this.cognitionCapacity(account):0,balance=this.balance(kind,unit,account);if(balance.available<amount)throw new InsufficientReservationBalanceError(kind,unit,amount,balance.available);
      this.db.prepare('UPDATE value_accounts SET reserved=? WHERE kind=? AND unit=? AND account=?').run(checkedSum(balance.reserved,amount),kind,unit,account);
      this.db.prepare("INSERT INTO value_reservations VALUES(?,?,?,?,?,?,'RESERVED',?,NULL)").run(id,kind,unit,account,amount,purpose,new Date().toISOString());this.journalReservation(id,'RESERVED',amount);
      if(cognitive)this.dormancy(account,before,this.cognitionCapacity(account));
    });
  }
  private journalReservation(id:string,transition:string,amount:number):void {const r=this.reservation(id)!;this.db.prepare('INSERT INTO reservation_journal(reservation_id,transition,amount,kind,unit,account,purpose,tick,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,transition,amount,r.kind,r.unit,r.account,r.purpose,this.repo.getWorld()!.currentTick,new Date().toISOString());}
  resolveReservation(id:string,consume:number|null=null,to:string|null=null):void {
    this.requireModel();this.atomic(()=>{const r=this.reservation(id);if(!r)throw new Error('Reservation not found');const status=consume===null?'RELEASED':'CONSUMED';if(r.status!=='RESERVED'){if(r.status!==status)throw new Error('Reservation already resolved differently');if(consume!==null){const ledger=this.db.prepare('SELECT amount,to_account FROM value_ledger WHERE idempotency_key=?').get(`reservation:${id}`) as {amount:number;to_account:string|null}|undefined;if(!ledger||ledger.amount!==consume||ledger.to_account!==to)throw new Error('Reservation consumption retry conflicts');}return;}if(consume!==null){integer(consume);if(consume>r.amount)throw new Error('Consumption exceeds reservation');}
      const cognitive=r.kind==='RESOURCE'&&r.unit==='COGNITION_CREDIT',before=cognitive?this.cognitionCapacity(r.account):0,balance=this.balance(r.kind,r.unit,r.account);this.db.prepare('UPDATE value_accounts SET reserved=? WHERE kind=? AND unit=? AND account=?').run(difference(balance.reserved,r.amount),r.kind,r.unit,r.account);
      if(consume!==null)this.move({kind:r.kind,unit:r.unit,amount:consume,from:r.account,to,category:r.purpose==='COGNITION'?'COGNITION_CONSUMED':r.purpose==='EXECUTION'?'LOCAL_EXECUTION_CONSUMED':'RESERVATION_SETTLED',initiator:r.account,key:`reservation:${id}`,...(r.purpose==='DESCENDANT'?{proposal:id.split(':')[1]!}:{})},r.account);
      this.db.prepare('UPDATE value_reservations SET status=?,resolved_at=? WHERE id=?').run(status,new Date().toISOString(),id);this.journalReservation(id,status,consume??0);
      if(cognitive)this.dormancy(r.account,before,this.cognitionCapacity(r.account));
    });
  }
  request(agentId:string,input:{resource:ResourceType;amount:number;fundingAccount?:string|undefined;currency?:string|undefined;maxSpend?:number|undefined;reason:string}):PurchaseRequest {
    this.requireModel();integer(input.amount,true);safeText(input.reason);this.validateUnit('RESOURCE',input.resource);
    const funding=input.fundingAccount??`AGENT:${agentId}`;if(funding!==`AGENT:${agentId}`)throw new Error('Purchase requests can only use your own capital account');this.validateAccount('CAPITAL',funding);
    if((input.currency===undefined)!==(input.maxSpend===undefined))throw new Error('Specify both currency and maximum spend, or neither');if(input.currency)currencyCode(input.currency);if(input.maxSpend!==undefined)integer(input.maxSpend);
    return this.atomic(()=>{const id=randomUUID();this.db.prepare("INSERT INTO resource_purchase_requests VALUES(?,?,?,?,?,?,?,?,'PENDING',?,?,NULL)").run(id,agentId,input.resource,input.amount,funding,input.currency??null,input.maxSpend??null,input.reason,this.repo.getWorld()!.currentTick,new Date().toISOString());this.repo.addEvent('RESOURCE_PURCHASE_REQUESTED',this.repo.getWorld()!.currentTick,agentId,null,{requestId:id,resource:input.resource,amount:input.amount});return this.getRequest(id);});
  }
  requests():PurchaseRequest[] {this.requireModel();return this.db.prepare('SELECT * FROM resource_purchase_requests ORDER BY created_at').all() as PurchaseRequest[];}
  getRequest(id:string):PurchaseRequest {this.requireModel();const r=this.db.prepare('SELECT * FROM resource_purchase_requests WHERE id=?').get(id) as PurchaseRequest|undefined;if(!r)throw new Error('Resource request not found');return r;}
  /** Private requester facts; deliberately separate from self(), which also feeds public presence. */
  pendingRequests(agentId:string,limit?:number):PurchaseRequestSummary[] {
    this.requireModel();if(limit!==undefined)integer(limit,true);
    return (this.db.prepare("SELECT * FROM resource_purchase_requests WHERE agent_id=? AND status='PENDING' ORDER BY created_tick,created_at,id LIMIT ?").all(agentId,limit??-1) as PurchaseRequest[]).map(summarizeRequest);
  }
  pendingRequestCount(agentId:string):number {
    this.requireModel();return (this.db.prepare("SELECT count(*) n FROM resource_purchase_requests WHERE agent_id=? AND status='PENDING'").get(agentId) as {n:number}).n;
  }
  cancelRequest(agentId:string,id:string,tick:number):PurchaseRequestSummary {
    this.requireModel();return this.atomic(()=>{
      // Query by actor as well as ID: a foreign request and a missing request have the same error.
      const agent=this.repo.getAgent(agentId),r=this.db.prepare('SELECT * FROM resource_purchase_requests WHERE id=? AND agent_id=?').get(id,agentId) as PurchaseRequest|undefined;
      if(!agent||agent.id!==agentId||!r)throw new Error('Resource purchase request not found or not authorized');
      if(r.status!=='PENDING')throw new Error('Only PENDING resource purchase requests can be cancelled');
      this.db.prepare("UPDATE resource_purchase_requests SET status='CANCELLED' WHERE id=? AND agent_id=? AND status='PENDING'").run(id,agentId);
      this.repo.addEvent('RESOURCE_PURCHASE_REQUEST_CANCELLED',tick,agentId,null,{requestId:id,agentId,resource:r.resource,amount:r.amount,createdTick:r.created_tick,withdrawnTick:tick});
      return {...summarizeRequest(r),status:'CANCELLED'};
    });
  }
  decideRequest(id:string,approve:boolean):PurchaseRequest {
    this.requireModel();return this.atomic(()=>{const r=this.getRequest(id),status=approve?'APPROVED':'DENIED';if(r.status===status)return r;if(r.status!=='PENDING'&&!(r.status==='APPROVED'&&!approve))throw new Error('Request cannot be decided in its current state');
      if(approve&&r.currency)this.reserve(`purchase:${id}`,'CAPITAL',r.currency,r.funding_account,r.max_spend!,'PURCHASE');if(!approve&&r.status==='APPROVED'&&r.currency)this.resolveReservation(`purchase:${id}`);
      this.db.prepare('UPDATE resource_purchase_requests SET status=? WHERE id=?').run(status,id);this.repo.addEvent(approve?'RESOURCE_PURCHASE_APPROVED':'RESOURCE_PURCHASE_DENIED',this.repo.getWorld()!.currentTick,OWNER_ID,r.agent_id,{requestId:id});return this.getRequest(id);});
  }
  settleRequest(id:string,input:{cost:number;amount:number;key:string;reference:string}):PurchaseRequest {
    this.requireModel();integer(input.cost);integer(input.amount,true);safeText(input.reference);if(!input.reference)throw new Error('External settlement reference is required');safeText(input.key,180);
    return this.atomic(()=>{const r=this.getRequest(id);if(r.status!=='APPROVED'&&r.status!=='SETTLED')throw new Error('Approve the request before settlement');if(input.amount>r.amount)throw new Error('Settlement exceeds requested resource amount');if(input.cost>0&&(!r.currency||input.cost>r.max_spend!))throw new Error('Settlement exceeds authorized capital');
      if(r.status==='SETTLED'){
        const existing=this.db.prepare('SELECT * FROM value_ledger WHERE id=?').get(r.settlement_id) as {idempotency_key:string;amount:number;reference:string};
        const debit=this.db.prepare('SELECT amount FROM value_ledger WHERE idempotency_key=?').get(`purchase:${input.key}:capital`) as {amount:number}|undefined;
        if(existing.idempotency_key!==`purchase:${input.key}:resource`||existing.amount!==input.amount||existing.reference!==input.reference||(debit?.amount??0)!==input.cost)throw new Error('Settlement retry conflicts with settled request');return r;
      }
      if(r.currency){this.resolveReservation(`purchase:${id}`);this.move({kind:'CAPITAL',unit:r.currency,amount:input.cost,from:r.funding_account,to:null,category:'PURCHASE_SETTLEMENT',initiator:OWNER_ID,key:`purchase:${input.key}:capital`,reference:input.reference,artifact:id});}
      const transactionId=this.move({kind:'RESOURCE',unit:r.resource,amount:input.amount,from:null,to:`AGENT:${r.agent_id}`,category:'PURCHASE_SETTLEMENT',initiator:OWNER_ID,key:`purchase:${input.key}:resource`,reference:input.reference,artifact:id});
      this.db.prepare("UPDATE resource_purchase_requests SET status='SETTLED',settlement_id=? WHERE id=?").run(transactionId,id);this.repo.addEvent('RESOURCE_PURCHASE_SETTLED',this.repo.getWorld()!.currentTick,OWNER_ID,r.agent_id,{requestId:id,transactionId,resource:r.resource,amount:input.amount,currency:r.currency,costMinorUnits:input.cost});return this.getRequest(id);
    });
  }
  migrationPreview(){
    return {resourceModelVersion:this.version(),migrationRequired:this.version()!==2,tick:this.repo.getWorld()?.currentTick,status:this.repo.getWorld()?.status,agents:this.repo.listAgents().map(a=>({id:a.id,name:a.name,legacyCompute:a.computeCredits,localCompute:a.computeCredits,cognitionCredits:0,storageBytes:a.storageBytes,sleepingUntilTick:a.sleepingUntilTick,capital:{}})),worldReserve:{COGNITION_CREDIT:0,LOCAL_COMPUTE:0},worldTreasury:{},legacyDescendantEscrow:this.repo.listDescendantProposals().filter(p=>this.repo.getComputeReservation(p.id)?.status==='RESERVED').map(p=>({proposalId:p.id,agentId:p.proposerAgentId,localCompute:p.proposerComputeContribution,cognitionCredits:0}))};
  }
  migrateLegacy():{applied:boolean;version:number} {
    return this.atomic(()=>{if(this.version()===2)return{applied:false,version:2};const world=this.repo.getWorld();if(!world||world.status!=='paused')throw new Error('Migration requires a paused world');if(this.db.prepare('SELECT 1 FROM runner_lease').get())throw new Error('Migration requires no runner lease');if(this.repo.tickSchedule())throw new Error('Migration requires no pending scheduler');if(this.repo.databaseIntegrity()!=='ok'||(this.db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Migration requires SQLite integrity');if(this.repo.incompleteFilesystemOperations().length)throw new Error('Migration requires reconciled filesystem operations');
      for(const agent of this.repo.listAgents()){integer(agent.computeCredits);integer(agent.storageBytes);}
      const legacyEscrow=this.repo.listDescendantProposals().filter(p=>this.repo.getComputeReservation(p.id)?.status==='RESERVED');
      for(const p of legacyEscrow){const r=this.repo.getComputeReservation(p.id)!;integer(r.amount);if(r.agentId!==p.proposerAgentId||r.amount!==p.proposerComputeContribution||p.status!=='PENDING')throw new Error('Legacy descendant escrow integrity failed');}
      this.schema();this.db.prepare('INSERT INTO resource_model VALUES(1,2,?)').run(new Date().toISOString());
      for(const unit of RESOURCE_TYPES)this.ensureAccount('RESOURCE',unit,'WORLD_RESERVE');
      for(const agent of this.repo.listAgents()){
        this.ensureAgent(agent.id);let amount=agent.computeCredits;
        for(const p of legacyEscrow)if(p.proposerAgentId===agent.id)amount=checkedSum(amount,integer(p.proposerComputeContribution));
        if(amount)this.move({kind:'RESOURCE',unit:'LOCAL_COMPUTE',amount,from:null,to:`AGENT:${agent.id}`,category:'MIGRATION',initiator:OWNER_ID,key:`migration:${agent.id}`});
      }
      for(const p of legacyEscrow)this.reserve(`descendant:${p.id}:proposer:LOCAL_COMPUTE`,'RESOURCE','LOCAL_COMPUTE',`AGENT:${p.proposerAgentId}`,p.proposerComputeContribution,'DESCENDANT');
      for(const op of this.repo.incompleteDescendantOperations())if(op.state==='PREPARED'||op.state==='FILESYSTEM_COMMITTED'){
        const p=this.repo.getDescendantProposal(op.proposalId)!;
        this.reserve(`descendant:${p.id}:acceptor:LOCAL_COMPUTE`,'RESOURCE','LOCAL_COMPUTE',`AGENT:${p.coParentAgentId}`,op.acceptorContribution,'DESCENDANT');
      }
      const failures=this.integrity();if(failures.length)throw new Error(`Resource migration integrity failed: ${failures.join('; ')}`);
      this.repo.addEvent('RESOURCE_MODEL_MIGRATED',world.currentTick,OWNER_ID,null,{version:2,legacyComputeToLocalCompute:'1:1',cognitionCreated:0,capitalCreated:0});return{applied:true,version:2};
    });
  }
  integrity():string[] {
    if(this.version()!==2)return ['Resource model v1: explicit migration required'];
    const failures:string[]=[],accounts=this.db.prepare('SELECT * FROM value_accounts').all() as {kind:ValueKind;unit:string;account:string;total:number;reserved:number}[];
    for(const a of accounts){try{integer(a.total);integer(a.reserved);this.validateAccount(a.kind,a.account);this.validateUnit(a.kind,a.unit);if(a.reserved>a.total)throw new Error('Reserved balance exceeds total');}catch{failures.push(`Invalid balance ${a.account}/${a.unit}`);continue;}
      const rows=this.db.prepare('SELECT amount,from_account,to_account FROM value_ledger WHERE kind=? AND unit=?').all(a.kind,a.unit) as {amount:number;from_account:string|null;to_account:string|null}[];
      if(rows.some(r=>!Number.isSafeInteger(r.amount)||r.amount<0)){failures.push(`Invalid ledger integer ${a.unit}`);continue;}
      const total=rows.reduce((sum,r)=>sum+(r.to_account===a.account?BigInt(r.amount):0n)-(r.from_account===a.account?BigInt(r.amount):0n),0n);
      const reservations=this.db.prepare("SELECT amount FROM value_reservations WHERE kind=? AND unit=? AND account=? AND status='RESERVED'").all(a.kind,a.unit,a.account) as {amount:number}[];
      if(total!==BigInt(a.total))failures.push(`Ledger mismatch ${a.account}/${a.unit}`);
      if(reservations.some(r=>!Number.isSafeInteger(r.amount)||r.amount<0)||reservations.reduce((sum,r)=>sum+BigInt(r.amount),0n)!==BigInt(a.reserved))failures.push(`Reservation mismatch ${a.account}/${a.unit}`);
    }
    for(const agent of this.repo.listAgents())for(const unit of RESOURCE_TYPES)if(!accounts.some(a=>a.account===`AGENT:${agent.id}`&&a.unit===unit&&a.kind==='RESOURCE'))failures.push(`Missing agent resource account ${agent.id}/${unit}`);
    for(const row of this.db.prepare('SELECT * FROM value_reservations').all() as {id:string;kind:string;unit:string;account:string;status:string;amount:number;purpose:string}[]){const transitions=this.db.prepare('SELECT * FROM reservation_journal WHERE reservation_id=? ORDER BY id').all(row.id) as {transition:string;amount:number;kind:string;unit:string;account:string;purpose:string}[];if(transitions[0]?.transition!=='RESERVED'||transitions[0]?.amount!==row.amount||transitions.length!==(row.status==='RESERVED'?1:2)||transitions.at(-1)?.transition!==row.status||transitions.some(t=>t.account!==row.account||t.kind!==row.kind||t.unit!==row.unit||t.purpose!==row.purpose))failures.push(`Reservation journal mismatch ${row.id}`);
      if(row.status==='CONSUMED'){const ledger=this.db.prepare('SELECT amount,from_account,unit,kind FROM value_ledger WHERE idempotency_key=?').get(`reservation:${row.id}`) as {amount:number;from_account:string;unit:string;kind:string}|undefined;if(!ledger||ledger.amount!==transitions.at(-1)?.amount||ledger.from_account!==row.account||ledger.kind!==row.kind||ledger.unit!==row.unit)failures.push(`Reservation consumption mismatch ${row.id}`);}
    }
    for(const entry of this.db.prepare('SELECT kind,unit,from_account,to_account FROM value_ledger').all() as {kind:ValueKind;unit:string;from_account:string|null;to_account:string|null}[])for(const account of [entry.from_account,entry.to_account])if(account&&!accounts.some(a=>a.kind===entry.kind&&a.unit===entry.unit&&a.account===account))failures.push(`Missing ledger account ${account}/${entry.unit}`);
    for(const op of this.db.prepare('SELECT id,agent_id,status FROM cognition_opportunities').all() as {id:string;agent_id:string;status:string}[]){const r=this.reservation(op.id),expected=op.status==='PENDING'?'RESERVED':op.status==='SUCCESS'?'CONSUMED':'RELEASED';if(!r||r.status!==expected||r.amount!==1||r.purpose!=='COGNITION'||r.account!==`AGENT:${op.agent_id}`)failures.push(`Cognition opportunity reservation mismatch ${op.id}`);}
    for(const request of this.requests()){
      try{integer(request.amount,true);this.validateUnit('RESOURCE',request.resource);this.validateAccount('CAPITAL',request.funding_account);if(request.funding_account!==`AGENT:${request.agent_id}`||!['PENDING','APPROVED','DENIED','SETTLED','CANCELLED'].includes(request.status))throw new Error('Invalid purchase ownership/status');if(request.currency){currencyCode(request.currency);integer(request.max_spend!);}else if(request.max_spend!==null)throw new Error('Currency/spend mismatch');}catch{failures.push(`Invalid purchase request ${request.id}`);}
      const creation=this.db.prepare("SELECT actor_id FROM events WHERE type='RESOURCE_PURCHASE_REQUESTED' AND json_extract(payload,'$.requestId')=? ORDER BY id LIMIT 1").get(request.id) as {actor_id:string}|undefined;
      if(creation&&creation.actor_id!==request.agent_id)failures.push(`Purchase request ownership changed ${request.id}`);
      const r=this.reservation(`purchase:${request.id}`);
      if(request.status==='APPROVED'&&request.currency&&(!r||r.status!=='RESERVED'||r.amount!==request.max_spend||r.account!==request.funding_account||r.unit!==request.currency))failures.push(`Purchase reservation mismatch ${request.id}`);
      if((request.status==='DENIED'||request.status==='SETTLED')&&r&&r.status==='RESERVED')failures.push(`Resolved purchase has an outstanding hold ${request.id}`);
      if(request.status==='SETTLED'){const entry=this.db.prepare('SELECT amount,unit,to_account,artifact FROM value_ledger WHERE id=?').get(request.settlement_id) as {amount:number;unit:string;to_account:string;artifact:string}|undefined;if(!entry||entry.amount<1||entry.amount>request.amount||entry.unit!==request.resource||entry.to_account!==`AGENT:${request.agent_id}`||entry.artifact!==request.id)failures.push(`Purchase settlement mismatch ${request.id}`);}
      const cancellations=this.db.prepare("SELECT actor_id,tick,payload FROM events WHERE type='RESOURCE_PURCHASE_REQUEST_CANCELLED' AND json_extract(payload,'$.requestId')=? ORDER BY id").all(request.id) as {actor_id:string;tick:number;payload:string}[];
      if(request.status==='CANCELLED'||cancellations.length){
        const event=cancellations[0],facts=event?JSON.parse(event.payload) as Record<string,unknown>:{};
        if(request.status!=='CANCELLED'||cancellations.length!==1||event?.actor_id!==request.agent_id||facts.agentId!==request.agent_id||facts.resource!==request.resource||facts.amount!==request.amount||facts.createdTick!==request.created_tick||facts.withdrawnTick!==event?.tick)failures.push(`Purchase cancellation lifecycle mismatch ${request.id}`);
        if(request.settlement_id!==null||r||this.db.prepare("SELECT 1 FROM value_ledger WHERE category='PURCHASE_SETTLEMENT' AND artifact=?").get(request.id))failures.push(`Cancelled purchase has economic effects ${request.id}`);
      }
    }
    for(const outcome of this.db.prepare('SELECT id FROM execution_outcomes').all() as {id:string}[]){const r=this.reservation(outcome.id);if(!r||r.kind!=='RESOURCE'||r.unit!=='LOCAL_COMPUTE'||r.purpose!=='EXECUTION'||r.status!=='CONSUMED')failures.push(`Execution outcome reservation mismatch ${outcome.id}`);}
    if(this.db.prepare('SELECT idempotency_key FROM value_ledger GROUP BY idempotency_key HAVING count(*)>1').get())failures.push('Duplicate ledger idempotency key');
    for(const trigger of ['immutable_value_ledger_update','immutable_value_ledger_delete','immutable_reservation_journal_update','immutable_reservation_journal_delete'])if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger))failures.push(`Missing immutable journal protection ${trigger}`);
    if((this.db.pragma('foreign_key_check') as unknown[]).length)failures.push('Foreign key integrity failed');
    return failures;
  }
  reconcileAbandonedExecutions(leaseToken:string):void {
    this.requireModel();if(this.repo.runnerLeaseState(leaseToken)!=='owned')throw new Error('Execution recovery requires exclusive runner ownership');
    for(const r of this.db.prepare("SELECT id,amount FROM value_reservations WHERE purpose='EXECUTION' AND status='RESERVED'").all() as {id:string;amount:number}[])this.resolveReservation(r.id,r.amount);
  }
  consumed(resource:ResourceType,afterEventTick=0):number {
    const rows=this.db.prepare("SELECT amount FROM value_ledger WHERE kind='RESOURCE' AND unit=? AND to_account IS NULL AND category IN ('COGNITION_CONSUMED','LOCAL_EXECUTION_CONSUMED') AND tick>=?").all(resource,afterEventTick) as {amount:number}[];
    return rows.reduce((sum,r)=>checkedSum(sum,r.amount),0);
  }
  total(resource:ResourceType):number {this.requireModel();return (this.db.prepare("SELECT total FROM value_accounts WHERE kind='RESOURCE' AND unit=?").all(resource) as {total:number}[]).reduce((sum,r)=>checkedSum(sum,r.total),0);}
}
