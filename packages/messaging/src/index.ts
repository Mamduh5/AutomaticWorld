export interface OwnerGateway { sendFromWorld(message:{content:string}):Promise<{accepted:boolean}>; receiveIntoWorld(message:{to:string;content:string}):Promise<{accepted:boolean}>; }
export class NullOwnerGateway implements OwnerGateway { async sendFromWorld():Promise<{accepted:boolean}>{return {accepted:false};} async receiveIntoWorld():Promise<{accepted:boolean}>{return {accepted:false};} }
