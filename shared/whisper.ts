export interface WhisperMessage { id:string;fromId:string;fromNickname:string;toId:string;toNickname:string;text:string;sentAt:number }
export const WHISPER_RULES={maxLength:160,cooldownMs:1000,receiptLimit:24} as const;
export function normalizeWhisper(value:unknown):string{
  if(typeof value!=='string')throw new Error('귓속말을 입력해 주세요.');
  const text=value.normalize('NFC').trim().replace(/[\r\n]+/g,' ');
  if(!text||[...text].length>WHISPER_RULES.maxLength||/[\p{C}<>]/u.test(text))throw new Error('귓속말은 1~160자로 입력해 주세요.');
  return text;
}
