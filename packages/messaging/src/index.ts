import nodemailer from 'nodemailer';
import type { OwnerOutboxRecord } from '../../shared/src/index.js';
import type { WorldRepository } from '../../persistence/src/repository.js';

export interface GatewayResult{delivered:boolean;externalId?:string;}
export interface OwnerGateway{readonly name:string;deliver(message:OwnerOutboxRecord):Promise<GatewayResult>;receiveIntoWorld?(message:{to:string;content:string;externalId:string}):Promise<{accepted:boolean}>;}
export class NullOwnerGateway implements OwnerGateway{readonly name='disabled';async deliver():Promise<GatewayResult>{return{delivered:false};}}
export class ConsoleOwnerGateway implements OwnerGateway{
  readonly name='console';constructor(private readonly write:(text:string)=>void=(text)=>console.log(text)){}
  async deliver(message:OwnerOutboxRecord):Promise<GatewayResult>{this.write(`AutomaticWorld — Message from ${message.agentName}\n\nWorld tick: ${message.tick}\nAgent: ${message.agentName}\n\n${message.content}`);return{delivered:true,externalId:`console:${message.id}`};}
}

export interface MailTransport{sendMail(options:{from:string;to:string;subject:string;text:string;headers:Record<string,string>}):Promise<{messageId?:string}>;}
export interface EmailGatewayConfig{worldAddress:string;ownerDestination:string;transport:MailTransport;}
export class EmailOwnerGateway implements OwnerGateway{
  readonly name='email';constructor(private readonly config:EmailGatewayConfig){}
  async deliver(message:OwnerOutboxRecord):Promise<GatewayResult>{try{const result=await this.config.transport.sendMail({from:`AutomaticWorld <${this.config.worldAddress}>`,to:this.config.ownerDestination,subject:`AutomaticWorld — Message from ${message.agentName}`,text:`World tick: ${message.tick}\nAgent: ${message.agentName}\n\n${message.content}`,headers:{'X-AutomaticWorld-Message-ID':message.id}});return{delivered:true,...(result.messageId?{externalId:result.messageId}:{})};}catch{throw new Error('Email delivery failed');}}
}

export interface LineGatewayConfig{channelAccessToken:string;ownerDestinationId:string;endpoint?:string;fetcher?:typeof fetch;}
export class LineOwnerGateway implements OwnerGateway{
  readonly name='line';private readonly endpoint:string;private readonly fetcher:typeof fetch;
  constructor(private readonly config:LineGatewayConfig){this.endpoint=config.endpoint??'https://api.line.me/v2/bot/message/push';this.fetcher=config.fetcher??fetch;}
  async deliver(message:OwnerOutboxRecord):Promise<GatewayResult>{const text=`AutomaticWorld — Message from ${message.agentName}\nWorld tick: ${message.tick}\n\n${message.content}`;if(text.length>5_000)throw new Error('LINE text message exceeds 5000 characters');const response=await this.fetcher(this.endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.config.channelAccessToken}`,'Content-Type':'application/json','X-Line-Retry-Key':message.id},body:JSON.stringify({to:this.config.ownerDestinationId,messages:[{type:'text',text}]})});if(!response.ok){const detail=(await response.text()).slice(0,1_000);throw new Error(`LINE delivery failed (${response.status}): ${detail}`);}return{delivered:true,externalId:response.headers.get('x-line-request-id')??message.id};}
}

export class OwnerGatewayDispatcher{
  constructor(private readonly repo:WorldRepository,private readonly gateways:OwnerGateway[]){}
  async dispatch(limit=20):Promise<{delivered:number;failed:number}>{let delivered=0,failed=0;for(const message of this.repo.dispatchableOutbox(limit)){let failure:string|null=null;if(this.gateways.length===0)failure='No Owner gateway configured';for(const gateway of this.gateways){if(this.repo.gatewayDelivered(message.id,gateway.name))continue;try{const result=await gateway.deliver(message);if(!result.delivered)throw new Error(`${gateway.name} did not accept delivery`);this.repo.recordGatewayDelivery(message.id,gateway.name,'delivered',null,result.externalId??null);}catch(error){const detail=error instanceof Error?error.message:'Delivery failed';this.repo.recordGatewayDelivery(message.id,gateway.name,'failed',detail,null);failure=failure??detail;}}if(failure){this.repo.updateOutbox(message.id,'failed',failure);this.repo.addEvent('OWNER_MESSAGE_DELIVERY_FAILED',message.tick,message.agentId,null,{outboxId:message.id,error:failure});failed++;}else{this.repo.updateOutbox(message.id,'delivered',null);this.repo.addEvent('OWNER_MESSAGE_DELIVERED',message.tick,message.agentId,null,{outboxId:message.id,gateways:this.gateways.map((g)=>g.name)});delivered++;}}return{delivered,failed};}
}

export interface WorldSmtpOptions{host:string;port:number;secure:boolean;auth:{user:string;pass:string};}
export type MailTransportFactory=(options:WorldSmtpOptions)=>MailTransport;
const nodemailerTransport:MailTransportFactory=(options)=>nodemailer.createTransport(options);
export function configuredOwnerGateways(env:NodeJS.ProcessEnv=process.env,createMailTransport:MailTransportFactory=nodemailerTransport):OwnerGateway[]{
  const gateways:OwnerGateway[]=[];if(env.OWNER_CONSOLE_GATEWAY==='true')gateways.push(new ConsoleOwnerGateway());
  if(env.WORLD_SMTP_HOST&&env.WORLD_EMAIL_ADDRESS&&env.WORLD_EMAIL_APP_PASSWORD&&env.OWNER_EMAIL_DESTINATION){const transport=createMailTransport({host:env.WORLD_SMTP_HOST,port:Number(env.WORLD_SMTP_PORT??587),secure:env.WORLD_SMTP_SECURE==='true',auth:{user:env.WORLD_EMAIL_ADDRESS,pass:env.WORLD_EMAIL_APP_PASSWORD}});gateways.push(new EmailOwnerGateway({worldAddress:env.WORLD_EMAIL_ADDRESS,ownerDestination:env.OWNER_EMAIL_DESTINATION,transport}));}
  if(env.LINE_CHANNEL_ACCESS_TOKEN&&env.LINE_OWNER_DESTINATION_ID)gateways.push(new LineOwnerGateway({channelAccessToken:env.LINE_CHANNEL_ACCESS_TOKEN,ownerDestinationId:env.LINE_OWNER_DESTINATION_ID}));return gateways;
}
