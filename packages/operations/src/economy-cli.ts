import type { WorldRepository } from '../../persistence/src/repository.js';
import { integer, type ResourceType } from '../../resources/src/economy.js';

export function economyCli(repo:WorldRepository,args:string[]):unknown {
  const [group,command='status']=args,economy=repo.economy;
  const option=(name:string,required=true)=>{const indexes=args.flatMap((value,i)=>value===name?[i]:[]);if(indexes.length>1)throw new Error(`${name} can only occur once`);const value=indexes.length?args[indexes[0]!+1]:undefined;if(value?.startsWith('--')||required&&!value)throw new Error(`${name} is required`);return value;};
  const amount=(name:string)=>integer(Number(option(name)));
  const account=(name:string)=>{const value=option(name)!;if(value==='WORLD_RESERVE'||value==='WORLD_TREASURY'||value.startsWith('AGENT:'))return value;const agent=repo.getAgent(value);if(!agent)throw new Error('Account or inhabitant not found');return `AGENT:${agent.id}`;};
  const reference=()=>option('--reference',false);
  if(group==='resources'&&command==='migration-status')return {resourceModelVersion:economy.version(),migrationRequired:economy.version()!==2};
  if(group==='resources'&&command==='migrate-legacy'){
    if(args.includes('--preview')===args.includes('--apply'))throw new Error('Specify exactly one of --preview or --apply');
    return args.includes('--preview')?economy.migrationPreview():economy.migrateLegacy();
  }
  economy.requireModel();const kind=group==='economy'?'CAPITAL':'RESOURCE';
  if(command==='status')return {resourceModelVersion:2,accounts:economy.accounts(kind),integrity:economy.integrity(),...(kind==='CAPITAL'?{worldTreasury:economy.capital('WORLD_TREASURY')}:{})};
  if(command==='ledger')return economy.ledger(kind);
  if(command==='compensate')return {transactionId:economy.compensate(option('--transaction')!,option('--key')!,option('--reference')!)};
  if(group==='economy'&&(command==='invest'||command==='record-revenue')){
    const ref=reference(),memo=option('--memo',false);if(ref&&memo)throw new Error('Use either --memo or --reference');
    const relatedAgent=option('--agent',false),artifact=option('--artifact',false);
    return {transactionId:economy.recordCapital({currency:option('--currency')!,amount:amount('--amount'),to:account('--to'),key:option('--key')!,...((ref??memo)?{reference:(ref??memo)!}:{}),...(relatedAgent?{relatedAgent:repo.getAgent(relatedAgent)?.id??relatedAgent}:{}),...(artifact?{artifact}:{})},command==='record-revenue')};
  }
  if(group==='resources'&&command==='inject'){const ref=reference();return {transactionId:economy.injectResource({resource:option('--resource')! as ResourceType,amount:amount('--amount'),to:account('--to'),source:(option('--source',false)??'OWNER_RESOURCE_INJECTION').toUpperCase(),key:option('--key')!,...(ref?{reference:ref}:{})})};}
  if(command==='transfer')return {transactionId:economy.transfer(kind,option(kind==='CAPITAL'?'--currency':'--resource')!,amount('--amount'),account('--from'),account('--to'),option('--key')!)};
  if(group==='resources'&&command==='requests')return economy.requests().filter(r=>args.includes('--all')||r.status==='PENDING'||r.status==='APPROVED');
  if(group==='resources'&&command==='request'){
    const action=args[2],id=args[3];if(!id)throw new Error('Usage: resources request show|approve|deny|settle <request-id>');
    if(action==='show')return economy.getRequest(id);
    if(action==='approve'||action==='deny')return economy.decideRequest(id,action==='approve');
    if(action==='settle')return economy.settleRequest(id,{amount:amount('--amount'),cost:amount('--cost'),key:option('--key')!,reference:option('--reference')!});
  }
  throw new Error('Unknown economy/resources command. See docs/RESOURCES-ECONOMY.md');
}

export function isReadOnlyEconomyCommand(args:string[]):boolean {
  const [,command='status']=args;
  return ['status','ledger','migration-status','requests'].includes(command)||command==='migrate-legacy'&&args.includes('--preview')||command==='request'&&args[2]==='show';
}
